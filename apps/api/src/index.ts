import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { ENV } from './config/env';
import { ensureMinioBucket } from './lib/minio';
import { redis } from './lib/redis';
import authRouter from './routes/auth';
import workspacesRouter from './routes/workspaces';
import sheetsRouter from './routes/sheets';
const app = express();

app.use(helmet());
app.use(cors({ origin: ENV.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api' });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/workspaces', workspacesRouter);
app.use('/workspaces/:workspaceId/sheets', sheetsRouter);
// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
const server = createServer(app);

async function main() {
  await redis.connect().catch(() => {}); // graceful if Redis unavailable in dev
  await ensureMinioBucket();
  server.listen(ENV.PORT, () => {
    console.log(`[api] running on http://localhost:${ENV.PORT}`);
  });
}

main().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
