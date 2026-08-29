import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

/**
 * Bundle the server into a single runnable file.
 *
 * @drawpro/client and @drawpro/diagram are workspace packages that are not
 * published, so they are inlined here. Everything else stays external and is
 * resolved from node_modules at run time — @phi-ag/argon2 in particular loads
 * its .wasm from its own package directory, which only works if it is a real
 * installed dependency rather than bundled.
 */
const external = [
  '@modelcontextprotocol/sdk',
  '@phi-ag/argon2',
  '@dagrejs/dagre',
  'fractional-indexing',
  'zod',
];

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external,
  // No shebang banner: esbuild preserves the one already at the top of
  // src/server.ts, and adding another puts a second on line 2, where node
  // parses it as JavaScript instead of ignoring it.
  logLevel: 'info',
});

chmodSync('dist/server.js', 0o755);
