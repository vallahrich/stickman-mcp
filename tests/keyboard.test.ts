import { describe, expect, it } from "vitest";
import {
  bindFocusedKeyboard, createKeyboardController,
  type KeyboardControllerOptions, type KeyboardIntent, type KeyboardIntentRecord,
  type KeyboardMotionObservation, type KeyboardState
} from "../src/keyboard.js";
import {
  createBrowserScene, viewportToScene,
  type BrowserClock, type BrowserPlayerPort, type CssRect
} from "../src/browser.js";
import { advanceMotionIntent, createMotionIntentState, type WorldMotionScene } from "../src/world-motion.js";
import { createIsometricRoom } from "../src/room.js";
import type { CompiledAnimation, SampledFrame } from "../src/contract.js";

class Clock implements BrowserClock {
  time = 0;
  next = 1;
  callbacks = new Map<number, (time: number) => void>();
  now(): number { return this.time; }
  request(callback: (time: number) => void): number {
    const id = this.next++;
    this.callbacks.set(id, callback);
    return id;
  }
  cancel(id: number): void { this.callbacks.delete(id); }
  advance(ms: number): void {
    this.time += ms;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(this.time);
  }
  elapse(ms: number): void {
    for (let left = ms; left > 0;) {
      const dt = Math.min(10, left);
      this.advance(dt);
      left -= dt;
    }
  }
}

class Port implements BrowserPlayerPort {
  rect: CssRect = { left: 0, top: 0, width: 640, height: 360 };
  reduced = false;
  current = true;
  visible = false;
  disposals = 0;
  frames: SampledFrame[] = [];
  layout = new Set<() => void>();
  motion = new Set<(value: boolean) => void>();
  drawError: Error | null = null;
  measure(): CssRect { return this.rect; }
  layoutCurrent(): boolean { return this.current; }
  draw(frame: SampledFrame): void {
    if (this.drawError) throw this.drawError;
    this.frames.push(frame);
  }
  setVisible(value: boolean): void { this.visible = value; }
  dispose(): void { this.disposals++; this.visible = false; }
  reducedMotion(): boolean { return this.reduced; }
  onReducedMotion(fn: (value: boolean) => void): () => void {
    this.motion.add(fn);
    return () => { this.motion.delete(fn); };
  }
  onLayoutChange(fn: () => void): () => void {
    this.layout.add(fn);
    return () => { this.layout.delete(fn); };
  }
  setReduced(value: boolean): void {
    this.reduced = value;
    for (const fn of [...this.motion]) fn(value);
  }
  invalidate(): void { for (const fn of [...this.layout]) fn(); }
}

const defaults = {
  canvas: { width: 640, height: 360 }, initialX: 140, groundY: 290,
  pointTarget: { x: 500, y: 100 }
} satisfies KeyboardControllerOptions;
const flatScene: WorldMotionScene = {
  canvas: { width: 640, height: 360, fps: 60 }, width: 640, depth: 0,
  initial: { x: 140, z: 0 }, pointTarget: { x: 500, z: 0, height: 190 },
  projectWorld: (point, height = 0) => ({ x: point.x, y: 290 - height }),
  canOccupy: point => point.x >= 80 && point.x <= 560 && point.z === 0
};
const noIntent: KeyboardIntent = { horizontal: 0, depth: 0, run: false, jumpRequest: 0, pointRequest: 0, stop: false };
function setup(overrides: Partial<KeyboardControllerOptions> = {}, port = new Port()) {
  const clock = new Clock();
  const programs: CompiledAnimation[] = [];
  const states: KeyboardState[] = [];
  const intents: KeyboardIntentRecord[] = [];
  const samples: KeyboardMotionObservation[] = [];
  const errors: Error[] = [];
  const options: KeyboardControllerOptions = {
    ...defaults, onProgram: program => programs.push(program),
    onState: state => states.push(state), onError: error => errors.push(error),
    onIntent: record => intents.push(record), onMotion: sample => samples.push(sample),
    ...overrides
  };
  const controller = createKeyboardController(options, port, clock);
  return { controller, port, clock, programs, states, intents, samples, errors, options };
}

describe("canonical continuous intent adapter", () => {
  it("renders the exact initial root with no autoplay or option mutation", () => {
    const options = { ...defaults, canvas: { ...defaults.canvas }, pointTarget: { ...defaults.pointTarget } };
    const before = structuredClone(options);
    const { controller, clock, port, programs } = setup(options);
    expect(controller.snapshot()).toMatchObject({
      status: "idle", motionStatus: "idle", timeMs: 0,
      currentRoot: { x: 140, y: 290 }, intent: noIntent
    });
    expect(port.frames[0]?.x).toBe(140);
    expect(clock.callbacks.size).toBe(0);
    expect(programs).toHaveLength(1);
    expect(programs[0]?.spec.actions).toEqual([]);
    expect(options).toEqual(before);
  });

  it("walk input changes immediately and visibly moves before 120ms, without compiling new programs", () => {
    const { controller, clock, port, programs, intents, errors } = setup();
    controller.press("right");
    expect(controller.snapshot()).toMatchObject({ direction: 1, intent: { horizontal: 1, stop: false } });
    expect(intents.at(-1)?.timeMs).toBe(0);
    clock.elapse(100);
    expect(port.frames.at(-1)!.x).toBeGreaterThan(140);
    expect(controller.snapshot().status).toBe("moving");
    expect(programs).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("advances OLD intent to the input timestamp before applying NEW intent at the same timestamp", () => {
    const { controller, clock, port, intents } = setup();
    let core = createMotionIntentState(flatScene, 0);
    core = advanceMotionIntent(core, noIntent, 0).state;
    const right: KeyboardIntent = { ...noIntent, horizontal: 1 };
    core = advanceMotionIntent(core, right, 0).state;
    controller.press("right");
    // Input between RAF ticks: no simulation interval may use the future input.
    clock.time = 73;
    const old = advanceMotionIntent(core, right, 73);
    const released = advanceMotionIntent(old.state, noIntent, 73);
    controller.release("right");
    expect(port.frames.at(-1)).toEqual(released.frame);
    expect(intents.at(-1)).toEqual({ timeMs: 73, intent: noIntent });
  });

  it("renders exactly the shared core samples and never integrates its own root/feet", () => {
    const { controller, clock, port } = setup();
    let core = createMotionIntentState(flatScene, 0);
    core = advanceMotionIntent(core, noIntent, 0).state;
    core = advanceMotionIntent(core, noIntent, 0).state;
    const right: KeyboardIntent = { ...noIntent, horizontal: 1 };
    core = advanceMotionIntent(core, right, 0).state;
    controller.press("right");
    for (let time = 10; time <= 500; time += 10) {
      const sample = advanceMotionIntent(core, right, time);
      core = sample.state;
      clock.advance(10);
      expect(port.frames.at(-1)).toEqual(sample.frame);
    }
  });

  it("deduplicates held/repeated intent with one RAF and no finite-clip backlog", () => {
    const { controller, clock, programs, intents, errors } = setup();
    controller.press("right");
    for (let i = 0; i < 100; i++) controller.press("right");
    expect(intents).toHaveLength(1);
    expect(clock.callbacks.size).toBe(1);
    clock.elapse(500);
    expect(programs).toHaveLength(1);
    expect(clock.callbacks.size).toBeLessThanOrEqual(1);
    expect(errors).toHaveLength(0);
  });

  it("run is held intent, not a new action queue", () => {
    const { controller, clock, intents, programs } = setup();
    controller.press("right");
    clock.elapse(100);
    controller.press("run");
    expect(controller.snapshot()).toMatchObject({ running: true, intent: { run: true } });
    controller.release("run");
    expect(controller.snapshot().running).toBe(false);
    expect(intents.at(-1)?.intent.horizontal).toBe(1);
    expect(programs).toHaveLength(1);
  });

  it("opposing directions cancel immediately; releasing one restores the other", () => {
    const { controller } = setup();
    controller.press("right");
    controller.press("left");
    expect(controller.snapshot().direction).toBe(0);
    controller.release("right");
    expect(controller.snapshot().direction).toBe(-1);
  });

  it("jump edges survive keyup and repeated keydown cannot retrigger them", () => {
    const { controller, clock, intents, programs, errors } = setup();
    controller.press("right");
    clock.elapse(80);
    controller.press("jump");
    const id = controller.snapshot().intent.jumpRequest;
    controller.release("jump");
    expect(controller.snapshot().intent.jumpRequest).toBe(id);
    clock.elapse(100);
    expect(controller.snapshot().motionStatus).toBe("jumping");
    controller.press("jump");
    const second = controller.snapshot().intent.jumpRequest;
    for (let i = 0; i < 50; i++) controller.press("jump");
    expect(controller.snapshot().intent.jumpRequest).toBe(second);
    expect(second).toBe(id + 1);
    expect(intents.filter(record => record.intent.jumpRequest === second)).toHaveLength(1);
    expect(programs).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("point uses a monotonic edge and only the supplied scene target", () => {
    const { controller, samples, clock, errors } = setup();
    controller.press("point");
    expect(controller.snapshot().intent.pointRequest).toBe(1);
    controller.release("point");
    clock.elapse(100);
    expect(samples.some(sample => sample.status === "pointing")).toBe(true);
    expect(controller.snapshot().currentRoot.x).toBeCloseTo(140, 6);
    expect(errors).toHaveLength(0);
  });
});

describe("responsive stopping, reversal and jumping acceptance", () => {
  it.each([false, true])("release clears intent immediately and settles within 250ms (run=%s)", run => {
    const { controller, clock, port, errors } = setup();
    if (run) controller.press("run");
    controller.press("right");
    clock.elapse(250);
    controller.release("right");
    expect(controller.snapshot().direction).toBe(0);
    clock.elapse(250);
    const stopped = port.frames.at(-1)!.x;
    clock.elapse(150);
    expect(Math.abs(port.frames.at(-1)!.x - stopped)).toBeLessThanOrEqual(0.25);
    expect(["idle", "blocked"]).toContain(controller.snapshot().motionStatus);
    expect(clock.callbacks.size).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("reversal changes intent immediately and reverses actual root motion without waiting 648ms", () => {
    const { controller, clock, port, errors } = setup();
    controller.press("right");
    clock.elapse(250);
    controller.release("right");
    controller.press("left");
    expect(controller.snapshot().direction).toBe(-1);
    clock.elapse(200);
    const x = port.frames.at(-1)!.x;
    clock.elapse(50);
    expect(port.frames.at(-1)!.x).toBeLessThan(x);
    expect(errors).toHaveLength(0);
  });

  it("a jump during movement visibly enters crouch/preload in <120ms, not at a clip endpoint", () => {
    const { controller, clock, port, errors } = setup();
    controller.press("right");
    clock.elapse(150);
    const before = port.frames.at(-1)!;
    controller.press("jump");
    clock.elapse(50);
    expect(controller.snapshot().motionStatus).toBe("jumping");
    expect(port.frames.at(-1)!.segments).not.toEqual(before.segments);
    expect(errors).toHaveLength(0);
  });

  it("Escape-style stop clears pending/held intent immediately and safely lands within 700ms", () => {
    const { controller, clock, port, errors } = setup();
    controller.press("right");
    controller.press("jump");
    clock.elapse(100);
    controller.stop();
    const id = controller.snapshot().intent.jumpRequest;
    expect(controller.snapshot()).toMatchObject({ direction: 0, running: false, intent: { stop: true } });
    clock.elapse(700);
    expect(["idle", "blocked"]).toContain(controller.snapshot().motionStatus);
    const landed = port.frames.at(-1)!;
    const feet = landed.segments.filter(s => s.id === "left-shin" || s.id === "right-shin");
    expect(feet).toHaveLength(2);
    for (const foot of feet) expect(foot.y2).toBeCloseTo(290, 6);
    expect(controller.snapshot().intent.jumpRequest).toBe(id);
    expect(errors).toHaveLength(0);
    expect(clock.callbacks.size).toBe(0);
  });

  it("clearing a pending jump prevents a stale ID from replaying on the next move", () => {
    const { controller, clock, samples, errors } = setup();
    controller.press("jump");
    controller.release("jump");
    controller.stop();
    clock.elapse(800);
    const count = samples.length;
    controller.press("right");
    clock.elapse(100);
    expect(samples.slice(count).some(sample => sample.status === "jumping")).toBe(false);
    expect(errors).toHaveLength(0);
  });
});

describe("canonical physical bounds and contacts", () => {
  it.each([NaN, Infinity, -1, 0, 640])("rejects invalid initial root %s", initialX => {
    expect(() => setup({ initialX })).toThrow();
  });
  it("rejects invalid scene/floor/target instead of silently relocating roots", () => {
    expect(() => setup({ canvas: { width: 4097, height: 360 } })).toThrow();
    expect(() => setup({ groundY: NaN })).toThrow();
    expect(() => setup({ groundY: 0 })).toThrow();
    expect(() => setup({ pointTarget: { x: 700, y: 20 } })).toThrow();
    expect(() => setup({ pointTarget: { x: NaN, y: 20 } })).toThrow();
  });

  it("keeps fixed bone lengths, grounded world anchors, bounds and continuous roots through stop/reversal", () => {
    const { controller, clock, port, errors } = setup();
    const lengths = new Map<string, number>();
    controller.press("right");
    clock.elapse(250);
    controller.release("right");
    clock.elapse(250);
    controller.press("left");
    clock.elapse(350);
    controller.stop();
    clock.elapse(300);
    let plantedPairs = 0;
    for (let i = 0; i < port.frames.length; i++) {
      const frame = port.frames[i]!;
      const previous = port.frames[i - 1];
      if (previous) expect(Math.abs(frame.x - previous.x)).toBeLessThan(8);
      for (const segment of frame.segments) {
        const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
        if (!lengths.has(segment.id)) lengths.set(segment.id, length);
        expect(length).toBeCloseTo(lengths.get(segment.id)!, 6);
        for (const [x, y] of [[segment.x1, segment.y1], [segment.x2, segment.y2]]) {
          expect(x).toBeGreaterThanOrEqual(-1e-6);
          expect(x).toBeLessThanOrEqual(640.000001);
          expect(y).toBeGreaterThanOrEqual(-1e-6);
          expect(y).toBeLessThanOrEqual(290.000001);
        }
        if (previous && ["left-shin", "right-shin"].includes(segment.id)) {
          const old = previous.segments.find(s => s.id === segment.id)!;
          if (Math.abs(old.y2 - 290) < 1e-6 && Math.abs(segment.y2 - 290) < 1e-6) {
            expect(Math.abs(old.x2 - segment.x2)).toBeLessThanOrEqual(0.25);
            plantedPairs++;
          }
        }
      }
    }
    expect(plantedPairs).toBeGreaterThan(20);
    expect(errors).toHaveLength(0);
  });

  it.each(["left", "right"] as const)("held %s stops at a genuine boundary without teleporting or a busy RAF loop", command => {
    const { controller, clock, port, errors } = setup({ initialX: command === "left" ? 90 : 550 });
    controller.press(command);
    clock.elapse(2500);
    expect(controller.snapshot().motionStatus).toBe("blocked");
    expect(clock.callbacks.size).toBe(0);
    const final = port.frames.at(-1)!.x;
    expect(final).toBeGreaterThan(0);
    expect(final).toBeLessThan(640);
    expect(errors).toHaveLength(0);
  });

  it("accepts the whole 1280x720 CSS scene mapped for a 64px avatar", () => {
    const scene = createBrowserScene({ left: 0, top: 0, width: 1280, height: 720 }, 64);
    const start = viewportToScene(scene, { x: 200, y: 600 });
    const target = viewportToScene(scene, { x: 1000, y: 200 });
    const port = new Port();
    port.rect = { ...scene.rect };
    const { controller, clock, errors } = setup({
      canvas: { ...scene.canvas }, initialX: start.x, groundY: start.y, pointTarget: target
    }, port);
    controller.press("right");
    clock.elapse(100);
    expect(controller.snapshot().currentRoot.x).toBeGreaterThan(start.x);
    expect(errors).toHaveLength(0);
  });
});

describe("timestamps, callbacks and lifecycle", () => {
  it("remains responsive after reading the initially idle preview for 60 seconds", () => {
    const { controller, clock, errors } = setup();
    expect(clock.callbacks.size).toBe(0);
    clock.time = 60_000;
    controller.press("right");
    expect(controller.snapshot()).toMatchObject({ timeMs: 60_000, direction: 1, error: null });
    expect(clock.callbacks.size).toBe(1);
    clock.elapse(100);
    expect(controller.snapshot().currentRoot.x).toBeGreaterThan(140);
    expect(errors).toHaveLength(0);
  });
  it("preserves a settled post-stop root during a minute of reading, then accepts reversal", () => {
    const { controller, clock, errors } = setup();
    controller.press("right");
    clock.elapse(250);
    controller.release("right");
    clock.elapse(300);
    expect(controller.snapshot().status).toBe("idle");
    expect(clock.callbacks.size).toBe(0);
    const root = controller.snapshot().currentRoot;
    clock.time += 60_000;
    controller.press("left");
    expect(controller.snapshot().currentRoot).toEqual(root);
    clock.elapse(100);
    expect(controller.snapshot().currentRoot.x).toBeLessThan(root.x);
    expect(errors).toHaveLength(0);
  });
  it("records committed intent timestamps and exposes no mutable core state", () => {
    const { controller, clock, intents, samples } = setup();
    clock.time = 42;
    controller.press("right");
    expect(intents.at(-1)?.timeMs).toBe(42);
    Object.assign(intents.at(-1)!.intent, { horizontal: -1 });
    Object.assign(samples.at(-1)!.frame, { x: 999 });
    const snap = controller.snapshot();
    Object.assign(snap.currentRoot, { x: 999 });
    Object.assign(snap.intent, { horizontal: -1 });
    expect(controller.snapshot().direction).toBe(1);
    expect(controller.snapshot().currentRoot.x).toBe(140);
  });

  it("tolerates a RAF timestamp predating input but rejects an input clock regression", () => {
    const { controller, clock, errors } = setup();
    controller.press("right");
    clock.time = 25;
    controller.release("right");
    const callbacks = [...clock.callbacks.values()];
    clock.callbacks.clear();
    for (const fn of callbacks) fn(16);
    expect(controller.snapshot().timeMs).toBe(25);
    expect(errors).toHaveLength(0);
    clock.time = 24;
    controller.press("left");
    expect(controller.snapshot().status).toBe("error");
    expect(errors[0]?.message).toMatch(/monotonic/);
  });

  it("reports invalid RAF timestamps with terminal state, not a silent fallback", () => {
    const { controller, clock, errors } = setup();
    controller.press("right");
    clock.advance(NaN);
    expect(controller.snapshot().status).toBe("error");
    expect(errors[0]?.message).toMatch(/timestamp/);
    expect(clock.callbacks.size).toBe(0);
  });

  it("reports input render failures and cleans pending RAF/observers", () => {
    const { controller, clock, port, errors } = setup();
    controller.press("right");
    port.drawError = new Error("surface failed");
    controller.release("right");
    expect(errors.map(error => error.message)).toEqual(["surface failed"]);
    expect(controller.snapshot()).toMatchObject({ status: "error", error: "surface failed" });
    expect(clock.callbacks.size).toBe(0);
    expect(port.layout.size + port.motion.size).toBe(0);
    expect(port.visible).toBe(false);
  });

  it("reports RAF render failures explicitly", () => {
    const { controller, clock, port, errors } = setup();
    controller.press("right");
    port.drawError = new Error("RAF surface failed");
    clock.advance(20);
    expect(errors[0]?.message).toBe("RAF surface failed");
    expect(controller.snapshot().status).toBe("error");
  });

  it("deprecated onProgram fires only for the initial authored idle program", () => {
    const { controller, clock, programs } = setup();
    controller.press("right");
    clock.elapse(100);
    controller.press("jump");
    controller.stop();
    clock.elapse(700);
    expect(programs).toHaveLength(1);
    expect(programs[0]?.spec.actions).toEqual([]);
  });

  it("disposes RAF, subscriptions, shared surface and binding hooks once; commands become inert", () => {
    const { controller, clock, port, intents } = setup();
    controller.press("right");
    let disposed = 0;
    controller.onDispose(() => disposed++);
    controller.dispose();
    controller.dispose();
    controller.press("jump");
    controller.release("right");
    controller.stop();
    clock.advance(1000);
    expect(controller.snapshot().status).toBe("disposed");
    expect(disposed).toBe(1);
    expect(clock.callbacks.size).toBe(0);
    expect(port.disposals).toBe(1);
    expect(port.layout.size + port.motion.size).toBe(0);
    expect(intents).toHaveLength(1);
  });

  it.each(["event", "measure", "guard"] as const)("terminally invalidates %s layout and never draws to stale coordinates", method => {
    const { controller, clock, port } = setup();
    controller.press("right");
    clock.elapse(100);
    const last = port.frames.at(-1);
    if (method === "event") port.invalidate();
    else if (method === "measure") port.rect = { ...port.rect, width: 800 };
    else port.current = false;
    clock.advance(100);
    expect(controller.snapshot().status).toBe("invalid");
    expect(port.frames.at(-1)).toBe(last);
    expect(port.visible).toBe(false);
    expect(clock.callbacks.size).toBe(0);
    controller.dispose();
    expect(port.disposals).toBe(1);
  });

  it("checks idle layout before accepting an input", () => {
    const { controller, port } = setup();
    port.rect = { ...port.rect, left: 12 };
    controller.press("right");
    expect(controller.snapshot().status).toBe("invalid");
  });

  it("initial reduced motion rejects animation and returning to normal needs a fresh press", () => {
    const port = new Port();
    port.reduced = true;
    const { controller, clock, intents } = setup({}, port);
    controller.press("right");
    controller.press("jump");
    expect(controller.snapshot().status).toBe("reduced");
    expect(controller.snapshot().currentRoot.x).toBe(140);
    expect(clock.callbacks.size).toBe(0);
    expect(intents).toHaveLength(0);
    port.setReduced(false);
    clock.elapse(100);
    expect(controller.snapshot().direction).toBe(0);
    controller.press("right");
    clock.elapse(100);
    expect(controller.snapshot().currentRoot.x).toBeGreaterThan(140);
  });

  it("enabling reduced motion clears intent but lands safely instead of freezing airborne or resetting", () => {
    const { controller, clock, port, errors } = setup();
    controller.press("jump");
    clock.elapse(150);
    port.setReduced(true);
    expect(controller.snapshot()).toMatchObject({ status: "reduced", direction: 0, intent: { stop: true } });
    clock.elapse(700);
    expect(["idle", "blocked"]).toContain(controller.snapshot().motionStatus);
    expect(clock.callbacks.size).toBe(0);
    const root = controller.snapshot().currentRoot.x;
    controller.press("right");
    clock.elapse(100);
    expect(controller.snapshot().currentRoot.x).toBe(root);
    port.setReduced(false);
    expect(controller.snapshot().direction).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("duplicate motion preference notifications do not interrupt live motion", () => {
    const { controller, port, clock, intents } = setup();
    controller.press("right");
    port.setReduced(false);
    expect(intents).toHaveLength(1);
    expect(clock.callbacks.size).toBe(1);
  });
});

// Fake platform boundary only. All motion tests use the real canonical API.
class FakeDocument extends EventTarget {
  activeElement: EventTarget | null = null;
  hidden = false;
}
class FakeHost extends EventTarget {
  ownerDocument = new FakeDocument();
  attributes = new Map<string, string>();
  isContentEditable = false;
  editableTag = false;
  getAttribute(key: string): string | null { return this.attributes.get(key) ?? null; }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  removeAttribute(key: string): void { this.attributes.delete(key); }
  matches(): boolean { return this.editableTag; }
  element(): HTMLElement { return this as unknown as HTMLElement; }
  focus(): void { this.ownerDocument.activeElement = this; }
  key(type: "keydown" | "keyup", code: string, properties: Partial<Pick<KeyboardEvent, "repeat" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "isComposing">> = {}): Event {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, ...properties });
    this.dispatchEvent(event);
    return event;
  }
}

describe("focused approved keyboard binding", () => {
  it("accepts the actual room fixture's first W after 60 seconds with no idle RAF or suspension error", () => {
    const room = createIsometricRoom({
      width: 1000, depth: 600, canvas: { width: 2304, height: 1296 }, padding: 100,
      objects: [{ id: "crate", x: 400, z: 240, width: 180, depth: 100, height: 90 }]
    });
    const { controller, clock, errors } = setup({
      canvas: { ...room.canvas },
      world: {
        width: room.width, depth: room.depth, initial: { x: 180, z: 420 },
        pointTarget: { x: 650, z: 200, height: 100 },
        projectWorld: (p, height = 0) => room.project(p, height),
        canOccupy: (p, radius) => room.canOccupy(p, radius), actorRadius: 12
      }
    });
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    expect(clock.callbacks.size).toBe(0);
    clock.time = 60_000;
    expect(host.key("keydown", "KeyW").defaultPrevented).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      timeMs: 60_000, depthDirection: -1, worldRoot: { x: 180, z: 420 }, error: null
    });
    expect(clock.callbacks.size).toBe(1);
    expect(errors).toHaveLength(0);
    controller.dispose();
    binding.dispose();
  });
  it.each(["ArrowUp", "KeyW", "ArrowDown", "KeyS"])("maps %s to world depth intent and clears it on release", code => {
    const world = {
      width: 400, depth: 400, initial: { x: 180, z: 180 },
      pointTarget: { x: 300, z: 260, height: 100 },
      projectWorld: (p: { x: number; z: number }, height = 0) => ({ x: 640 + p.x - p.z, y: 260 + (p.x + p.z) * 0.5 - height })
    };
    const { controller, errors } = setup({ canvas: { width: 1280, height: 720 }, world });
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    expect(host.key("keydown", code).defaultPrevented).toBe(true);
    expect(controller.snapshot().depthDirection).toBe(code === "ArrowUp" || code === "KeyW" ? -1 : 1);
    host.key("keyup", code);
    expect(controller.snapshot().depthDirection).toBe(0);
    expect(errors).toHaveLength(0);
    binding.dispose();
  });

  it("latches world depth metadata before the host renders the canonical frame", () => {
    const port = new Port();
    let observedRoot: { x: number; z: number } | undefined;
    const draw = port.draw.bind(port);
    port.draw = frame => {
      expect(observedRoot).toBeDefined();
      draw(frame);
    };
    setup({ onMotion: sample => { observedRoot = { ...sample.worldRoot }; } }, port);
  });

  it("publishes world flight height for the parent's grounded shadow, then returns it to zero on landing", () => {
    const heights: number[] = [];
    const { controller, clock } = setup({ onMotion: sample => heights.push(sample.worldHeight) });
    controller.press("jump");
    clock.elapse(300);
    expect(Math.max(...heights)).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeLessThanOrEqual(28);
    expect(controller.snapshot().worldHeight).toBeGreaterThan(0);
    controller.stop();
    clock.elapse(700);
    expect(controller.snapshot().worldHeight).toBe(0);
  });

  it("requires approval and never auto-focuses or listens to document keydown", () => {
    const { controller, intents } = setup();
    const host = new FakeHost();
    expect(() => bindFocusedKeyboard(host.element(), controller, { approved: false as true })).toThrow(/approved/);
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    expect(host.ownerDocument.activeElement).toBe(null);
    expect(host.key("keydown", "ArrowRight").defaultPrevented).toBe(false);
    host.ownerDocument.dispatchEvent(new Event("keydown"));
    expect(intents).toHaveLength(0);
    binding.dispose();
  });

  it.each(["ArrowLeft", "KeyA", "ArrowRight", "KeyD", "Space", "KeyP"])("accepts %s only on the focused approved host and ignores repeat", code => {
    const { controller, intents } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    expect(host.key("keydown", code).defaultPrevented).toBe(true);
    expect(intents).toHaveLength(1);
    host.key("keydown", code, { repeat: true });
    expect(intents).toHaveLength(1);
    binding.dispose();
    controller.dispose();
  });

  it("Shift before focus applies run to the first movement; aliases release only when all are up", () => {
    const { controller } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    host.key("keydown", "KeyD", { shiftKey: true });
    host.key("keydown", "ArrowRight", { shiftKey: true });
    expect(controller.snapshot().intent).toMatchObject({ horizontal: 1, run: true });
    host.key("keyup", "KeyD", { shiftKey: true });
    expect(controller.snapshot().direction).toBe(1);
    host.key("keyup", "ArrowRight");
    expect(controller.snapshot()).toMatchObject({ direction: 0, running: false });
    binding.dispose();
  });

  it.each(["ctrlKey", "altKey", "metaKey", "isComposing"] as const)("does not capture %s shortcuts/composition", modifier => {
    const { controller, intents } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    expect(host.key("keydown", "KeyD", { [modifier]: true }).defaultPrevented).toBe(false);
    expect(intents).toHaveLength(0);
    binding.dispose();
  });

  it("ignores editable hosts/descendants, unrelated keys, and pre-handled events", () => {
    const { controller, intents } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    host.isContentEditable = true;
    expect(host.key("keydown", "Space").defaultPrevented).toBe(false);
    host.isContentEditable = false;
    host.editableTag = true;
    expect(host.key("keydown", "KeyD").defaultPrevented).toBe(false);
    host.editableTag = false;
    host.ownerDocument.activeElement = new EventTarget();
    expect(host.key("keydown", "KeyD").defaultPrevented).toBe(false);
    host.focus();
    expect(host.key("keydown", "KeyQ").defaultPrevented).toBe(false);
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { code: "KeyD" });
    event.preventDefault();
    host.dispatchEvent(event);
    expect(intents).toHaveLength(0);
    binding.dispose();
  });

  it.each(["blur", "escape", "hidden"] as const)("clears held/jump intent immediately on %s and lets core settle", method => {
    const { controller, clock, errors } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    host.key("keydown", "KeyD");
    host.key("keydown", "Space");
    clock.elapse(100);
    if (method === "blur") {
      host.ownerDocument.activeElement = null;
      host.dispatchEvent(new Event("blur"));
    } else if (method === "escape") expect(host.key("keydown", "Escape").defaultPrevented).toBe(true);
    else {
      host.ownerDocument.hidden = true;
      host.ownerDocument.dispatchEvent(new Event("visibilitychange"));
    }
    expect(controller.snapshot()).toMatchObject({ direction: 0, running: false, intent: { stop: true } });
    clock.elapse(700);
    expect(["idle", "blocked"]).toContain(controller.snapshot().motionStatus);
    expect(clock.callbacks.size).toBe(0);
    expect(errors).toHaveLength(0);
    binding.dispose();
  });

  it("idempotently restores only owned tabindex and detaches input listeners", () => {
    const { controller, intents } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    expect(host.getAttribute("tabindex")).toBe("0");
    binding.dispose();
    binding.dispose();
    expect(host.getAttribute("tabindex")).toBe(null);
    host.focus();
    expect(host.key("keydown", "KeyD").defaultPrevented).toBe(false);
    expect(intents).toHaveLength(1); // Binding disposal explicitly sent stop.
    host.setAttribute("tabindex", "-1");
    bindFocusedKeyboard(host.element(), controller, { approved: true }).dispose();
    expect(host.getAttribute("tabindex")).toBe("-1");
    host.removeAttribute("tabindex");
    const other = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.setAttribute("tabindex", "3");
    other.dispose();
    expect(host.getAttribute("tabindex")).toBe("3");
  });

  it("controller disposal automatically removes keyboard listeners and restores tabindex", () => {
    const { controller } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    controller.dispose();
    expect(host.getAttribute("tabindex")).toBe(null);
    expect(host.key("keydown", "KeyD").defaultPrevented).toBe(false);
    binding.dispose();
    expect(() => bindFocusedKeyboard(host.element(), controller, { approved: true })).toThrow(/disposed/);
  });

  it("does not capture keys while reduced/invalid", () => {
    const { controller, port } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    port.setReduced(true);
    expect(host.key("keydown", "Space").defaultPrevented).toBe(false);
    port.setReduced(false);
    controller.invalidateLayout();
    expect(host.key("keydown", "KeyD").defaultPrevented).toBe(false);
    binding.dispose();
  });
});
