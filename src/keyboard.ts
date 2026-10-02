import {
  createBrowserPlayer, createSceneProjection,
  type BrowserClock, type BrowserPlayer, type BrowserPlayerPort
} from "./browser.js";
import { compileAnimation } from "./compiler.js";
import { CONTRACT_VERSION, type AnimationSpec, type CompiledAnimation, type Point2D } from "./contract.js";

export type KeyboardCommand = "left" | "right" | "run" | "jump" | "point";
export type KeyboardStatus = "idle" | "moving" | "jumping" | "pointing" | "blocked" | "reduced" | "invalid" | "error" | "disposed";

export interface KeyboardState {
  readonly status: KeyboardStatus;
  /** Canonical sampled world root, never a separately integrated position. */
  readonly currentRoot: Readonly<Point2D>;
  readonly deferredJump: boolean;
  readonly direction: -1 | 0 | 1;
  readonly running: boolean;
  readonly error: string | null;
}

export interface KeyboardControllerOptions {
  /** Virtual units, not CSS pixels. Use the browser scene mapper for CSS anchors. */
  canvas: { width: number; height: number };
  initialX: number;
  groundY: number;
  /** Required explicit world-space anchor for P. */
  pointTarget: Point2D;
  onState?: (state: KeyboardState) => void;
  onError?: (error: Error) => void;
  /** Receives canonical data for diagnostics, not executable authored code. */
  onProgram?: (program: CompiledAnimation) => void;
}

export interface KeyboardController {
  snapshot(): KeyboardState;
  press(command: KeyboardCommand): void;
  release(command: KeyboardCommand): void;
  /** Clears intent; the active finite clip finishes at its safe grounded endpoint. */
  stop(): void;
  /** Terminal: hide stale coordinates; remap the scene and create a new controller. */
  invalidateLayout(reason?: string): void;
  /** Immediate teardown (unlike stop); releases RAF, player, port and subscriptions. */
  dispose(): void;
  /** Bindings use this to restore listeners/tabindex on controller teardown. */
  onDispose(listener: () => void): () => void;
}

/**
 * Bounded keyboard testbed using the SAME canonical compiler and sampler.
 *
 * This is not a game-input protocol for MCP: MCP supplies authored sequences;
 * local keyboard intent supplies a single canonical action at each endpoint.
 * No physics, joint coordinates, authored JavaScript, or per-frame compilation.
 *
 * v1 has no velocity/contact-state handoff or interruptible landing API.
 * Each segment therefore anticipates and settles again, with possible facing/
 * pose discontinuities at remount. Root positions never teleport. Release,
 * Escape, reversal, run changes and jump wait at most one segment (walk 700ms,
 * run 500ms, jump 1000ms, point 700ms); there is no in-air steering.
 * Contacts/bones/physical bounds inside each clip are canonical, not a promise
 * of seamless cross-clip foot continuity. Long RAF gaps finish only one clip.
 *
 * A full-size rig is required so the core's action-dependent headroom policy
 * cannot resize the actor between walk, point and jump. Conservative 80-unit
 * root margins are genuine usable bounds, not sampler clamping. Reduced motion
 * disables all keyboard clips and freezes the current canonical frame without
 * endpoint skipping. If it interrupts a clip, remount is required (the frozen
 * pose might be airborne); otherwise returning to normal needs fresh input.
 *
 * The controller owns the supplied port and disposes it once. A browser host
 * may implement the port or wrap its rendering surface; do not reuse a disposed
 * mounted player as a port. Layout invalidation is terminal, never a resize of
 * stale anchors. Call invalidateLayout when an explicit point anchor moves.
 */
export function createKeyboardController(
  options: KeyboardControllerOptions, port: BrowserPlayerPort, clock: BrowserClock
): KeyboardController {
  const canvas = { ...options.canvas, fps: 60 };
  const sceneRect = createSceneProjection(port.measure(), canvas).rect;
  const { initialX, groundY } = options;
  const target = { ...options.pointTarget };
  if (canvas.width < 180 || !Number.isFinite(groundY) || groundY < 196 || groundY > canvas.height - 4) {
    throw new RangeError("Keyboard testbed requires width >=180 and groundY from 196 to canvas.height - 4 for a fixed full-size rig.");
  }
  const minX = 80;
  const maxX = canvas.width - 80;
  if (!Number.isFinite(initialX) || initialX < minX || initialX > maxX) {
    throw new RangeError(`initialX must lie inside the usable root bounds ${minX}..${maxX}.`);
  }
  if (![target.x, target.y].every(Number.isFinite) || target.x < 0 || target.x > canvas.width || target.y < 0 || target.y > canvas.height) {
    throw new RangeError("pointTarget must be finite and inside the virtual canvas.");
  }
  const held = new Set<KeyboardCommand>();
  let jump = false;
  let point = false;
  let root: Point2D = { x: initialX, y: groundY };
  let status: KeyboardStatus = port.reducedMotion() ? "reduced" : "idle";
  let errorMessage: string | null = null;
  let player: BrowserPlayer | null = null;
  let raf: number | null = null;
  let previous = 0;
  let reduced = status === "reduced";
  let interrupted = false;
  let intentRevision = 0;
  const cleanups: Array<() => void> = [];
  const disposeListeners = new Set<() => void>();
  const direction = (): -1 | 0 | 1 => held.has("left") === held.has("right") ? 0 : held.has("left") ? -1 : 1;
  const terminal = (): boolean => status === "disposed" || status === "error" || status === "invalid";
  const snapshot = (): KeyboardState => ({
    status, currentRoot: { ...root }, deferredJump: jump,
    direction: direction(), running: held.has("run"), error: errorMessage
  });
  const publish = (): void => { options.onState?.(snapshot()); };
  const clearIntent = (): void => { intentRevision++; held.clear(); jump = false; point = false; };
  const layoutCurrent = (): boolean => {
    const rect = port.measure();
    return rect.left === sceneRect.left && rect.top === sceneRect.top
      && rect.width === sceneRect.width && rect.height === sceneRect.height
      && (port.layoutCurrent?.() ?? true);
  };
  const cancelRaf = (): void => { if (raf !== null) clock.cancel(raf); raf = null; };
  const releasePlayer = (): void => {
    const old = player;
    player = null;
    old?.dispose();
  };
  // A clip owns its playhead, not the shared surface or observer subscriptions.
  const clipPort: BrowserPlayerPort = {
    measure: () => port.measure(),
    layoutCurrent,
    draw(frame) { root = { x: frame.x, y: frame.groundY }; port.draw(frame); },
    setVisible: visible => port.setVisible(visible),
    dispose() {},
    reducedMotion: () => false,
    onReducedMotion: () => () => {},
    onLayoutChange: () => () => {}
  };
  const compile = (action: AnimationSpec["actions"] = [], durationMs = 100, destination = root.x): CompiledAnimation => {
    const spec: AnimationSpec = {
      version: CONTRACT_VERSION, canvas: { ...canvas }, durationMs,
      actor: { x: root.x, groundY },
      targets: { travel: { x: destination, y: groundY }, point: { ...target } },
      actions: action
    };
    const result = compileAnimation(spec);
    if (!result.valid || !result.program) {
      throw new TypeError(`Keyboard clip rejected: ${result.diagnostics.map(d => `${d.code} ${d.path}: ${d.message}`).join("; ")}`);
    }
    return result.program;
  };
  const fail = (cause: unknown): void => {
    cancelRaf();
    releasePlayer();
    clearIntent();
    status = "error";
    const error = cause instanceof Error ? cause : new Error(String(cause));
    errorMessage = error.message;
    port.setVisible(false);
    publish();
    options.onError?.(error);
  };
  const invalidateLayout = (reason = "Layout changed. Remap anchors and recreate the keyboard controller."): void => {
    if (terminal()) return;
    cancelRaf();
    releasePlayer();
    clearIntent();
    status = "invalid";
    errorMessage = reason;
    port.setVisible(false);
    for (const cleanup of cleanups.splice(0)) cleanup();
    publish();
  };
  const schedule = (): void => { if (player && raf === null && !terminal() && !reduced) raf = clock.request(tick); };
  const begin = (): void => {
    if (player || terminal() || reduced) return;
    if (!layoutCurrent()) { invalidateLayout(); return; }
    let kind: "walk" | "run" | "jump" | "point";
    let durationMs: number;
    let destination = root.x;
    if (jump) { kind = "jump"; durationMs = 1000; jump = false; }
    else if (point) { kind = "point"; durationMs = 700; point = false; }
    else {
      const dir = direction();
      if (!dir) { status = "idle"; publish(); return; }
      kind = held.has("run") ? "run" : "walk";
      // Two supported steps: 2/(.7*.76)<=4, 2/(.5*.76)<=5.5.
      durationMs = kind === "run" ? 500 : 700;
      destination = Math.max(minX, Math.min(maxX, root.x + dir * (kind === "run" ? 60 : 40)));
      if (destination === root.x) { status = "blocked"; publish(); return; }
    }
    const action = kind === "jump"
      ? { action: kind, startMs: 0, durationMs }
      : { action: kind, startMs: 0, durationMs, target: kind === "point" ? "point" : "travel" };
    const program = compile([action], durationMs, destination);
    const revision = intentRevision;
    options.onProgram?.(structuredClone(program));
    // A callback is allowed to stop/dispose; never start work after teardown.
    if (terminal() || reduced || revision !== intentRevision) return;
    status = kind === "jump" ? "jumping" : kind === "point" ? "pointing" : "moving";
    player = createBrowserPlayer(program, clipPort, clock, { clock: "external", onInvalidate: invalidateLayout });
    previous = clock.now();
    if (!Number.isFinite(previous)) throw new RangeError("Keyboard clock timestamp must be finite.");
    schedule();
    publish();
  };
  function tick(now: number): void {
    raf = null;
    if (!player || terminal() || reduced) return;
    try {
      if (!Number.isFinite(now)) throw new RangeError("Keyboard clock timestamp must be finite.");
      const time = Math.min(player.durationMs, player.snapshot().timeMs + Math.max(0, now - previous));
      previous = now;
      player.seek(time);
      if (time === player.durationMs) {
        releasePlayer();
        begin();
      } else { schedule(); publish(); }
    } catch (cause) {
      if (!terminal()) fail(cause);
    }
  }
  const controller: KeyboardController = {
    snapshot,
    press(command) {
      if (terminal() || reduced || held.has(command)) return;
      intentRevision++;
      held.add(command);
      if (command === "jump") jump = true;
      if (command === "point") point = true;
      try { begin(); publish(); } catch (cause) { fail(cause); }
    },
    release(command) {
      if (terminal()) return;
      intentRevision++;
      held.delete(command);
      if (command === "jump") jump = false;
      if (command === "point") point = false;
      if (!player && !reduced) {
        try { begin(); } catch (cause) { fail(cause); }
      }
      publish();
    },
    stop() {
      if (terminal()) return;
      clearIntent();
      if (!player && !reduced) status = "idle";
      publish();
    },
    invalidateLayout,
    dispose() {
      if (status === "disposed") return;
      cancelRaf();
      releasePlayer();
      clearIntent();
      status = "disposed";
      for (const listener of [...disposeListeners]) listener();
      disposeListeners.clear();
      for (const cleanup of cleanups.splice(0)) cleanup();
      port.dispose();
      publish();
    },
    onDispose(listener) {
      if (status === "disposed") { listener(); return () => {}; }
      disposeListeners.add(listener);
      return () => { disposeListeners.delete(listener); };
    }
  };
  try {
    // Validate/render the initial exact root before accepting any input.
    const initial = compile();
    const still = createBrowserPlayer(initial, clipPort, clock, { clock: "external" });
    still.dispose();
    cleanups.push(port.onLayoutChange(() => invalidateLayout()));
    cleanups.push(port.onReducedMotion(value => {
      if (terminal() || value === reduced) return;
      reduced = value;
      interrupted ||= player !== null;
      cancelRaf();
      releasePlayer();
      clearIntent();
      status = value ? "reduced" : interrupted ? "invalid" : "idle";
      if (!value && interrupted) {
        errorMessage = "Reduced motion interrupted a clip. Remount from a stable grounded scene before playing again.";
        port.setVisible(false);
      }
      publish();
    }));
    publish();
  } catch (cause) {
    controller.dispose();
    throw cause;
  }
  return controller;
}

export interface FocusedKeyboardBinding {
  /** Stops held intent, detaches listeners, restores owned tabindex; idempotent. */
  dispose(): void;
}

/**
 * Host-only listeners; focus must be on the explicitly approved host itself.
 * Descendant inputs/contenteditable/widgets and Ctrl/Alt/Meta shortcuts are
 * never captured. No document/window key handlers and no automatic focus.
 * Binding teardown stops intent, but controller/port teardown remains explicit.
 * Controller teardown also automatically disposes its associated bindings.
 * Visibility loss clears intent even if the browser does not send keyup/blur.
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
      case "ShiftLeft": case "ShiftRight": return "run";
      case "Space": return "jump";
      case "KeyP": return "point";
      default: return undefined;
    }
  };
  const clear = (): void => { keys.clear(); controller.stop(); };
  const keydown = (event: KeyboardEvent): void => {
    const status = controller.snapshot().status;
    if (["disposed", "error", "invalid", "reduced"].includes(status)) return;
    if (disposed || host.ownerDocument.hidden || host.ownerDocument.activeElement !== host || event.target !== host
      || host.isContentEditable || host.matches("input,textarea,select,button,a[href],[role=textbox]")
      || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.defaultPrevented) return;
    if (event.code === "Escape") { event.preventDefault(); clear(); return; }
    const command = commandFor(event);
    if (!command) return;
    event.preventDefault();
    if (event.repeat || keys.has(event.code)) return;
    keys.set(event.code, command);
    // Shift may already be held before this host received focus.
    if (event.shiftKey && command !== "run") controller.press("run");
    controller.press(command);
  };
  const keyup = (event: KeyboardEvent): void => {
    const command = keys.get(event.code);
    keys.delete(event.code);
    if (command && ![...keys.values()].includes(command)) controller.release(command);
    if (!event.shiftKey && ![...keys.values()].includes("run")) controller.release("run");
    // Keyup only reconciles our own held keys; never prevents a browser shortcut.
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
