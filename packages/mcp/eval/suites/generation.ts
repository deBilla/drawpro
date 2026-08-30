import { validateScene } from '@drawpro/diagram';
import type { Grader, Suite } from '../grade';
import { sheetIdFrom, startEnv } from '../harness';

/**
 * What a spec turns into.
 *
 * The claim this package makes is that a model supplying only "what connects to
 * what" gets a diagram that is actually readable — bound arrows, no overlapping
 * boxes, text inside its shape. These grade the artefact, not the transcript.
 */

const SPEC = {
  title: 'Login flow',
  nodes: [
    { id: 'browser', label: 'Browser', shape: 'rectangle' as const },
    { id: 'api', label: 'API', shape: 'rectangle' as const },
    { id: 'pg', label: 'Postgres', shape: 'ellipse' as const },
    { id: 'redis', label: 'Redis — refresh tokens', shape: 'ellipse' as const },
    { id: 'deny', label: '401 Unauthorized', shape: 'diamond' as const },
  ],
  edges: [
    { from: 'browser', to: 'api', label: 'credentials' },
    { from: 'api', to: 'pg', label: 'look up user' },
    { from: 'api', to: 'redis', label: 'store refresh token' },
    { from: 'api', to: 'deny', label: 'no match', style: 'dashed' as const },
    { from: 'deny', to: 'browser' },
  ],
};

function overlaps(a: any, b: any): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

export const generation: Suite = {
  name: 'generation',
  description: 'A coordinate-free spec becomes a diagram that renders cleanly.',

  async run(grader: Grader) {
    const env = await startEnv();
    try {
      const reply = await env.call('create_diagram', {
        workspace_id: env.api.workspaceId,
        name: 'Login flow',
        spec: SPEC,
      });

      const sheetId = sheetIdFrom(reply);
      grader.check(
        {
          id: 'creates-and-links',
          title: 'a valid spec creates a sheet and returns a link to it',
          guards: 'Without the link the user cannot find what was just made.',
          critical: true,
        },
        Boolean(sheetId),
        reply,
      );
      if (!sheetId) return;

      const scene = await env.open(sheetId);
      const elements = scene.elements as any[];
      const shapes = elements.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type));
      const arrows = elements.filter((e) => e.type === 'arrow');

      grader.check(
        {
          id: 'node-per-participant',
          title: 'one shape per node in the spec',
          guards: 'A dropped participant is a diagram that lies about the system.',
        },
        shapes.length === SPEC.nodes.length,
        `${shapes.length} shapes for ${SPEC.nodes.length} nodes`,
      );

      grader.check(
        {
          id: 'edge-per-connection',
          title: 'one arrow per edge in the spec',
          guards: 'A dropped edge is a connection the reader will not know exists.',
        },
        arrows.length === SPEC.edges.length,
        `${arrows.length} arrows for ${SPEC.edges.length} edges`,
      );

      grader.check(
        {
          id: 'labels-survive',
          title: 'every node label appears in the scene',
          guards: 'Boxes without their labels are the failure this tool replaces.',
        },
        SPEC.nodes.every((n) => elements.some((e) => e.type === 'text' && e.originalText === n.label)),
        elements.filter((e) => e.type === 'text').map((e) => e.originalText).join(' | '),
      );

      grader.check(
        {
          id: 'arrows-bound',
          title: 'every arrow is bound to a shape at both ends',
          guards: 'Unbound arrows detach the moment anyone moves a box in the editor.',
        },
        arrows.length > 0 &&
          arrows.every((a) => a.startBinding?.elementId && a.endBinding?.elementId),
        arrows.map((a) => `${a.startBinding?.elementId ?? 'none'}->${a.endBinding?.elementId ?? 'none'}`).join(' '),
      );

      const issues = validateScene(elements);
      const errors = issues.filter((i) => i.level === 'error');
      grader.check(
        {
          id: 'scene-invariants',
          title: 'the generated scene passes its own structural validator',
          guards: 'Broken bindings and spilled text render as a visibly wrong diagram.',
          critical: true,
        },
        errors.length === 0,
        errors.map((e) => e.message).join('; '),
      );

      let collisions = 0;
      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
          if (overlaps(shapes[i], shapes[j])) collisions++;
        }
      }
      grader.check(
        {
          id: 'no-overlapping-boxes',
          title: 'no two node boxes overlap',
          guards: 'Overlapping boxes are the single most common hand-written-JSON defect.',
          critical: true,
        },
        collisions === 0,
        `${collisions} overlapping pair(s)`,
      );

      grader.check(
        {
          id: 'title-rendered',
          title: 'a spec title becomes a title element',
          guards: 'An untitled sheet in a list of sheets is unidentifiable.',
        },
        elements.some((e) => e.type === 'text' && e.originalText === SPEC.title),
      );

      grader.check(
        {
          id: 'count-is-truthful',
          title: 'the element count in the reply matches the sheet that was written',
          guards: 'A model relays this number to the user; a wrong one is a quiet lie.',
        },
        reply.includes(`${elements.length} elements`),
        `reply said: ${reply.split('\n')[0]}`,
      );

      // Reading back is the other half of the loop: a diagram that cannot be
      // described is one Claude cannot extend in a later session.
      const outline = await env.call('read_sheet', {
        workspace_id: env.api.workspaceId,
        sheet_id: sheetId,
      });
      grader.check(
        {
          id: 'round-trips',
          title: 'read_sheet reports back every participant it just wrote',
          guards: 'Extending an existing diagram starts by reading it.',
        },
        SPEC.nodes.every((n) => outline.includes(n.label)),
        outline,
      );
    } finally {
      await env.close();
    }
  },
};
