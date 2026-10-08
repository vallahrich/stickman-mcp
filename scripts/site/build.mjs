import fs from "node:fs/promises";
import path from "node:path";
import { buildCatalogue, repo } from "./catalogue.mjs";
import { buildStories } from "./stories.mjs";
import { removeRetiredPresentationAssets } from "./retired-presentations.mjs";
import { showcaseSection } from "./showcase-section.mjs";

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--dev")) throw new Error("Use site:build with optional --dev; neither build publishes a site.");
const development = args.includes("--dev");
const output = path.join(repo, "dist", development ? "site-dev" : "site");
await fs.mkdir(output, { recursive: true });
await removeRetiredPresentationAssets(output);
const catalogue = await buildCatalogue(output, { development });
const stories = await buildStories(output);
const showcase = await showcaseSection(output);
const css = await fs.readFile(path.join(repo, "site", "styles.css"), "utf8");
const js = await fs.readFile(path.join(repo, "site", "catalogue.js"), "utf8");
const encode = data => JSON.stringify(data).replaceAll("<", "\\u003c");
let html = await fs.readFile(path.join(repo, "site", "index.html"), "utf8");
html = html.replace('<link rel="stylesheet" href="styles.css"><script src="catalogue.js" defer></script>', `<style>${css}</style>`)
  .replace("__CATALOGUE_DATA__", encode(catalogue))
  .replace("__SHOWCASE_SECTION__", showcase)
  .replace("</body>", `<script>${js}</script></body>`);
await fs.writeFile(path.join(output, "index.html"), html);
await fs.writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /\n");
await fs.copyFile(path.join(repo, "docs", "mcp-setup.md"), path.join(output, "connection-guide.md"));
await fs.copyFile(path.join(repo, "docs", "agent-integration.md"), path.join(output, "llms.txt"));
await fs.copyFile(path.join(repo, "docs", "showcase-sources.md"), path.join(output, "source-notices.md"));
await fs.writeFile(path.join(output, "capabilities.json"), JSON.stringify({
  name: "Stickman MCP", description: "Local deterministic stick-figure SVG/HTML animation for IT and digital-services presentations, websites and videos",
  publication: "private", transport: "stdio", runtimeMotionIds: catalogue.runtimeMotionIds,
  tools: ["discover", "describe", "schema", "validate", "compile", "preview", "export", "story"].map(name => `stickman_${name}`),
  catalogue: "catalogue.json", stories: "stories.json", setup: "connection-guide.md", examples: ["cloud architecture explanation", "IT service workflow", "cybersecurity briefing"],
  limitations: ["Catalogue previews are not runtime integration", "Arbitrary contact-safe choreography and cross-slide continuity are not qualified", "No guaranteed automatic client discovery"]
}, null, 2) + "\n");
console.log(JSON.stringify({ output, development, motions: catalogue.motionCount, stories: stories.length, runtimeIds: catalogue.runtimeMotionIds.length }));
