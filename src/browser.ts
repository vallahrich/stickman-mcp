import { compileAnimation, sampleAnimation } from "./compiler.js";
import { CONTRACT_VERSION, type CompiledAnimation, type PlaybackMode, type Point2D, type SampledFrame } from "./contract.js";
import { frameGeometry } from "./render.js";

export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SceneProjection {
  readonly rect: Readonly<CssRect>;
  readonly canvas: Readonly<{ width: number; height: number }>;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}

function positive(value: number, name: string): void {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive.`);
}

function canvasBounds(width: number, height: number): void {
  if (![width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096)) {
    throw new RangeError("The v1 virtual canvas must be 64..4096 units on each axis. Use a bounded host region or a larger avatar (or a smaller avatar for a region below 64 units).");
  }
}

/** CSS viewport pixels, not device pixels; xMidYMid meet is always isotropic. */
export function createSceneProjection(rect: CssRect, canvas: { width: number; height: number }): SceneProjection {
  finite(rect.left, "rect.left");
  finite(rect.top, "rect.top");
  positive(rect.width, "rect.width");
  positive(rect.height, "rect.height");
  canvasBounds(canvas.width, canvas.height);
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  return {
    rect: Object.freeze({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }),
    canvas: Object.freeze({ ...canvas }),
    scale,
    offsetX: (rect.width - canvas.width * scale) / 2,
    offsetY: (rect.height - canvas.height * scale) / 2
  };
}

/**
 * Size the whole scene, never just the actor: all roots, floors, travel and
 * pointing targets must use this projection. Ceil rounding may make the actual
 * standing height slightly smaller than requested. The 144-unit reference is
 * approximate; the canonical sampler may adapt the pose to available headroom.
 */
export function createBrowserScene(rect: CssRect, standingHeightCss = 64): SceneProjection {
  positive(standingHeightCss, "standingHeightCss");
  positive(rect.width, "rect.width");
  positive(rect.height, "rect.height");
  const scale = standingHeightCss / 144;
  return createSceneProjection(rect, {
    width: Math.ceil(rect.width / scale),
    height: Math.ceil(rect.height / scale)
  });
}

function insideCanvas(point: Point2D, canvas: { width: number; height: number }): Point2D {
  finite(point.x, "point.x");
  finite(point.y, "point.y");
  if (point.x < 0 || point.y < 0 || point.x > canvas.width || point.y > canvas.height) {
    throw new RangeError("Anchor is outside the virtual scene, including its letterbox. Choose a bounded region containing the anchor.");
  }
  return point;
}

export function viewportToScene(projection: SceneProjection, point: Point2D): Point2D {
  return insideCanvas({
    x: (point.x - projection.rect.left - projection.offsetX) / projection.scale,
    y: (point.y - projection.rect.top - projection.offsetY) / projection.scale
  }, projection.canvas);
}

export function sceneToViewport(projection: SceneProjection, point: Point2D): Point2D {
  insideCanvas(point, projection.canvas);
  return {
    x: projection.rect.left + projection.offsetX + point.x * projection.scale,
    y: projection.rect.top + projection.offsetY + point.y * projection.scale
  };
}

export interface RectAnchor {
  getBoundingClientRect(): CssRect;
}

export interface HostViewportMetrics extends RectAnchor {
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly clientLeft: number;
  readonly clientTop: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

/**
 * Rect of an absolute left:0/top:0 overlay in a bordered/scrolling host.
 * Supports untransformed hosts and positive axis-aligned CSS scaling, including
 * slide zoom. For rotation/skew/perspective use the mounted SVG's CTM mapper.
 * Padding is inside this region; margins and borders are outside.
 */
export function measureHostViewport(host: HostViewportMetrics): CssRect {
  const rect = host.getBoundingClientRect();
  positive(host.offsetWidth, "host.offsetWidth");
  positive(host.offsetHeight, "host.offsetHeight");
  positive(host.clientWidth, "host.clientWidth");
  positive(host.clientHeight, "host.clientHeight");
  positive(rect.width, "host rect.width");
  positive(rect.height, "host rect.height");
  const sx = rect.width / host.offsetWidth;
  const sy = rect.height / host.offsetHeight;
  const result = {
    left: rect.left + (host.clientLeft - host.scrollLeft) * sx,
    top: rect.top + (host.clientTop - host.scrollTop) * sy,
    width: host.clientWidth * sx,
    height: host.clientHeight * sy
  };
  for (const [key, value] of Object.entries(result)) finite(value, key);
  return result;
}

/** Pointing uses the actual DOM border-box center, in viewport CSS pixels. */
export function mapElementAnchor(projection: SceneProjection, element: RectAnchor): Point2D {
  const rect = element.getBoundingClientRect();
  return viewportToScene(projection, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
}

/** Travel deliberately projects the anchor's x onto a single chosen flat floor. */
export function projectTravelAnchor(anchor: Point2D, groundY: number, canvas: { width: number; height: number }): Point2D {
  insideCanvas(anchor, canvas);
  return insideCanvas({ x: anchor.x, y: groundY }, canvas);
}

export interface ScreenMatrix {
  /** Legacy SVGMatrix instances are intrinsically planar and omit is2D. */
  readonly is2D?: boolean;
  inverse(): Pick<DOMMatrixReadOnly, "a" | "b" | "c" | "d" | "e" | "f">;
}

/** Use this instead of a rect projection for transformed SVG/slide containers. */
export function svgViewportToScene(svg: { getScreenCTM(): ScreenMatrix | null }, point: Point2D, canvas: { width: number; height: number }): Point2D {
  canvasBounds(canvas.width, canvas.height);
  finite(point.x, "point.x");
  finite(point.y, "point.y");
  const matrix = svg.getScreenCTM();
  if (!matrix || matrix.is2D === false) throw new Error("SVG has no invertible 2D screen transform. Mount it in a visible, planar host.");
  const inverse = matrix.inverse();
  return insideCanvas({
    x: inverse.a * point.x + inverse.c * point.y + inverse.e,
    y: inverse.b * point.x + inverse.d * point.y + inverse.f
  }, canvas);
}

export interface BrowserClock {
  now(): number;
  request(callback: (timeMs: number) => void): number;
  cancel(id: number): void;
}

/** Typed platform seam, also usable by a deck with its own rendering surface. */
export interface BrowserPlayerPort {
  measure(): CssRect;
  /** Optional additional guard for host dimensions/CTM/connectivity. */
  layoutCurrent?(): boolean;
  draw(frame: SampledFrame): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  reducedMotion(): boolean;
  onReducedMotion(listener: (reduced: boolean) => void): () => void;
  onLayoutChange(listener: () => void): () => void;
}

export interface BrowserPlayerOptions {
  /** External mode never schedules RAF; the deck calls player.seek(t). */
  clock?: "internal" | "external";
  mode?: PlaybackMode;
  onInvalidate?: (reason: string) => void;
}

export interface BrowserPlayerState {
  readonly timeMs: number;
  readonly playing: boolean;
  readonly cancelled: boolean;
  readonly disposed: boolean;
  readonly layoutValid: boolean;
  readonly mode: PlaybackMode;
}

export interface BrowserPlayer {
  readonly durationMs: number;
  snapshot(): BrowserPlayerState;
  play(): BrowserPlayerState;
  pause(): BrowserPlayerState;
  seek(timeMs: number): BrowserPlayerState;
  cancel(): BrowserPlayerState;
  dispose(): void;
  /** Terminal layout invalidation: remap, recompile and remount explicitly. */
  invalidateLayout(reason?: string): void;
}

function canonicalProgram(input: unknown): CompiledAnimation {
  if (typeof input !== "object" || input === null || !("contractVersion" in input) || input.contractVersion !== CONTRACT_VERSION || !("spec" in input)) {
    throw new TypeError("Mount requires a compiled stickman.animation/v1 program, not authored JavaScript or HTML.");
  }
  if (Object.keys(input).some(key => key !== "contractVersion" && key !== "spec")) throw new TypeError("Compiled program may contain only contractVersion and spec.");
  const result = compileAnimation(input.spec);
  if (!result.valid || !result.program) {
    throw new TypeError(`Invalid compiled program: ${result.diagnostics.map(item => `${item.path}: ${item.message}`).join("; ")}`);
  }
  return result.program;
}

function sameRect(a: CssRect, b: CssRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * Canonical sampling, one playhead, no autoplay. Reduced/static mode displays
 * the canonical final pose. Finish does not loop or implicitly restart.
 * Invalid layout freezes the time, hides the stale overlay and releases hooks.
 * Remount with newly mapped compiled data; seek the saved time before play.
 */
export function createBrowserPlayer(input: unknown, port: BrowserPlayerPort, clock: BrowserClock, options: BrowserPlayerOptions = {}): BrowserPlayer {
  const program = canonicalProgram(input);
  if (options.clock !== undefined && options.clock !== "internal" && options.clock !== "external") throw new TypeError("Invalid browser clock mode.");
  if (options.mode !== undefined && !["normal", "reduced", "static"].includes(options.mode)) throw new TypeError("Invalid motion mode.");
  const measured = port.measure();
  const initialRect = { left: measured.left, top: measured.top, width: measured.width, height: measured.height };
  createSceneProjection(initialRect, program.spec.canvas);
  let timeMs = 0;
  let playing = false;
  let cancelled = false;
  let disposed = false;
  let layoutValid = true;
  let reduced = port.reducedMotion();
  let previous = 0;
  let requestId: number | null = null;
  const cleanups: Array<() => void> = [];
  const mode = (): PlaybackMode => options.mode === "static" ? "static"
    : reduced || options.mode === "reduced" ? "reduced" : "normal";
  const sampleTime = (): number => {
    if (mode() !== "normal") return timeMs;
    const frameDuration = 1000 / program.spec.canvas.fps;
    return Math.min(program.spec.durationMs, Math.floor(timeMs / frameDuration + 1e-9) * 1000 / program.spec.canvas.fps);
  };
  const snapshot = (): BrowserPlayerState => ({ timeMs, playing, cancelled, disposed, layoutValid, mode: mode() });
  const stop = (): void => {
    playing = false;
    if (requestId !== null) clock.cancel(requestId);
    requestId = null;
  };
  const detach = (): void => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
  const invalidateLayout = (reason = "Host or anchor layout changed. Remap anchors, recompile, and remount."): void => {
    if (disposed || cancelled || !layoutValid) return;
    stop();
    layoutValid = false;
    port.setVisible(false);
    detach();
    options.onInvalidate?.(reason);
  };
  const guard = (): void => {
    if (disposed) throw new Error("Browser player is disposed.");
    if (cancelled) throw new Error("Browser player is cancelled.");
    if (layoutValid && (!sameRect(initialRect, port.measure()) || port.layoutCurrent?.() === false)) invalidateLayout();
    if (!layoutValid) throw new Error("Browser player layout is invalid. Remap anchors, recompile, and remount.");
  };
  const draw = (): void => port.draw(sampleAnimation(program, sampleTime(), mode()));
  const schedule = (): void => {
    if (playing && options.clock !== "external" && requestId === null) requestId = clock.request(tick);
  };
  const tick = (now: number): void => {
    requestId = null;
    if (!playing || disposed || cancelled || !layoutValid) return;
    if (!sameRect(initialRect, port.measure()) || port.layoutCurrent?.() === false) { invalidateLayout(); return; }
    finite(now, "clock timestamp");
    timeMs = Math.min(program.spec.durationMs, timeMs + Math.max(0, now - previous));
    previous = now;
    if (timeMs === program.spec.durationMs) stop();
    draw();
    schedule();
  };
  const player: BrowserPlayer = {
    durationMs: program.spec.durationMs,
    snapshot,
    play() {
      guard();
      if (mode() !== "normal" || timeMs === program.spec.durationMs) return snapshot();
      if (!playing) {
        if (options.clock !== "external") {
          previous = clock.now();
          finite(previous, "clock timestamp");
        }
        playing = true;
        schedule();
      }
      return snapshot();
    },
    pause() { stop(); return snapshot(); },
    seek(value) {
      finite(value, "seek timeMs");
      guard();
      timeMs = Math.max(0, Math.min(program.spec.durationMs, value));
      if (playing && options.clock !== "external") {
        previous = clock.now();
        finite(previous, "clock timestamp");
      }
      if (timeMs === program.spec.durationMs) stop();
      draw();
      return snapshot();
    },
    cancel() {
      if (!disposed && !cancelled) {
        stop();
        cancelled = true;
        detach();
        port.setVisible(false);
      }
      return snapshot();
    },
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      detach();
      port.dispose();
    },
    invalidateLayout
  };
  try {
    cleanups.push(port.onLayoutChange(() => invalidateLayout()));
    cleanups.push(port.onReducedMotion(value => {
      if (disposed || cancelled || !layoutValid) return;
      reduced = value;
      stop();
      draw();
    }));
    port.setVisible(true);
    draw();
  } catch (error) {
    player.dispose();
    throw error;
  }
  return player;
}

export interface BrowserMountOptions extends BrowserPlayerOptions {
  /** Caller explicitly authorizes this specific host, not document.body by default. */
  approved: true;
  /** Only a static host is changed; the owned position change is reversible. */
  positionHost?: "require-positioned" | "relative";
}

export interface MountedBrowserPlayer extends BrowserPlayer {
  readonly svg: SVGSVGElement;
  /** Accurate for borders, page/host scroll and planar slide transforms. */
  mapViewportPoint(point: Point2D): Point2D;
  mapElement(element: RectAnchor): Point2D;
}

const svgNamespace = "http://www.w3.org/2000/svg";

/** Shared pose painter for scripted decks and focused controller diagnostics. */
export function createSvgPainter(svg: SVGSVGElement, color = "#202124", parent: SVGElement = svg): {
  draw(frame: SampledFrame): void;
  dispose(): void;
} {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new TypeError("SVG painter color must be a six-digit hex color.");
  const document = svg.ownerDocument;
  const layer = document.createElementNS(svgNamespace, "g");
  if (parent.ownerDocument !== document) throw new Error("SVG painter parent must belong to the same document.");
  parent.appendChild(layer);
  const node = <K extends keyof SVGElementTagNameMap>(tag: K, parent: SVGElement = layer): SVGElementTagNameMap[K] => {
    const child = document.createElementNS(svgNamespace, tag);
    parent.appendChild(child);
    return child;
  };
  const attr = (element: SVGElement, values: Record<string, number | string>): void => {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "number") finite(value, key);
      element.setAttribute(key, String(value));
    }
  };
  const body = node("g");
  attr(body, { fill: "none", stroke: color, "stroke-linecap": "round", "stroke-linejoin": "round" });
  const details = new Map<string, SVGPathElement>();
  const head = node("circle");
  const prop = node("g");
  const crate = node("rect", prop);
  const handle = node("path", prop);
  attr(head, { fill: "#fff", stroke: color });
  attr(crate, { fill: "#fff", stroke: color, rx: 3 });
  attr(handle, { fill: "none", stroke: color, "stroke-linecap": "round" });
  let disposed = false;
  return {
    draw(frame) {
      if (disposed) throw new Error("SVG painter is disposed.");
      const geometry = frameGeometry(frame);
      const viewBox = svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      const scenePerCssPixel = rect.width > 0 && viewBox.width > 0 ? viewBox.width / rect.width : 1;
      const strokeWidth = Math.max(geometry.strokeWidth, 2.5 * scenePerCssPixel);
      attr(body, { "stroke-width": strokeWidth });
      for (const limb of geometry.limbs) {
        let path = details.get(limb.id);
        if (!path) { path = node("path", body); details.set(limb.id, path); }
        attr(path, { d: limb.d, "stroke-width": strokeWidth });
      }
      for (const detail of geometry.paths) {
        let path = details.get(detail.id);
        if (!path) { path = node("path", body); details.set(detail.id, path); }
        attr(path, { d: detail.d, "stroke-width": detail.strokeWidth ?? strokeWidth });
      }
      const appendDrawn = (id: string): void => {
        body.appendChild(details.get(id)!);
        if (id.endsWith("-leg")) {
          const foot = details.get(id.replace("-leg", "-foot"));
          if (foot) body.appendChild(foot);
        }
      };
      for (const id of geometry.segmentOrder.slice(0, 3)) appendDrawn(id);
      body.appendChild(head);
      for (const id of geometry.segmentOrder.slice(3)) appendDrawn(id);
      const finger = details.get("point-finger");
      if (finger) body.appendChild(finger);
      attr(head, { cx: geometry.head.x, cy: geometry.head.y, r: geometry.headRadius, "stroke-width": strokeWidth });
      prop.style.display = frame.prop ? "" : "none";
      if (frame.prop) {
        attr(crate, { x: frame.prop.x, y: frame.prop.y, width: frame.prop.width, height: frame.prop.height, "stroke-width": strokeWidth });
        if (geometry.handlePath === null) throw new Error("Shared renderer geometry is missing the prop handle.");
        attr(handle, { d: geometry.handlePath, "stroke-width": 1.4 * geometry.scale });
      }
    },
    dispose() { if (!disposed) { disposed = true; layer.remove(); } }
  };
}

/**
 * Mount only in an explicitly approved host. Uses DOM nodes, never HTML strings,
 * document-global IDs, eval, CSS keyframes or an independent pose generator.
 * Host/viewport resize and captured scroll invalidate rather than reflow authored
 * coordinates. Moving an anchor without those events requires invalidateLayout().
 * Host CSS must not override the owned SVG's sizing/position/pointer-events.
 */
export function mountBrowserAnimation(host: HTMLElement, input: unknown, options: BrowserMountOptions): MountedBrowserPlayer {
  if (options?.approved !== true) throw new Error("Explicit approval of the host is required.");
  if (options.positionHost !== undefined && !["require-positioned", "relative"].includes(options.positionHost)) throw new TypeError("Invalid host positioning option.");
  const program = canonicalProgram(input);
  const document = host.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error("Host must belong to a live browser document.");
  if (!host.isConnected) throw new Error("Host must be connected before mounting.");
  positive(host.clientWidth, "host.clientWidth");
  positive(host.clientHeight, "host.clientHeight");
  const oldPosition = host.style.getPropertyValue("position");
  const oldPriority = host.style.getPropertyPriority("position");
  let ownedPosition = false;
  if (window.getComputedStyle(host).position === "static") {
    if (options.positionHost !== "relative") throw new Error("Host must be positioned; explicitly choose positionHost: 'relative' to allow a reversible change.");
    host.style.setProperty("position", "relative");
    ownedPosition = true;
  }
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", `0 0 ${program.spec.canvas.width} ${program.spec.canvas.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = `${host.clientWidth}px`;
  svg.style.height = `${host.clientHeight}px`;
  svg.style.pointerEvents = "none";
  svg.style.background = "transparent";
  svg.style.border = "0";
  svg.style.padding = "0";
  svg.style.margin = "0";
  svg.style.overflow = "hidden";
  const restore = (): void => {
    svg.remove();
    if (ownedPosition && host.style.getPropertyValue("position") === "relative" && host.style.getPropertyPriority("position") === "") {
      if (oldPosition) host.style.setProperty("position", oldPosition, oldPriority);
      else host.style.removeProperty("position");
    }
  };
  const color = program.spec.actor?.color ?? "#202124";
  const painter = createSvgPainter(svg, color);
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const initialWidth = host.clientWidth;
  const initialHeight = host.clientHeight;
  let initialMatrix: DOMMatrix | null = null;
  let player: BrowserPlayer;
  try {
    host.appendChild(svg);
    initialMatrix = svg.getScreenCTM();
    if (!initialMatrix || initialMatrix.is2D === false) throw new Error("Overlay requires a visible planar SVG screen transform.");
    const mountedMatrix = initialMatrix;
    player = createBrowserPlayer(program, {
      measure: () => svg.getBoundingClientRect(),
      layoutCurrent() {
        const current = svg.getScreenCTM();
        return host.isConnected && svg.isConnected && host.clientWidth === initialWidth && host.clientHeight === initialHeight
          && current !== null && current.is2D !== false && initialMatrix !== null
          && (["a", "b", "c", "d", "e", "f"] as const).every(key => current[key] === mountedMatrix[key]);
      },
      setVisible: visible => { svg.style.visibility = visible ? "visible" : "hidden"; },
      dispose: () => { painter.dispose(); restore(); },
      reducedMotion: () => media.matches,
      onReducedMotion(listener) {
        const changed = (event: MediaQueryListEvent): void => listener(event.matches);
        media.addEventListener("change", changed);
        return () => media.removeEventListener("change", changed);
      },
      onLayoutChange(listener) {
        const width = host.clientWidth;
        const height = host.clientHeight;
        const observer = new window.ResizeObserver(() => {
          if (host.clientWidth !== width || host.clientHeight !== height) listener();
        });
        const changed = (): void => listener();
        observer.observe(host);
        window.addEventListener("resize", changed);
        window.addEventListener("scroll", changed, true);
        return () => {
          observer.disconnect();
          window.removeEventListener("resize", changed);
          window.removeEventListener("scroll", changed, true);
        };
      },
      draw: frame => painter.draw(frame)
    }, {
      now: () => window.performance.now(),
      request: callback => window.requestAnimationFrame(callback),
      cancel: id => window.cancelAnimationFrame(id)
    }, options);
  } catch (error) {
    painter.dispose();
    restore();
    throw error;
  }
  const mapViewportPoint = (point: Point2D): Point2D => {
    const state = player.snapshot();
    if (state.disposed || state.cancelled || !state.layoutValid) throw new Error("Cannot map anchors with an inactive browser player.");
    const matrix = svg.getScreenCTM();
    if (!host.isConnected || !svg.isConnected || host.clientWidth !== initialWidth || host.clientHeight !== initialHeight
      || !matrix || matrix.is2D === false || !initialMatrix
      || (["a", "b", "c", "d", "e", "f"] as const).some(key => matrix[key] !== initialMatrix?.[key])) {
      player.invalidateLayout();
      throw new Error("Browser player layout changed. Remap anchors, recompile, and remount.");
    }
    return svgViewportToScene(svg, point, program.spec.canvas);
  };
  return {
    ...player,
    svg,
    mapViewportPoint,
    mapElement(element) {
      const rect = element.getBoundingClientRect();
      return mapViewportPoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  };
}
