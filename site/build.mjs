import { marked } from 'marked';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the GitHub Pages site from the markdown already in the repository.
 *
 * There is deliberately no second copy of the documentation. `docs/*.md` stays
 * the source of truth and is readable on GitHub; this script renders it. The
 * one page that is not a rendered file is the landing page, which is the
 * positioning statement and has nowhere else to live.
 *
 * The eval numbers are read from `packages/mcp/eval/results.json` at build
 * time, so a published claim about the suite cannot drift from what the suite
 * actually scored — the deploy workflow runs the eval immediately before this.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, '_site');

const REPO = 'https://github.com/deBilla/drawpro';
const NPM = 'https://www.npmjs.com/package/@drawpro/mcp';

/**
 * URL prefix the site is served under.
 *
 * A GitHub project page lives at /<repo>/, so every absolute link needs that
 * prefix; a custom domain or a user page serves from /. Set SITE_BASE to change
 * it — the deploy workflow passes the value Pages reports, so the two cannot
 * disagree.
 */
const BASE = (process.env.SITE_BASE ?? '/drawpro/').replace(/\/?$/, '/');

// ─── Data ────────────────────────────────────────────────────────────────────

function evalResults() {
  const path = join(root, 'packages/mcp/eval/results.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

const DOC_ORDER = [
  ['connect-claude-code', 'Connect Claude Code', 'Point Claude at your account in two commands'],
  ['mcp-tools', 'MCP tools', 'What each of the eight tools does, and which to reach for'],
  ['diagram-specs', 'Diagram specs', 'The authoring format, and why it has no coordinates'],
  ['tool-lifecycle', 'Tool lifecycle', 'Designing, testing, publishing and judging an MCP tool'],
  ['evaluation', 'Evaluation', 'How the server is measured, and how to reproduce it'],
  ['encryption', 'Encryption', 'The scheme, the wire format, and what the server can never see'],
  ['privacy', 'Privacy', "What leaves your machine, what doesn't, and what you can turn on"],
  ['operations', 'Operations', 'Deploys, migrations, builds'],
  ['development', 'Development', 'Repository layout and tests'],
];

// ─── Rendering ───────────────────────────────────────────────────────────────

const CSS = `
:root {
  --bg: #fbfbfa; --panel: #ffffff; --ink: #1a1a18; --muted: #6b6a65;
  --line: #e4e2dd; --accent: #2f5fd8; --accent-soft: #eef2fd;
  --ok: #157f4a; --ok-soft: #e8f5ee; --warn: #a8620a; --code-bg: #f4f3f0;
  --radius: 10px;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14140f; --panel: #1c1c18; --ink: #eceae3; --muted: #9d9b93;
    --line: #302f29; --accent: #8fabf5; --accent-soft: #1e2537;
    --ok: #6ed49b; --ok-soft: #16281e; --warn: #e0a760; --code-bg: #232320;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans);
       font-size: 16px; line-height: 1.65; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: var(--mono); font-size: 0.875em; background: var(--code-bg);
       padding: 0.15em 0.4em; border-radius: 4px; }
pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 16px; overflow-x: auto; line-height: 1.5; }
pre code { background: none; padding: 0; font-size: 0.83em; }
hr { border: none; border-top: 1px solid var(--line); margin: 40px 0; }
table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 0.92em; display: block; overflow-x: auto; }
th, td { text-align: left; padding: 9px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 0.82em; text-transform: uppercase; letter-spacing: 0.04em; }
blockquote { margin: 20px 0; padding: 2px 18px; border-left: 3px solid var(--line); color: var(--muted); }
img { max-width: 100%; }

.nav { border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 10; }
.nav-inner { max-width: 1080px; margin: 0 auto; padding: 0 24px; height: 56px;
             display: flex; align-items: center; gap: 26px; }
.brand { font-weight: 650; color: var(--ink); letter-spacing: -0.01em; }
.brand span { color: var(--muted); font-weight: 400; }
.nav a.link { color: var(--muted); font-size: 0.92em; }
.nav a.link:hover { color: var(--ink); text-decoration: none; }
.nav .spacer { flex: 1; }

.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.prose { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; }
.prose h1 { font-size: 2.1em; letter-spacing: -0.025em; margin: 0 0 8px; line-height: 1.2; }
.prose h2 { font-size: 1.35em; letter-spacing: -0.015em; margin: 44px 0 12px;
            padding-top: 16px; border-top: 1px solid var(--line); }
.prose h3 { font-size: 1.08em; margin: 30px 0 8px; }

.hero { padding: 84px 0 56px; border-bottom: 1px solid var(--line); }
.hero h1 { font-size: 3em; line-height: 1.08; letter-spacing: -0.035em; margin: 0 0 20px; max-width: 15ch; }
.hero p.lede { font-size: 1.2em; color: var(--muted); max-width: 60ch; margin: 0 0 32px; line-height: 1.55; }
.pill { display: inline-flex; align-items: center; gap: 8px; background: var(--accent-soft);
        color: var(--accent); border-radius: 999px; padding: 5px 14px; font-size: 0.8em;
        font-weight: 550; margin-bottom: 24px; }
.cmd { display: flex; align-items: center; gap: 12px; background: var(--code-bg);
       border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 18px;
       font-family: var(--mono); font-size: 0.88em; overflow-x: auto; max-width: 640px; }
.cmd .prompt { color: var(--muted); user-select: none; }

.grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); margin: 32px 0; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; }
.card h3 { margin: 0 0 8px; font-size: 1em; }
.card p { margin: 0; color: var(--muted); font-size: 0.92em; line-height: 1.55; }
.card a { font-size: 0.92em; }

section.band { padding: 56px 0; border-bottom: 1px solid var(--line); }
section.band h2 { font-size: 1.7em; letter-spacing: -0.02em; margin: 0 0 10px; }
section.band > .wrap > p { color: var(--muted); max-width: 64ch; margin: 0 0 8px; }

.score { display: flex; flex-wrap: wrap; align-items: center; gap: 28px; background: var(--ok-soft);
         border: 1px solid var(--line); border-radius: var(--radius); padding: 24px 28px; margin: 28px 0; }
.score .big { font-size: 2.6em; font-weight: 680; color: var(--ok); letter-spacing: -0.03em; line-height: 1; }
.score .meta { color: var(--muted); font-size: 0.9em; }
.score .meta strong { color: var(--ink); font-weight: 600; }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; }
@media (max-width: 760px) { .two-col { grid-template-columns: 1fr; gap: 24px; } .hero h1 { font-size: 2.2em; } }

.foot { padding: 40px 0 64px; color: var(--muted); font-size: 0.88em; }
.badge-ok { color: var(--ok); font-weight: 600; }
.toc { list-style: none; padding: 0; margin: 0; }
.toc li { padding: 7px 0; border-bottom: 1px solid var(--line); }
.toc .d { color: var(--muted); font-size: 0.88em; }
`;

function page({ title, description, body, active = '' }) {
  const link = (href, label, key) =>
    `<a class="link" href="${href}"${active === key ? ' style="color:var(--ink)"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description.replace(/"/g, '&quot;')}">
<style>${CSS}</style>
</head>
<body>
<nav class="nav"><div class="nav-inner">
  <a class="brand" href="${BASE}">DrawPro <span>MCP</span></a>
  ${link(`${BASE}docs/connect-claude-code.html`, 'Install', 'install')}
  ${link(`${BASE}docs/mcp-tools.html`, 'Tools', 'tools')}
  ${link(`${BASE}evals.html`, 'Evals', 'evals')}
  ${link(`${BASE}docs/`, 'Docs', 'docs')}
  <span class="spacer"></span>
  <a class="link" href="${REPO}">GitHub</a>
</div></nav>
${body}
<footer class="foot"><div class="wrap">
  MIT licensed · <a href="${REPO}">source</a> · <a href="${NPM}">@drawpro/mcp on npm</a>
</div></footer>
</body>
</html>`;
}

/** Render repo markdown, rewriting the in-repo .md links to site URLs. */
function renderMarkdown(text) {
  const html = marked.parse(text, { mangle: false, headerIds: true });
  return html
    .replace(/href="\.\/([a-z-]+)\.md"/g, 'href="./$1.html"')
    .replace(/href="([a-z-]+)\.md"/g, 'href="$1.html"')
    .replace(/href="\.\.\/README\.md"/g, `href="${BASE}"`);
}

// ─── Pages ───────────────────────────────────────────────────────────────────

function landing(results) {
  const score = results
    ? `<div class="score">
         <div><div class="big">${results.passed}/${results.total}</div></div>
         <div class="meta">
           <strong>Deterministic checks passing</strong> — v${results.version}, ${results.durationSeconds}s,
           no account and no API key required.<br>
           Reproduce it yourself: <code>npm run eval --workspace @drawpro/mcp</code>
         </div>
       </div>`
    : '';

  return `
<header class="hero"><div class="wrap">
  <div class="pill">Model Context Protocol server</div>
  <h1>Diagrams your agent can actually draw.</h1>
  <p class="lede">
    DrawPro is a diagramming platform built to be driven by an agent. Claude describes what
    connects to what; layout, sizing, text wrapping and arrow binding are derived. The result
    lands in your account as a real, editable Excalidraw sheet — encrypted before it leaves
    your machine.
  </p>
  <div class="cmd"><span class="prompt">$</span> claude mcp add drawpro --scope user -- npx -y @drawpro/mcp</div>
</div></header>

<section class="band"><div class="wrap">
  <h2>Why an MCP server, and not a prompt</h2>
  <p>Asking a model to write Excalidraw JSON by hand produces overlapping boxes and arrows
     bound to nothing, because coordinates are the part a language model is worst at and the
     part that decides whether a diagram is readable.</p>
  <div class="grid">
    <div class="card">
      <h3>Specs, not coordinates</h3>
      <p>A spec is nodes and edges. There is nowhere to put an x or a y — the schema does not
         offer one — so layout is computed by dagre every time, not guessed.</p>
    </div>
    <div class="card">
      <h3>Refusals that close the loop</h3>
      <p>An edge naming a node that does not exist is refused with that node's name, and
         nothing is written. The model reads the message and fixes it in the same turn.</p>
    </div>
    <div class="card">
      <h3>Reads back as meaning</h3>
      <p>A sheet returns as an outline of shapes and connections, not tens of thousands of
         characters of coordinates and style. Extending a diagram starts by reading it.</p>
    </div>
    <div class="card">
      <h3>Eight tools, three of them writers</h3>
      <p>Because one writer would be a trap: regenerating layout destroys a hand-drawn sheet,
         so wording changes and geometry changes get their own tools.</p>
    </div>
  </div>
</div></section>

<section class="band"><div class="wrap">
  <h2>Measured, not asserted</h2>
  <p>Anyone can claim their MCP server works. This one ships a suite that drives the real
     server over a real MCP stdio session and grades what comes out — runnable by a stranger,
     with no account, no API key and no network.</p>
  ${score}
  <div class="two-col">
    <div>
      <h3>What the checks protect</h3>
      <p style="color:var(--muted)">Every check states what breaks in the real world if it
      fails. Some are marked critical: a silent overwrite, a half-applied edit, a plaintext
      label on the wire, or a model asking the user to type their passcode into a chat.</p>
    </div>
    <div>
      <h3>And a judged suite for behaviour</h3>
      <p style="color:var(--muted)">A second suite drives a real model through the same
      prompts and grades the transcripts, with an ablation arm that removes the plugin. The
      delta between the arms is the number that says whether it earns its place.</p>
    </div>
  </div>
  <p style="margin-top:24px"><a href="${BASE}evals.html">See the full scorecard →</a></p>
</div></section>

<section class="band"><div class="wrap">
  <h2>The server runs on your machine, and that is the point</h2>
  <p>DrawPro is end-to-end encrypted. Diagrams are sealed in the client with X25519 + AES-256-GCM
     and the server stores only ciphertext — it cannot read your drawings, and neither can we.
     A hosted remote MCP server would have to receive plaintext to do its job, which would undo
     that property entirely. So it runs locally: encryption and decryption stay here, exactly as
     they do in the browser.</p>
  <div class="grid">
    <div class="card">
      <h3>The passcode never enters the chat</h3>
      <p>Reading needs your private key, unwrapped by an interactive <code>login</code> that
         stores it in the OS keychain. It is never a tool argument, so it never reaches the
         model's context — and a locked tool relays that instruction rather than asking.</p>
    </div>
    <div class="card">
      <h3>Sheet names are content too</h3>
      <p>Names are sealed at creation. The server sees <code>[encrypted]</code>; a dashboard
         of readable titles would leak the shape of everything you work on.</p>
    </div>
    <div class="card">
      <h3>Large scenes cost nothing to move</h3>
      <p>Because the server is local, <code>import_sheet</code> reads a file straight into the
         encrypted blob. The contents never pass through the model's context.</p>
    </div>
  </div>
  <p style="margin-top:20px"><a href="${BASE}docs/encryption.html">How the encryption works →</a>
     &nbsp;·&nbsp; <a href="${BASE}docs/privacy.html">What leaves your machine →</a></p>
</div></section>

<section class="band"><div class="wrap">
  <h2>Get started</h2>
  <div class="cmd" style="margin-bottom:14px"><span class="prompt">$</span> npx -y @drawpro/mcp connect dp_live_...</div>
  <div class="cmd"><span class="prompt">$</span> npx -y @drawpro/mcp login</div>
  <p style="margin-top:20px"><a href="${BASE}docs/connect-claude-code.html">Full setup, including where the token comes from →</a></p>
</div></section>`;
}

function docsIndex() {
  const rows = DOC_ORDER.filter(([slug]) => existsSync(join(root, 'docs', `${slug}.md`)))
    .map(
      ([slug, title, blurb]) =>
        `<li><a href="./${slug}.html">${title}</a><div class="d">${blurb}</div></li>`,
    )
    .join('\n');
  return `<div class="prose"><h1>Documentation</h1>
    <p style="color:var(--muted)">Rendered from the markdown in the repository, so what is
    published and what is in the tree cannot drift apart.</p>
    <ul class="toc">${rows}</ul></div>`;
}

function evalsPage(results) {
  const scorecard = join(root, 'packages/mcp/eval/SCORECARD.md');
  const body = existsSync(scorecard)
    ? renderMarkdown(readFileSync(scorecard, 'utf8'))
    : '<p>The scorecard has not been generated yet. Run <code>npm run eval --workspace @drawpro/mcp</code>.</p>';

  const banner = results
    ? `<div class="score">
         <div><div class="big">${results.passed}/${results.total}</div></div>
         <div class="meta"><strong>checks passing</strong> in ${results.durationSeconds}s ·
         @drawpro/mcp v${results.version} · generated ${results.generatedAt.slice(0, 10)}<br>
         <code>npm run eval --workspace @drawpro/mcp</code></div>
       </div>`
    : '';

  return `<div class="prose">${banner}${body}
    <h2>Reproducing this</h2>
    <p>Clone the repository, <code>npm install</code>, then run the command above. It needs no
    DrawPro account, no API key and no network: the suite starts a DrawPro API in the same
    process and points the real MCP server at it.</p>
    <p>A suite that has only ever passed proves nothing, so it is worth breaking something to
    watch it fail — the eval README names two one-line faults and what each one should catch.</p>
    </div>`;
}

// ─── Build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'docs'), { recursive: true });

const results = evalResults();

writeFileSync(
  join(out, 'index.html'),
  page({
    title: 'DrawPro MCP — diagrams your agent can actually draw',
    description:
      'An MCP server that turns a description of what connects to what into a real, editable, end-to-end encrypted Excalidraw diagram in your account.',
    body: landing(results),
    active: 'home',
  }),
);

writeFileSync(
  join(out, 'evals.html'),
  page({
    title: 'Evals — DrawPro MCP',
    description: 'How the DrawPro MCP server is measured, and how to reproduce the number.',
    body: evalsPage(results),
    active: 'evals',
  }),
);

writeFileSync(
  join(out, 'docs', 'index.html'),
  page({ title: 'Documentation — DrawPro MCP', description: 'DrawPro documentation.', body: docsIndex(), active: 'docs' }),
);

let count = 0;
for (const file of readdirSync(join(root, 'docs'))) {
  if (!file.endsWith('.md') || file === 'README.md') continue;
  const slug = file.replace(/\.md$/, '');
  const meta = DOC_ORDER.find(([s]) => s === slug);
  const html = renderMarkdown(readFileSync(join(root, 'docs', file), 'utf8'));
  writeFileSync(
    join(out, 'docs', `${slug}.html`),
    page({
      title: `${meta?.[1] ?? slug} — DrawPro MCP`,
      description: meta?.[2] ?? 'DrawPro documentation.',
      body: `<div class="prose">${html}</div>`,
      active: slug === 'mcp-tools' ? 'tools' : slug === 'connect-claude-code' ? 'install' : 'docs',
    }),
  );
  count++;
}

// Jekyll would otherwise swallow any path beginning with an underscore.
writeFileSync(join(out, '.nojekyll'), '');

// Published so the number on the site is checkable against the raw run.
if (results) {
  cpSync(join(root, 'packages/mcp/eval/results.json'), join(out, 'eval-results.json'));
}

console.log(`site: 3 pages + ${count} docs → ${out}`);
