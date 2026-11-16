import { describe, expect, it } from "vitest";
import {
  STICKMAN_PLAYER_STYLE, bindScrollTimeline, createBrowserPlayer, createBrowserScene, createSceneProjection, createSvgPainter, mapElementAnchor,
  measureHostViewport, projectTravelAnchor, registerStickmanPlayerElement, sceneToViewport,
  svgViewportToScene, viewportToScene,
  type BrowserClock, type BrowserPlayerOptions, type BrowserPlayerPort, type CssRect,
  type HostViewportMetrics, type ScreenMatrix, type StickmanPlayerElement
} from "../src/browser.js";
import { choreographAnimation } from "../src/choreograph.js";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
import type { AnimationSpec, CompiledAnimation, SampledFrame } from "../src/contract.js";

const spec: AnimationSpec = {
  version: "stickman.animation/v1",
  canvas: { width: 640, height: 360, fps: 30 },
  actor: { x: 140, groundY: 290 },
  durationMs: 2400,
  targets: { stop: { x: 350, y: 290 } },
  actions: [{ action: "walk", startMs: 0, durationMs: 2400, target: "stop" }]
};

function compile(input: unknown = spec): CompiledAnimation {
  const result = compileAnimation(input);
  if (!result.program) throw new Error(JSON.stringify(result.diagnostics));
  return result.program;
}

class FakeClock implements BrowserClock {
  time = 100;
  nextId = 1;
  callbacks = new Map<number, (timeMs: number) => void>();
  cancelled: number[] = [];
  nowCalls = 0;
  now(): number { this.nowCalls++; return this.time; }
  request(callback: (timeMs: number) => void): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }
  cancel(id: number): void { this.cancelled.push(id); this.callbacks.delete(id); }
  advance(delta: number): void {
    this.time += delta;
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of pending) callback(this.time);
  }
}

class FakePort implements BrowserPlayerPort {
  rect: CssRect = { left: 12, top: 20, width: 640, height: 360 };
  visible = false;
  reduced = false;
  current = true;
  frames: SampledFrame[] = [];
  disposals = 0;
  layoutListeners = new Set<() => void>();
  motionListeners = new Set<(reduced: boolean) => void>();
  measure(): CssRect { return this.rect; }
  layoutCurrent(): boolean { return this.current; }
  draw(frame: SampledFrame): void { this.frames.push(frame); }
  setVisible(visible: boolean): void { this.visible = visible; }
  dispose(): void { this.disposals++; this.visible = false; }
  reducedMotion(): boolean { return this.reduced; }
  onLayoutChange(listener: () => void): () => void {
    this.layoutListeners.add(listener);
    return () => { this.layoutListeners.delete(listener); };
  }
  onReducedMotion(listener: (reduced: boolean) => void): () => void {
    this.motionListeners.add(listener);
    return () => { this.motionListeners.delete(listener); };
  }
  resize(): void { for (const listener of [...this.layoutListeners]) listener(); }
  motion(reduced: boolean): void {
    this.reduced = reduced;
    for (const listener of [...this.motionListeners]) listener(reduced);
  }
}

function setup(options: BrowserPlayerOptions = {}, reduced = false) {
  const port = new FakePort();
  port.reduced = reduced;
  const clock = new FakeClock();
  const program = compile();
  const player = createBrowserPlayer(program, port, clock, options);
  return { port, clock, program, player };
}

describe("browser coordinate mapping", () => {
  it("uses isotropic letterboxing and maps element centers, not top-left corners", () => {
    const projection = createSceneProjection({ left: 10, top: 30, width: 1000, height: 1000 }, { width: 1000, height: 500 });
    expect(projection.scale).toBe(1);
    expect(projection.offsetX).toBe(0);
    expect(projection.offsetY).toBe(250);
    const anchor = mapElementAnchor(projection, {
      getBoundingClientRect: () => ({ left: 290, top: 360, width: 40, height: 40 })
    });

    expect(anchor).toEqual({ x: 300, y: 100 });
    expect(sceneToViewport(projection, anchor)).toEqual({ x: 310, y: 380 });
    expect(() => viewportToScene(projection, { x: 20, y: 100 })).toThrow(/letterbox/);
  });

  it("letterboxes horizontally without stretching coordinates", () => {
    const projection = createSceneProjection({ left: 50, top: 80, width: 800, height: 200 }, { width: 400, height: 400 });
    expect(projection.scale).toBe(0.5);
    expect(projection.offsetX).toBe(300);
    expect(viewportToScene(projection, { x: 400, y: 130 })).toEqual({ x: 100, y: 100 });
    expect(() => viewportToScene(projection, { x: 100, y: 130 })).toThrow();
  });

  it.each([48, 64, 80])("keeps %i CSS pixel avatar scene and pointing direction consistent", height => {
    const projection = createBrowserScene({ left: 25, top: 45, width: 1280, height: 720 }, height);
    expect(projection.canvas.width).toBe(Math.ceil(1280 * 144 / height));
    expect(projection.canvas.height).toBe(Math.ceil(720 * 144 / height));
    expect(projection.scale * 144).toBeLessThanOrEqual(height);
    expect(projection.scale * 144).toBeGreaterThan(height - 0.1);
    const rootCss = { x: 200, y: 600 };
    const targetCss = { x: 1000, y: 200 };
    const root = viewportToScene(projection, rootCss);
    const target = viewportToScene(projection, targetCss);
    expect((target.y - root.y) / (target.x - root.x)).toBeCloseTo(-0.5, 12);
    expect(sceneToViewport(projection, target)).toEqual(targetCss);
    const travel = projectTravelAnchor(target, root.y, projection.canvas);
    expect(travel.y).toBe(root.y);
    expect(travel.x).toBe(target.x);
    expect(sceneToViewport(projection, travel).y).toBeCloseTo(rootCss.y);
  });

  it("uses ceil and reports actual isotropic scale rather than silently distorting", () => {
    const scene = createBrowserScene({ left: 0, top: 0, width: 997, height: 563 }, 64);
    expect(scene.canvas).toEqual({ width: 2244, height: 1267 });
    expect(scene.scale).toBe(Math.min(997 / 2244, 563 / 1267));
    const point = { x: 490, y: 280 };
    const restored = sceneToViewport(scene, viewportToScene(scene, point));
    expect(restored.x).toBeCloseTo(point.x, 12);
    expect(restored.y).toBeCloseTo(point.y, 12);
  });

  it("rejects unsupported canvas bounds with actionable advice", () => {
    expect(() => createBrowserScene({ left: 0, top: 0, width: 1920, height: 1080 }, 48)).toThrow(/bounded host region or a larger avatar/);
    expect(() => createBrowserScene({ left: 0, top: 0, width: 10, height: 10 }, 80)).toThrow(/64..4096/);
    expect(() => createSceneProjection({ left: 0, top: 0, width: 500, height: 500 }, { width: 4097, height: 64 })).toThrow();
    expect(() => createSceneProjection({ left: 0, top: 0, width: 500, height: 500 }, { width: 64.5, height: 64 })).toThrow();
    expect(createSceneProjection({ left: 0, top: 0, width: 500, height: 500 }, { width: 64, height: 4096 }).canvas.height).toBe(4096);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid requested heights (%s)", height => {
    expect(() => createBrowserScene({ left: 0, top: 0, width: 1280, height: 720 }, height)).toThrow();
  });

  it("accounts for host borders, scrollbar, scroll offsets and slide CSS zoom without DPR", () => {
    const host: HostViewportMetrics = {
      getBoundingClientRect: () => ({ left: 100, top: 200, width: 1020, height: 820 }),
      offsetWidth: 510, offsetHeight: 410,
      clientWidth: 485, clientHeight: 400, clientLeft: 5, clientTop: 5,
      scrollLeft: 30, scrollTop: 40
    };
    const rect = measureHostViewport(host);
    expect(rect).toEqual({ left: 50, top: 130, width: 970, height: 800 });
    const projection = createSceneProjection(rect, { width: 970, height: 800 });
    expect(mapElementAnchor(projection, {
      getBoundingClientRect: () => ({ left: 130, top: 310, width: 40, height: 40 })
    })).toEqual({ x: 100, y: 200 });
  });

  it("uses the actual inverse SVG screen transform for rotated slide anchors", () => {
    const matrix: ScreenMatrix = {
      is2D: true,
      // Forward transform: viewport x=100-y/2, y=200+x/2.
      inverse: () => ({ a: 0, b: -2, c: 2, d: 0, e: -400, f: 200 })
    };
    expect(svgViewportToScene({ getScreenCTM: () => matrix }, { x: 50, y: 300 }, { width: 640, height: 360 }))
      .toEqual({ x: 200, y: 100 });
    expect(() => svgViewportToScene({ getScreenCTM: () => null }, { x: 0, y: 0 }, spec.canvas)).toThrow(/transform/);
    expect(svgViewportToScene({
      getScreenCTM: () => ({ inverse: matrix.inverse })
    }, { x: 50, y: 300 }, spec.canvas)).toEqual({ x: 200, y: 100 });
    expect(() => svgViewportToScene({
      getScreenCTM: () => ({ is2D: false, inverse: matrix.inverse })
    }, { x: 0, y: 0 }, spec.canvas)).toThrow(/transform/);
    expect(() => svgViewportToScene({
      getScreenCTM: () => ({ is2D: true, inverse: () => ({ a: NaN, b: 0, c: 0, d: 1, e: 0, f: 0 }) })
    }, { x: 0, y: 0 }, spec.canvas)).toThrow(/finite/);
  });

  it("rejects out-of-scene floors and non-finite coordinates", () => {
    expect(() => projectTravelAnchor({ x: 100, y: 100 }, 361, spec.canvas)).toThrow();
    expect(() => projectTravelAnchor({ x: NaN, y: 100 }, 290, spec.canvas)).toThrow();
    expect(() => viewportToScene(createSceneProjection({ left: 0, top: 0, width: 640, height: 360 }, spec.canvas), { x: Infinity, y: 0 })).toThrow();
  });
});

describe("browser motion sampler", () => {
  it("matches renderer joint positions through side, three-quarter, front, and mirrored turn frames", () => {
    const program = compile({
      version: "stickman.animation/v1",
      canvas: { width: 1600, height: 900, fps: 60 },
      actor: { x: 760, groundY: 720 },
      durationMs: 900,
      actions: [{ action: "turn-around", startMs: 0, durationMs: 900 }]
    });
    const port = new FakePort();
    port.rect = { left: 0, top: 0, width: 1000, height: 700 };
    const clock = new FakeClock();
    const player = createBrowserPlayer(program, port, clock, { clock: "external" });
    for (const [time, expectedFacing] of [[0, 1], [300, 0.42], [25000 / 60, 0], [900, -1]] as const) {
      player.seek(time);
      const browserFrame = port.frames.at(-1)!;
      const rendererFrame = sampleAnimation(program, time);
      expect(browserFrame).toEqual(rendererFrame);
      expect(browserFrame.facing).toBeCloseTo(expectedFacing, 2);
    }
  });
});

describe("browser player lifecycle using typed platform fakes", () => {
  it("copies DOMRect-style prototype getters rather than spreading an empty object", () => {
    const port = new FakePort();
    port.measure = () => new class {
      get left() { return 12; }
      get top() { return 20; }
      get width() { return 640; }
      get height() { return 360; }
    }();
    const player = createBrowserPlayer(compile(), port, new FakeClock());
    expect(player.snapshot().layoutValid).toBe(true);
    player.seek(100);
    expect(player.snapshot().timeMs).toBe(100);
    player.dispose();
  });
  it("starts paused, samples the canonical pose and uses only one internal request", () => {
    const { player, clock, port, program } = setup();
    expect(player.snapshot().playing).toBe(false);
    expect(clock.callbacks.size).toBe(0);
    expect(port.frames[0]).toEqual(sampleAnimation(program, 0));
    player.play();
    player.play();
    expect(clock.callbacks.size).toBe(1);
    clock.advance(400);
    expect(player.snapshot().timeMs).toBe(400);
    expect(port.frames.at(-1)).toEqual(sampleAnimation(program, 400));
    player.pause();
    expect(clock.callbacks.size).toBe(0);
    clock.advance(1000);
    expect(player.snapshot().timeMs).toBe(400);
    player.play();
    clock.advance(100);
    expect(player.snapshot().timeMs).toBe(500);
  });

  it("external deck seek never requests or reads a hidden clock", () => {
    const { player, clock, port, program } = setup({ clock: "external" });
    player.play();
    player.seek(600);
    expect(player.snapshot()).toMatchObject({ timeMs: 600, playing: true });
    expect(port.frames.at(-1)).toEqual(sampleAnimation(program, 600));
    clock.advance(1000);
    expect(player.snapshot().timeMs).toBe(600);
    player.pause();
    player.seek(200);
    expect(clock.callbacks.size).toBe(0);
    expect(clock.nowCalls).toBe(0);
    expect(player.snapshot().timeMs).toBe(200);
  });

  it("holds browser samples on canvas fps frame boundaries", () => {
    const { player, port, program } = setup({ clock: "external" });
    player.seek(35);
    expect(player.snapshot().timeMs).toBe(35);
    expect(port.frames.at(-1)).toEqual(sampleAnimation(program, 1000 / 30));
    player.seek(66);
    expect(port.frames.at(-1)).toEqual(sampleAnimation(program, 1000 / 30));
    player.seek(67);
    expect(port.frames.at(-1)).toEqual(sampleAnimation(program, 2000 / 30));
  });

  it("finishes without a loop/restart and requires an explicit seek to replay", () => {
    const { player, clock, port } = setup();
    player.play();
    clock.advance(5000);
    const final = port.frames.at(-1);
    expect(player.snapshot()).toMatchObject({ timeMs: 2400, playing: false });
    player.play();
    clock.advance(1000);
    expect(clock.callbacks.size).toBe(0);
    expect(port.frames.at(-1)).toEqual(final);
    player.seek(0);
    player.play();
    expect(clock.callbacks.size).toBe(1);
  });

  it.each(["reduced", "static"] as const)("has a stable %s state and no RAF", mode => {
    const { player, clock, port, program } = setup({ mode });
    expect(port.frames.at(-1)).toEqual(sampleAnimation(program, 2400, mode));
    player.play();
    player.seek(300);
    expect(player.snapshot().playing).toBe(false);
    expect(port.frames.at(-1)).toEqual(sampleAnimation(program, 300, mode));
    expect(clock.callbacks.size).toBe(0);
  });

  it("respects reduced-motion preference even when normal was requested", () => {
    const { player, clock, port, program } = setup({ mode: "normal" }, true);
    player.play();
    expect(player.snapshot().mode).toBe("reduced");
    expect(port.frames.at(-1)).toEqual(sampleAnimation(program, 0, "reduced"));
    expect(clock.callbacks.size).toBe(0);
    port.motion(false);
    expect(player.snapshot().playing).toBe(false);
    player.play();
    clock.advance(400);
    port.motion(true);
    expect(player.snapshot()).toMatchObject({ timeMs: 400, playing: false, mode: "reduced" });
    expect(clock.callbacks.size).toBe(0);
    port.motion(false);
    expect(player.snapshot()).toMatchObject({ timeMs: 400, playing: false });
  });

  it("resize invalidates once, hides stale pointing, preserves time and releases observers", () => {
    const reasons: string[] = [];
    const { player, clock, port } = setup({ onInvalidate: reason => reasons.push(reason) });
    player.play();
    clock.advance(300);
    port.rect = { ...port.rect, width: 800 };
    port.resize();
    port.resize();
    expect(player.snapshot()).toMatchObject({ timeMs: 300, playing: false, layoutValid: false });
    expect(reasons).toHaveLength(1);
    expect(port.visible).toBe(false);
    expect(clock.callbacks.size).toBe(0);
    expect(port.layoutListeners.size).toBe(0);
    expect(port.motionListeners.size).toBe(0);
    expect(() => player.seek(400)).toThrow(/layout/);
    expect(() => player.play()).toThrow(/layout/);
    player.dispose();
    expect(port.disposals).toBe(1);
  });

  it("checks current layout synchronously during paused seeks, without waiting for an observer", () => {
    const { player, port } = setup();
    player.seek(100);
    port.rect = { ...port.rect, left: 30 };
    expect(() => player.seek(200)).toThrow(/layout/);
    expect(player.snapshot().timeMs).toBe(100);
    expect(port.visible).toBe(false);
  });

  it("checks CTM/connectivity guard even if the bounding rect is unchanged", () => {
    const { player, port, clock } = setup();
    player.play();
    port.current = false;
    clock.advance(100);
    expect(player.snapshot()).toMatchObject({ layoutValid: false, timeMs: 0, playing: false });
    expect(clock.callbacks.size).toBe(0);
  });

  it("supports explicit invalidation of anchors moved without host resize", () => {
    const { player, port } = setup({ clock: "external" });
    player.seek(750);
    player.invalidateLayout("Slide anchor moved");
    expect(player.snapshot()).toMatchObject({ timeMs: 750, layoutValid: false });
    expect(port.visible).toBe(false);
  });

  it("cancel is terminal and dispose removes owned resources exactly once", () => {
    const { player, port, clock } = setup();
    player.play();
    const staleCallback = [...clock.callbacks.values()][0]!;
    player.cancel();
    player.cancel();
    expect(clock.callbacks.size).toBe(0);
    expect(port.layoutListeners.size + port.motionListeners.size).toBe(0);
    expect(() => player.seek(0)).toThrow(/cancelled/);
    expect(() => player.play()).toThrow(/cancelled/);
    const count = port.frames.length;
    staleCallback(900);
    expect(port.frames).toHaveLength(count);
    player.dispose();
    player.dispose();
    expect(port.disposals).toBe(1);
    expect(() => player.play()).toThrow(/disposed/);
    expect(() => player.seek(0)).toThrow(/disposed/);
    expect(player.pause().disposed).toBe(true);
    expect(player.cancel().disposed).toBe(true);
  });

  it("dispose cancels RAF without needing cancel first", () => {
    const { player, port, clock } = setup();
    player.play();
    player.dispose();
    expect(clock.cancelled).toHaveLength(1);
    expect(clock.callbacks.size).toBe(0);
    expect(port.layoutListeners.size + port.motionListeners.size).toBe(0);
  });

  it("canonical validation rejects tampered programs before creating resources", () => {
    const port = new FakePort();
    const clock = new FakeClock();
    expect(() => createBrowserPlayer({ contractVersion: spec.version, spec: { ...spec, unsafeCode: "alert(1)" } }, port, clock)).toThrow(/unknown|Unknown/);
    expect(() => createBrowserPlayer(spec, port, clock)).toThrow(/compiled/);
    expect(() => createBrowserPlayer({ ...compile(), script: "alert(1)" }, port, clock)).toThrow(/only/);
    expect(port.frames).toHaveLength(0);
    expect(port.layoutListeners.size + port.motionListeners.size).toBe(0);
  });

  it("detaches subscriptions and disposes the surface when initial paint fails", () => {
    const port = new FakePort();
    port.draw = () => { throw new Error("Paint failed"); };
    expect(() => createBrowserPlayer(compile(), port, new FakeClock())).toThrow("Paint failed");
    expect(port.disposals).toBe(1);
    expect(port.layoutListeners.size + port.motionListeners.size).toBe(0);
  });

  it("clones canonical data so caller mutations cannot alter mounted motion", () => {
    const program = compile();
    const port = new FakePort();
    const player = createBrowserPlayer(program, port, new FakeClock());
    const expected = sampleAnimation(program, 500);
    program.spec.actor = { x: 400, groundY: 320 };
    player.seek(500);
    expect(port.frames.at(-1)).toEqual(expected);
  });

  it("rejects non-finite seek rather than corrupting the playhead", () => {
    const { player } = setup();
    player.seek(100);
    for (const time of [NaN, Infinity, -Infinity]) expect(() => player.seek(time)).toThrow(/finite/);
    expect(player.snapshot().timeMs).toBe(100);
    expect(player.seek(-1).timeMs).toBe(0);
    expect(player.seek(9999).timeMs).toBe(2400);
  });
});

class MockDomNode {
  readonly tagName: string;
  readonly ownerDocument: MockDocument;
  parentNode: MockDomNode | null = null;
  children: MockDomNode[] = [];
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  textContent = "";
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(tagName: string, doc: MockDocument) {
    this.tagName = tagName;
    this.ownerDocument = doc;
  }

  get firstChild(): MockDomNode | null {
    return this.children[0] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  appendChild<T extends MockDomNode>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends MockDomNode>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  remove(): void {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  getBoundingClientRect(): CssRect {
    return { left: 0, top: 0, width: 800, height: 450 };
  }

  get viewBox(): { baseVal: { width: number; height: number } } {
    const vb = this.attributes.get("viewBox")?.split(/\s+/).map(Number);
    return { baseVal: { width: vb?.[2] ?? 800, height: vb?.[3] ?? 450 } };
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatchEvent(event: { type: string }): boolean {
    for (const fn of this.listeners.get(event.type) ?? []) {
      fn(event);
    }
    return true;
  }

  findAll(predicate: (node: MockDomNode) => boolean): MockDomNode[] {
    const found: MockDomNode[] = [];
    const visit = (n: MockDomNode): void => {
      if (predicate(n)) found.push(n);
      for (const c of n.children) visit(c);
    };
    visit(this);
    return found;
  }
}

class MockDocument {
  defaultView: Record<string, unknown> | null = null;
  createElementNS(_ns: string, tagName: string): MockDomNode {
    return new MockDomNode(tagName, this);
  }
}

describe("v2 multi-actor & add-on browser overlay and <stickman-player> custom element", () => {
  it("paints v2 multi-actor accessories and layered add-ons cleanly via createSvgPainter & createBrowserPlayer", () => {
    const choreo = choreographAnimation({
      theme: { accentColor: "#2563eb" },
      actors: [
        {
          id: "host",
          x: "left",
          accessory: "tie",
          actions: [{ action: "write-board", emitCue: "ready" }, { action: "idea" }]
        },
        {
          id: "guest",
          x: "right",
          accessory: "glasses",
          actions: [{ action: "clap", afterCue: "ready" }]
        }
      ]
    });
    expect(choreo.valid).toBe(true);
    const v2Program = choreo.program!;

    const doc = new MockDocument();
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 800 450");
    const painter = createSvgPainter(svg as unknown as SVGSVGElement, "#202124", svg as unknown as SVGElement, "#2563eb");

    const port = new FakePort();
    port.rect = { left: 0, top: 0, width: 800, height: 450 };
    port.draw = (frame) => {
      port.frames.push(frame);
      painter.draw(frame);
    };

    const player = createBrowserPlayer(v2Program, port, new FakeClock(), { clock: "external" });
    player.seek(800); // mid write-board
    expect(svg.findAll((n) => n.getAttribute("data-actor") === "host")).toHaveLength(1);
    expect(svg.findAll((n) => n.getAttribute("data-actor") === "guest")).toHaveLength(1);
    expect(svg.findAll((n) => n.getAttribute("data-accessory") === "tie")).toHaveLength(1);
    expect(svg.findAll((n) => n.getAttribute("data-accessory") === "glasses")).toHaveLength(1);
    expect(svg.findAll((n) => n.getAttribute("data-addon") === "board")).toHaveLength(1);

    const ideaAct = (v2Program.spec as { actors: Array<{ actions: Array<{ startMs: number; durationMs: number }> }> }).actors[0]!.actions[1]!;
    player.seek(ideaAct.startMs + ideaAct.durationMs * 0.7);
    expect(svg.findAll((n) => n.getAttribute("data-addon") === "bulb")).toHaveLength(1);

    painter.dispose();
    player.dispose();
  });

  it("registerStickmanPlayerElement returns false without DOM globals and defines a full-featured custom element when available", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = {
      HTMLElement: g.HTMLElement,
      customElements: g.customElements,
      document: g.document,
      matchMedia: g.matchMedia,
      requestAnimationFrame: g.requestAnimationFrame,
      cancelAnimationFrame: g.cancelAnimationFrame
    };

    try {
      delete g.HTMLElement;
      delete g.customElements;
      expect(registerStickmanPlayerElement()).toBe(false);
      expect(() => registerStickmanPlayerElement("invalidtag")).toThrow(/hyphen/);

      let reduced = false;
      const mediaListeners = new Set<(ev: { matches: boolean }) => void>();
      let nowMs = 1000;
      let nextRafId = 1;
      const rafQueue = new Map<number, (now: number) => void>();

      const mockDoc = new MockDocument();
      mockDoc.defaultView = {
        performance: { now: () => nowMs },
        CustomEvent: globalThis.CustomEvent,
        matchMedia: () => ({
          get matches() {
            return reduced;
          },
          addEventListener(_t: string, cb: (ev: { matches: boolean }) => void) {
            mediaListeners.add(cb);
          },
          removeEventListener(_t: string, cb: (ev: { matches: boolean }) => void) {
            mediaListeners.delete(cb);
          }
        }),
        requestAnimationFrame(cb: (now: number) => void) {
          const id = nextRafId++;
          rafQueue.set(id, cb);
          return id;
        },
        cancelAnimationFrame(id: number) {
          rafQueue.delete(id);
        }
      };

      class BaseMockHtmlElement extends MockDomNode {
        constructor() {
          super("stickman-player", mockDoc);
        }
      }

      const registry = new Map<string, CustomElementConstructor>();
      g.HTMLElement = BaseMockHtmlElement;
      g.document = mockDoc;
      g.customElements = {
        define(name: string, ctor: CustomElementConstructor) {
          registry.set(name, ctor);
        },
        get(name: string) {
          return registry.get(name);
        }
      };

      expect(registerStickmanPlayerElement("stickman-player")).toBe(true);
      expect(registerStickmanPlayerElement("stickman-player")).toBe(true); // idempotent!

      const Ctor = registry.get("stickman-player")!;
      expect(Ctor).toBeDefined();

      const choreo = choreographAnimation({
        actors: [
          {
            id: "speaker",
            x: "offstage-left",
            accessory: "tie",
            actions: [
              { action: "walk-on", to: "left", emitCue: "entered" },
              { action: "idea", emitCue: "aha", emitCueAt: "end" },
              { action: "walk-off", to: "offstage-right" }
            ]
          },
          {
            id: "listener",
            x: "right",
            accessory: "glasses",
            actions: [{ action: "thumbs-up", afterCue: "entered" }]
          }
        ]
      });
      expect(choreo.valid).toBe(true);
      const v2Program = choreo.program!;

      // 1. Programmatic setProgram + play/pause/seek + stickman:marker CustomEvent dispatch
      const el = new Ctor() as StickmanPlayerElement & MockDomNode & {
        connectedCallback(): void;
        disconnectedCallback(): void;
        attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void;
      };
      const receivedMarkers: Array<Record<string, unknown>> = [];
      el.addEventListener("stickman:marker", (ev) => {
        receivedMarkers.push((ev as CustomEvent<Record<string, unknown>>).detail);
      });

      el.connectedCallback();
      el.setProgram(v2Program);
      expect(el.durationMs).toBe(v2Program.spec.durationMs);
      expect(el.findAll((n) => n.getAttribute("data-stickman-style") === "true")).toHaveLength(1);
      expect(el.findAll((n) => n.getAttribute("data-stickman-style") === "true")[0]!.textContent).toBe(STICKMAN_PLAYER_STYLE);
      expect(el.findAll((n) => n.getAttribute("data-stickman-svg") === "true")).toHaveLength(1);
      expect(el.findAll((n) => n.getAttribute("data-actor") === "speaker")).toHaveLength(1);
      expect(el.findAll((n) => n.getAttribute("data-actor") === "listener")).toHaveLength(1);

      expect(el.play().playing).toBe(true);
      expect(rafQueue.size).toBe(1);

      while (rafQueue.size > 0) {
        nowMs += 300;
        const pending = [...rafQueue.values()];
        rafQueue.clear();
        for (const cb of pending) cb(nowMs);
      }

      expect(el.snapshot()).toMatchObject({ timeMs: v2Program.spec.durationMs, playing: false });
      expect(receivedMarkers.map((m) => m.marker)).toEqual(expect.arrayContaining(["entered", "aha"]));
      expect(receivedMarkers.some((m) => m.actorId === "speaker")).toBe(true);

      // Seek + pause check
      el.seek(500);
      expect(el.currentTimeMs).toBe(500);
      el.play();
      expect(el.pause().playing).toBe(false);
      expect(rafQueue.size).toBe(0);

      // 2. prefers-reduced-motion: reduce pauses RAF & renders onstage summary pose
      el.play();
      expect(rafQueue.size).toBe(1);
      reduced = true;
      for (const listener of mediaListeners) listener({ matches: true });
      expect(el.snapshot()).toMatchObject({ playing: false, mode: "reduced" });
      expect(rafQueue.size).toBe(0);
      expect(el.play().playing).toBe(false);

      reduced = false;
      for (const listener of mediaListeners) listener({ matches: false });
      el.dispose();

      // 3. Declarative JSON text content loading on connectedCallback
      const declarativeEl = new Ctor() as StickmanPlayerElement & MockDomNode & {
        connectedCallback(): void;
      };
      declarativeEl.textContent = JSON.stringify({
        actor: { x: "center", accessory: "hat" },
        actions: [{ action: "wave", durationMs: 800 }]
      });
      declarativeEl.connectedCallback();
      expect(declarativeEl.durationMs).toBe(800);
      expect(declarativeEl.findAll((n) => n.getAttribute("data-accessory") === "hat")).toHaveLength(1);

      // 4. Attribute-based JSON loading via program="..."
      const attrEl = new Ctor() as StickmanPlayerElement & MockDomNode & {
        connectedCallback(): void;
        attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void;
      };
      const jsonSpec = JSON.stringify(v2Program);
      attrEl.setAttribute("program", jsonSpec);
      attrEl.connectedCallback();
      expect(attrEl.durationMs).toBe(v2Program.spec.durationMs);
      attrEl.dispose();
    } finally {
      for (const [key, val] of Object.entries(saved)) {
        if (val === undefined) delete g[key];
        else g[key] = val;
      }
    }
  });

  it("bindScrollTimeline maps clamped scroll progress onto playhead timeMs, attaches passive listeners, respects reduced motion without scroll-jacking, and cleans up on dispose", () => {
    const events = new Map<string, Set<() => void>>();
    const listenerOptions: Array<{ type: string; options: unknown }> = [];
    const scroller = {
      scrollTop: 0,
      scrollHeight: 2500,
      clientHeight: 500,
      addEventListener(type: string, fn: () => void, options?: unknown) {
        listenerOptions.push({ type, options });
        let set = events.get(type);
        if (!set) {
          set = new Set();
          events.set(type, set);
        }
        set.add(fn);
      },
      removeEventListener(type: string, fn: () => void) {
        events.get(type)?.delete(fn);
      }
    };

    const sought: number[] = [];
    const binding = bindScrollTimeline(
      { seek: (t) => sought.push(t) },
      { durationMs: 4000, container: scroller, startOffsetPx: 200, endOffsetPx: 200 }
    );

    // Passive listener verification + initial clamped sync at scrollTop=0 (< startOffsetPx=200)
    expect(listenerOptions.every((entry) => (entry.options as { passive?: boolean })?.passive === true)).toBe(true);
    expect(sought.at(-1)).toBe(0);

    // Midpoint across [200 .. 1800] (span = 1600): scrollTop = 1000 -> progress 0.5 -> 2000ms
    scroller.scrollTop = 1000;
    for (const fn of events.get("scroll") ?? []) fn();
    expect(sought.at(-1)).toBe(2000);

    // Overscroll past end clamps cleanly to durationMs
    scroller.scrollTop = 2400;
    expect(binding.update()).toBe(4000);
    expect(sought.at(-1)).toBe(4000);

    // Cleanup removes all listeners and freezes updates
    binding.dispose();
    expect(events.get("scroll")?.size ?? 0).toBe(0);
    expect(events.get("resize")?.size ?? 0).toBe(0);
    const countAfterDispose = sought.length;
    scroller.scrollTop = 600;
    expect(binding.update()).toBe(4000);
    expect(sought).toHaveLength(countAfterDispose);

    // Sticky scrollElement runway + prefers-reduced-motion guard
    let rectTop = 0;
    let reducedActive = true;
    const mediaChanges = new Set<(ev: { matches: boolean }) => void>();
    const setTimes: number[] = [];
    const stickyBinding = bindScrollTimeline(
      { setTimeMs: (t) => setTimes.push(t) },
      {
        durationMs: 3000,
        container: { innerHeight: 600 },
        scrollElement: { getBoundingClientRect: () => ({ top: rectTop, height: 2600 }) },
        reducedTimeMs: 2400,
        matchMedia: () => ({
          get matches() {
            return reducedActive;
          },
          addEventListener(_t, cb) {
            mediaChanges.add(cb);
          },
          removeEventListener(_t, cb) {
            mediaChanges.delete(cb);
          }
        })
      }
    );

    // Reduced-motion active: deterministically pins to reducedTimeMs (2400ms) regardless of scroll
    expect(setTimes.at(-1)).toBe(2400);
    rectTop = -500;
    expect(stickyBinding.update()).toBe(2400);

    // User disables reduced motion dynamically -> resumes scroll-driven timeline (500 / 2000 = 0.25 -> 750ms)
    reducedActive = false;
    for (const cb of mediaChanges) cb({ matches: false });
    expect(setTimes.at(-1)).toBe(750);
    stickyBinding.dispose();
    expect(mediaChanges.size).toBe(0);

    // Callback target + respectReducedMotion: false override
    let callbackTime = -1;
    const cbBinding = bindScrollTimeline(
      (t) => {
        callbackTime = t;
      },
      {
        durationMs: 1000,
        container: { scrollTop: 300, scrollHeight: 1100, clientHeight: 500 },
        respectReducedMotion: false,
        matchMedia: () => ({ matches: true })
      }
    );
    expect(callbackTime).toBe(500);
    cbBinding.dispose();
  });
});
