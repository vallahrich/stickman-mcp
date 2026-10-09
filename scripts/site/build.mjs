import fs from "node:fs/promises";
import path from "node:path";
import { buildCatalogue, repo } from "./catalogue.mjs";
import { buildStories } from "./stories.mjs";
import { removeRetiredPresentationAssets } from "./retired-presentations.mjs";
import { showcaseSection } from "./showcase-section.mjs";

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
const css = await fs.readFile(path.join(repo, "site", "styles.css"), "utf8");
const js = await fs.readFile(path.join(repo, "site", "catalogue.js"), "utf8");
const encode = data => JSON.stringify(data).replaceAll("<", "\\u003c");
let html = await fs.readFile(path.join(repo, "site", "index.html"), "utf8");
if (candidate) {
  const version = JSON.parse(await fs.readFile(path.join(repo, "package.json"), "utf8")).version;
  html = html.replace('<meta name="robots" content="noindex,nofollow">', '<meta name="robots" content="index,follow">')
    .replace('<span class="badge">Private preview</span>', '<span class="badge">Release candidate</span>')
    .replace("Build the private checkout first. Review the setup command before adding the server to your agent.", "Install the matching reviewed tarball. Point your agent at the installed package directory.")
    .replace('<h3>1. Build</h3><pre>npm ci\nnpm run build</pre>', '<h3>1. Install</h3><pre>npm install ./vallahrich-stickman-mcp-0.1.0-rc.1.tgz\nnpx stickman discover</pre>')
    .replace("Checkout path", "Installed package path")
    .replace("C:\\Projects\\stickman-mcp", "C:\\Projects\\demo\\node_modules\\@vallahrich\\stickman-mcp")
    .replaceAll("0.1.0-rc.1", version);
  html = html.replace('href="source-notices.md">Sources &amp; notices</a>', 'href="source-notices.md">Sources &amp; notices</a><a href="NOTICE">Attribution</a><a href="rights.md">Rights</a><a href="LICENSE">MIT license</a>');
}
html = html.replace('<link rel="stylesheet" href="styles.css"><script src="catalogue.js" defer></script>', `<style>${css}</style>`)
  .replace("__CATALOGUE_DATA__", encode(catalogue))
  .replace("__SHOWCASE_SECTION__", showcase)
  .replace("</body>", `<script>${js}</script></body>`);
await fs.writeFile(path.join(output, "index.html"), html);
await fs.writeFile(path.join(output, "robots.txt"), candidate ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n");
await fs.copyFile(path.join(repo, "docs", "mcp-setup.md"), path.join(output, "connection-guide.md"));
await fs.copyFile(path.join(repo, "docs", "agent-integration.md"), path.join(output, "llms.txt"));
await fs.copyFile(path.join(repo, "docs", "showcase-sources.md"), path.join(output, "source-notices.md"));
if (candidate) {
  for (const name of ["LICENSE", "NOTICE"]) await fs.copyFile(path.join(repo, name), path.join(output, name));
  await fs.copyFile(path.join(repo, "docs/rights.md"), path.join(output, "rights.md"));
}
await fs.writeFile(path.join(output, "capabilities.json"), JSON.stringify({
  name: "Stickman MCP", description: "Local deterministic stick-figure SVG/HTML animation for IT and digital-services presentations, websites and videos",
  publication: candidate ? "local-release-candidate-not-published" : "private", transport: "stdio", runtimeMotionIds: catalogue.runtimeMotionIds,
  tools: ["discover", "describe", "schema", "validate", "compile", "preview", "export", "story",
    "compose_film", "render_film", "list_film_assets", "check_join", "author_motion", "preview_motion"].map(name => `stickman_${name}`),
  catalogue: "catalogue.json", stories: "stories.json", setup: "connection-guide.md", examples: ["cloud architecture explanation", "IT service workflow", "cybersecurity briefing"],
  limitations: ["Catalogue previews are not runtime integration", "Arbitrary contact-safe choreography and cross-slide continuity are not qualified", "No guaranteed automatic client discovery"]
}, null, 2) + "\n");
console.log(JSON.stringify({ output, development, motions: catalogue.motionCount, stories: stories.length, runtimeIds: catalogue.runtimeMotionIds.length }));
