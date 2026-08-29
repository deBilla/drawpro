import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';

const router = Router();

/**
 * Anonymous usage aggregates from opted-in MCP installs.
 *
 * Unauthenticated on purpose: requiring a token would tie every report to an
 * account, which is exactly what this is designed not to do. The cost is that
 * it is writable by anyone, so the schema is strict, the payload is capped, and
 * the rate limit is tight.
 *
 * Nothing accepted here describes a diagram, a workspace, or a sheet.
 */
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  message: { error: 'Too many reports' },
  standardHeaders: true,
  legacyHeaders: false,
});

const reportSchema = z.object({
  installId: z.string().uuid(),
  mcpVersion: z.string().min(1).max(20),
  calls: z.number().int().min(0).max(1_000_000),
  writes: z.number().int().min(0).max(1_000_000),
  tools: z
    .array(
      z.object({
        tool: z.string().min(1).max(40),
        calls: z.number().int().min(0),
        refused: z.number().int().min(0),
        failed: z.number().int().min(0),
        median_ms: z.number().int().min(0),
      }),
    )
    .max(50),
});

// POST /telemetry
router.post('/', reportLimiter, validate(reportSchema), async (req: Request, res: Response) => {
  try {
    const body = req.body as z.infer<typeof reportSchema>;
    await prisma.telemetryReport.create({
      data: {
        installId: body.installId,
        mcpVersion: body.mcpVersion,
        calls: body.calls,
        writes: body.writes,
        tools: body.tools,
      },
    });
    return res.status(202).json({ data: { message: 'Thanks' } });
  } catch (err) {
    console.error('[telemetry]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
