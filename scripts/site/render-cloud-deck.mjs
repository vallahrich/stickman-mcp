// Reproducible engineering preview using the installed renderer's pure HTML API.
// This is NOT render_deck approval, and never creates/changes an approval record.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildStickmanDeck } from "./deck-provider.mjs";

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const renderer = arg("renderer"), work = arg("work"), out = arg("out");
if (!renderer || !work || !out) throw new Error("Use --renderer <installed renderer> --work <session folder> --out <story.html>");
const input = path.resolve("examples/cloud-deck");
const root = path.resolve(work);
await fs.mkdir(root, { recursive: true });
const { prepareDeck, publicValidation, renderPilot } = await import(pathToFileURL(path.join(renderer, "dist/service.js")));
const { renderHtml } = await import(pathToFileURL(path.join(renderer, "dist/render.js")));
const read = async name => JSON.parse(await fs.readFile(path.join(input, name + ".json"), "utf8"));
const sources = { brief: await read("brief"), brand: await read("brand"), storyboard: await read("storyboard") };
// All renderer assets/outputs stay inside the declared roots; installed source is read-only.
const roots = { inputRoots: [input, root], outputRoot: root };
const prepared = await prepareDeck(sources, roots);
await fs.writeFile(path.join(root, "renderer-validation.json"), JSON.stringify(publicValidation(prepared), null, 2));
if (!prepared.ok) throw new Error(JSON.stringify(prepared.diagnostics));
const pilot = await renderPilot(sources, roots, { name: "pilot-v10.html", overwrite: true });
if (!pilot.ok) throw new Error(JSON.stringify(pilot.diagnostics));
const raw = path.join(root, "workload-migration", "deck.html");
await fs.writeFile(raw, renderHtml(prepared.parsed.brief, prepared.parsed.brand, prepared.parsed.storyboard, { mode: "deck", assets: prepared.assets }));
const built = await buildStickmanDeck({ deckPath: raw, storyboardPath: path.join(input, "storyboard.json"), outPath: path.resolve(out) });
await fs.writeFile(path.join(root, "render-status.json"), JSON.stringify({
  status:"unapproved-engineering-preview", method:"validated pure renderHtml API + adapter-1.0 stickman provider",
  pilot:pilot.path, previewHash:pilot.previewHash, approvalRecorded:false,
  notice:"Implementation was authorised. This preview has not received pilot-specific user approval or a user rating."
}, null, 2));
console.log(JSON.stringify({ ...built.timing, bytes: built.bytes, out: path.resolve(out), renderer: "validated pure renderHtml engineering preview", pilot: pilot.path, approval: "not requested or recorded" }));
