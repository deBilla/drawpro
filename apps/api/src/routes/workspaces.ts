import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100),
});

// GET /workspaces — list memberships
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: req.userId },
      include: {
        workspace: {
          include: { _count: { select: { sheets: true } } },
        },
      },
      orderBy: { workspace: { updatedAt: 'desc' } },
    });

    const workspaces = memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
      sheetsCount: m.workspace._count.sheets,
    }));

    return res.json({ data: workspaces });
  } catch (err) {
    console.error('[workspaces/list]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /workspaces — create
router.post('/', requireAuth, validate(createSchema), async (req: AuthRequest, res) => {
  try {
    const workspace = await prisma.workspace.create({
      data: {
        name: req.body.name,
        ownerId: req.userId!,
        members: { create: { userId: req.userId!, role: 'owner' } },
      },
    });
    return res.status(201).json({ data: { ...workspace, role: 'owner' } });
  } catch (err) {
    console.error('[workspaces/create]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /workspaces/:id
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: req.params.id, userId: req.userId! },
      },
      include: {
        workspace: {
          include: { sheets: { orderBy: { updatedAt: 'desc' } } },
        },
      },
    });

    if (!member) return res.status(404).json({ error: 'Workspace not found' });

    return res.json({ data: { ...member.workspace, role: member.role } });
  } catch (err) {
    console.error('[workspaces/get]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /workspaces/:id — rename (owner only)
router.patch('/:id', requireAuth, validate(updateSchema), async (req: AuthRequest, res) => {
  try {
    const workspace = await prisma.workspace.findUnique({ where: { id: req.params.id } });
    if (!workspace || workspace.ownerId !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const updated = await prisma.workspace.update({
      where: { id: req.params.id },
      data: { name: req.body.name },
    });
    return res.json({ data: updated });
  } catch (err) {
    console.error('[workspaces/update]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /workspaces/:id — owner only
router.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const workspace = await prisma.workspace.findUnique({ where: { id: req.params.id } });
    if (!workspace || workspace.ownerId !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await prisma.workspace.delete({ where: { id: req.params.id } });
    return res.json({ data: { message: 'Workspace deleted' } });
  } catch (err) {
    console.error('[workspaces/delete]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
