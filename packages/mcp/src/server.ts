#!/usr/bin/env node
/**
 * DrawPro MCP server — local stdio.
 *
 * Local by necessity, not preference. DrawPro is end-to-end encrypted: content
 * is sealed in the client and the server stores only ciphertext. A hosted
 * remote MCP server would have to receive plaintext diagrams, which would undo
 * that property entirely. Running here means encryption and decryption stay on
 * this machine, exactly as they do in the browser.
 *
 *   claude mcp add drawpro -e DRAWPRO_TOKEN=dp_live_... -- npx -y @drawpro/mcp
 *
 * Reading additionally needs the account private key, which an interactive
 * `login` derives from the passcode and stores in the OS keychain. The passcode
 * never reaches a tool argument, so it stays out of the model's context.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  DrawProClient,
  askHidden,
  decryptPrivateKey,
  forgetKey,
  loadKey,
  storeKey,
  type DrawProUser,
} from '@drawpro/client';
import {
  buildDiagram,
  describeScene,
  formatOutline,
  measureText,
  validateSpec,
  type DiagramSpec,
  type ExcalidrawElement,
  type ExcalidrawScene,
} from '@drawpro/diagram';

const BASE_URL = process.env.DRAWPRO_URL ?? 'https://drawpro.kithly.app/api';
const APP_URL = BASE_URL.replace(/\/api\/?$/, '');

class ConfigError extends Error {}

/**
 * Built on first use rather than at import.
 *
 * Constructing at module scope meant a missing token crashed with a raw stack
 * trace before any command could run — including `login`, which is what a user
 * reaches for when setting the token up.
 */
let clientInstance: DrawProClient | null = null;
function api(): DrawProClient {
  if (!clientInstance) {
    const token = process.env.DRAWPRO_TOKEN;
    if (!token) {
      throw new ConfigError(
        'DRAWPRO_TOKEN is not set. Create a token in DrawPro under "Connect to Claude Code", then:\n' +
          '  claude mcp add drawpro --scope user -e DRAWPRO_TOKEN="dp_live_..." -- npx -y @drawpro/mcp',
      );
    }
    clientInstance = new DrawProClient(BASE_URL, token);
  }
  return clientInstance;
}

let cachedUser: DrawProUser | null = null;
async function currentUser(): Promise<DrawProUser> {
  if (!cachedUser) cachedUser = await api().me();
  return cachedUser;
}

/**
 * The private key, or a message explaining how to get one. Returned rather than
 * thrown so the model can relay an actionable instruction instead of an error.
 */
async function unlockedKey(): Promise<{ key: Uint8Array } | { error: string }> {
  const user = await currentUser();
  if (!user.encryptedPrivateKey) {
    return { error: 'This account has no encryption keys set up.' };
  }
  const key = loadKey(user.email);
  if (!key) {
    return {
      error:
        'This account is locked, so names and contents cannot be read. Ask the user to run ' +
        '`DRAWPRO_TOKEN=... npx -y @drawpro/mcp login` in a terminal. It prompts for their ' +
        'passcode and stores the derived key in the OS keychain. Never ask the user for their ' +
        'passcode here — it must not pass through this conversation.',
    };
  }
  return { key };
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function sheetUrl(workspaceId: string, sheetId: string): string {
  return `${APP_URL}/workspace/${workspaceId}/sheet/${sheetId}`;
}

const server = new McpServer({ name: 'drawpro', version: '0.0.1' });

// ─── Read ────────────────────────────────────────────────────────────────────

server.tool(
  'list_workspaces',
  'List the DrawPro workspaces this account can access. Workspace names are ' +
    'encrypted at rest and are only readable once the account is unlocked.',
  {},
  async () => {
    const workspaces = await api().listWorkspaces();
    const unlocked = await unlockedKey();

    const rows = await Promise.all(
      workspaces.map(async (ws) => {
        const name =
          'key' in unlocked ? await api().readName(ws.encryptedName, unlocked.key) : null;
        return `${ws.id}  ${name ?? ws.name}  (${ws.sheetsCount ?? '?'} sheets)`;
      }),
    );

    const note = 'error' in unlocked ? `\n\nNames are encrypted. ${unlocked.error}` : '';
    return text(rows.join('\n') + note);
  },
);

server.tool(
  'list_sheets',
  'List the sheets in a DrawPro workspace, with their decrypted names.',
  { workspace_id: z.string().describe('Workspace id, from list_workspaces') },
  async ({ workspace_id }) => {
    const sheets = await api().listSheets(workspace_id);
    const unlocked = await unlockedKey();

    const rows = await Promise.all(
      sheets.map(async (s) => {
        const name =
          'key' in unlocked ? await api().readName(s.encryptedData, unlocked.key) : null;
        return `${s.id}  ${name ?? s.name}  updated ${s.updatedAt}`;
      }),
    );

    const note = 'error' in unlocked ? `\n\nNames are encrypted. ${unlocked.error}` : '';
    return text((rows.join('\n') || '(no sheets)') + note);
  },
);

server.tool(
  'read_sheet',
  'Read what a DrawPro sheet contains: its shapes, and which arrows connect ' +
    'what. Returns a readable outline rather than raw Excalidraw JSON, which ' +
    'is mostly coordinates and style.',
  {
    workspace_id: z.string(),
    sheet_id: z.string(),
  },
  async ({ workspace_id, sheet_id }) => {
    const unlocked = await unlockedKey();
    if ('error' in unlocked) return text(unlocked.error);

    const scene = await api().readSheet(workspace_id, sheet_id, unlocked.key);
    const outline = describeScene(scene.elements as ExcalidrawElement[]);
    return text(
      `sheet: ${scene.name}\nelements: ${scene.elements.length}\n\n${formatOutline(outline)}`,
    );
  },
);

// ─── Write ───────────────────────────────────────────────────────────────────

const specShape = {
  spec: z
    .object({
      title: z.string().optional(),
      direction: z.enum(['TB', 'BT', 'LR', 'RL']).optional(),
      nodes: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          shape: z.enum(['rectangle', 'ellipse', 'diamond']).optional(),
          accent: z.enum(['blue', 'green', 'yellow', 'red', 'violet', 'grey', 'none']).optional(),
        }),
      ),
      edges: z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().optional(),
          style: z.enum(['solid', 'dashed', 'dotted']).optional(),
          arrowhead: z.boolean().optional(),
        }),
      ),
    })
    .describe(
      'What connects to what. Layout, sizing, text wrapping, and arrow binding ' +
        'are derived — never supply coordinates.',
    ),
};

server.tool(
  'validate_spec',
  'Check a diagram spec without creating anything. Use this before writing if ' +
    'the diagram is large or the spec was assembled programmatically.',
  specShape,
  async ({ spec }) => {
    const issues = validateSpec(spec as DiagramSpec);
    if (issues.length === 0) return text('Spec is valid.');
    return text(issues.map((i) => `${i.level}: ${i.message}`).join('\n'));
  },
);

/**
 * Shared build step, so create and update report problems identically.
 *
 * Explicitly discriminated: inferring the union from object literals leaves
 * every key optional on both branches, and `'error' in built` then fails to
 * narrow.
 */
type BuildOutcome =
  | { ok: false; error: string }
  | { ok: true; scene: ExcalidrawScene; warnings: string[] };

function buildOrExplain(spec: DiagramSpec): BuildOutcome {
  const { scene, issues } = buildDiagram(spec);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    return {
      ok: false,
      error:
        'The diagram was not created. Fix the spec and try again:\n' +
        errors.map((i) => `  error: ${i.message}`).join('\n'),
    };
  }
  const warnings = issues.filter((i) => i.level === 'warning');
  return { ok: true, scene, warnings: warnings.map((w) => w.message) };
}

server.tool(
  'create_diagram',
  'Create a new sheet in DrawPro from a diagram spec. Returns a link to open it.',
  {
    workspace_id: z.string().describe('Workspace id, from list_workspaces'),
    name: z.string().describe('Sheet name, shown in the dashboard'),
    ...specShape,
  },
  async ({ workspace_id, name, spec }) => {
    const built = buildOrExplain(spec as DiagramSpec);
    if (!built.ok) return text(built.error);

    const user = await currentUser();
    const sheet = await api().createSheet(
      workspace_id,
      { name, elements: built.scene.elements, appState: built.scene.appState },
      user.publicKey,
    );

    const warned = built.warnings.length
      ? `\n\nwarnings:\n${built.warnings.map((w) => `  ${w}`).join('\n')}`
      : '';
    return text(
      `Created "${name}" with ${built.scene.elements.length} elements.\n${sheetUrl(workspace_id, sheet.id)}${warned}`,
    );
  },
);

server.tool(
  'update_diagram',
  'Replace a sheet’s contents with a new diagram. This overwrites the whole ' +
    'sheet, so read_sheet first if you intend to preserve anything already there.',
  {
    workspace_id: z.string(),
    sheet_id: z.string(),
    name: z.string().describe('Sheet name; the existing name is inside the encrypted blob'),
    ...specShape,
  },
  async ({ workspace_id, sheet_id, name, spec }) => {
    const built = buildOrExplain(spec as DiagramSpec);
    if (!built.ok) return text(built.error);

    const user = await currentUser();
    await api().updateSheet(
      workspace_id,
      sheet_id,
      { name, elements: built.scene.elements, appState: built.scene.appState },
      user.publicKey,
    );

    const warned = built.warnings.length
      ? `\n\nwarnings:\n${built.warnings.map((w) => `  ${w}`).join('\n')}`
      : '';
    return text(
      `Updated "${name}" to ${built.scene.elements.length} elements.\n${sheetUrl(workspace_id, sheet_id)}${warned}`,
    );
  },
);

/**
 * Interactive unlock, run as `drawpro-mcp login`.
 *
 * It lives in this binary rather than a separate package because a user who
 * installs the MCP server needs it, and because the passcode must be typed at a
 * terminal — never passed as a tool argument, where it would land in the
 * model's context and the transcript.
 */
async function login(forget: boolean): Promise<void> {
  const user = await currentUser();

  if (forget) {
    forgetKey(user.email);
    console.log(`Forgot the stored key for ${user.email}.`);
    return;
  }

  if (!user.encryptedPrivateKey || !user.salt) {
    console.log(`${user.email} has no encryption keys — nothing to unlock.`);
    return;
  }

  if (loadKey(user.email)) {
    console.log(`${user.email} is already unlocked. Use \`login --forget\` to clear it.`);
    return;
  }

  const passcode = await askHidden('passcode: ');
  process.stdout.write('deriving key (argon2id, 128 MB)... ');
  const started = Date.now();

  let key: Uint8Array;
  try {
    key = await decryptPrivateKey(user.encryptedPrivateKey, passcode, user.salt);
  } catch {
    // AES-GCM reports a failed tag check as an opaque operation error; for this
    // command there is only one thing it can mean.
    console.log('');
    throw new ConfigError('Incorrect passcode.');
  }
  console.log(`${Date.now() - started} ms`);

  const { location } = storeKey(user.email, key);
  console.log(`Unlocked ${user.email}. Key stored in the ${location}.`);
  console.log('Claude can now read your sheets. The passcode was not stored or sent anywhere.');
}

server.tool(
  'edit_sheet_text',
  'Correct the wording on an existing sheet without redrawing it. Use this for ' +
    'any sheet a person drew: update_diagram regenerates layout from a spec, so ' +
    'it discards hand-placed elements, region containers, and unbound ' +
    'annotations. This rewrites only the text you name and leaves every other ' +
    'element, and every coordinate, exactly as it was.',
  {
    workspace_id: z.string(),
    sheet_id: z.string(),
    edits: z
      .array(
        z.object({
          find: z.string().describe("The element's exact current text, as read_sheet reports it"),
          replace: z.string(),
        }),
      )
      .describe('Applied all-or-nothing: if any find has no match, nothing is written.'),
  },
  async ({ workspace_id, sheet_id, edits }) => {
    const unlocked = await unlockedKey();
    if ('error' in unlocked) return text(unlocked.error);

    const scene = await api().readSheet(workspace_id, sheet_id, unlocked.key);
    const elements = scene.elements as ExcalidrawElement[];

    const counts = new Map<string, number>();
    for (const el of elements) {
      if (el.type !== 'text') continue;
      const current = ((el.originalText ?? el.text) as string | undefined)?.trim();
      if (current === undefined) continue;

      const edit = edits.find((e) => e.find.trim() === current);
      if (!edit) continue;

      el.text = edit.replace;
      el.originalText = edit.replace;

      // Keep the box honest about its new contents. Bound text is re-measured
      // by Excalidraw on load; unbound text is not, so it would keep a stale
      // width and clip.
      const metrics = measureText(edit.replace, (el.fontSize as number) ?? 20, 1000);
      el.width = metrics.width;
      el.height = metrics.height;

      el.version = ((el.version as number) ?? 1) + 1;
      el.versionNonce = Math.floor(Math.random() * 2 ** 31);
      el.updated = Date.now();

      counts.set(edit.find, (counts.get(edit.find) ?? 0) + 1);
    }

    // Fail closed. A partially applied edit is worse than none: the sheet ends
    // up in a state neither the user nor the model expected, and the diff is
    // invisible without re-reading.
    const missed = edits.filter((e) => !counts.has(e.find));
    if (missed.length > 0) {
      return text(
        'Nothing was written. These strings matched no text element:\n' +
          missed.map((e) => `  ${JSON.stringify(e.find)}`).join('\n') +
          '\n\nRun read_sheet and copy the text exactly as it appears there.',
      );
    }

    const user = await currentUser();
    await api().updateSheet(
      workspace_id,
      sheet_id,
      { name: scene.name, elements, appState: scene.appState },
      user.publicKey,
    );

    const applied = [...counts.entries()]
      .map(([find, n]) => `  ${JSON.stringify(find)} -> ${n} element${n === 1 ? '' : 's'}`)
      .join('\n');
    return text(
      `Updated "${scene.name}". ${elements.length} elements preserved; only the text below changed.\n${applied}\n${sheetUrl(workspace_id, sheet_id)}`,
    );
  },
);

async function main() {
  const command = process.argv[2];

  if (command === 'login') {
    await login(process.argv.includes('--forget'));
    return;
  }

  if (command && command !== 'serve') {
    console.error(`Unknown command "${command}". Use: drawpro-mcp [serve|login] [--forget]`);
    process.exit(2);
  }

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  // stderr only — stdout is the protocol channel.
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(2);
  }
  console.error('[drawpro-mcp]', err.message);
  process.exit(1);
});
