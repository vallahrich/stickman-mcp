import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
import { renderAnimatedSvg, renderHtml, renderSvgFrame } from "../src/render.js";

function preview(reduced: boolean) {
  const compiled = compileAnimation({
    version: "stickman.animation/v1",
    canvas: { width: 320, height: 240, fps: 24 },
    durationMs: 1000,
    actor: { x: 80, groundY: 200 },
    targets: { end: { x: 200, y: 200 } },
    actions: [{ action: "walk", startMs: 0, durationMs: 800, target: "end" }]
  });
  const program = compiled.program!;
  const nodes = new Map<string, {
    value: string; textContent: string; attributes: Map<string, number>;
    listeners: Map<string, () => void>;
    setAttribute(key: string, value: number): void;
    addEventListener(event: string, listener: () => void): void;
  }>();
  for (const id of ["mode", "seek", "toggle", "head", ...sampleAnimation(program, 0).segments.map(line => line.id)]) {
    const attributes = new Map<string, number>();
    const listeners = new Map<string, () => void>();
    nodes.set(id, {
      value: "", textContent: "Pause", attributes, listeners,
      setAttribute: (key, value) => { attributes.set(key, value); },
      addEventListener: (event, listener) => { listeners.set(event, listener); }
    });
  }
  const frames: ((now: number) => void)[] = [];
  const script = /<script>([\s\S]+?)<\/script>/.exec(renderHtml(program))![1]!;
  runInNewContext(script, {
    document: {
      querySelector: (selector: string) => nodes.get(selector.slice(1)) ?? null,
      getElementById: (id: string) => nodes.get(id) ?? null
    },
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: (callback: (now: number) => void) => { frames.push(callback); }
  });
  return { nodes, frames, program };
}

describe("self-contained HTML startup controls", () => {
  it("starts reduced-motion previews paused with an accurate Play button and final pose", () => {
    const { nodes, frames, program } = preview(true);
    expect(nodes.get("mode")!.value).toBe("reduced");
    expect(nodes.get("toggle")!.textContent).toBe("Play");
    expect(frames).toHaveLength(0);
    expect(nodes.get("head")!.attributes.get("cx")).toBe(sampleAnimation(program, 1000, "reduced").head.x);
    nodes.get("toggle")!.listeners.get("click")!();
    expect(nodes.get("mode")!.value).toBe("normal");
    expect(nodes.get("toggle")!.textContent).toBe("Pause");
    expect(frames).toHaveLength(1);
  });

  describe("prop paint parity", () => {
    it("uses the same visible outlined prop in HTML, SVG frames and animated SVG", () => {
      const compiled = compileAnimation({
        version: "stickman.animation/v1",
        canvas: { width: 640, height: 360, fps: 24 },
        durationMs: 1200,
        actor: { x: 148, groundY: 210, color: "#202124" },
        prop: { id: "crate", x: 150, y: 160, width: 50, height: 50, toX: 250, handle: { x: 5, y: 8 } },
        actions: [{ action: "push", startMs: 0, durationMs: 1000, target: "crate" }]
      });
      expect(compiled.valid).toBe(true);
      for (const artifact of [
        renderHtml(compiled.program!), renderSvgFrame(compiled.program!, 500), renderAnimatedSvg(compiled.program!)
      ]) {
        const prop = /<g id="prop"><rect([^>]+)>/.exec(artifact);
        expect(prop).not.toBeNull();
        expect(prop![1]).toContain('fill="#fff"');
        expect(prop![1]).toContain('stroke="#202124"');
        expect(prop![1]).toContain('stroke-width="4"');
      }
    });
  });

  it("starts normal previews playing and labels pause/resume accurately", () => {
    const { nodes, frames } = preview(false);
    expect(nodes.get("mode")!.value).toBe("normal");
    expect(nodes.get("toggle")!.textContent).toBe("Pause");
    expect(frames).toHaveLength(1);
    nodes.get("toggle")!.listeners.get("click")!();
    expect(nodes.get("toggle")!.textContent).toBe("Play");
    nodes.get("toggle")!.listeners.get("click")!();
    expect(nodes.get("toggle")!.textContent).toBe("Pause");
  });
});
