import { describe, expect, it } from "vitest";
import {
  bindFocusedKeyboard, createKeyboardController,
  type KeyboardController, type KeyboardControllerOptions, type KeyboardState
} from "../src/keyboard.js";
import { createBrowserScene, viewportToScene, type BrowserClock, type BrowserPlayerPort, type CssRect } from "../src/browser.js";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
import type { CompiledAnimation, SampledFrame } from "../src/contract.js";

class Clock implements BrowserClock {
  time = 0;
  next = 1;
  callbacks = new Map<number, (time: number) => void>();
  now(): number { return this.time; }
  request(fn: (time: number) => void): number {
    const id = this.next++;
    this.callbacks.set(id, fn);
    return id;
  }
  cancel(id: number): void { this.callbacks.delete(id); }
  advance(ms: number): void {
    this.time += ms;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(this.time);
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

const defaults: KeyboardControllerOptions = {
  canvas: { width: 640, height: 360 }, initialX: 140, groundY: 290,
  pointTarget: { x: 500, y: 100 }
};

function setup(overrides: Partial<KeyboardControllerOptions> = {}, port = new Port()) {
  const clock = new Clock();
  const programs: CompiledAnimation[] = [];
  const states: KeyboardState[] = [];
  const errors: Error[] = [];
  const controller = createKeyboardController({
    ...defaults, onProgram: program => programs.push(program),
    onState: state => states.push(state), onError: error => errors.push(error),
    ...overrides
  }, port, clock);
  return { controller, port, clock, programs, states, errors };
}

describe("keyboard canonical intent and cadence", () => {
  it("renders the exact initial root without autoplay or mutation of options", () => {
    const options = { ...defaults, canvas: { ...defaults.canvas }, pointTarget: { ...defaults.pointTarget } };
    const before = structuredClone(options);
    const { controller, clock, port, programs } = setup(options);
    expect(controller.snapshot()).toMatchObject({ status: "idle", currentRoot: { x: 140, y: 290 } });
    expect(port.frames[0]?.x).toBe(140);
    expect(clock.callbacks.size).toBe(0);
    expect(programs).toHaveLength(0);
    expect(options).toEqual(before);
  });

  it.each(["walk", "run"] as const)("uses feasible short %s segments, compiling once per horizon not per frame", kind => {
    const { controller, clock, programs, port } = setup();
    if (kind === "run") controller.press("run");
    controller.press("right");
    expect(programs).toHaveLength(1);
    const program = programs[0]!;
    expect(program.spec.actions[0]?.action).toBe(kind);
    expect(program.spec.durationMs).toBe(kind === "walk" ? 700 : 500);
    expect(compileAnimation(program.spec).valid).toBe(true);
    for (let i = 0; i < 10; i++) {
      clock.advance(20);
      expect(port.frames.at(-1)).toEqual(sampleAnimation(program, (i + 1) * 20));
    }
    expect(programs).toHaveLength(1);
    clock.advance(program.spec.durationMs - 200);
    expect(programs).toHaveLength(2);
    expect(programs[1]?.spec.actor?.x).toBe(sampleAnimation(program, program.spec.durationMs).x);
    expect(clock.callbacks.size).toBe(1);
  });

  it("deduplicates repeated key intent and never builds a clip backlog", () => {
    const { controller, programs, clock } = setup();
    for (let i = 0; i < 100; i++) controller.press("right");
    expect(programs).toHaveLength(1);
    clock.advance(20_000);
    expect(programs).toHaveLength(2);
    expect(controller.snapshot().currentRoot.x).toBe(180);
    expect(clock.callbacks.size).toBe(1);
  });

  it("release and Escape-style stop finish the current safe plant without teleporting", () => {
    const { controller, clock, programs } = setup();
    controller.press("right");
    clock.advance(250);
    const x = controller.snapshot().currentRoot.x;
    controller.release("right");
    controller.stop();
    expect(controller.snapshot().currentRoot.x).toBe(x);
    clock.advance(450);
    expect(controller.snapshot()).toMatchObject({ status: "idle", currentRoot: { x: 180, y: 290 } });
    expect(programs).toHaveLength(1);
    expect(clock.callbacks.size).toBe(0);
  });

  it("reverses and changes run intent only at grounded endpoints", () => {
    const { controller, clock, programs } = setup();
    controller.press("right");
    clock.advance(200);
    controller.release("right");
    controller.press("left");
    controller.press("run");
    expect(programs).toHaveLength(1);
    clock.advance(500);
    expect(programs[1]?.spec.actions[0]?.action).toBe("run");
    expect(programs[1]?.spec.actor?.x).toBe(180);
    expect(programs[1]?.spec.targets?.travel?.x).toBe(120);
    controller.stop();
    clock.advance(500);
    expect(controller.snapshot().currentRoot.x).toBe(120);
  });

  it("defers a single jump, lands before movement, and disallows in-air steering", () => {
    const { controller, clock, programs } = setup();
    controller.press("right");
    controller.press("jump");
    expect(controller.snapshot().deferredJump).toBe(true);
    clock.advance(700);
    expect(controller.snapshot()).toMatchObject({ status: "jumping", deferredJump: false });
    expect(programs[1]?.spec.actions[0]?.action).toBe("jump");
    controller.release("right");
    controller.press("left");
    clock.advance(400);
    expect(controller.snapshot().currentRoot.x).toBe(180);
    expect(programs).toHaveLength(2);
    clock.advance(600);
    expect(programs[2]?.spec.actor?.x).toBe(180);
    expect(programs[2]?.spec.targets?.travel?.x).toBe(140);
  });

  it("a released queued jump/point is cancelled; held jump does not repeatedly hop", () => {
    const { controller, clock, programs } = setup();
    controller.press("right");
    controller.press("jump");
    controller.press("point");
    controller.release("jump");
    controller.release("point");
    controller.release("right");
    clock.advance(700);
    expect(programs).toHaveLength(1);
    controller.press("jump");
    for (let i = 0; i < 30; i++) controller.press("jump");
    clock.advance(1000);
    expect(controller.snapshot().status).toBe("idle");
    expect(programs).toHaveLength(2);
  });

  it("points at only the supplied explicit scene anchor", () => {
    const { controller, clock, programs } = setup();
    controller.press("point");
    expect(controller.snapshot().status).toBe("pointing");
    expect(programs[0]?.spec.targets?.point).toEqual(defaults.pointTarget);
    expect(programs[0]?.spec.actions[0]?.target).toBe("point");
    clock.advance(700);
    expect(controller.snapshot().currentRoot.x).toBe(140);
    expect(controller.snapshot().status).toBe("idle");
  });

  it("opposing held directions stop at the next plant and releasing one resumes the other", () => {
    const { controller, programs, clock } = setup();
    controller.press("right");
    controller.press("left");
    clock.advance(700);
    expect(controller.snapshot()).toMatchObject({ status: "idle", direction: 0 });
    expect(clock.callbacks.size).toBe(0);
    controller.release("right");
    expect(programs[1]?.spec.targets?.travel?.x).toBe(140);
  });
});

describe("keyboard bounds and canonical geometry", () => {
  it.each([NaN, Infinity, -1, 0, 79, 561, 640])("rejects invalid/out-of-usable-bounds initial root %s", initialX => {
    expect(() => setup({ initialX })).toThrow(/initialX/);
  });

  it.each([NaN, 0, 195, 357])("rejects floors %s that would resize or overflow the rig", groundY => {
    expect(() => setup({ groundY })).toThrow(/full-size rig/);
  });

  it("rejects invalid canvas and point targets rather than silently clamping", () => {
    expect(() => setup({ canvas: { width: 4097, height: 360 } })).toThrow(/canvas/);
    expect(() => setup({ pointTarget: { x: 700, y: 20 } })).toThrow(/pointTarget/);
    expect(() => setup({ pointTarget: { x: NaN, y: 20 } })).toThrow(/pointTarget/);
  });

  it.each([-1, 1] as const)("halts held motion at the genuine %s boundary with no zero-distance loops", dir => {
    const initialX = dir === -1 ? 90 : 550;
    const { controller, clock, programs } = setup({ initialX });
    controller.press(dir === -1 ? "left" : "right");
    clock.advance(700);
    expect(controller.snapshot()).toMatchObject({ status: "blocked", currentRoot: { x: dir === -1 ? 80 : 560, y: 290 } });
    expect(programs).toHaveLength(1);
    expect(clock.callbacks.size).toBe(0);
  });

  it("samples canonical fixed bones and planted feet, without a second pose engine", () => {
    const { controller, clock, programs, port } = setup();
    controller.press("left");
    const program = programs[0]!;
    const lengths = new Map<string, number>();
    const frames: SampledFrame[] = [];
    for (let i = 0; i < 70; i++) {
      clock.advance(10);
      const frame = sampleAnimation(program, (i + 1) * 10);
      frames.push(frame);
      // Finish remounts only if intent remains; this test releases before endpoint.
      if (i === 68) controller.release("left");
      expect(port.frames.at(-1)).toEqual(frame);
      for (const segment of frame.segments) {
        const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
        if (!lengths.has(segment.id)) lengths.set(segment.id, length);
        expect(length).toBeCloseTo(lengths.get(segment.id)!, 6);
        for (const [x, y] of [[segment.x1, segment.y1], [segment.x2, segment.y2]]) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(640);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(290.000001);
        }
      }
    }
    // Consecutive grounded support samples retain their world-space anchor.
    let plantedPairs = 0;
    for (let i = 1; i < frames.length; i++) {
      for (const id of ["left-shin", "right-shin"]) {
        const a = frames[i - 1]!.segments.find(s => s.id === id);
        const b = frames[i]!.segments.find(s => s.id === id);
        if (a && b && Math.abs(a.y2 - 290) < 1e-6 && Math.abs(b.y2 - 290) < 1e-6 && Math.abs(a.x2 - b.x2) < 1e-6) plantedPairs++;
      }
    }
    expect(plantedPairs).toBeGreaterThan(10);
  });

  it.each([80, 560])("keeps run, jump and point feasible at usable boundary %s", initialX => {
    const { controller, programs, clock, errors } = setup({ initialX });
    controller.press("jump");
    clock.advance(1000);
    controller.release("jump");
    controller.press("point");
    clock.advance(700);
    controller.release("point");
    controller.press("run");
    controller.press(initialX === 80 ? "right" : "left");
    clock.advance(500);
    controller.stop();
    expect(errors).toHaveLength(0);
    expect(programs.slice(0, 3).map(p => p.spec.actions[0]?.action)).toEqual(["jump", "point", "run"]);
    for (const program of programs) expect(compileAnimation(program.spec).valid).toBe(true);
  });

  it("supports the parent 1280x720 CSS scene with a 64px avatar through whole-scene mapping", () => {
    const scene = createBrowserScene({ left: 0, top: 0, width: 1280, height: 720 }, 64);
    const start = viewportToScene(scene, { x: 200, y: 600 });
    const target = viewportToScene(scene, { x: 1000, y: 200 });
    const port = new Port();
    port.rect = { ...scene.rect };
    const { controller, clock, programs, errors } = setup({
      canvas: { ...scene.canvas }, initialX: start.x, groundY: start.y, pointTarget: target
    }, port);
    controller.press("right");
    controller.stop();
    clock.advance(700);
    controller.press("point");
    expect(errors).toHaveLength(0);
    expect(programs[1]?.spec.targets?.point).toEqual(target);
    expect(controller.snapshot().currentRoot.x).toBe(start.x + 40);
  });

  it("does not evade the core's minimum cadence by pretending 300ms locomotion is feasible", () => {
    const { controller, programs } = setup();
    controller.press("right");
    const spec = structuredClone(programs[0]!.spec);
    spec.durationMs = 300;
    spec.actions[0]!.durationMs = 300;
    const result = compileAnimation(spec);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some(d => d.code === "infeasible_cadence")).toBe(true);
  });
});

describe("keyboard lifecycle and explicit failures", () => {
  it("disposes RAF, observers and shared surface exactly once; later commands are inert", () => {
    const { controller, clock, port, programs } = setup();
    controller.press("right");
    controller.dispose();
    controller.dispose();
    controller.press("jump");
    controller.release("right");
    controller.stop();
    clock.advance(1000);
    expect(controller.snapshot().status).toBe("disposed");
    expect(clock.callbacks.size).toBe(0);
    expect(port.disposals).toBe(1);
    expect(port.layout.size + port.motion.size).toBe(0);
    expect(programs).toHaveLength(1);
  });

  it.each(["event", "measure", "guard"] as const)("terminally invalidates %s layout rather than resizing old coordinates", method => {
    const { controller, clock, port } = setup();
    controller.press("right");
    clock.advance(100);
    const x = controller.snapshot().currentRoot.x;
    if (method === "event") port.invalidate();
    else if (method === "measure") port.rect = { ...port.rect, width: 800 };
    else port.current = false;
    clock.advance(100);
    expect(controller.snapshot()).toMatchObject({ status: "invalid", currentRoot: { x, y: 290 } });
    expect(port.visible).toBe(false);
    expect(clock.callbacks.size).toBe(0);
    controller.press("jump");
    expect(controller.snapshot().status).toBe("invalid");
    controller.dispose();
    expect(port.disposals).toBe(1);
  });

  it("detects an idle layout change even without a delivered observer event", () => {
    const { controller, port, clock } = setup();
    port.rect = { ...port.rect, left: 12 };
    controller.press("right");
    expect(controller.snapshot().status).toBe("invalid");
    expect(clock.callbacks.size).toBe(0);
  });

  it("initial reduced motion never skips to an endpoint and needs fresh intention on normal mode", () => {
    const port = new Port();
    port.reduced = true;
    const { controller, clock, programs } = setup({}, port);
    controller.press("right");
    controller.press("jump");
    expect(controller.snapshot().status).toBe("reduced");
    expect(programs).toHaveLength(0);
    expect(clock.callbacks.size).toBe(0);
    expect(controller.snapshot().currentRoot.x).toBe(140);
    port.setReduced(false);
    clock.advance(1000);
    expect(programs).toHaveLength(0);
    controller.press("right");
    expect(programs).toHaveLength(1);
  });

  it("reduced motion interrupts without teleport; remount is required after an interrupted pose", () => {
    const { controller, port, clock, programs } = setup();
    controller.press("jump");
    clock.advance(450);
    const frame = port.frames.at(-1);
    port.setReduced(true);
    expect(port.frames.at(-1)).toBe(frame);
    expect(controller.snapshot().status).toBe("reduced");
    expect(clock.callbacks.size).toBe(0);
    port.setReduced(false);
    expect(controller.snapshot().status).toBe("invalid");
    controller.press("left");
    expect(programs).toHaveLength(1);
  });

  it("duplicate motion preference notifications do not interrupt a live clip", () => {
    const { controller, port, clock } = setup();
    controller.press("right");
    port.setReduced(false);
    expect(controller.snapshot().status).toBe("moving");
    expect(clock.callbacks.size).toBe(1);
    controller.stop();
    clock.advance(700);
    expect(controller.snapshot().currentRoot.x).toBe(180);
  });

  it("reports render failures with terminal state and no silent fallback", () => {
    const { controller, clock, port, errors } = setup();
    controller.press("right");
    port.drawError = new Error("surface failed");
    clock.advance(100);
    expect(errors.map(error => error.message)).toEqual(["surface failed"]);
    expect(controller.snapshot()).toMatchObject({ status: "error", error: "surface failed" });
    expect(clock.callbacks.size).toBe(0);
    expect(port.visible).toBe(false);
  });

  it("reports invalid clock timestamps explicitly", () => {
    const { controller, clock, errors } = setup();
    controller.press("right");
    clock.advance(NaN);
    expect(controller.snapshot().status).toBe("error");
    expect(errors[0]?.message).toMatch(/timestamp/);
    expect(clock.callbacks.size).toBe(0);
  });

  it("reports program callback failures, rather than falling back to an uncompiled pose", () => {
    const { controller, errors, clock } = setup({ onProgram: () => { throw new Error("intent adapter failed"); } });
    controller.press("right");
    expect(errors[0]?.message).toBe("intent adapter failed");
    expect(controller.snapshot()).toMatchObject({ status: "error", currentRoot: { x: 140, y: 290 } });
    expect(clock.callbacks.size).toBe(0);
  });

  it("isolates published state/program data from internal roots and compiled clips", () => {
    let observed: KeyboardState | undefined;
    const { controller, clock } = setup({
      onState: state => { observed = state; },
      onProgram: program => { program.spec.actor!.x = 400; }
    });
    controller.press("right");
    if (observed) Object.assign(observed.currentRoot, { x: 999 });
    expect(controller.snapshot().currentRoot.x).toBe(140);
    controller.stop();
    clock.advance(700);
    expect(controller.snapshot().currentRoot.x).toBe(180);
  });

  it("respects disposal or stop from the program callback", () => {
    let controller: KeyboardController | undefined;
    const env = setup({ onProgram: () => controller?.stop() });
    controller = env.controller;
    controller.press("right");
    expect(env.clock.callbacks.size).toBe(0);
    expect(controller.snapshot().currentRoot.x).toBe(140);
  });
});

// Minimal DOM seam: no browser emulation dependency, and no unsafe broad casts.
// HTMLElement narrowing is localized to the fake host boundary.
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
  it("requires approval and never auto-focuses or listens globally", () => {
    const { controller, programs } = setup();
    const host = new FakeHost();
    expect(() => bindFocusedKeyboard(host.element(), controller, { approved: false as true })).toThrow(/approved/);
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    expect(host.ownerDocument.activeElement).toBe(null);
    expect(host.key("keydown", "ArrowRight").defaultPrevented).toBe(false);
    expect(programs).toHaveLength(0);
    binding.dispose();
  });

  it.each(["ArrowLeft", "KeyA", "ArrowRight", "KeyD", "Space", "KeyP"])("accepts %s only on the focused approved host", code => {
    const { controller, programs } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    expect(host.key("keydown", code).defaultPrevented).toBe(true);
    expect(programs).toHaveLength(1);
    host.key("keydown", code, { repeat: true });
    expect(programs).toHaveLength(1);
    binding.dispose();
    controller.dispose();
  });

  it("Shift already held before focus runs the first segment; aliases release only when all are up", () => {
    const { controller, programs, clock } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    host.key("keydown", "KeyD", { shiftKey: true });
    host.key("keydown", "ArrowRight", { shiftKey: true });
    expect(programs[0]?.spec.actions[0]?.action).toBe("run");
    host.key("keyup", "KeyD", { shiftKey: true });
    expect(controller.snapshot().direction).toBe(1);
    host.key("keyup", "ArrowRight");
    expect(controller.snapshot()).toMatchObject({ direction: 0, running: false });
    clock.advance(500);
    expect(programs).toHaveLength(1);
    binding.dispose();
  });

  it.each(["ctrlKey", "altKey", "metaKey", "isComposing"] as const)("does not capture %s shortcuts/composition", modifier => {
    const { controller, programs } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    expect(host.key("keydown", "KeyD", { [modifier]: true }).defaultPrevented).toBe(false);
    expect(programs).toHaveLength(0);
    binding.dispose();
  });

  it("does not capture editable hosts or descendants, unrelated keys, or pre-handled events", () => {
    const { controller, programs } = setup();
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
    expect(programs).toHaveLength(0);
    binding.dispose();
  });

  it.each(["blur", "escape", "hidden"] as const)("clears held/deferred intent on %s without abrupt root changes", method => {
    const { controller, programs, clock } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.focus();
    host.key("keydown", "KeyD");
    host.key("keydown", "Space");
    clock.advance(200);
    const root = controller.snapshot().currentRoot;
    if (method === "blur") {
      host.ownerDocument.activeElement = null;
      host.dispatchEvent(new Event("blur"));
    } else if (method === "escape") expect(host.key("keydown", "Escape").defaultPrevented).toBe(true);
    else {
      host.ownerDocument.hidden = true;
      host.ownerDocument.dispatchEvent(new Event("visibilitychange"));
    }
    expect(controller.snapshot()).toMatchObject({ direction: 0, deferredJump: false, currentRoot: root });
    clock.advance(500);
    expect(programs).toHaveLength(1);
    expect(clock.callbacks.size).toBe(0);
    binding.dispose();
  });

  it("idempotently restores only an owned tabindex and detaches input listeners", () => {
    const { controller, programs } = setup();
    const host = new FakeHost();
    const binding = bindFocusedKeyboard(host.element(), controller, { approved: true });
    expect(host.getAttribute("tabindex")).toBe("0");
    binding.dispose();
    binding.dispose();
    expect(host.getAttribute("tabindex")).toBe(null);
    host.focus();
    expect(host.key("keydown", "KeyD").defaultPrevented).toBe(false);
    expect(programs).toHaveLength(0);
    host.setAttribute("tabindex", "-1");
    bindFocusedKeyboard(host.element(), controller, { approved: true }).dispose();
    expect(host.getAttribute("tabindex")).toBe("-1");
    host.removeAttribute("tabindex");
    const other = bindFocusedKeyboard(host.element(), controller, { approved: true });
    host.setAttribute("tabindex", "3");
    other.dispose();
    expect(host.getAttribute("tabindex")).toBe("3");
  });

  it("controller disposal also removes bound keyboard listeners and restores tabindex", () => {
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

  it("does not capture keyboard events on an invalidated or reduced-motion controller", () => {
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
