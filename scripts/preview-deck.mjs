import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const client = new Client({ name: "stickman-local-deck", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(repo, "dist", "mcp.js"), "--root", resolve(repo, "output")],
  stderr: "inherit"
});
await client.connect(transport);
await client.listTools();
const modules = new Set(["browser.js", "compiler.js", "contract.js", "render.js", "keyboard.js"]);
const server = createServer(async (request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (request.headers.host !== origin.slice(7)
    || (request.headers.origin && request.headers.origin !== origin)) {
    response.writeHead(403);
    response.end("This preview accepts same-origin localhost requests only.");
    return;
  }
  const url = new URL(request.url, origin);
  try {
    if (request.method === "POST" && url.pathname === "/api/compile") {
      if (!request.headers["content-type"]?.startsWith("application/json")) {
        response.writeHead(415); response.end("Use application/json."); return;
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          response.writeHead(413); response.end("Animation request exceeds 256 KiB."); return;
        }
        chunks.push(chunk);
      }
      let animation;
      try { animation = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { response.writeHead(400); response.end("Invalid JSON animation document."); return; }
      const result = await client.callTool({ name: "stickman_compile", arguments: { animation } });
      response.writeHead(result.isError ? 422 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(result.structuredContent));
      return;
    }
    if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
    let file;
    if (url.pathname === "/") file = resolve(repo, "examples", "browser-deck.html");
    else if (url.pathname.startsWith("/modules/") && modules.has(url.pathname.slice(9))) {
      file = resolve(repo, "dist", url.pathname.slice(9));
    } else if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    else { response.writeHead(404); response.end("Unknown preview resource."); return; }
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  } catch (error) {
    console.error(error);
    response.writeHead(500); response.end("Local preview failed; see terminal diagnostics.");
  }
});
server.listen(0, "127.0.0.1", () => {
  console.log(`Local deck preview: http://127.0.0.1:${server.address().port}/`);
  console.log("Compilation uses the actual local stdio MCP server. No public service or client settings are changed.");
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await client.close();
  process.disconnect?.();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.send) process.on("message", message => { if (message === "shutdown") shutdown(); });
