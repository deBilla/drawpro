import type { Grader, Suite } from '../grade';
import { startEnv } from '../harness';

/**
 * The surface a model actually sees.
 *
 * A tool it cannot understand from the inventory alone is a tool it will
 * misuse, and no amount of correct implementation behind it helps. These check
 * the offer, not the behaviour.
 */

const EXPECTED = [
  'create_diagram',
  'edit_sheet_text',
  'import_sheet',
  'list_sheets',
  'list_workspaces',
  'read_sheet',
  'update_diagram',
  'validate_spec',
];

/** Fields that would mean the caller is being asked to do layout. */
const LAYOUT_FIELDS = ['x', 'y', 'width', 'height', 'position', 'coordinates'];

export const contract: Suite = {
  name: 'contract',
  description: 'The tool inventory a model is offered, and what it promises.',

  async run(grader: Grader) {
    const env = await startEnv();
    try {
      const { tools } = await env.client.listTools();
      const names = tools.map((t) => t.name).sort();

      grader.check(
        {
          id: 'inventory',
          title: 'exposes exactly the eight documented tools',
          guards: 'A tool that exists but is undocumented gets used by guesswork.',
        },
        JSON.stringify(names) === JSON.stringify(EXPECTED),
        names.join(', '),
      );

      grader.check(
        {
          id: 'descriptions',
          title: 'every tool describes itself in more than a label',
          guards: 'Selection between eight tools is made from these strings alone.',
        },
        tools.every((t) => (t.description ?? '').length > 40),
        tools.map((t) => `${t.name}:${(t.description ?? '').length}`).join(' '),
      );

      // The spec schema must not offer anywhere to put coordinates. If it does,
      // a model will fill them in, and fight the layout engine that exists to
      // stop diagrams overlapping.
      const create = tools.find((t) => t.name === 'create_diagram');
      const nodeProps = Object.keys(
        (create?.inputSchema as any)?.properties?.spec?.properties?.nodes?.items?.properties ?? {},
      );
      grader.check(
        {
          id: 'no-layout-fields',
          title: 'the node schema offers no place to put coordinates',
          guards: 'Hand-supplied geometry is what produces the overlapping boxes.',
        },
        nodeProps.length > 0 && !nodeProps.some((p) => LAYOUT_FIELDS.includes(p.toLowerCase())),
        `node properties: ${nodeProps.join(', ')}`,
      );

      // update_diagram destroys hand-drawn work. Its description is the only
      // warning a model gets, so the warning is part of the contract.
      const update = tools.find((t) => t.name === 'update_diagram')?.description ?? '';
      grader.check(
        {
          id: 'destructive-tool-says-so',
          title: 'update_diagram announces that it overwrites, and names the tool to run first',
          guards: 'Silent wholesale replacement of a hand-drawn sheet is unrecoverable.',
          critical: true,
        },
        /overwrit/i.test(update) && /read_sheet/.test(update),
        update,
      );

      // Two of the three writing tools are destructive in different ways, so the
      // non-destructive one has to be reachable by description.
      const edit = tools.find((t) => t.name === 'edit_sheet_text')?.description ?? '';
      grader.check(
        {
          id: 'safe-alternative-is-findable',
          title: 'edit_sheet_text points at itself as the safe path for a drawn sheet',
          guards: 'Otherwise every wording fix reaches for the tool that regenerates layout.',
        },
        /update_diagram/.test(edit),
        edit,
      );

      grader.check(
        {
          id: 'validate-is-side-effect-free',
          title: 'validate_spec needs no workspace, so it cannot write anywhere',
          guards: 'A dry run that could write is not a dry run.',
        },
        !Object.keys((tools.find((t) => t.name === 'validate_spec')?.inputSchema as any)?.properties ?? {}).includes(
          'workspace_id',
        ),
      );
    } finally {
      await env.close();
    }
  },
};
