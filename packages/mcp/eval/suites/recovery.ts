import type { Grader, Suite } from '../grade';
import { sheetIdFrom, startEnv } from '../harness';

/**
 * What happens when the call is wrong.
 *
 * A refusal is read by a model deciding what to do next, so it has to say what
 * went wrong, whether a retry can work, and it must leave nothing half-written
 * behind. These are the checks that close the correction loop without the user
 * having to intervene.
 */

export const recovery: Suite = {
  name: 'recovery',
  description: 'Bad calls are refused with enough information to fix them.',

  async run(grader: Grader) {
    const env = await startEnv();
    try {
      // A spec naming a node it never introduces — the commonest authoring slip,
      // and the one the eval prompts reproduce.
      const before = env.api.sheets.size;
      const refused = await env.call('create_diagram', {
        workspace_id: env.api.workspaceId,
        name: 'Pipeline',
        spec: {
          nodes: [
            { id: 'ingress', label: 'ingress' },
            { id: 'router', label: 'router' },
          ],
          edges: [
            { from: 'ingress', to: 'router' },
            { from: 'router', to: 'cache' },
          ],
        },
      });

      grader.check(
        {
          id: 'names-the-broken-thing',
          title: 'a dangling edge is refused by naming the node that is missing',
          guards: 'Without the name, the fix is a guess and the model retries blind.',
        },
        refused.includes('cache'),
        refused,
      );

      grader.check(
        {
          id: 'refusal-writes-nothing',
          title: 'a refused create leaves no sheet behind',
          guards: 'A half-created diagram is worse than none — nobody knows it is there.',
          critical: true,
        },
        env.api.sheets.size === before,
        `${before} sheets before, ${env.api.sheets.size} after`,
      );

      // The same call with the missing node added must now succeed, or the loop
      // the refusal message invites is not actually closeable.
      const fixed = await env.call('create_diagram', {
        workspace_id: env.api.workspaceId,
        name: 'Pipeline',
        spec: {
          nodes: [
            { id: 'ingress', label: 'ingress' },
            { id: 'router', label: 'router' },
            { id: 'cache', label: 'cache' },
          ],
          edges: [
            { from: 'ingress', to: 'router' },
            { from: 'router', to: 'cache' },
          ],
        },
      });
      grader.check(
        {
          id: 'correction-succeeds',
          title: 'the corrected spec the message implies is accepted',
          guards: 'A refusal that cannot be satisfied is a dead end dressed as guidance.',
        },
        Boolean(sheetIdFrom(fixed)),
        fixed,
      );

      // validate_spec is the dry run. It must find the same problems and touch
      // nothing while doing it.
      const countBeforeValidate = env.api.sheets.size;
      const dryRun = await env.call('validate_spec', {
        spec: {
          nodes: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'duplicate' },
          ],
          edges: [{ from: 'a', to: 'ghost' }],
        },
      });
      grader.check(
        {
          id: 'dry-run-finds-both',
          title: 'validate_spec reports the duplicate id and the dangling edge',
          guards: 'Checking before writing is only worth doing if it finds what writing would.',
        },
        dryRun.includes("Duplicate node id 'a'") && dryRun.includes("unknown node 'ghost'"),
        dryRun,
      );
      grader.check(
        {
          id: 'dry-run-is-dry',
          title: 'validate_spec creates nothing',
          guards: 'A dry run with side effects is a trap.',
        },
        env.api.sheets.size === countBeforeValidate,
      );

      // edit_sheet_text is all-or-nothing. Half-applied edits leave a state
      // nobody expected and a diff nobody can see without re-reading.
      const drawn = await env.seed('Hand drawn', [
        {
          id: 'box1',
          type: 'rectangle',
          x: 0, y: 0, width: 200, height: 80,
          boundElements: null, containerId: null,
        },
        {
          id: 'label1',
          type: 'text',
          x: 10, y: 20, width: 180, height: 40,
          text: 'Old wording here',
          originalText: 'Old wording here',
          fontSize: 20, lineHeight: 1.25, containerId: null, boundElements: null,
        },
      ]);

      const partial = await env.call('edit_sheet_text', {
        workspace_id: env.api.workspaceId,
        sheet_id: drawn.id,
        edits: [
          { find: 'Old wording here', replace: 'New wording here' },
          { find: 'A string that is not on this sheet', replace: 'irrelevant' },
        ],
      });

      const after = await env.open(drawn.id);
      const stillOld = after.elements.some((e: any) => e.originalText === 'Old wording here');

      grader.check(
        {
          id: 'all-or-nothing-edit',
          title: 'one unmatched find leaves every element untouched',
          guards: 'A partially applied edit is invisible until someone re-reads the sheet.',
          critical: true,
        },
        stillOld,
        partial,
      );

      grader.check(
        {
          id: 'says-what-did-not-match',
          title: 'the refusal reports that nothing was written',
          guards: 'Silence here reads as success and the wrong text ships.',
        },
        /nothing was written|no match|matched nothing/i.test(partial),
        partial,
      );

      // The same edit alone must work — proving the refusal was about the
      // unmatched string, not about the tool being unusable.
      await env.call('edit_sheet_text', {
        workspace_id: env.api.workspaceId,
        sheet_id: drawn.id,
        edits: [{ find: 'Old wording here', replace: 'New wording here' }],
      });
      const edited = await env.open(drawn.id);
      grader.check(
        {
          id: 'edit-preserves-geometry',
          title: 'a successful edit changes the text and no coordinate',
          guards: 'Rewriting a label must not silently redraw a hand-placed diagram.',
        },
        edited.elements.some((e: any) => e.originalText === 'New wording here') &&
          edited.elements.find((e: any) => e.id === 'box1')?.x === 0 &&
          edited.elements.length === 2,
        JSON.stringify(edited.elements.map((e: any) => ({ id: e.id, x: e.x, t: e.originalText }))),
      );

      const missingFile = await env.call('import_sheet', {
        workspace_id: env.api.workspaceId,
        file_path: '/nonexistent/path/to/diagram.excalidraw',
        name: 'Nope',
      });
      grader.check(
        {
          id: 'missing-file-explains',
          title: 'importing a file that is not there explains itself instead of crashing',
          guards: 'A stack trace here tells the model nothing it can act on.',
        },
        /could not read/i.test(missingFile),
        missingFile,
      );
    } finally {
      await env.close();
    }
  },
};
