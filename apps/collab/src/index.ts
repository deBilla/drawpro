import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { ENV } from './config/env';
import { setupWSConnection } from './lib/ydoc';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'collab' });
});

const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // URL pattern: /{roomId}  (roomId == sheetId)
  const roomId = (req.url ?? '/').slice(1).split('?')[0] || 'default';
  setupWSConnection(ws, roomId);
});

httpServer.listen(ENV.PORT, () => {
  console.log(`[collab] WebSocket server running on ws://localhost:${ENV.PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[collab] shutting down…');
  wss.close(() => httpServer.close(() => process.exit(0)));
});
