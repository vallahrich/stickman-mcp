import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repo } from "./catalogue.mjs";

const mime = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".mp4": "video/mp4", ".vtt": "text/vtt", ".pdf": "application/pdf", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
export async function createSiteServer() {
  const root = await fs.realpath(path.join(repo, "dist", "site"));
  return http.createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
      catch { response.writeHead(400).end("Malformed request URL"); return; }
      const candidate = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
      if (!candidate.startsWith(root + path.sep)) { response.writeHead(403).end("Outside preview root"); return; }
      const filename = await fs.realpath(candidate);
      if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end("Outside preview root"); return; }
      const type = mime[path.extname(filename)];
      if (!type) { response.writeHead(404).end("Unsupported preview asset"); return; }
      const stat = await fs.stat(filename);
      if (!stat.isFile()) { response.writeHead(404).end("Asset not found"); return; }
      let start = 0, end = stat.size - 1, status = 200;
      const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
      if (request.headers.range) {
        const range = request.headers.range.match(/^bytes=(\d+)-(\d*)$/);
        if (!range) { response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end(); return; }
        start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
          response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end(); return;
        }
        status = 206; headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      }
      headers["Content-Length"] = end - start + 1;
      response.writeHead(status, headers);
      if (request.method === "HEAD" || stat.size === 0) { response.end(); return; }
      const stream = createReadStream(filename, { start, end });
      stream.on("error", error => { console.error(`Preview read failed: ${error.message}`); response.destroy(error); });
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) { response.writeHead(404).end("Asset not found"); }
      else { console.error(`Preview request failed: ${error.message}`); response.writeHead(500).end("Preview asset could not be read"); }
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--port");
  const port = index < 0 ? 4173 : Number(process.argv[index + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Provide a valid --port");
  const server = await createSiteServer();
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Private preview: http://127.0.0.1:${port}/`));
}
