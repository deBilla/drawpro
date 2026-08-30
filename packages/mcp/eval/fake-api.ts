import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { webcrypto } from 'node:crypto';

/**
 * A DrawPro API that runs in this process, for the eval to talk to.
 *
 * Not a mock in the usual sense. It is a real HTTP server holding real
 * ciphertext, and it keeps every request body it was sent — which is what makes
 * the privacy claims checkable rather than merely asserted. An eval can look at
 * exactly what crossed the wire and fail if a node label is in it.
 *
 * Using the real API instead would make the suite depend on an account, a
 * network, and someone's live diagrams, and none of those can run in CI or be
 * reproduced by a reader.
 */

export interface Recorded {
  method: string;
  path: string;
  /** Verbatim request body. Evals grep this for plaintext that should not be here. */
  body: string;
}

export interface Sheet {
  id: string;
  workspaceId: string;
  name: string;
  isEncrypted: boolean;
  encryptedData: string | null;
  updatedAt: string;
}

export interface FakeApi {
  url: string;
  /** Base64 X25519 public key the account seals to. */
  publicKey: string;
  /** Raw 32-byte private key, for decrypting what the server wrote. */
  privateKey: Uint8Array;
  email: string;
  token: string;
  workspaceId: string;
  sheets: Map<string, Sheet>;
  requests: Recorded[];
  close: () => Promise<void>;
}

/** PKCS#8 wrapper prefix for an X25519 private key — the 32 raw bytes follow it. */
const PKCS8_X25519_PREFIX_LEN = 16;

async function generateKeyPair(): Promise<{ publicKey: string; privateKey: Uint8Array }> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'X25519' } as EcKeyGenParams, true, [
    'deriveBits',
  ])) as CryptoKeyPair;

  const rawPublic = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));

  return {
    publicKey: Buffer.from(rawPublic).toString('base64'),
    privateKey: pkcs8.slice(PKCS8_X25519_PREFIX_LEN),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

let counter = 0;
function nextId(prefix: string): string {
  return `${prefix}${(++counter).toString().padStart(4, '0')}xxxxxxxxxxxxxxxx`;
}

export async function startFakeApi(): Promise<FakeApi> {
  const { publicKey, privateKey } = await generateKeyPair();
  const token = 'dp_live_evalonly000000000000000';
  const email = 'eval@drawpro.invalid';
  const workspaceId = nextId('ws_');

  const sheets = new Map<string, Sheet>();
  const requests: Recorded[] = [];

  const state = { publicKey, privateKey, email, token, workspaceId, sheets, requests };

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req);
    const path = (req.url ?? '').split('?')[0];
    requests.push({ method: req.method ?? 'GET', path, body });

    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.headers.authorization !== `Bearer ${token}`) {
      return send(401, { error: 'Invalid API token.' });
    }

    // GET /auth/me
    if (path === '/auth/me') {
      return send(200, {
        data: {
          id: 'user_eval',
          email,
          publicKey,
          // Only its presence is read by the server (to tell "has encryption" from
          // "plaintext account"); unwrapping it is `login`'s job, and the eval
          // installs the derived key directly instead of paying argon2 per run.
          encryptedPrivateKey: 'eval-fixture-not-a-real-wrapped-key',
          salt: '00'.repeat(32),
        },
      });
    }

    // GET /workspaces
    if (path === '/workspaces' && req.method === 'GET') {
      return send(200, {
        data: [
          {
            id: workspaceId,
            name: '[encrypted]',
            encryptedName: await sealName('Eval workspace', publicKey),
            role: 'owner',
            sheetsCount: sheets.size,
          },
        ],
      });
    }

    const sheetsList = path.match(/^\/workspaces\/([^/]+)\/sheets$/);
    const sheetOne = path.match(/^\/workspaces\/([^/]+)\/sheets\/([^/]+)$/);

    // GET|POST /workspaces/:wid/sheets
    if (sheetsList) {
      const wid = sheetsList[1];
      if (req.method === 'GET') {
        return send(200, { data: [...sheets.values()].filter((s) => s.workspaceId === wid) });
      }
      if (req.method === 'POST') {
        const parsed = JSON.parse(body) as { name?: string; encryptedData?: string };
        // The real API rejects plaintext content from an account that has keys.
        // Mirroring that here is the point: if the MCP server ever stopped
        // sealing, this fake would reject it exactly as production does.
        if (!parsed.encryptedData) {
          return send(400, { error: 'This account has keys; send encryptedData.' });
        }
        const sheet: Sheet = {
          id: nextId('sh_'),
          workspaceId: wid,
          name: '[encrypted]',
          isEncrypted: true,
          encryptedData: parsed.encryptedData,
          updatedAt: new Date().toISOString(),
        };
        sheets.set(sheet.id, sheet);
        return send(200, { data: sheet });
      }
    }

    // GET|PUT /workspaces/:wid/sheets/:id
    if (sheetOne) {
      const sheet = sheets.get(sheetOne[2]);
      if (!sheet) return send(404, { error: 'Sheet not found.' });

      if (req.method === 'GET') return send(200, { data: sheet });

      if (req.method === 'PUT') {
        const parsed = JSON.parse(body) as { encryptedData?: string };
        if (!parsed.encryptedData) {
          return send(400, { error: 'This account has keys; send encryptedData.' });
        }
        sheet.encryptedData = parsed.encryptedData;
        sheet.updatedAt = new Date().toISOString();
        return send(200, { data: sheet });
      }
    }

    return send(404, { error: `No route for ${req.method} ${path}` });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    ...state,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** Seal a bare string the way the browser seals a workspace name. */
async function sealName(name: string, publicKeyBase64: string): Promise<string> {
  const { encryptMessage } = await import('@drawpro/client');
  return encryptMessage(name, publicKeyBase64);
}
