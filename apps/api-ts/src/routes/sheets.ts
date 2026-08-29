import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router({ mergeParams: true });

const createSchema = z.object({
  name: z.string().min(1).max(200),
  encryptedData: z.string().min(1).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  elements: z.array(z.unknown()).optional(),
  appState: z.record(z.unknown()).optional(),
  encryptedData: z.string().min(1).optional(),
});

async function checkAccess(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

/**
 * Encryption happens in the browser, never here.
 *
 * Clients holding encryption keys send `encryptedData` — a base64 ECIES blob of
 * `{ name, elements, appState }` produced by `encryptMessage()` in the frontend.
 * This server stores that blob verbatim and cannot read it: it has the user's
 * public key but never their private key or passcode.
 *
 * Requests from a key-holding user that carry plaintext content are rejected
 * rather than silently encrypted server-side (see `assertEncryptionContract`).
 */
async function userHasKeys(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true },
  });
  return !!user?.publicKey;
}

/**
 * Fail closed. Returns an error string when the payload violates the account's
 * encryption mode, or null when it is acceptable.
 */
function assertEncryptionContract(
  hasKeys: boolean,
  body: { name?: unknown; elements?: unknown; appState?: unknown; encryptedData?: unknown },
  { allowPlaintextName = false }: { allowPlaintextName?: boolean } = {},
): string | null {
  const plaintextFields = [
    body.elements !== undefined && 'elements',
    body.appState !== undefined && 'appState',
    !allowPlaintextName && body.name !== undefined && 'name',
  ].filter(Boolean) as string[];

  if (hasKeys) {
    if (plaintextFields.length > 0) {
      return `Encryption is enabled for this account. Send 'encryptedData' instead of plaintext ${plaintextFields.join(', ')}.`;
    }
    if (body.encryptedData === undefined) {
      return "Encryption is enabled for this account. 'encryptedData' is required.";
    }
    return null;
  }

  if (body.encryptedData !== undefined) {
    return "Encryption is not set up for this account. Set up keys via PUT /auth/keys before sending 'encryptedData'.";
  }
  return null;
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

    // A new sheet's name is content too — encrypted clients send it inside the blob.
    const hasKeys = await userHasKeys(req.userId!);
    const violation = assertEncryptionContract(hasKeys, req.body, { allowPlaintextName: true });
    if (violation) return res.status(400).json({ error: violation });

    const sheet = await prisma.sheet.create({
      data: {
        workspaceId: req.params.workspaceId,
        name: hasKeys ? '[encrypted]' : req.body.name,
        encryptedData: hasKeys ? req.body.encryptedData : null,
      },
    });
    return res.status(201).json({ data: { ...sheet, isEncrypted: sheet.encryptedData !== null } });
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
// Encrypted accounts send {encryptedData} — an opaque blob, stored verbatim.
// Accounts without keys send plaintext {name?, elements?, appState?}.
// Mixing the two is rejected; the server never encrypts anything itself.
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

    const hasKeys = await userHasKeys(req.userId!);
    const violation = assertEncryptionContract(hasKeys, req.body);
    if (violation) return res.status(400).json({ error: violation });

    // Encrypted accounts: the blob is authoritative and self-contained. The client
    // decrypted the whole sheet to edit it, so it always sends the whole sheet back.
    // No server-side merge — that is what silently wiped elements on name-only saves.
    const data = hasKeys
      ? {
          encryptedData: req.body.encryptedData as string,
          name: '[encrypted]',
          elements: Prisma.DbNull,
          appState: Prisma.DbNull,
        }
      : {
          ...(req.body.name !== undefined && { name: req.body.name }),
          ...(req.body.elements !== undefined && { elements: req.body.elements }),
          ...(req.body.appState !== undefined && { appState: req.body.appState }),
        };

    const updated = await prisma.sheet.update({
      where: { id: req.params.id },
      data: { ...data, version: { increment: 1 } },
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
