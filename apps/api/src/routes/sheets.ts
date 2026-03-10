import { Router } from 'express';
import { z } from 'zod';
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

// GET /workspaces/:workspaceId/sheets
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const member = await checkAccess(req.params.workspaceId, req.userId!);
    if (!member) return res.status(403).json({ error: 'Not authorized' });

    const sheets = await prisma.sheet.findMany({
      where: { workspaceId: req.params.workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, version: true, createdAt: true, updatedAt: true },
    });

    return res.json({ data: sheets });
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
    return res.status(201).json({ data: sheet });
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

    return res.json({ data: sheet });
  } catch (err) {
    console.error('[sheets/get]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /workspaces/:workspaceId/sheets/:id
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

    const updated = await prisma.sheet.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.name !== undefined && { name: req.body.name }),
        ...(req.body.elements !== undefined && { elements: req.body.elements }),
        ...(req.body.appState !== undefined && { appState: req.body.appState }),
        version: { increment: 1 },
      },
    });

    return res.json({ data: updated });
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
