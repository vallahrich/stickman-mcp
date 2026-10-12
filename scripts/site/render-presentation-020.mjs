// Private MCP 0.2.0 pilot plus an explicitly experimental Stickman derivative.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { brief, storyboard } from "./presentation-020-inputs.mjs";
import { composeFilm, loadShowcaseResources } from "../film/runtime.mjs";
import { composePerformance, createPerformanceRenderer } from "./performance.mjs";
import { taskSpec, tokenTheme, compactSvg } from "./deck-provider.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../motions/keypose.mjs";

const arg = name => { const i = process.argv.indexOf("--" + name); return i < 0 ? undefined : process.argv[i + 1]; };
const renderer = path.resolve(arg("renderer") ?? "C:\\dynamic-presentations-mcp");
const root = path.resolve(arg("work") ?? ".release-local\\presentation-020");
const pkg = JSON.parse(await fs.readFile(path.join(renderer, "package.json"), "utf8"));
if (pkg.version !== "0.2.0") throw new Error(`Expected renderer 0.2.0, found ${pkg.version}.`);
await fs.mkdir(root, { recursive: true });
const brand = JSON.parse(await fs.readFile(path.resolve("examples\\cloud-deck\\brand.json"), "utf8"));
const inputs = { brief, brand, storyboard };
await fs.writeFile(path.join(root, "inputs.json"), JSON.stringify(inputs, null, 2));
const client = new Client({ name: "stickman-020-pilot", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath, args: [path.join(renderer, "dist", "mcp.js")],
  env: { ...process.env, DP_INPUT_ROOTS: [process.cwd(), root].join(path.delimiter), DP_OUTPUT_ROOT: root }
});
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content.find(part => part.type === "text")?.text ?? "{}");
  await fs.writeFile(path.join(root, name + ".json"), JSON.stringify(result, null, 2));
  if (response.isError || !result.ok) throw new Error(`${name}: ${JSON.stringify(result)}`);
  return result;
}
let pilot;
try {
  await client.connect(transport);
  const server = client.getServerVersion();
  if (server?.version !== "0.2.0") throw new Error("Compiled MCP server is not 0.2.0.");
  await fs.writeFile(path.join(root, "server.json"), JSON.stringify(server, null, 2));
  await fs.writeFile(path.join(root, "tool-contracts.json"), JSON.stringify(await client.listTools(), null, 2));
  await call("get_authoring_guide", { includeLedger: true, includeRubric: true });
  await call("validate_deck", inputs);
  await call("motion_status", { storyboard });
  const priorPath = path.join(root, "render_pilot.json");
  const prior = await fs.stat(priorPath).then(() => fs.readFile(priorPath, "utf8"), error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  pilot = await call("render_pilot", { ...inputs, name: "native-pilot.html", overwrite: true,
    ...(prior ? { reviewSessionId: JSON.parse(prior).reviewSessionId } : {}) });
  await call("get_review_context", { deckId: storyboard.deckId, reviewSessionId: pilot.reviewSessionId });
} finally { await client.close(); }

const resources = await loadShowcaseResources();
const source = await composeFilm({
  id: "review-020-neutral", bridge: "auto", performance: [{ motion: "present", root: 400, beat: "neutral", hold: 20 }],
  scenes: [{ id: "neutral", state: "review", cues: [{ frame: 0, text: "Review" }] }], set: []
}, resources);
const neutral = source.performance.clip.frames[0];
const actions = ["inspect", "compare", "review"];
const payload = {};
for (const [i, action] of actions.entries()) {
  const motion = taskSpec(action, neutral);
  // Let each deliberate action breathe, then hold instead of looping gestures.
  const spec = { ...motion.spec, frames: 77,
    poseKeys: motion.spec.poseKeys.map(key => ({ ...key, frame: key.frame * 2 })) };
  const clip = buildKeyPoseClip(spec, neutral);
  const gates = await keyPoseGates(clip, spec);
  if (!gates.passed) throw new Error(`${action}: ${JSON.stringify(gates)}`);
  const performance = composePerformance([{ motion: spec.id, root: 400, hold: 100 }], {
    motions: new Map([[spec.id, { spec, clip }]]), sampleClipMotion: resources.sampleClipMotion, neutral
  });
  const render = createPerformanceRenderer(performance, { ...resources, set: [], motions: new Map([[spec.id, { spec, clip }]]),
    theme: tokenTheme, clipFigure: false });
  const dict = [], frames = [], indices = new Map();
  for (let frame = 0; frame < performance.frames; frame++) {
    const layers = await render(frame);
    const svg = compactSvg(layers.actor);
    if (!indices.has(svg)) { indices.set(svg, dict.length); dict.push(svg); }
    frames.push(indices.get(svg));
  }
  payload[storyboard.slides[i].id] = { action, dict, frames };
}
const raw = await fs.readFile(pilot.path, "utf8");
const theme = (await fs.readFile(path.resolve("site\\styles.css"), "utf8")).split("*{box-sizing")[0];
const detect = `<script>(()=>{const param=new URLSearchParams(location.search).get("scoutTheme");document.documentElement.setAttribute("data-theme",param||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));})();</script>`;
const runtime = await fs.readFile(path.resolve("scripts\\site\\presentation-020-client.js"), "utf8");
const data = JSON.stringify(payload).replaceAll("<", "\\u003c");
const html = raw.replace("<head>", "<head>" + detect + "<style>" + theme + "</style>")
  .replace("</body>", `<script id="stickman-020-frames" type="application/json">${data}</script><script>${runtime}</script></body>`);
const output = path.join(root, "with-stickman.html");
await fs.writeFile(output, html);
await fs.writeFile(path.join(root, "integration-status.json"), JSON.stringify({
  renderer: "0.2.0", server: "0.2.0", mcpPilot: pilot.path, reviewSessionId: pilot.reviewSessionId,
  integration: output, integrationHash: createHash("sha256").update(html).digest("hex"),
  status: "experimental-provider-derivative", approvalRecorded: false,
  notice: "The integrated file is a local derivative, not the MCP artifact hash. Native pilot qualification does not qualify this derivative."
}, null, 2));
console.log(JSON.stringify({ output, native: pilot.path, reviewSessionId: pilot.reviewSessionId, renderer: pkg.version }));

// A qualified native pilot does not cover the injected local derivative.
if (arg("review")) {
  const report = JSON.parse(await fs.readFile(path.resolve(arg("review")), "utf8"));
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [path.join(renderer, "dist", "mcp.js")],
      env: { ...process.env, DP_INPUT_ROOTS: [process.cwd(), root].join(path.delimiter), DP_OUTPUT_ROOT: root }
    }));
    const recorded = await call("record_review", { deckId: storyboard.deckId, reviewSessionId: pilot.reviewSessionId, report });
    if (!recorded.qualified) throw new Error("Independent review did not qualify the native pilot.");
    const delivered = await call("finalize_delivery", { ...inputs, stage: "pilot", reviewSessionId: pilot.reviewSessionId,
      name: "qualified-native-pilot.html", overwrite: true });
    if (delivered.deliveryStatus !== "qualified") throw new Error("MCP did not return a qualified pilot delivery.");
    console.log(JSON.stringify({ qualifiedNative: delivered.path, integrationQualified: false }));
  } finally { await client.close(); }
}
