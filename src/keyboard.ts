import {
  createSceneProjection, type BrowserClock, type BrowserPlayerPort
} from "./browser.js";
import { type CompiledAnimation, type Point2D, type SampledFrame } from "./contract.js";
import {
  advanceMotionIntent, createMotionIntentState,
  type MotionIntentState, type MotionIntentSample, type WorldPoint, type WorldRoom, type WorldMotionScene
} from "./world-motion.js";

export type KeyboardCommand = "left" | "right" | "forward" | "backward" | "run" | "jump" | "point";
export type KeyboardMotionStatus = "idle" | "moving" | "jumping" | "pointing" | "blocked";
export type KeyboardStatus = KeyboardMotionStatus | "reduced" | "invalid" | "error" | "disposed";

export interface KeyboardIntent {
  readonly horizontal: -1 | 0 | 1;
  readonly depth: -1 | 0 | 1;
  readonly run: boolean;
  readonly jumpRequest: number;
  readonly pointRequest: number;
  readonly stop: boolean;
}

/** Timestamped intent observations, not a promise of partition-independent replay. */
export interface KeyboardIntentRecord {
  readonly timeMs: number;
  readonly intent: KeyboardIntent;
}

export interface KeyboardState extends KeyboardIntentRecord {
  readonly status: KeyboardStatus;
  /** Core status remains observable while reduced motion safely brakes/lands. */
  readonly motionStatus: KeyboardMotionStatus;
  /** Canonical frame root and world floor; not the actor's airborne hip position. */
  readonly currentRoot: Readonly<Point2D>;
  readonly worldRoot: Readonly<WorldPoint>;
  readonly worldHeight: number;
  readonly direction: -1 | 0 | 1;
  readonly depthDirection: -1 | 0 | 1;
  readonly running: boolean;
  readonly error: string | null;
}

export interface KeyboardMotionObservation extends KeyboardIntentRecord {
  readonly status: KeyboardMotionStatus;
  readonly frame: SampledFrame;
  readonly worldRoot: Readonly<WorldPoint>;
  readonly worldHeight: number;
  readonly contacts: MotionIntentSample["contacts"];
}

export interface KeyboardControllerOptions {
  /** Virtual units, not CSS pixels. Map the entire browser scene and its anchors. */
  canvas: { width: number; height: number };
  /** Legacy flat scene; required unless world is supplied. */
  initialX?: number;
  groundY?: number;
  pointTarget?: Point2D;
  /** Fixed orthographic room callbacks, supplied by the trusted local host. */
  world?: WorldRoom;
  program?: CompiledAnimation;
  onState?: (state: KeyboardState) => void;
  onError?: (error: Error) => void;
  onIntent?: (record: KeyboardIntentRecord) => void;
  onMotion?: (observation: KeyboardMotionObservation) => void;
  /**
   * @deprecated Called ONLY once with the canonical authored baseline, if supplied.
   * Interactive intent is not a sequence of finite v1 programs. Use onMotion.
   */
  onProgram?: (program: CompiledAnimation) => void;
}

export interface KeyboardController {
  snapshot(): KeyboardState;
  press(command: KeyboardCommand): void;
  release(command: KeyboardCommand): void;
  /** Immediately clears intent; canonical core brakes/lands without pose freezing. */
  stop(): void;
  /** Terminal: stale scene coordinates are hidden, never resized in place. */
  invalidateLayout(reason?: string): void;
  dispose(): void;
  onDispose(listener: () => void): () => void;
}

/**
 * Responsive local intent adapter, not an MCP game-input protocol. MCP supplies
 * authored v1 programs; local keyboard intent uses the world/contact planner and
 * compiler's shared FK/IK. No finite-clip queues, per-frame compilation, root integration,
 * foot/joint manipulation, or independent physics live in this adapter. The
 * world-motion planner owns X/Z trajectories and contacts; compiler owns joints.
 *
 * Input advances OLD intent to clock.now(), then NEW intent at that same time.
 * Jump/point requests have monotonic edge IDs: keyup does not revoke a pending
 * jump. Escape/blur sets stop=true; the core cancels requests and brakes/lands.
 * RAF advances only the returned opaque core state. A RAF timestamp predating
 * an input has zero elapsed time; input clock regression is an explicit error.
 *
 * Reduced motion rejects fresh keyboard motion and clears intent immediately.
 * An already moving/airborne pose settles safely through the same core, rather
 * than teleporting or freezing in flight. Once settled it is static; returning
 * to normal does not restore held input. Safe settling can still be animated.
 *
 * The controller owns the port and observers after successful construction.
 * Layout invalidation hides the stale surface and is terminal; remap/recreate.
 * Dispose also removes associated focused bindings and restores owned tabindex.
 * Deterministic replay is NOT promised here; onIntent records exact transitions
 * for diagnostics, and onMotion reports canonical samples with their timestamps.
 */
export function createKeyboardController(
  options: KeyboardControllerOptions, port: BrowserPlayerPort, clock: BrowserClock
): KeyboardController {
  let room: WorldRoom;
  if (options.world) room = options.world;
  else {
    const { initialX, groundY, pointTarget } = options;
    if (initialX === undefined || groundY === undefined || pointTarget === undefined) {
      throw new TypeError("Supply world room options or legacy initialX, groundY and pointTarget.");
    }
    const width = options.canvas.width;
    room = {
      width, depth: 0, initial: { x: initialX, z: 0 },
      pointTarget: { x: pointTarget.x, z: 0, height: groundY - pointTarget.y },
      projectWorld: (point, height = 0) => ({ x: point.x, y: groundY - height }),
      canOccupy: point => point.x >= 80 && point.x <= width - 80 && point.z === 0
    };
  }
  const scene: WorldMotionScene = {
    ...room, canvas: { ...options.canvas, fps: 60 },
    projectWorld: (point, height = 0) => room.projectWorld(point, height),
    ...(room.canOccupy ? { canOccupy: (point: WorldPoint, radius: number) => room.canOccupy!(point, radius) } : {}),
    ...(options.program ? { program: options.program } : {})
  };
  const sceneRect = createSceneProjection(port.measure(), scene.canvas).rect;
  const initialTime = clock.now();
  if (!Number.isFinite(initialTime)) throw new RangeError("Keyboard clock timestamp must be finite.");
  let core: MotionIntentState = createMotionIntentState(scene, initialTime);
  let timeMs = initialTime;
  let reduced = port.reducedMotion();
  let terminalStatus: "invalid" | "error" | "disposed" | null = null;
  let errorMessage: string | null = null;
  let intent: KeyboardIntent = { horizontal: 0, depth: 0, run: false, jumpRequest: 0, pointRequest: 0, stop: reduced };
  const initialSample = advanceMotionIntent(core, intent, initialTime);
  core = initialSample.state;
  let motionStatus: KeyboardMotionStatus = initialSample.status;
  let frame: SampledFrame = initialSample.frame;
  let worldRoot: WorldPoint = { ...initialSample.worldRoot };
  let worldHeight = initialSample.worldHeight;
  let contacts = initialSample.contacts;
  let raf: number | null = null;
  let jumpRequest = 0;
  let pointRequest = 0;
  const held = new Set<KeyboardCommand>();
  const cleanups: Array<() => void> = [];
  const disposeListeners = new Set<() => void>();
  const direction = (): -1 | 0 | 1 => held.has("left") === held.has("right") ? 0 : held.has("left") ? -1 : 1;
  const depthDirection = (): -1 | 0 | 1 => scene.depth === 0 || held.has("forward") === held.has("backward") ? 0 : held.has("forward") ? -1 : 1;
  const snapshot = (): KeyboardState => ({
    timeMs, intent: { ...intent }, status: terminalStatus ?? (reduced ? "reduced" : motionStatus),
    motionStatus, currentRoot: { x: frame.x, y: frame.groundY },
    worldRoot: { ...worldRoot }, worldHeight, direction: intent.horizontal, depthDirection: intent.depth, running: intent.run, error: errorMessage
  });
  const publish = (): void => { options.onState?.(snapshot()); };
  const cancelRaf = (): void => { if (raf !== null) clock.cancel(raf); raf = null; };
  const detach = (): void => { for (const cleanup of cleanups.splice(0)) cleanup(); };
  const clearHeld = (): void => { held.clear(); };
  const layoutCurrent = (): boolean => {
    const rect = port.measure();
    return rect.left === sceneRect.left && rect.top === sceneRect.top
      && rect.width === sceneRect.width && rect.height === sceneRect.height
      && (port.layoutCurrent?.() ?? true);
  };
  const advance = (next: KeyboardIntent, atMs: number): void => {
    if (!Number.isFinite(atMs)) throw new RangeError("Keyboard clock timestamp must be finite.");
    if (atMs < timeMs) throw new RangeError("Keyboard input clock must be monotonic.");
    const sample = advanceMotionIntent(core, next, atMs);
    if (sample.diagnostic !== undefined) {
      throw new Error(`Keyboard motion rejected: ${typeof sample.diagnostic === "string" ? sample.diagnostic : JSON.stringify(sample.diagnostic)}`);
    }
    core = sample.state;
    worldRoot = { ...sample.worldRoot };
    worldHeight = sample.worldHeight;
    contacts = sample.contacts;
    frame = sample.frame;
    motionStatus = sample.status;
    timeMs = atMs;
    intent = { ...next };
  };
  const render = (): void => {
    if (terminalStatus !== null) return;
    // Host can latch depth/occlusion metadata before its existing draw(frame).
    options.onMotion?.({
      timeMs, intent: { ...intent }, status: motionStatus,
      frame: structuredClone(frame), worldRoot: { ...worldRoot }, worldHeight, contacts: structuredClone(contacts)
    });
    if (terminalStatus !== null) return;
    port.draw(frame);
    publish();
  };
  const needsTick = (): boolean => motionStatus === "moving" || motionStatus === "jumping" || motionStatus === "pointing"
    || (!reduced && !intent.stop && (intent.horizontal !== 0 || intent.depth !== 0) && motionStatus !== "blocked");
  const schedule = (): void => {
    if (terminalStatus === null && raf === null && needsTick()) raf = clock.request(tick);
  };
  const settleSchedule = (): void => { if (needsTick()) schedule(); else cancelRaf(); };
  const fail = (cause: unknown): void => {
    if (terminalStatus !== null) return;
    cancelRaf();
    clearHeld();
    intent = { ...intent, horizontal: 0, depth: 0, run: false, stop: true };
    terminalStatus = "error";
    const error = cause instanceof Error ? cause : new Error(String(cause));
    errorMessage = error.message;
    detach();
    port.setVisible(false);
    publish();
    options.onError?.(error);
  };
  const invalidateLayout = (reason = "Layout changed. Remap anchors and recreate the keyboard controller."): void => {
    if (terminalStatus !== null) return;
    cancelRaf();
    clearHeld();
    intent = { ...intent, horizontal: 0, depth: 0, run: false, stop: true };
    terminalStatus = "invalid";
    errorMessage = reason;
    detach();
    port.setVisible(false);
    publish();
  };
  const guardLayout = (): boolean => {
    if (layoutCurrent()) return true;
    invalidateLayout();
    return false;
  };
  const transition = (change: () => KeyboardIntent): void => {
    if (terminalStatus !== null) return;
    try {
      if (!guardLayout()) return;
      const atMs = clock.now();
      // No callbacks between old/new sampling: observers see one committed input.
      advance(intent, atMs);
      advance(change(), atMs);
      options.onIntent?.({ timeMs, intent: { ...intent } });
      if (terminalStatus !== null) return;
      render();
      settleSchedule();
    } catch (cause) { fail(cause); }
  };
  function tick(atMs: number): void {
    raf = null;
    if (terminalStatus !== null) return;
    try {
      if (!Number.isFinite(atMs)) throw new RangeError("Keyboard RAF timestamp must be finite.");
      if (!guardLayout()) return;
      advance(intent, Math.max(timeMs, atMs));
      render();
      settleSchedule();
    } catch (cause) { fail(cause); }
  }
  const controller: KeyboardController = {
    snapshot,
    press(command) {
      if (terminalStatus !== null || reduced || held.has(command)) return;
      transition(() => {
        held.add(command);
        if (command === "jump") jumpRequest++;
        if (command === "point") pointRequest++;
        return { horizontal: direction(), depth: depthDirection(), run: held.has("run"), jumpRequest, pointRequest, stop: false };
      });
    },
    release(command) {
      if (terminalStatus !== null || !held.has(command)) return;
      transition(() => {
        held.delete(command);
        // Edge requests remain pending until consumed/cancelled by the core.
        return { ...intent, horizontal: direction(), depth: depthDirection(), run: held.has("run") };
      });
    },
    stop() {
      transition(() => {
        clearHeld();
        // Retain monotonic IDs: core stop cancels pending requests, not their history.
        return { horizontal: 0, depth: 0, run: false, jumpRequest, pointRequest, stop: true };
      });
    },
    invalidateLayout,
    dispose() {
      if (terminalStatus === "disposed") return;
      cancelRaf();
      clearHeld();
      intent = { ...intent, horizontal: 0, depth: 0, run: false, stop: true };
      terminalStatus = "disposed";
      for (const listener of [...disposeListeners]) listener();
      disposeListeners.clear();
      detach();
      port.dispose();
      publish();
    },
    onDispose(listener) {
      if (terminalStatus === "disposed") { listener(); return () => {}; }
      disposeListeners.add(listener);
      return () => { disposeListeners.delete(listener); };
    }
  };
  try {
    advance(intent, initialTime);
    cleanups.push(port.onLayoutChange(() => invalidateLayout()));
    cleanups.push(port.onReducedMotion(value => {
      if (terminalStatus !== null || value === reduced) return;
      reduced = value;
      controller.stop();
    }));
    if (options.onProgram) {
      options.onProgram(structuredClone(core.program));
    }
    if (terminalStatus === null) {
      port.setVisible(true);
      render();
    }
  } catch (cause) {
    // Initialization failures throw; runtime failures publish terminal error state.
    cancelRaf();
    detach();
    port.dispose();
    throw cause;
  }
  return controller;
}

export interface FocusedKeyboardBinding {
  dispose(): void;
}

/**
 * Host-only listeners; explicitly approved host itself must have focus.
 * No automatic focus, document/window key handlers, editable/widget capture,
 * Ctrl/Alt/Meta shortcut capture, or composition interception.
 * Blur/hidden/disposal clears held intent; controller safely brakes/lands.
 */
export function bindFocusedKeyboard(
  host: HTMLElement, controller: KeyboardController, options: { approved: true }
): FocusedKeyboardBinding {
  if (options.approved !== true) throw new TypeError("Keyboard host must be explicitly approved.");
  if (controller.snapshot().status === "disposed") throw new Error("Cannot bind a disposed keyboard controller.");
  const original = host.getAttribute("tabindex");
  const ownsTabIndex = original === null;
  if (ownsTabIndex) host.setAttribute("tabindex", "0");
  const keys = new Map<string, KeyboardCommand>();
  let disposed = false;
  const commandFor = (event: KeyboardEvent): KeyboardCommand | undefined => {
    switch (event.code) {
      case "ArrowLeft": case "KeyA": return "left";
      case "ArrowRight": case "KeyD": return "right";
      case "ArrowUp": case "KeyW": return "forward";
      case "ArrowDown": case "KeyS": return "backward";
      case "ShiftLeft": case "ShiftRight": return "run";
      case "Space": return "jump";
      case "KeyP": return "point";
      default: return undefined;
    }
  };
  const clear = (): void => { keys.clear(); controller.stop(); };
  const keydown = (event: KeyboardEvent): void => {
    if (["disposed", "error", "invalid", "reduced"].includes(controller.snapshot().status)) return;
    if (disposed || host.ownerDocument.hidden || host.ownerDocument.activeElement !== host || event.target !== host
      || host.isContentEditable || host.matches("input,textarea,select,button,a[href],[role=textbox]")
      || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.defaultPrevented) return;
    if (event.code === "Escape") { event.preventDefault(); clear(); return; }
    const command = commandFor(event);
    if (!command) return;
    event.preventDefault();
    if (event.repeat || keys.has(event.code)) return;
    keys.set(event.code, command);
    if (event.shiftKey && command !== "run") controller.press("run");
    controller.press(command);
  };
  const keyup = (event: KeyboardEvent): void => {
    const command = keys.get(event.code);
    keys.delete(event.code);
    if (command && ![...keys.values()].includes(command)) controller.release(command);
    if (!event.shiftKey && ![...keys.values()].includes("run")) controller.release("run");
  };
  const visibility = (): void => { if (host.ownerDocument.hidden) clear(); };
  host.addEventListener("keydown", keydown);
  host.addEventListener("keyup", keyup);
  host.addEventListener("blur", clear);
  host.ownerDocument.addEventListener("visibilitychange", visibility);
  let detachDispose: () => void = () => {};
  const binding: FocusedKeyboardBinding = {
    dispose() {
      if (disposed) return;
      disposed = true;
      detachDispose();
      host.removeEventListener("keydown", keydown);
      host.removeEventListener("keyup", keyup);
      host.removeEventListener("blur", clear);
      host.ownerDocument.removeEventListener("visibilitychange", visibility);
      clear();
      if (ownsTabIndex && host.getAttribute("tabindex") === "0") host.removeAttribute("tabindex");
    }
  };
  detachDispose = controller.onDispose(() => binding.dispose());
  return binding;
}
