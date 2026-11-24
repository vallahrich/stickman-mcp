import { isMainThread, parentPort } from "node:worker_threads";

export interface RasterWorkerRequest {
  id: number;
  svg: string;
  loadSystemFonts: boolean;
}

export interface RasterWorkerResponse {
  id: number;
  png?: Uint8Array;
  error?: string;
}

interface ResvgCtor {
  new (svg: string, options?: { font?: { loadSystemFonts?: boolean } }): {
    render(): { asPng(): Uint8Array };
  };
}

let cachedResvg: ResvgCtor | undefined;

async function getResvg(): Promise<ResvgCtor> {
  if (!cachedResvg) {
    const mod = await import("@resvg/resvg-js");
    cachedResvg = mod.Resvg;
  }
  return cachedResvg;
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on("message", async (msg: RasterWorkerRequest) => {
    try {
      const Resvg = await getResvg();
      const raw = new Resvg(msg.svg, {
        font: { loadSystemFonts: msg.loadSystemFonts }
      }).render().asPng();
      // Copy into an owned standalone ArrayBuffer so zero-copy transfer never fails on slab-backed Buffers.
      const out = new Uint8Array(raw.byteLength);
      out.set(raw);
      port.postMessage({ id: msg.id, png: out } satisfies RasterWorkerResponse, [out.buffer]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      port.postMessage({ id: msg.id, error: message } satisfies RasterWorkerResponse);
    }
  });
}
