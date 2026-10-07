import fs from "node:fs/promises";
import path from "node:path";
import { buildCatalogue, repo } from "./catalogue.mjs";

const output = path.join(repo, "dist", "site");
await fs.mkdir(output, { recursive: true });
const catalogue = await buildCatalogue(output);
let comparison = { slides: [] };
try { comparison = JSON.parse(await fs.readFile(path.join(output, "demo", "comparison.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const css = await fs.readFile(path.join(repo, "site", "styles.css"), "utf8");
const js = await fs.readFile(path.join(repo, "site", "catalogue.js"), "utf8");
const encode = data => JSON.stringify(data).replaceAll("<", "\\u003c");
let html = await fs.readFile(path.join(repo, "site", "index.html"), "utf8");
html = html.replace('<link rel="stylesheet" href="styles.css"><script src="catalogue.js" defer></script>', `<style>${css}</style>`)
  .replace("__CATALOGUE_DATA__", encode(catalogue))
  .replace("__COMPARISON_DATA__", encode(comparison))
  .replace("</body>", `<script>${js}</script></body>`);
if (!comparison.slides.length) html = html.replace('id="comparison"', 'id="comparison" hidden');
try { await fs.access(path.join(output, "showcase.mp4")); }
catch (error) { if (error.code !== "ENOENT") throw error; html = html.replace('id="showcase"', 'id="showcase" hidden'); }
await fs.writeFile(path.join(output, "index.html"), html);
await fs.writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /\n");
await fs.copyFile(path.join(repo, "docs", "mcp-setup.md"), path.join(output, "connection-guide.md"));
await fs.copyFile(path.join(repo, "docs", "agent-integration.md"), path.join(output, "llms.txt"));
await fs.copyFile(path.join(repo, "docs", "showcase-sources.md"), path.join(output, "source-notices.md"));
await fs.writeFile(path.join(output, "capabilities.json"), JSON.stringify({
  name: "Stickman MCP", description: "Local deterministic stick-figure SVG/HTML animation for IT and digital-services presentations, websites and videos",
  publication: "private", transport: "stdio", runtimeMotionIds: catalogue.runtimeMotionIds,
  tools: ["discover", "describe", "schema", "validate", "compile", "preview", "export"].map(name => `stickman_${name}`),
  catalogue: "catalogue.json", setup: "connection-guide.md", examples: ["cloud architecture explanation", "IT service workflow", "cybersecurity briefing"],
  limitations: ["Catalogue approval is not runtime promotion", "Ratings do not train model weights", "Arbitrary contact-safe choreography and cross-slide continuity are not qualified", "No guaranteed automatic client discovery"]
}, null, 2) + "\n");
console.log(JSON.stringify({ output, approved: catalogue.approvedCount, runtimeIds: catalogue.runtimeMotionIds.length, mechanicalRequalification: catalogue.motions.filter(m => m.mechanicalCheck === "needs-requalification").map(m => m.id) }));
