import type { Grader, Suite } from '../grade';
import { sheetIdFrom, startEnv } from '../harness';

/**
 * The claims that would be worst to be wrong about.
 *
 * DrawPro's position is that the server holds ciphertext and the passcode never
 * enters a transcript. Both are checkable rather than promised: the fake API
 * keeps every request body it was sent, so an eval can read exactly what
 * crossed the wire and fail if a label is sitting in it.
 */

// Strings that appear nowhere except inside this diagram, so finding one in a
// request body is unambiguous evidence it was sent in the clear.
const CANARY_NODE = 'Quarterly-Revenue-Canary-8817';
const CANARY_EDGE = 'settles-into-Canary-4402';
const CANARY_TITLE = 'Board-Deck-Canary-1195';

export const privacy: Suite = {
  name: 'privacy',
  description: 'Nothing readable leaves the machine, and the passcode is never requested.',

  async run(grader: Grader) {
    const env = await startEnv();
    try {
      const reply = await env.call('create_diagram', {
        workspace_id: env.api.workspaceId,
        name: CANARY_TITLE,
        spec: {
          title: CANARY_TITLE,
          nodes: [
            { id: 'a', label: CANARY_NODE },
            { id: 'b', label: 'Ledger' },
          ],
          edges: [{ from: 'a', to: 'b', label: CANARY_EDGE }],
        },
      });

      const sheetId = sheetIdFrom(reply);
      const wire = env.api.requests.map((r) => r.body).join('\n');

      grader.check(
        {
          id: 'labels-not-on-the-wire',
          title: 'no node label, edge label, or title appears in any request body',
          guards: 'This is the entire end-to-end encryption claim. If it fails, the claim is false.',
          critical: true,
        },
        !wire.includes(CANARY_NODE) && !wire.includes(CANARY_EDGE) && !wire.includes(CANARY_TITLE),
        [CANARY_NODE, CANARY_EDGE, CANARY_TITLE].filter((c) => wire.includes(c)).join(', '),
      );

      const post = env.api.requests.find((r) => r.method === 'POST' && r.path.endsWith('/sheets'));
      grader.check(
        {
          id: 'sheet-name-sealed',
          title: 'the sheet name sent to the server is the [encrypted] sentinel',
          guards: 'Sheet names are content: a dashboard of readable titles leaks the whole map.',
          critical: true,
        },
        Boolean(post) && JSON.parse(post!.body).name === '[encrypted]',
        post?.body.slice(0, 200),
      );

      grader.check(
        {
          id: 'ciphertext-is-real',
          title: 'the blob the server stored decrypts back to the diagram',
          guards: 'Sending nothing readable is only useful if the real content is in there.',
        },
        sheetId
          ? (await env.open(sheetId)).elements.some(
              (e: any) => e.originalText === CANARY_NODE,
            )
          : false,
      );

      // A local usage log exists; it must record shapes and counts, never content.
      grader.check(
        {
          id: 'no-content-in-transit-metadata',
          title: 'the workspace id is sent, but no diagram content rides along with it',
          guards: 'Metadata leaks are how "encrypted" products turn out to be readable.',
        },
        !wire.includes('Ledger'),
      );
    } finally {
      await env.close();
    }

    // ─── The locked account ──────────────────────────────────────────────────
    // Reading needs a key the server deliberately cannot obtain on its own. What
    // it does about that is the most consequential message it ever returns.
    const locked = await startEnv({ unlocked: false });
    try {
      const sheet = await locked.seed('Architecture', []);
      const answer = await locked.call('read_sheet', {
        workspace_id: locked.api.workspaceId,
        sheet_id: sheet.id,
      });

      grader.check(
        {
          id: 'locked-explains-itself',
          title: 'a locked read returns the exact unlock command instead of an opaque error',
          guards: 'An unexplained failure gets retried forever or reported as a broken product.',
        },
        answer.includes('@drawpro/mcp login'),
        answer,
      );

      grader.check(
        {
          id: 'locked-says-no-restart',
          title: 'the message says the same tool can simply be retried afterwards',
          guards: 'Otherwise the model tells the user to restart Claude, which is not needed.',
        },
        /do NOT need to restart|not need to restart|try the same tool again/i.test(answer),
        answer,
      );

      grader.check(
        {
          id: 'never-asks-for-the-passcode',
          title: 'the message forbids asking the user for their passcode',
          guards:
            'The passcode is the account master secret. A model that asks for it puts it in a transcript, which is exactly what the out-of-band unlock exists to prevent.',
          critical: true,
        },
        /never ask the user for their passcode/i.test(answer),
        answer,
      );

      const names = await locked.call('list_workspaces');
      grader.check(
        {
          id: 'locked-degrades-softly',
          title: 'listing still returns ids while names stay unreadable',
          guards: 'A locked account should be navigable, not bricked.',
        },
        names.includes(locked.api.workspaceId) && /encrypted/i.test(names),
        names,
      );
    } finally {
      await locked.close();
    }
  },
};
