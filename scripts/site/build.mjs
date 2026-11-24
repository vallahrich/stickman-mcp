import fs from "node:fs/promises";
import path from "node:path";
import { COMPACT_CLIENT_RENDERER_JS } from "../../dist/index.js";
import { blueprintSection } from "./blueprint-section.mjs";
import { buildCatalogue, repo } from "./catalogue.mjs";
import { buildHeadMetadata, generateDiscoveryFiles } from "./discovery.mjs";
import { buildStories } from "./stories.mjs";
import { removeRetiredPresentationAssets } from "./retired-presentations.mjs";
import { showcaseSection } from "./showcase-section.mjs";
import { studioSection } from "./studio-section.mjs";

const args = process.argv.slice(2);
if (args.some(arg => !["--dev", "--release-candidate"].includes(arg))) throw new Error("Use site:build with optional --dev or --release-candidate; neither publishes a site.");
const development = args.includes("--dev");
const candidate = args.includes("--release-candidate");
if (candidate && (development || !process.env.STICKMAN_SITE_OUTPUT)) throw new Error("Release candidate requires an isolated STICKMAN_SITE_OUTPUT, without --dev.");
const output = process.env.STICKMAN_SITE_OUTPUT ? path.resolve(process.env.STICKMAN_SITE_OUTPUT) : path.join(repo, "dist", development ? "site-dev" : "site");
await fs.mkdir(output, { recursive: true });
await removeRetiredPresentationAssets(output);
const catalogue = await buildCatalogue(output, { development });
if (candidate) {
  catalogue.publication = "local-release-candidate-not-published";
  await fs.writeFile(path.join(output, "catalogue.json"), JSON.stringify(catalogue, null, 2) + "\n");
}
const stories = await buildStories(output);
const showcase = await showcaseSection(output);
const studio = await studioSection(repo);
const blueprint = await blueprintSection(repo);
const css = await fs.readFile(path.join(repo, "site", "styles.css"), "utf8");
const js = await fs.readFile(path.join(repo, "site", "catalogue.js"), "utf8");
const appJs = await fs.readFile(path.join(repo, "site", "app.js"), "utf8");
const encode = data => JSON.stringify(data).replaceAll("<", "\\u003c");
const version = JSON.parse(await fs.readFile(path.join(repo, "package.json"), "utf8")).version;
const discoveryHead = buildHeadMetadata({ version, releaseCandidate: candidate });
// Checkout line endings differ across platforms. Normalize before matching
// multiline installation snippets so candidate commands never retain npm ci.
let html = (await fs.readFile(path.join(repo, "site", "index.html"), "utf8")).replace(/\r\n/g, "\n");
if (candidate) {
  html = html.replace('<meta name="robots" content="noindex,nofollow">', '<meta name="robots" content="index,follow">')
    .replace('<span class="badge">v0.3 · Deterministic MCP</span>', `<span class="badge">v${version} · Local MCP</span>`)
    .replace("Build the local checkout first. Review the setup command before adding the server to your agent.", "Install the matching reviewed tarball. Point your agent at the installed package directory.")
    .replace('<h3>1. Build</h3><pre>npm ci\nnpm run build</pre>', `<h3>1. Install</h3><pre>npm install ./vallahrich-stickman-mcp-${version}.tgz\nnpx stickman discover</pre>`)
    .replace("Checkout path", "Installed package path")
    .replace("C:\\Projects\\stickman-mcp", "C:\\Projects\\demo\\node_modules\\@vallahrich\\stickman-mcp")
    .replaceAll("0.1.0-rc.1", version);
  html = html.replace('href="source-notices.md">Sources &amp; notices</a>', 'href="source-notices.md">Sources &amp; notices</a><a href="NOTICE">Attribution</a><a href="rights.md">Rights</a><a href="LICENSE">MIT license</a>');
  if (!html.includes(`vallahrich-stickman-mcp-${version}.tgz`)) {
    throw new Error("Candidate installation snippet failed to inject tarball version.");
  }
}
html = html.replace("<!-- DISCOVERY_HEAD -->", discoveryHead)
  .replace('<link rel="stylesheet" href="styles.css"><script src="catalogue.js" defer></script><script src="app.js" defer></script>', `<style>${css}</style>`)
  .replace("__CATALOGUE_DATA__", encode(catalogue))
  .replace("__SHOWCASE_SECTION__", showcase)
  .replace("__STUDIO_SECTION__", studio)
  .replace("__BLUEPRINT_SECTION__", blueprint)
  .replace("</body>", `<script>${js}\n${COMPACT_CLIENT_RENDERER_JS}\n${appJs}</script></body>`);
await fs.writeFile(path.join(output, "index.html"), html);
await generateDiscoveryFiles(output, { version, releaseCandidate: candidate, repoRoot: repo, catalogue });
await fs.copyFile(path.join(repo, "docs", "mcp-setup.md"), path.join(output, "connection-guide.md"));
await fs.copyFile(path.join(repo, "docs", "showcase-sources.md"), path.join(output, "source-notices.md"));
if (candidate) {
  for (const name of ["LICENSE", "NOTICE"]) await fs.copyFile(path.join(repo, name), path.join(output, name));
  await fs.copyFile(path.join(repo, "docs/rights.md"), path.join(output, "rights.md"));
}
await fs.writeFile(path.join(output, "capabilities.json"), JSON.stringify({
  name: "Stickman MCP", description: "Local deterministic stick-figure SVG/HTML animation for IT and digital-services presentations, websites and videos",
  publication: candidate ? "local-release-candidate-not-published" : "private", transport: "stdio",
  contracts: ["stickman.animation/v1", "stickman.animation/v2", "stickman.movie/v1"], runtimeMotionIds: catalogue.runtimeMotionIds,
  tools: ["discover", "describe", "schema", "validate", "compile", "choreograph", "storyboard", "preview", "export", "story",
    "movie", "critique", "compose_film", "render_film", "list_film_assets", "check_join", "author_motion", "preview_motion"].map(name => `stickman_${name}`),
  resources: ["stickman://catalog", "stickman://schema/v1", "stickman://schema/v2", "stickman://schema/movie-v1",
    "stickman://anchors", "stickman://props", "stickman://rubric/human-critique", "ui://stickman/player",
    "stickman://templates/presentation-pitch", "stickman://templates/two-actor-dialogue", "stickman://templates/idea-reveal",
    "stickman://templates/sports-action", "stickman://templates/incident-warroom-movie", "stickman://templates/two-actor-handoff"],
  prompts: ["choreograph-slide", "two-actor-dialogue", "create-and-critique-movie"],
  catalogue: "catalogue.json", stories: "stories.json", setup: "connection-guide.md", examples: ["cloud architecture explanation", "IT service workflow", "cybersecurity briefing", "incident war room recovery"],
  limitations: ["Catalogue previews are not runtime integration", "Arbitrary contact-safe choreography and cross-slide continuity are not qualified", "No guaranteed automatic client discovery"]
}, null, 2) + "\n");
console.log(JSON.stringify({ output, development, motions: catalogue.motionCount, stories: stories.length, runtimeIds: catalogue.runtimeMotionIds.length }));
