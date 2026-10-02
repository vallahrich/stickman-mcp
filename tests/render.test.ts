import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
import { renderAnimatedSvg, renderHtml, renderSvgFrame } from "../src/render.js";

function preview(reduced: boolean) {
  const compiled = compileAnimation({
    version: "stickman.animation/v1",
    canvas: { width: 320, height: 240, fps: 24 },
    durationMs: 2000,
    actor: { x: 80, groundY: 200 },
    targets: { end: { x: 200, y: 200 } },
    actions: [{ action: "walk", startMs: 0, durationMs: 1600, target: "end" }]
  });
  const program = compiled.program!;
  const nodes = new Map<string, {
    value: string; textContent: string; attributes: Map<string, string | number>;
    listeners: Map<string, () => void>;
    setAttribute(key: string, value: string | number): void;
    addEventListener(event: string, listener: () => void): void;
  }>();
  for (const id of ["mode", "seek", "toggle", "head", "stage-svg", "ground", "pelvis", "neck", "left-foot", "right-foot", "left-hand", "right-hand", ...sampleAnimation(program, 0).segments.map(line => line.id)]) {
    const attributes = new Map<string, string | number>();
    const listeners = new Map<string, () => void>();
    nodes.set(id, {
      value: "", textContent: "Pause", attributes, listeners,
      setAttribute: (key, value) => { attributes.set(key, value); },
      addEventListener: (event, listener) => { listeners.set(event, listener); }
    });
  }
  const frames: ((now: number) => void)[] = [];
  const scheduled = new Map<number, (now: number) => void>();
  let requestId = 0;
  const script = /<script id="stickman-player">([\s\S]+?)<\/script>/.exec(renderHtml(program))![1]!;
  runInNewContext(script, {
    document: {
      querySelector: (selector: string) => nodes.get(selector === "#stage svg" ? "stage-svg" : selector.slice(1)) ?? null,
      getElementById: (id: string) => nodes.get(id) ?? null
    },
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: (callback: (now: number) => void) => {
      const id = ++requestId;
      scheduled.set(id, callback);
      frames.push(callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      const callback = scheduled.get(id);
      if (callback) frames.splice(frames.indexOf(callback), 1);
      scheduled.delete(id);
    }
  });
  return { nodes, frames, program };
}

describe("self-contained HTML startup controls", () => {
  it("starts reduced-motion previews paused with an accurate Play button and final pose", () => {
    const { nodes, frames, program } = preview(true);
    expect(nodes.get("mode")!.value).toBe("reduced");
    expect(nodes.get("toggle")!.textContent).toBe("Play");
    expect(frames).toHaveLength(0);
    expect(nodes.get("head")!.attributes.get("cx")).toBe(sampleAnimation(program, program.spec.durationMs, "reduced").head.x);
    nodes.get("toggle")!.listeners.get("click")!();
    expect(nodes.get("mode")!.value).toBe("normal");
    expect(nodes.get("toggle")!.textContent).toBe("Pause");
    expect(frames).toHaveLength(1);
  });

  describe("rig-safe vector frame playback", () => {
    it("preserves solved poses instead of interpolating independent bone endpoints", () => {
      const compiled = compileAnimation({
        version: "stickman.animation/v1",
        canvas: { width: 640, height: 360, fps: 24 },
        durationMs: 2400,
        actor: { x: 180, groundY: 290 },
        actions: [{ action: "wave", startMs: 300, durationMs: 1600 }]
      });
      expect(compiled.valid).toBe(true);
      const artifact = renderAnimatedSvg(compiled.program!);
      expect(artifact).toContain('calcMode="discrete"');
      expect(artifact).not.toContain('calcMode="linear"');
      const keys = /keyTimes="([^"]+)"/.exec(artifact)![1]!.split(";").map(Number);
      expect(keys).toHaveLength(145);
      expect(keys[0]).toBe(0);
      expect(keys.at(-1)).toBe(1);
      for (let index = 1; index < keys.length; index++) expect(keys[index]).toBeGreaterThan(keys[index - 1]!);
    });

    it("keeps distinct frame times on longer vector clips", () => {
      const compiled = compileAnimation({
        version: "stickman.animation/v1",
        canvas: { width: 640, height: 360, fps: 1 },
        durationMs: 20000,
        actor: { x: 180, groundY: 290 },
        actions: []
      });
      expect(compiled.valid).toBe(true);
      const keys = /keyTimes="([^"]+)"/.exec(renderAnimatedSvg(compiled.program!))![1]!.split(";").map(Number);
      expect(keys).toHaveLength(1201);
      for (let index = 1; index < keys.length; index++) expect(keys[index]).toBeGreaterThan(keys[index - 1]!);
    });
  });

  describe("prop paint parity", () => {
    it("uses the same visible outlined prop in HTML, SVG frames and animated SVG", () => {
      const compiled = compileAnimation({
        version: "stickman.animation/v1",
        canvas: { width: 640, height: 360, fps: 24 },
        durationMs: 3000,
        actor: { x: 105, groundY: 210, color: "#202124" },
        prop: { id: "crate", x: 150, y: 160, width: 50, height: 50, toX: 250, handle: { x: 5, y: 8 } },
        actions: [{ action: "push", startMs: 0, durationMs: 2600, target: "crate" }]
      });
      expect(compiled.valid).toBe(true);
      const widths: number[] = [];
      for (const artifact of [
        renderHtml(compiled.program!), renderSvgFrame(compiled.program!, 500), renderAnimatedSvg(compiled.program!)
      ]) {
        const prop = /<g id="prop"><rect([^>]+)>/.exec(artifact);
        expect(prop).not.toBeNull();
        expect(prop![1]).toContain('fill="#fff"');
        expect(prop![1]).toContain('stroke="#202124"');
        const width = /stroke-width="([^"]+)"/.exec(prop![1]!);
        expect(width).not.toBeNull();
        widths.push(Number(width![1]));
      }
      expect(widths[0]).toBeGreaterThan(0);
      expect(widths[1]).toBe(widths[0]);
      expect(widths[2]).toBe(widths[0]);
    });
  });

  it("starts normal previews playing and labels pause/resume accurately", () => {
    const { nodes, frames } = preview(false);
    expect(nodes.get("mode")!.value).toBe("normal");
    expect(nodes.get("toggle")!.textContent).toBe("Pause");
    expect(frames).toHaveLength(1);
    nodes.get("toggle")!.listeners.get("click")!();
    expect(nodes.get("toggle")!.textContent).toBe("Play");
    expect(frames).toHaveLength(0);
    nodes.get("toggle")!.listeners.get("click")!();
    expect(nodes.get("toggle")!.textContent).toBe("Pause");
    expect(frames).toHaveLength(1);
    nodes.get("mode")!.value = "normal";
    nodes.get("mode")!.listeners.get("change")!();
    expect(frames).toHaveLength(1);
  });
});
