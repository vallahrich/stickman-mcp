import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = path.resolve(process.argv[2] ?? path.join(repo, "output"));
const recipe = JSON.parse(await fs.readFile(new URL("./team-handoff.json", import.meta.url), "utf8"));
const client = new Client({ name: "film-example", version: "1.0.0" });
const call = async (name, args) => {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(JSON.stringify(response.structuredContent));
  return response.structuredContent.result;
};
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(repo, "dist", "mcp.js"), "--root", root], stderr: "inherit" }));
  const assets = await call("stickman_list_film_assets", {});
  console.log(JSON.stringify({ approvedFilmMotions: assets.motions.length }));
  console.log(JSON.stringify(await call("stickman_compose_film", { recipe })));
  console.log(JSON.stringify(await call("stickman_render_film", { recipe, outputDir: recipe.id, preview: true, qaFrames: 8 })));
} finally { await client.close(); }
