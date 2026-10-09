// Reproducible engineering preview using the installed renderer's pure HTML API.
// This is NOT render_deck approval, and never creates/changes an approval record.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildStickmanDeck } from "./deck-provider.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const renderer = arg("renderer"), work = arg("work"), out = arg("out");
if (!renderer || !work || !out) throw new Error("Use --renderer <installed renderer> --work <session folder> --out <story.html>");
const input = path.resolve("examples/cloud-deck");
const root = path.resolve(work);
await fs.mkdir(root, { recursive: true });
const { prepareDeck, publicValidation } = await import(pathToFileURL(path.join(renderer, "dist/service.js")));
const { renderHtml } = await import(pathToFileURL(path.join(renderer, "dist/render.js")));
const read = async name => JSON.parse(await fs.readFile(path.join(input, name + ".json"), "utf8"));
const sources = { brief: await read("brief"), brand: await read("brand"), storyboard: await read("storyboard") };
// All renderer assets/outputs stay inside the declared roots; installed source is read-only.
const roots = { inputRoots: [input, root], outputRoot: root };
const client = new Client({ name: "stickman-cloud-authoring", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath, args: [path.join(renderer, "dist", "mcp.js")],
  env: { ...process.env, DP_INPUT_ROOTS: roots.inputRoots.join(path.delimiter), DP_OUTPUT_ROOT: root }
});
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  const text = response.content.find(part => part.type === "text")?.text;
  if (!text) throw new Error(`${name}: MCP returned no text result.`);
  const result = JSON.parse(text);
  await fs.writeFile(path.join(root, `mcp-${name}.json`), JSON.stringify(result, null, 2));
  if (response.isError || !result.ok) throw new Error(`${name}: ${JSON.stringify(result.diagnostics)}`);
  return result;
}
let pilot;
try {
  await client.connect(transport);
  await call("get_authoring_guide", { includeLedger: true, includeRubric: true });
  await call("validate_deck", sources);
  await call("motion_status", { storyboard: sources.storyboard });
  pilot = await call("render_pilot", { ...sources, name: "pilot-review.html", overwrite: true });
} finally {
  await client.close();
}
const prepared = await prepareDeck(sources, roots);
await fs.writeFile(path.join(root, "renderer-validation.json"), JSON.stringify(publicValidation(prepared), null, 2));
if (!prepared.ok) throw new Error(JSON.stringify(prepared.diagnostics));
const raw = path.join(root, "workload-migration", "deck.html");
await fs.writeFile(raw, renderHtml(prepared.parsed.brief, prepared.parsed.brand, prepared.parsed.storyboard, { mode: "deck", assets: prepared.assets }));
const built = await buildStickmanDeck({ deckPath: raw, storyboardPath: path.join(input, "storyboard.json"), outPath: path.resolve(out) });
await fs.writeFile(path.join(root, "render-status.json"), JSON.stringify({
  status:"unapproved-engineering-preview", method:"MCP validate_deck + render_pilot; pure renderHtml full engineering preview + adapter-1.0 stickman provider",
  pilot:pilot.path, previewHash:pilot.previewHash, approvalRecorded:false,
  notice:"Implementation was authorised. This preview has not received pilot-specific user approval or a user rating."
}, null, 2));
console.log(JSON.stringify({ ...built.timing, bytes: built.bytes, out: path.resolve(out), renderer: "validated pure renderHtml engineering preview", pilot: pilot.path, approval: "not requested or recorded" }));
