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
 * Encrypt `plaintext` using ECIES (okara-crypto compatible):
 *   - ephemeral X25519 key pair (webcrypto, raw 32-byte export)
 *   - ECDH → HKDF-SHA512('drawpro-e2ee-salt','drawpro-e2ee-key') → AES-256-GCM key
 *   - AES-256-GCM with AAD='drawpro-e2ee-message', 16-byte IV
 *   - Returns base64( eph_pub(32) | iv(16) | authTag(16) | ciphertext )
 */
async function encryptForUser(plaintext: string, userPublicKeyB64: string): Promise<string> {
  const { webcrypto } = crypto;

  const ephemeralKeyPair = await webcrypto.subtle.generateKey(
    { name: 'X25519' } as EcKeyGenParams,
    true,
    ['deriveBits'],
  );

  const userPublicKey = await webcrypto.subtle.importKey(
    'raw',
    Buffer.from(userPublicKeyB64, 'base64'),
    { name: 'X25519' } as EcKeyImportParams,
    false,
    [],
  );

  const sharedSecretBits = await webcrypto.subtle.deriveBits(
    { name: 'X25519', public: userPublicKey } as EcdhKeyDeriveParams,
    ephemeralKeyPair.privateKey,
    256,
  );

  const aesKeyBytes = Buffer.from(
    crypto.hkdfSync(
      'sha512',
      Buffer.from(sharedSecretBits),
      Buffer.from('drawpro-e2ee-salt', 'utf8'),
      Buffer.from('drawpro-e2ee-key', 'utf8'),
      32,
    ),
  );

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKeyBytes, iv);
  cipher.setAAD(Buffer.from('drawpro-e2ee-message', 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  const ephPubRaw = Buffer.from(
    await webcrypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey),
  ); // 32 bytes

  aesKeyBytes.fill(0);

  // Wire format: eph_pub(32) | iv(16) | authTag(16) | ciphertext
  return Buffer.concat([ephPubRaw, iv, authTag, ct]).toString('base64');
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
        encryptedData: true,
      },
    });

    return res.json({
      data: sheets.map(({ encryptedData, ...s }) => ({
        ...s,
        isEncrypted: encryptedData !== null,
        encryptedData,
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

    return res.json({ data: { ...sheet, isEncrypted: sheet.encryptedData !== null } });
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

    let encryptedUpdate: {
      encryptedData: string;
      name: string;
      elements: null;
      appState: null;
    } | null = null;

    if (hasEncryptionKeys && (hasContent || hasName)) {
      // Merge incoming values with stored values
      const name = hasName ? req.body.name : (sheet.name === '[encrypted]' ? '' : sheet.name);
      const elements = hasElements ? req.body.elements : (sheet.elements ?? []);
      const appState = hasAppState ? req.body.appState : (sheet.appState ?? {});

      const plaintext = JSON.stringify({ name, elements, appState });
      const encryptedData = await encryptForUser(plaintext, user!.publicKey!);

      encryptedUpdate = {
        encryptedData,
        name: '[encrypted]',
        elements: null,
        appState: null,
      };
    }

    const updated = await prisma.sheet.update({
      where: { id: req.params.id },
      data: {
        ...(encryptedUpdate !== null && encryptedUpdate),
        ...(encryptedUpdate === null && hasName && { name: req.body.name }),
        ...(encryptedUpdate === null && hasElements && { elements: req.body.elements }),
        ...(encryptedUpdate === null && hasAppState && { appState: req.body.appState }),
        version: { increment: 1 },
      },
    });

    return res.json({ data: { ...updated, isEncrypted: updated.encryptedData !== null } });
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
