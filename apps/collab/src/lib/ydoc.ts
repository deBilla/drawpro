/**
 * Yjs WebSocket server with Redis-backed persistence and cross-instance pub/sub.
 *
 * Protocol (y-websocket spec):
 *   message type 0 → sync  (step1 / step2 / update)
 *   message type 1 → awareness
 *
 * Broadcast strategy:
 *   – Same instance: doc.on('update') broadcasts directly to local clients (no Redis round-trip).
 *   – Cross instance: updates published to Redis as { instanceId, update:base64 }.
 *                     Other instances apply + broadcast to their local clients.
 *                     The publishing instance ignores its own Redis messages.
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import WebSocket, { RawData } from 'ws';
import { redis, subscriber } from './redis';

// Unique ID for this process — used to skip our own Redis messages
const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2)}`;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket>;
}

interface RedisMsg {
  instanceId: string;
  update: string; // base64-encoded Yjs update
}

// ─── Room registry ────────────────────────────────────────────────────────────

const rooms = new Map<string, Room>();

// Track which awareness clientIds belong to each WebSocket (for cleanup on close)
const wsClientIds = new WeakMap<WebSocket, Set<number>>();

// ─── Redis cross-instance sync ────────────────────────────────────────────────

subscriber.on('messageBuffer', (channel: Buffer, data: Buffer) => {
  const roomId = channel.toString().replace(/^collab:/, '');
  const room = rooms.get(roomId);
  if (!room) return;

  let msg: RedisMsg;
  try {
    msg = JSON.parse(data.toString()) as RedisMsg;
  } catch {
    return;
  }

  // Ignore updates published by this instance — already applied + broadcast locally
  if (msg.instanceId === INSTANCE_ID) return;

  const update = Buffer.from(msg.update, 'base64');
  Y.applyUpdate(room.doc, update, 'redis');
  broadcastUpdate(room.clients, update, null);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toBuffer(rawData: RawData): Buffer | null {
  if (Array.isArray(rawData)) return Buffer.concat(rawData as Buffer[]);
  if (rawData instanceof ArrayBuffer) return Buffer.from(rawData);
  if (Buffer.isBuffer(rawData)) return rawData;
  return null;
}

function broadcastUpdate(
  clients: Set<WebSocket>,
  update: Uint8Array,
  origin: WebSocket | null,
): void {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeUpdate(enc, update);
  const msg = encoding.toUint8Array(enc);

  clients.forEach((ws) => {
    if (ws !== origin && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

async function persistDoc(roomId: string, doc: Y.Doc): Promise<void> {
  const state = Y.encodeStateAsUpdate(doc);
  await redis.set(`ydoc:${roomId}`, Buffer.from(state), 'EX', 60 * 60 * 24);
}

async function loadDocFromRedis(roomId: string, doc: Y.Doc): Promise<void> {
  const state = await redis.getBuffer(`ydoc:${roomId}`);
  if (state) {
    Y.applyUpdate(doc, state, 'redis');
    console.log(`[collab] loaded room ${roomId} from Redis`);
  }
}

// ─── Room creation ────────────────────────────────────────────────────────────

function createRoom(roomId: string): Room {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const clients: Set<WebSocket> = new Set();
  const room: Room = { doc, awareness, clients };
  rooms.set(roomId, room);

  // Broadcast awareness changes to all OTHER local clients
  awareness.on(
    'update',
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      const changed = [...added, ...updated, ...removed];
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      const msg = encoding.toUint8Array(enc);
      clients.forEach((ws) => {
        if (ws !== origin && ws.readyState === WebSocket.OPEN) ws.send(msg);
      });
    },
  );

  // Doc update → broadcast to local peers directly + publish to Redis for other instances
  doc.on('update', async (update: Uint8Array, origin: unknown) => {
    if (origin === 'redis' || origin === 'init') return;

    // Direct local broadcast — skip the originating WebSocket
    broadcastUpdate(clients, update, origin instanceof WebSocket ? origin : null);

    // Cross-instance sync
    try {
      const msg: RedisMsg = {
        instanceId: INSTANCE_ID,
        update: Buffer.from(update).toString('base64'),
      };
      await redis.publish(`collab:${roomId}`, JSON.stringify(msg));
      await persistDoc(roomId, doc);
    } catch (err) {
      console.error(`[collab] Redis error for room ${roomId}:`, err);
    }
  });

  subscriber.subscribe(`collab:${roomId}`, (err) => {
    if (err) console.error(`[collab] subscribe error for room ${roomId}:`, err);
  });

  // Best-effort async load; clients handle empty doc via sync step 2
  loadDocFromRedis(roomId, doc).catch(console.error);

  return room;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function setupWSConnection(ws: WebSocket, roomId: string): void {
  const room = rooms.get(roomId) ?? createRoom(roomId);
  room.clients.add(ws);
  wsClientIds.set(ws, new Set());
  console.log(`[collab] client joined room ${roomId} (${room.clients.size} total)`);

  // ── Sync step 1: send our state vector to the connecting client
  {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, room.doc);
    ws.send(encoding.toUint8Array(enc));
  }

  // ── Send current awareness states
  if (room.awareness.getStates().size > 0) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(
        room.awareness,
        Array.from(room.awareness.getStates().keys()),
      ),
    );
    ws.send(encoding.toUint8Array(enc));
  }

  ws.on('message', (rawData: RawData, isBinary: boolean) => {
    if (!isBinary) return; // skip text frames

    const buf = toBuffer(rawData);
    if (!buf || buf.length === 0) return;

    try {
      const decoder = decoding.createDecoder(new Uint8Array(buf));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        // Pass `ws` as transactionOrigin so doc.on('update') skips echoing back to sender
        syncProtocol.readSyncMessage(decoder, enc, room.doc, ws);
        if (encoding.length(enc) > 1) {
          ws.send(encoding.toUint8Array(enc));
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        const awarenessUpdate = decoding.readVarUint8Array(decoder);

        // Track which clientIds this ws is using (needed for cleanup on close)
        const ids = wsClientIds.get(ws);
        if (ids) {
          try {
            const d = decoding.createDecoder(awarenessUpdate);
            const len = decoding.readVarUint(d);
            for (let i = 0; i < len; i++) {
              ids.add(decoding.readVarUint(d)); // clientId
              decoding.readVarUint(d);          // clock
              decoding.readVarString(d);        // JSON state
            }
          } catch {
            // best-effort; awareness cleanup may be incomplete
          }
        }

        awarenessProtocol.applyAwarenessUpdate(room.awareness, awarenessUpdate, ws);
      }
    } catch (err) {
      console.error(`[collab] message error in room ${roomId}:`, err);
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);

    const ids = wsClientIds.get(ws);
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(ids), null);
    }
    wsClientIds.delete(ws);

    console.log(`[collab] client left room ${roomId} (${room.clients.size} remaining)`);

    if (room.clients.size === 0) {
      persistDoc(roomId, room.doc)
        .then(() => {
          rooms.delete(roomId);
          subscriber.unsubscribe(`collab:${roomId}`);
          room.doc.destroy();
        })
        .catch(console.error);
    }
  });

  ws.on('error', (err) => {
    console.error(`[collab] WebSocket error in room ${roomId}:`, err);
  });
}
