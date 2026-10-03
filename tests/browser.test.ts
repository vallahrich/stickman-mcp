import { describe, expect, it } from "vitest";
import {
  createBrowserPlayer, createBrowserScene, createSceneProjection, mapElementAnchor,
  measureHostViewport, projectTravelAnchor, sceneToViewport, svgViewportToScene, viewportToScene,
  type BrowserClock, type BrowserPlayerOptions, type BrowserPlayerPort, type CssRect,
  type HostViewportMetrics, type ScreenMatrix
} from "../src/browser.js";
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
    for (const [time, expectedFacing] of [[0, 1], [300, 0.5], [450, 0], [900, -1]] as const) {
      player.seek(time);
      const browserFrame = port.frames.at(-1)!;
      const rendererFrame = sampleAnimation(program, time);
      expect(browserFrame).toEqual(rendererFrame);
      expect(browserFrame.facing).toBeCloseTo(expectedFacing, 3);
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
