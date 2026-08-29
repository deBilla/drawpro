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
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  DrawProClient,
  askHidden,
  installId,
  readConfig,
  resolveToken,
  telemetryEnabled,
  writeConfig,
  type RequestTrace,
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
  growBoxesToFitText,
  measureText,
  validateScene,
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
    const token = resolveToken();
    if (!token) {
      throw new ConfigError(
        'No API token. Create one in DrawPro under "Connect to Claude Code", then:\n' +
          '  npx -y @drawpro/mcp connect dp_live_...\n\n' +
          'Or supply it through the environment when registering the server:\n' +
          '  claude mcp add drawpro --scope user -e DRAWPRO_TOKEN="dp_live_..." -- npx -y @drawpro/mcp',
      );
    }
    clientInstance = new DrawProClient(BASE_URL, token, (t) => inFlight.push(t));
  }
  return clientInstance;
}

/** One per server process, so calls from a single Claude session group together. */
const SESSION_ID = Math.random().toString(36).slice(2, 10);
const VERSION = '0.6.4';

/** Requests made while handling the current tool call. Reset per call, so a
 *  trace can separate time spent talking to DrawPro from local crypto and
 *  layout work — which is the difference between "the network is slow" and
 *  "argon2 is slow", and they need very different fixes. */
let inFlight: RequestTrace[] = [];

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
        `This account (${user.email}) is locked, so names and contents cannot be read.\n\n` +
        'Ask the user to run this in a terminal:\n' +
        '  npx -y @drawpro/mcp login\n\n' +
        'It prompts for their passcode and stores the derived key in the OS keychain. ' +
        'They do NOT need to restart — once it completes, simply try the same tool again ' +
        'and it will work.\n\n' +
        'Never ask the user for their passcode here. It is the account\'s master secret and ' +
        'must not pass through this conversation.',
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


// ─── Usage log ───────────────────────────────────────────────────────────────

/**
 * Append-only JSONL record of tool calls, written only when DRAWPRO_MCP_LOG
 * names a path.
 *
 * Opt-in, and deliberately content-free: shapes and counts, never a label, a
 * node name, a file's contents, or the token. The question this answers is
 * "which tools get reached for, and how often do they refuse" — none of which
 * needs the diagram itself. A log you would hesitate to paste into an issue is
 * a log nobody will keep enabled.
 */
const DEFAULT_LOG = join(homedir(), '.drawpro', 'usage.jsonl');

/**
 * Where usage is recorded, or undefined for nowhere.
 *
 * An explicit DRAWPRO_MCP_LOG always wins. Failing that, opting into telemetry
 * turns recording on at a default path — because consenting to *send* usage
 * plainly implies consent to *record* it, recording being the lesser act, and
 * because the alternative was a trap: telemetry on with no log configured sent
 * nothing, ever, while looking like it was working.
 *
 * The implication does not run the other way. Setting DRAWPRO_MCP_LOG records
 * locally and shares nothing.
 */
function logPath(): string | undefined {
  const explicit = process.env.DRAWPRO_MCP_LOG;
  if (explicit) return explicit;
  return telemetryEnabled() ? DEFAULT_LOG : undefined;
}

function logCall(entry: Record<string, unknown>): void {
  const path = logPath();
  if (!path) return;
  try {
    mkdirSync(join(homedir(), '.drawpro'), { recursive: true, mode: 0o700 });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // Never let bookkeeping break a tool call.
  }
}

/** Phrases the tools use when they decline to act. Counting these is the point:
 *  a high refusal rate means the descriptions are not steering well. */
const REFUSALS = [
  'Nothing was written',
  'The diagram was not created',
  'is locked',
  'Could not read',
  'has no "elements" array',
];

type ToolArgs = Record<string, unknown>;

/** Counts worth keeping, derived from arguments without recording their content. */
function summarise(args: ToolArgs): Record<string, unknown> {
  const spec = args.spec as { nodes?: unknown[]; edges?: unknown[] } | undefined;
  const edits = args.edits as unknown[] | undefined;
  return {
    workspace_id: args.workspace_id,
    sheet_id: args.sheet_id,
    ...(spec ? { nodes: spec.nodes?.length ?? 0, edges: spec.edges?.length ?? 0 } : {}),
    ...(edits ? { edits: edits.length } : {}),
    ...(args.file_path ? { from_file: true } : {}),
  };
}

type Handler = (args: never) => Promise<{ content: { type: 'text'; text: string }[] }>;

/** Wrap a handler so every call is timed and recorded. */
function instrument(name: string, handler: Handler): Handler {
  return (async (args: ToolArgs) => {
    const started = Date.now();
    inFlight = [];
    try {
      const result = await (handler as (a: ToolArgs) => ReturnType<Handler>)(args);
      const body = result.content.map((c: { text: string }) => c.text).join('\n');
      const apiMs = inFlight.reduce((sum, t) => sum + t.ms, 0);
      const total = Date.now() - started;
      logCall({
        session: SESSION_ID,
        tool: name,
        ok: true,
        refused: REFUSALS.some((r) => body.includes(r)),
        ms: total,
        api_ms: apiMs,
        local_ms: total - apiMs,
        requests: inFlight.map((t) => ({ m: t.method, p: t.path, s: t.status, ms: t.ms, bytes: t.bytes })),
        args: summarise(args),
        // Tools word this two ways: "38 elements" and "elements: 38".
        elements:
          Number(body.match(/(\d+) elements/)?.[1] ?? body.match(/elements: (\d+)/)?.[1]) ||
          undefined,
      });
      return result;
    } catch (err) {
      const apiMs = inFlight.reduce((sum, t) => sum + t.ms, 0);
      const total = Date.now() - started;
      logCall({
        session: SESSION_ID,
        tool: name,
        ok: false,
        ms: total,
        api_ms: apiMs,
        local_ms: total - apiMs,
        requests: inFlight.map((t) => ({ m: t.method, p: t.path, s: t.status, ms: t.ms, bytes: t.bytes })),
        args: summarise(args),
        error: (err as Error).message.slice(0, 200),
      });
      throw err;
    }
  }) as Handler;
}

const server = new McpServer({ name: 'drawpro', version: VERSION });

/** server.tool, with the handler wrapped so the call is logged. */
const tool: typeof server.tool = ((name: string, ...rest: unknown[]) => {
  const handler = rest.pop() as Handler;
  return (server.tool as unknown as (...a: unknown[]) => unknown)(
    name,
    ...rest,
    instrument(name, handler),
  );
}) as typeof server.tool;

// ─── Read ────────────────────────────────────────────────────────────────────

tool(
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

tool(
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

tool(
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

tool(
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

tool(
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

tool(
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

tool(
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
          find: z
            .string()
            .describe(
              'The element\'s current text, as read_sheet reports it. Whitespace is ' +
                'matched loosely, so the flattened single-line form read_sheet prints ' +
                'works even when the element itself contains line breaks.',
            ),
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

    /**
     * Collapse every run of whitespace to one space.
     *
     * read_sheet flattens newlines so an outline stays readable on one line per
     * element, which made its output unusable as `find` for any multi-line text
     * — while the tool's own instructions say to copy the text from there.
     * Matching on collapsed whitespace closes that gap: identifying *which*
     * element to change should not require reproducing its exact bytes,
     * including line breaks that are invisible in every rendering of it.
     */
    const collapse = (t: string) => t.replace(/\s+/g, ' ').trim();

    const counts = new Map<string, number>();
    const changedTextIds = new Set<string>();
    for (const el of elements) {
      if (el.type !== 'text') continue;
      const current = ((el.originalText ?? el.text) as string | undefined)?.trim();
      if (current === undefined) continue;

      // Exact first, so a caller who does have the real bytes keeps precise
      // control; collapsed only as a fallback.
      const edit =
        edits.find((e) => e.find.trim() === current) ??
        edits.find((e) => collapse(e.find) === collapse(current));
      if (!edit) continue;

      el.text = edit.replace;
      el.originalText = edit.replace;

      // Keep the box honest about its new contents. Bound text is re-measured
      // by Excalidraw on load; unbound text is not, so it would keep a stale
      // width and clip.
      const fontSize = (el.fontSize as number) ?? 20;
      /**
       * Wrap to the width the element already occupies.
       *
       * Unbound text used to be measured at a flat 1000px, which meant a long
       * replacement came back as one enormous line: taller by almost nothing,
       * so the box was not grown, and hundreds of pixels wider than the box it
       * sits in. The author chose that column width by hand-wrapping the
       * original — keeping it makes the replacement wrap into more lines, which
       * grows the height, which is what growBoxesToFitText can then act on.
       */
      const wrapWidth = Math.max((el.width as number) || 0, 80);
      const metrics = measureText(edit.replace, fontSize, wrapWidth);
      el.width = metrics.width;
      el.height = metrics.height;
      changedTextIds.add(el.id);

      el.version = ((el.version as number) ?? 1) + 1;
      el.versionNonce = Math.floor(Math.random() * 2 ** 31);
      el.updated = Date.now();

      counts.set(edit.find, (counts.get(edit.find) ?? 0) + 1);
    }

    // Longer replacement text can overflow the box it sits in; see
    // growBoxesToFitText for why only growing, and only the box, is correct.
    const resizes = growBoxesToFitText(elements, changedTextIds);

    // Fail closed. A partially applied edit is worse than none: the sheet ends
    // up in a state neither the user nor the model expected, and the diff is
    // invisible without re-reading.
    const missed = edits.filter((e) => !counts.has(e.find));
    if (missed.length > 0) {
      return text(
        'Nothing was written. These strings matched no text element:\n' +
          missed.map((e) => `  ${JSON.stringify(e.find)}`).join('\n') +
          '\n\nRun read_sheet and copy the text as it appears there. Line breaks and ' +
            'repeated spaces do not need to match — only the words do.',
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
    const grewNote = resizes.length
      ? '\n\nBoxes grown so the new text fits (nothing else moved, so check for overlap):\n' +
        resizes
          .map((r) => `  a ${r.shapeType} grew ${Math.round(r.from)}px -> ${Math.round(r.to)}px`)
          .join('\n')
      : '';
    return text(
      `Updated "${scene.name}". ${elements.length} elements preserved; only the text below changed.\n${applied}${grewNote}\n${sheetUrl(workspace_id, sheet_id)}`,
    );
  },
);

tool(
  'import_sheet',
  'Write a local .excalidraw file into a sheet, exactly as it is. Use this when ' +
    'geometry has to change — repositioning, resizing, re-anchoring arrows — ' +
    'which no spec can express and edit_sheet_text will not touch. Every ' +
    'coordinate in the file is preserved verbatim.',
  {
    workspace_id: z.string(),
    file_path: z.string().describe('Path to a .excalidraw file on this machine'),
    name: z.string().describe('Sheet name'),
    sheet_id: z
      .string()
      .optional()
      .describe('Omit to create a new sheet; supply it to replace an existing one'),
  },
  async ({ workspace_id, file_path, name, sheet_id }) => {
    let parsed: { elements?: unknown; appState?: unknown };
    try {
      parsed = JSON.parse(readFileSync(resolve(file_path), 'utf8')) as typeof parsed;
    } catch (err) {
      return text(`Could not read ${file_path}: ${(err as Error).message}`);
    }

    const elements = parsed.elements;
    if (!Array.isArray(elements) || elements.length === 0) {
      return text(`${file_path} has no "elements" array — is it an .excalidraw file?`);
    }

    // Reported, never enforced. This is a person's own drawing: overlapping
    // boxes and unbound arrows are their business, and refusing the import
    // would make the tool useless for exactly the hand-drawn sheets it exists
    // to carry.
    const issues = validateScene(elements as ExcalidrawElement[]);
    const noted = issues.length
      ? `\n\n${issues.length} thing(s) worth a look (imported anyway):\n` +
        issues.slice(0, 5).map((i) => `  ${i.level}: ${i.message}`).join('\n')
      : '';

    const user = await currentUser();
    const payload = {
      name,
      elements: elements as unknown[],
      appState: (parsed.appState as Record<string, unknown>) ?? {},
    };

    const sheet = sheet_id
      ? await api().updateSheet(workspace_id, sheet_id, payload, user.publicKey)
      : await api().createSheet(workspace_id, payload, user.publicKey);

    const id = sheet_id ?? sheet.id;
    return text(
      `${sheet_id ? 'Replaced' : 'Created'} "${name}" from ${file_path} — ` +
        `${elements.length} elements, every coordinate as in the file.\n${sheetUrl(workspace_id, id)}${noted}`,
    );
  },
);

/**
 * Summarise the usage log.
 *
 *   drawpro-mcp stats [path] [--json]
 *
 * The numbers worth watching are the refusal rates: a tool that frequently
 * declines is one whose description is not steering the model well, which is
 * cheaper to learn from real use than from a synthetic eval.
 *
 * Unlike the raw log — which carries workspace and sheet ids so you can
 * correlate calls against your own account — this output is aggregate only:
 * tool names, counts, and timings. Nothing here identifies an account, a
 * workspace, a sheet, or anything drawn on one, which is what makes it safe to
 * paste into a bug report. That is the intended path for improving the package:
 * the log stays on your machine, and you choose whether to share the summary.
 */
interface ToolSummary {
  tool: string;
  calls: number;
  refused: number;
  failed: number;
  median_ms: number;
}

interface LogSummary {
  calls: number;
  writes: number;
  from: string;
  to: string;
  tools: ToolSummary[];
}

const WRITE_TOOLS = ['create_diagram', 'update_diagram', 'edit_sheet_text', 'import_sheet'];

/** Aggregate a usage log. Shared by `stats` and by telemetry, so what is shown
 *  and what would be sent can never drift apart. */
function summariseLog(file: string): LogSummary | null {
  let rows: Record<string, unknown>[];
  try {
    rows = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const byTool = new Map<string, { n: number; refused: number; failed: number; ms: number[] }>();
  for (const r of rows) {
    const name = String(r.tool);
    const acc = byTool.get(name) ?? { n: 0, refused: 0, failed: 0, ms: [] };
    acc.n++;
    if (r.refused) acc.refused++;
    if (r.ok === false) acc.failed++;
    if (typeof r.ms === 'number') acc.ms.push(r.ms);
    byTool.set(name, acc);
  }

  const median = (xs: number[]) =>
    xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;

  return {
    calls: rows.length,
    writes: rows.filter(
      (r) => WRITE_TOOLS.includes(String(r.tool)) && !r.refused && r.ok !== false,
    ).length,
    from: String(rows[0].ts).slice(0, 10),
    to: String(rows[rows.length - 1].ts).slice(0, 10),
    tools: [...byTool.entries()]
      .sort((x, y) => y[1].n - x[1].n)
      .map(([tool, a]) => ({
        tool,
        calls: a.n,
        refused: a.refused,
        failed: a.failed,
        median_ms: median(a.ms),
      })),
  };
}

/**
 * Summarise the usage log.
 *
 *   drawpro-mcp stats [path] [--json]
 *
 * The numbers worth watching are the refusal rates: a tool that frequently
 * declines is one whose description is not steering the model well, which is
 * cheaper to learn from real use than from a synthetic eval.
 *
 * Unlike the raw log — which carries workspace and sheet ids so you can
 * correlate calls against your own account — this output is aggregate only.
 * Nothing here identifies an account, a workspace, a sheet, or anything drawn
 * on one, which is what makes it safe to paste into a bug report.
 */
/**
 * Break the `failed` column down by error message, from the raw local log.
 *
 * The aggregate deliberately carries no error text, so a run of failures shows
 * up as a count with no cause. The cause is sitting in the same file — it just
 * has to stay local, which is exactly why this reads the log rather than
 * enriching the report.
 */
function errors(file: string): void {
  let rows: Record<string, unknown>[];
  try {
    rows = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  } catch {
    console.error(`Could not read ${file}`);
    process.exit(2);
  }

  const failures = rows.filter((r) => r.ok === false || r.refused);
  if (failures.length === 0) {
    console.log('No failures or refusals recorded.');
    return;
  }

  const grouped = new Map<string, { n: number; tools: Set<string>; last: string }>();
  for (const r of failures) {
    const reason = String(r.error ?? 'refused (the tool declined, see its message)').slice(0, 120);
    const acc = grouped.get(reason) ?? { n: 0, tools: new Set<string>(), last: '' };
    acc.n++;
    acc.tools.add(String(r.tool));
    acc.last = String(r.ts);
    grouped.set(reason, acc);
  }

  console.log(`${failures.length} of ${rows.length} calls failed or were refused\n`);
  for (const [reason, a] of [...grouped.entries()].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${a.n}x  ${[...a.tools].join(', ')}`);
    console.log(`      ${reason}`);
    console.log(`      last seen ${a.last}\n`);
  }
  console.log('  This reads your local log and sends nothing.');
}

function stats(path: string | undefined, asJson: boolean): void {
  const file = path ?? logPath();
  if (!file) {
    console.error(
      'No usage is being recorded. Either set DRAWPRO_MCP_LOG, turn on telemetry\n' +
        '(which records to ~/.drawpro/usage.jsonl), or pass a path: drawpro-mcp stats <file>',
    );
    process.exit(2);
  }

  const summary = summariseLog(file);
  if (!summary) {
    console.log(asJson ? '{"calls":0}' : 'No calls recorded yet.');
    return;
  }

  if (asJson) {
    console.log(JSON.stringify({ version: VERSION, ...summary }, null, 2));
    return;
  }

  console.log(`${summary.calls} calls  ${summary.from} .. ${summary.to}\n`);
  console.log('  tool               calls  refused  failed  median');
  for (const t of summary.tools) {
    const pct = t.calls ? Math.round((t.refused / t.calls) * 100) : 0;
    console.log(
      `  ${t.tool.padEnd(18)} ${String(t.calls).padStart(5)}  ${String(t.refused).padStart(4)} ${String(pct).padStart(3)}%  ${String(t.failed).padStart(6)}  ${String(t.median_ms).padStart(5)}ms`,
    );
  }
  console.log(`\n  ${summary.writes} successful writes to sheets`);
  console.log(
    '\n  No ids, account details, or diagram content above — safe to paste into a bug report.',
  );
  console.log('  Add --json for a machine-readable copy, or --errors to see why calls failed.');
}


// ─── Telemetry ───────────────────────────────────────────────────────────────

/** Exactly what a report contains. Nothing else is ever sent. */
function buildReport(): { installId: string; mcpVersion: string; calls: number; writes: number; tools: unknown[] } | null {
  const file = logPath();
  if (!file) return null;
  const summary = summariseLog(file);
  if (!summary) return null;
  return {
    installId: installId(),
    mcpVersion: VERSION,
    calls: summary.calls,
    writes: summary.writes,
    tools: summary.tools,
  };
}

async function sendReport(report: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${BASE_URL}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/**
 * `drawpro-mcp telemetry [on|off]`
 *
 * Off unless turned on, and the payload is printed before the choice is made —
 * consent to something unseen is not consent. Reports carry an install id
 * generated on this machine, never the account, the token, or anything about a
 * diagram.
 */
async function telemetry(action: string | undefined): Promise<void> {
  if (action === 'off') {
    writeConfig({ telemetry: 'off' });
    console.log('Telemetry off. Nothing will be sent.');
    return;
  }

  const report = buildReport();

  if (action === 'on') {
    writeConfig({ telemetry: 'on' });
    console.log(`Telemetry on. Usage is recorded to ${logPath()}`);

    // Send straight away rather than waiting for the next server start.
    // Background sends only fire when the server boots, so enabling telemetry
    // mid-session used to do nothing visible until Claude Code was restarted —
    // which looks exactly like a broken pipe, and gives no way to tell the
    // difference.
    const built = buildReport();
    if (!built) {
      console.log('\nNothing recorded yet. The first report goes out once you have used the tools.');
      console.log('Turn it off any time with: drawpro-mcp telemetry off');
      return;
    }

    console.log('\nSending this now, and roughly once a day after:\n');
    console.log(JSON.stringify(built, null, 2));
    const { ok, detail } = await sendReport(built as unknown as Record<string, unknown>);
    if (ok) {
      writeConfig({ lastReportAt: new Date().toISOString() });
      console.log('\nSent.');
    } else {
      console.log(`\nCould not send it (${detail}). Telemetry is still on and it will retry.`);
    }
    console.log('Turn it off any time with: drawpro-mcp telemetry off');
    return;
  }

  const last = readConfig().lastReportAt;
  console.log(`Telemetry is ${telemetryEnabled() ? 'ON' : 'OFF'}.`);
  console.log(last ? `Last report sent ${last}.\n` : 'No report has been sent yet.\n');
  console.log('If enabled, this is the entire payload — tool counts and timings,');
  console.log('no account, no token, no workspace or sheet ids, nothing drawn:\n');
  console.log(
    report
      ? JSON.stringify(report, null, 2)
      : `  (no calls recorded yet; recording ${logPath() ? `to ${logPath()}` : 'is off'})`,
  );
  console.log('\n  drawpro-mcp telemetry on     share it');
  console.log('  drawpro-mcp telemetry off    stop');
  console.log('  drawpro-mcp report           send once now, without turning it on');
}

/** One-off send, for "here is what happened" in a bug report. */
async function reportOnce(): Promise<void> {
  const report = buildReport();
  if (!report) {
    console.error(
      'Nothing to report — no usage has been recorded. Set DRAWPRO_MCP_LOG, or\n' +
        'turn on telemetry, which records to ~/.drawpro/usage.jsonl.',
    );
    process.exit(2);
  }
  console.log('Sending:\n');
  console.log(JSON.stringify(report, null, 2));
  const { ok, detail } = await sendReport(report as unknown as Record<string, unknown>);
  console.log(ok ? '\nSent. Thank you.' : `\nCould not send (${detail}). Paste the JSON above into an issue instead.`);
}

/** Background send when enabled, at most daily. Never blocks or reports errors:
 *  a telemetry failure must not degrade the tool for the person who opted in. */
function maybeSendInBackground(): void {
  if (!telemetryEnabled()) return;
  const last = readConfig().lastReportAt;
  if (last && Date.now() - Date.parse(last) < 24 * 60 * 60 * 1000) return;
  const report = buildReport();
  if (!report) return;
  void sendReport(report as unknown as Record<string, unknown>).then(({ ok }) => {
    if (ok) writeConfig({ lastReportAt: new Date().toISOString() });
  });
}

/**
 * `drawpro-mcp auth <token>` / `auth --forget` / `auth`
 *
 * Stores the token so it can be rotated without touching the MCP registration.
 * Claude Code can add and remove a server but not edit one, so a token supplied
 * through `-e DRAWPRO_TOKEN` can only be changed by removing and re-adding the
 * whole server — and the secret then lives in ~/.claude.json alongside unrelated
 * configuration. Here it sits in a 0600 file next to the key material.
 *
 * The token is checked against the API before being saved: storing one that
 * does not work turns an immediate, obvious error into a puzzling one later.
 */
async function auth(arg: string | undefined): Promise<void> {
  if (arg === '--forget') {
    writeConfig({ token: undefined });
    console.log('Token cleared.');
    return;
  }

  if (!arg) {
    const current = readConfig().token;
    const fromEnv = Boolean(process.env.DRAWPRO_TOKEN);
    if (fromEnv) {
      console.log('Using DRAWPRO_TOKEN from the environment, which takes precedence.');
    } else if (current) {
      console.log(`Stored token: ${current.slice(0, 16)}…`);
    } else {
      console.log('No token stored.');
    }
    console.log('\n  drawpro-mcp auth dp_live_...   store or replace it');
    console.log('  drawpro-mcp auth --forget      clear it');
    return;
  }

  if (!arg.startsWith('dp_live_')) {
    throw new ConfigError('That does not look like a DrawPro token — they begin with dp_live_.');
  }

  const probe = new DrawProClient(BASE_URL, arg);
  let email: string;
  try {
    email = (await probe.me()).email;
  } catch (err) {
    throw new ConfigError(
      `That token was rejected, so it has not been saved: ${(err as Error).message}`,
    );
  }

  writeConfig({ token: arg });
  console.log(`Token saved for ${email}.`);
  if (process.env.DRAWPRO_TOKEN) {
    console.log(
      '\nNote: DRAWPRO_TOKEN is also set in this environment and takes precedence.\n' +
        'Remove it from the MCP registration for the stored token to be used.',
    );
  }
}

/**
 * `drawpro-mcp connect <token>` — the whole setup, in one command.
 *
 * Connecting used to span two tools: register the server with Claude Code, then
 * store the token here, then restart, and know that an environment variable
 * silently outranks the stored token. Every one of those steps was a place to
 * get stuck, and the failure modes were indistinguishable from each other — a
 * missing token, a stale token, and a token shadowed by the environment all
 * present as the same 401.
 *
 * This does the registration itself, so the ordering cannot be got wrong. It
 * registers WITHOUT -e DRAWPRO_TOKEN, which also keeps the token out of
 * ~/.claude.json, out of shell history, and out of the process list.
 */
function claudeAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function connect(token: string | undefined): Promise<void> {
  if (!token) {
    throw new ConfigError(
      'Usage: drawpro-mcp connect dp_live_...\n' +
        'Create a token in DrawPro under "Connect to Claude Code".',
    );
  }
  if (!token.startsWith('dp_live_')) {
    throw new ConfigError('That does not look like a DrawPro token — they begin with dp_live_.');
  }

  process.stdout.write('Checking the token... ');
  let user: DrawProUser;
  try {
    user = await new DrawProClient(BASE_URL, token).me();
  } catch (err) {
    console.log('');
    throw new ConfigError(`rejected, nothing has been changed: ${(err as Error).message}`);
  }
  console.log(`ok — ${user.email}`);

  writeConfig({ token });

  if (!claudeAvailable()) {
    console.log('\nToken saved, but the `claude` command was not found, so the server could not');
    console.log('be registered. Register it yourself, without -e DRAWPRO_TOKEN:');
    console.log('\n  claude mcp add drawpro --scope user -- npx -y @drawpro/mcp');
    return;
  }

  // Remove first so re-running is a rotation rather than an "already exists"
  // error. Claude Code can add and remove a server but not edit one.
  try {
    execFileSync('claude', ['mcp', 'remove', 'drawpro', '-s', 'user'], { stdio: 'ignore' });
  } catch {
    // Not registered yet, which is the normal first-run case.
  }

  try {
    execFileSync('claude', ['mcp', 'add', 'drawpro', '-s', 'user', '--', 'npx', '-y', '@drawpro/mcp'], {
      stdio: 'ignore',
    });
  } catch (err) {
    throw new ConfigError(
      `Token saved, but registering with Claude Code failed: ${(err as Error).message}\n` +
        'Register it yourself: claude mcp add drawpro --scope user -- npx -y @drawpro/mcp',
    );
  }

  console.log('Registered with Claude Code for all your projects.');

  if (user.encryptedPrivateKey && !loadKey(user.email)) {
    console.log('\nCreating diagrams will work now. Reading them needs your passcode, which');
    console.log('unwraps your private key on this machine — it is never sent anywhere.');
    console.log('Unlock now, or skip and run `npx -y @drawpro/mcp login` later.\n');

    const passcode = await askHidden('passcode (or press enter to skip): ');
    if (passcode) {
      process.stdout.write('unlocking... ');
      try {
        const key = await decryptPrivateKey(user.encryptedPrivateKey, passcode, user.salt!);
        const { location } = storeKey(user.email, key);
        console.log(`done, stored in the ${location}.`);
      } catch {
        console.log('incorrect passcode. Run `npx -y @drawpro/mcp login` when ready.');
      }
    }
  }

  console.log('\nRestart Claude Code, then ask it to list your DrawPro workspaces.');
}

async function main() {
  const command = process.argv[2];

  if (command === 'login') {
    await login(process.argv.includes('--forget'));
    return;
  }

  if (command === 'connect') {
    await connect(process.argv[3]);
    return;
  }

  if (command === 'auth') {
    await auth(process.argv[3]);
    return;
  }

  if (command === 'telemetry') {
    await telemetry(process.argv[3]);
    return;
  }

  if (command === 'report') {
    await reportOnce();
    return;
  }

  if (command === 'stats') {
    const rest = process.argv.slice(3);
    const file = rest.find((a) => !a.startsWith('--')) ?? logPath();
    if (rest.includes('--errors')) {
      if (!file) {
        console.error('No usage is being recorded, so there is nothing to explain.');
        process.exit(2);
      }
      errors(file);
      return;
    }
    stats(file, rest.includes('--json'));
    return;
  }

  if (command && command !== 'serve') {
    console.error(
      `Unknown command "${command}". ` +
        'Use: drawpro-mcp [serve|connect|auth|login|stats|telemetry|report]',
    );
    process.exit(2);
  }

  maybeSendInBackground();
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
