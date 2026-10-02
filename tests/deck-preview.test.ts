import { fork } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("compiles the deck scene through real stdio MCP and confines the local preview bridge", async () => {
  const child = fork(resolve("scripts", "preview-deck.mjs"), [], { silent: true, execArgv: [] });
  let diagnostics = "";
  child.stderr!.on("data", (chunk: Buffer) => { diagnostics += chunk.toString(); });
  const exited = new Promise<number | null>(resolveExit => child.once("exit", code => resolveExit(code)));
  try {
    const url = await new Promise<string>((resolveUrl, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error(`Preview startup timed out: ${diagnostics}`)), 30_000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Preview exited ${code}: ${diagnostics}`)); });
      child.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = /Local deck preview: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
        if (match) { clearTimeout(timeout); resolveUrl(match[1]!); }
      });
    });
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Compile with MCP and mount");
    expect((await fetch(`${url}modules/browser.js`)).status).toBe(200);
    expect((await fetch(`${url}modules/keyboard.js`)).status).toBe(200);
    expect((await fetch(`${url}modules/room.js`)).status).toBe(200);
    expect((await fetch(`${url}modules/world-motion.js`)).status).toBe(200);
    expect((await fetch(`${url}modules/mcp.js`)).status).toBe(404);
    expect((await fetch(`${url}api/compile`, {
      method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}"
    })).status).toBe(403);
    expect((await fetch(`${url}api/compile`, {
      method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}"
    })).status).toBe(415);
    expect((await fetch(`${url}api/compile`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad"
    })).status).toBe(400);
    expect((await fetch(`${url}api/compile`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: " ".repeat(256 * 1024 + 1)
    })).status).toBe(413);
    const animation = {
      version: "stickman.animation/v1", canvas: { width: 640, height: 400, fps: 30 },
      actor: { x: 200, groundY: 310 }, durationMs: 2400,
      actions: [{ action: "wave", startMs: 200, durationMs: 1600 }]
    };
    const compiled = await fetch(`${url}api/compile`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(animation)
    });
    expect(compiled.status).toBe(200);
    expect(await compiled.json()).toMatchObject({
      result: { valid: true, diagnostics: [], program: { contractVersion: "stickman.animation/v1", spec: animation } }
    });
    const invalid = await fetch(`${url}api/compile`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...animation, actions: [{ action: "dance", startMs: 0, durationMs: 1000 }] })
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      result: { valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unsupported_action" })]) }
    });
    expect(diagnostics).toBe("");
  } finally {
    if (child.connected) child.send("shutdown");
    const timeout = setTimeout(() => child.kill(), 5_000);
    await exited;
    clearTimeout(timeout);
  }
}, 45_000);
