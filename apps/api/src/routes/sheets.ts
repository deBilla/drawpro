import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router({ mergeParams: true });

const createSchema = z.object({
  name: z.string().min(1).max(200),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  elements: z.array(z.unknown()).optional(),
  appState: z.record(z.unknown()).optional(),
});

async function checkAccess(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

/**
 * Encrypt `plaintext` using ECIES:
 *   - ephemeral X25519 key pair (server-generated, discarded after use)
 *   - ECDH(ephemeral_private, user_public) → shared secret
 *   - HKDF-SHA512(shared_secret) → AES-256-GCM key
 *   - AES-256-GCM encrypt → {ciphertext, iv, authTag, ephemeralPublicKey}
 */
function encryptForUser(
  plaintext: string,
  userPublicKeyB64: string,
): {
  ciphertext: string;
  iv: string;
  authTag: string;
  ephemeralPublicKey: string;
} {
  const userPublicKey = crypto.createPublicKey({
    key: Buffer.from(userPublicKeyB64, 'base64'),
    format: 'der',
    type: 'spki',
  });

  const ephemeral = crypto.generateKeyPairSync('x25519');

  const sharedSecret = crypto.diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: userPublicKey,
  });

  const aesKey = Buffer.from(
    crypto.hkdfSync('sha512', sharedSecret, Buffer.alloc(0), 'drawpro-sheet-encryption', 32),
  );

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const ephemeralPublicKeyDer = ephemeral.publicKey.export({ type: 'spki', format: 'der' });

  aesKey.fill(0);

  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ephemeralPublicKey: Buffer.from(ephemeralPublicKeyDer).toString('base64'),
  };
}

// GET /workspaces/:workspaceId/sheets
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const member = await checkAccess(req.params.workspaceId, req.userId!);
    if (!member) return res.status(403).json({ error: 'Not authorized' });

    const sheets = await prisma.sheet.findMany({
      where: { workspaceId: req.params.workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        ciphertext: true, // used only to compute isEncrypted — not sent to client
      },
    });

    return res.json({
      data: sheets.map(({ ciphertext, ...s }) => ({
        ...s,
        isEncrypted: ciphertext !== null,
      })),
    });
  } catch (err) {
    console.error('[sheets/list]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /workspaces/:workspaceId/sheets
router.post('/', requireAuth, validate(createSchema), async (req: AuthRequest, res) => {
  try {
    const member = await checkAccess(req.params.workspaceId, req.userId!);
    if (!member || member.role === 'viewer') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const sheet = await prisma.sheet.create({
      data: { workspaceId: req.params.workspaceId, name: req.body.name },
    });
    return res.status(201).json({ data: { ...sheet, isEncrypted: false } });
  } catch (err) {
    console.error('[sheets/create]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /workspaces/:workspaceId/sheets/:id
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const member = await checkAccess(req.params.workspaceId, req.userId!);
    if (!member) return res.status(403).json({ error: 'Not authorized' });

    const sheet = await prisma.sheet.findFirst({
      where: { id: req.params.id, workspaceId: req.params.workspaceId },
    });
    if (!sheet) return res.status(404).json({ error: 'Sheet not found' });

    return res.json({ data: { ...sheet, isEncrypted: sheet.ciphertext !== null } });
  } catch (err) {
    console.error('[sheets/get]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /workspaces/:workspaceId/sheets/:id
// Receives plaintext {name?, elements?, appState?}.
// If the owner has encryption keys, encrypts name + elements + appState together.
router.put('/:id', requireAuth, validate(updateSchema), async (req: AuthRequest, res) => {
  try {
    const member = await checkAccess(req.params.workspaceId, req.userId!);
    if (!member || member.role === 'viewer') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const sheet = await prisma.sheet.findFirst({
      where: { id: req.params.id, workspaceId: req.params.workspaceId },
    });
    if (!sheet) return res.status(404).json({ error: 'Sheet not found' });

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { publicKey: true },
    });

    const hasName = req.body.name !== undefined;
    const hasElements = req.body.elements !== undefined;
    const hasAppState = req.body.appState !== undefined;
    const hasContent = hasElements || hasAppState;
    const hasEncryptionKeys = !!user?.publicKey;

    let encryptedFields: {
      ciphertext: string;
      iv: string;
      authTag: string;
      ephemeralPublicKey: string;
      name: string;
      elements: null;
      appState: null;
    } | null = null;

    if (hasEncryptionKeys && (hasContent || hasName)) {
      // Always encrypt name + elements + appState together so no field leaks individually.
      // Merge incoming values with stored values (plaintext or previously set during creation).
      const name = hasName ? req.body.name : (sheet.name === '[encrypted]' ? '' : sheet.name);
      const elements = hasElements ? req.body.elements : (sheet.elements ?? []);
      const appState = hasAppState ? req.body.appState : (sheet.appState ?? {});

      const plaintext = JSON.stringify({ name, elements, appState });
      const encrypted = encryptForUser(plaintext, user!.publicKey!);

      encryptedFields = {
        ...encrypted,
        name: '[encrypted]', // sentinel stored in DB — real name is inside ciphertext
        elements: null,
        appState: null,
      };
    }

    const updated = await prisma.sheet.update({
      where: { id: req.params.id },
      data: {
        // Encrypted path: name/elements/appState all go into ciphertext
        ...(encryptedFields !== null && encryptedFields),
        // Plaintext path: store fields directly
        ...(encryptedFields === null && hasName && { name: req.body.name }),
        ...(encryptedFields === null && hasElements && { elements: req.body.elements }),
        ...(encryptedFields === null && hasAppState && { appState: req.body.appState }),
        version: { increment: 1 },
      },
    });

    return res.json({ data: { ...updated, isEncrypted: updated.ciphertext !== null } });
  } catch (err) {
    console.error('[sheets/update]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /workspaces/:workspaceId/sheets/:id
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const member = await checkAccess(req.params.workspaceId, req.userId!);
    if (!member || member.role === 'viewer') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await prisma.sheet.deleteMany({
      where: { id: req.params.id, workspaceId: req.params.workspaceId },
    });
    return res.json({ data: { message: 'Sheet deleted' } });
  } catch (err) {
    console.error('[sheets/delete]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
