import { choreographAnimation } from "./choreograph.js";
import { compileAnimation, sampleAnimation } from "./compiler.js";
import {
  CONTRACT_VERSION,
  CONTRACT_VERSION_V2,
  type AnimationSpecV2,
  type ChoreographInput,
  type CompiledAnimation,
  type MarkerEvent,
  type PlaybackMode,
  type Point2D,
  type RenderStyle,
  type SampledFrame
} from "./contract.js";
import { renderBlueprintDefsSvg } from "./props.js";
import {
  BLUEPRINT_STAGE_STYLE,
  frameGeometry,
  renderBlueprintFrameSceneSvg,
  renderBlueprintStageBackdropSvg,
  renderSceneInnerSvg
} from "./render.js";

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
  if (
    typeof input !== "object" ||
    input === null ||
    !("contractVersion" in input) ||
    (input.contractVersion !== CONTRACT_VERSION && input.contractVersion !== CONTRACT_VERSION_V2) ||
    !("spec" in input)
  ) {
    throw new TypeError("Mount requires a compiled stickman.animation/v1 or stickman.animation/v2 program, not authored JavaScript or HTML.");
  }
  if (Object.keys(input).some(key => key !== "contractVersion" && key !== "spec" && key !== "events")) throw new TypeError("Compiled program may contain only contractVersion, spec and derived events.");
  const result = compileAnimation(input.spec);
  if (!result.valid || !result.program || result.program.contractVersion !== input.contractVersion) {
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

function unescapeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function syncSvgMarkupToDom(doc: Document, container: SVGElement, markup: string): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  if (!markup) return;
  const stack: SVGElement[] = [container];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*="[^"]*")*)\s*(\/?)>/g;
  const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)="([^"]*)"/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(markup)) !== null) {
    if (match.index > lastIndex) {
      const text = markup.slice(lastIndex, match.index);
      const top = stack[stack.length - 1];
      if (top && text) top.textContent = unescapeXml(text);
    }
    lastIndex = tagRe.lastIndex;
    const full = match[0];
    const tagName = match[1]!;
    const rawAttrs = match[2] ?? "";
    const selfClosing = match[3] === "/";
    if (full.startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = doc.createElementNS(svgNamespace, tagName);
    attrRe.lastIndex = 0;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(rawAttrs)) !== null) {
      el.setAttribute(attrMatch[1]!, unescapeXml(attrMatch[2]!));
    }
    stack[stack.length - 1]!.appendChild(el);
    if (!selfClosing) {
      stack.push(el);
    }
  }
}

/** Shared pose painter for scripted decks and focused controller diagnostics. */
export function createSvgPainter(
  svg: SVGSVGElement,
  color = "#202124",
  parent: SVGElement = svg,
  themeAccentColor?: string
): {
  draw(frame: SampledFrame): void;
  dispose(): void;
} {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new TypeError("SVG painter color must be a six-digit hex color.");
  const document = svg.ownerDocument;
  const layer = document.createElementNS(svgNamespace, "g");
  if (parent.ownerDocument !== document) throw new Error("SVG painter parent must belong to the same document.");
  parent.appendChild(layer);
  const node = <K extends keyof SVGElementTagNameMap>(tag: K, targetParent: SVGElement = layer): SVGElementTagNameMap[K] => {
    const child = document.createElementNS(svgNamespace, tag);
    targetParent.appendChild(child);
    return child;
  };
  const attr = (element: SVGElement, values: Record<string, number | string>): void => {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "number") finite(value, key);
      element.setAttribute(key, String(value));
    }
  };
  const sceneGroup = node("g");
  sceneGroup.setAttribute("data-stickman-scene", "true");
  sceneGroup.style.display = "none";
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
      const viewBox = svg.viewBox?.baseVal;
      const rect = svg.getBoundingClientRect();
      const scenePerCssPixel = rect.width > 0 && viewBox && viewBox.width > 0 ? viewBox.width / rect.width : 1;

      const isMultiScene =
        Boolean(frame.actors && frame.actors.length > 0) ||
        Boolean(frame.addons && frame.addons.length > 0);

      if (isMultiScene) {
        body.style.display = "none";
        head.style.display = "none";
        prop.style.display = "none";
        sceneGroup.style.display = "";
        const markup = renderSceneInnerSvg(frame, {
          defaultColor: color,
          ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
          minStrokeWidth: 2.5 * scenePerCssPixel
        });
        syncSvgMarkupToDom(document, sceneGroup, markup);
        return;
      }

      if (sceneGroup.firstChild) {
        while (sceneGroup.firstChild) sceneGroup.removeChild(sceneGroup.firstChild);
      }
      sceneGroup.style.display = "none";
      body.style.display = "";
      head.style.display = "";

      const geometry = frameGeometry(frame);
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
  const themeAccentColor =
    program.contractVersion === CONTRACT_VERSION_V2
      ? (program.spec as AnimationSpecV2).theme?.accentColor
      : undefined;
  const painter = createSvgPainter(svg, color, svg, themeAccentColor);
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

export const STICKMAN_PLAYER_STYLE = `
:host, stickman-player {
  display: block;
  --cp-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --cp-dur-fast: 140ms;
  --cp-dur-enter: 180ms;
  --cp-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06);
}
:host([data-theme="dark"]), stickman-player[data-theme="dark"], html[data-theme="dark"] stickman-player {
  --cp-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.24), 0 8px 24px rgba(0, 0, 0, 0.32);
}
svg[data-stickman-svg="true"] {
  display: block;
  width: 100%;
  height: auto;
  box-shadow: var(--cp-card-shadow);
}
[data-stickman-controls="true"] {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--cp-surface, #ffffff);
  color: var(--cp-text, #242424);
  border: 1px solid var(--cp-border, #dedede);
  border-radius: 10px;
  box-shadow: var(--cp-card-shadow);
  font-family: "Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
}
button, select, [data-stickman-control="toggle"] {
  font: inherit;
  font-weight: 600;
  min-width: 68px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--cp-border, #dedede);
  background: var(--cp-surface, #ffffff);
  color: var(--cp-text, #242424);
  cursor: pointer;
  transition: border-color 140ms var(--cp-ease-out), background-color 140ms var(--cp-ease-out), color 140ms var(--cp-ease-out), transform 140ms var(--cp-ease-out), opacity 140ms var(--cp-ease-out);
}
button:hover, select:hover, [data-stickman-control="toggle"]:hover {
  border-color: var(--cp-accent, #b11f4b);
}
button:active, [data-stickman-control="toggle"]:active {
  transform: scale(0.985);
}
[data-stickman-control="toggle"][aria-pressed="true"] {
  background: var(--cp-accent, #b11f4b);
  color: var(--cp-accent-fg, #ffffff);
  border-color: var(--cp-accent, #b11f4b);
}
input[type="range"][data-stickman-control="scrubber"] {
  flex: 1 1 140px;
  min-width: 96px;
  accent-color: var(--cp-accent, #b11f4b);
  cursor: pointer;
  transition: none;
}
button:focus-visible, select:focus-visible, input:focus-visible, [data-stickman-control]:focus-visible {
  outline: 3px solid var(--cp-accent, #b11f4b);
  outline-offset: 4px;
}
.cp-timecode, output, [data-timecode], [data-frame-counter], [data-status-numeric] {
  font-variant-numeric: tabular-nums;
  font-family: Consolas, "Courier New", Courier, monospace;
  font-size: 13px;
  color: var(--cp-text-muted, #5c5c5c);
  min-width: 12ch;
  text-align: right;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
}
`;

export type StickmanPlayerScrollOptions = Omit<ScrollTimelineOptions, "durationMs"> & {
  durationMs?: number;
};

export interface StickmanPlayerElement extends HTMLElement {
  readonly durationMs: number;
  readonly currentTimeMs: number;
  setProgram(input: unknown): BrowserPlayerState;
  play(): BrowserPlayerState;
  pause(): BrowserPlayerState;
  seek(timeMs: number): BrowserPlayerState;
  setMode(mode: PlaybackMode): BrowserPlayerState;
  bindScroll(options?: StickmanPlayerScrollOptions): ScrollTimelineBinding;
  snapshot(): BrowserPlayerState;
  dispose(): void;
}

function isValidMarkerEvent(item: unknown): item is MarkerEvent {
  if (typeof item !== "object" || item === null) return false;
  const rec = item as Record<string, unknown>;
  return (
    typeof rec.timeMs === "number" &&
    Number.isFinite(rec.timeMs) &&
    typeof rec.actionIndex === "number" &&
    typeof rec.action === "string" &&
    typeof rec.marker === "string" &&
    typeof rec.frame === "number" &&
    (rec.actorId === undefined || typeof rec.actorId === "string")
  );
}

function resolveElementProgramInput(raw: unknown): CompiledAnimation {
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Stickman player requires a compiled program or animation specification object.");
  }
  if ("contractVersion" in parsed) {
    const canonical = canonicalProgram(parsed);
    const rawEvents = (parsed as { events?: unknown }).events;
    if (!canonical.events && Array.isArray(rawEvents) && rawEvents.every(isValidMarkerEvent)) {
      return { ...canonical, events: rawEvents.map((ev) => ({ ...ev })) };
    }
    return canonical;
  }
  if ("version" in parsed) {
    const compiled = compileAnimation(parsed);
    if (!compiled.valid || !compiled.program) {
      throw new TypeError(
        `Invalid animation specification: ${compiled.diagnostics.map((d) => `${d.path}: ${d.message}`).join("; ")}`
      );
    }
    return compiled.program;
  }
  const choreographed = choreographAnimation(parsed as ChoreographInput);
  if (!choreographed.valid || !choreographed.program) {
    throw new TypeError(
      `Invalid choreography input: ${choreographed.diagnostics.map((d) => `${d.path}: ${d.message}`).join("; ")}`
    );
  }
  return choreographed.program;
}

function removeDomNode(node: Element | null): void {
  if (!node) return;
  if (typeof node.remove === "function") node.remove();
  else if (node.parentNode) node.parentNode.removeChild(node);
}

function createHtmlNode(doc: Document, tag: string): Element {
  return typeof (doc as { createElement?: unknown }).createElement === "function"
    ? doc.createElement(tag)
    : doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
}

function findDescendantByAttr(root: Element, attrName: string, attrValue: string): Element | null {
  const kids = (root as unknown as { children?: ArrayLike<Element> }).children;
  if (!kids) return null;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]!;
    if (child.getAttribute?.(attrName) === attrValue) return child;
    const nested = findDescendantByAttr(child, attrName, attrValue);
    if (nested) return nested;
  }
  return null;
}

export function registerStickmanPlayerElement(tagName = "stickman-player"): boolean {
  if (typeof tagName !== "string" || !/^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(tagName)) {
    throw new TypeError(`Invalid custom element tag name "${String(tagName)}"; custom elements must contain a hyphen.`);
  }
  const g = globalThis as typeof globalThis & {
    HTMLElement?: typeof HTMLElement;
    customElements?: CustomElementRegistry;
  };
  if (
    typeof g.HTMLElement !== "function" ||
    !g.customElements ||
    typeof g.customElements.define !== "function"
  ) {
    return false;
  }
  if (typeof g.customElements.get === "function" && g.customElements.get(tagName) !== undefined) {
    return true;
  }

  const BaseElement = g.HTMLElement;

  class StickmanPlayerCustomElement extends BaseElement implements StickmanPlayerElement {
    static get observedAttributes(): string[] {
      return ["program", "mode", "autoplay", "controls", "scroll-scrub", "style-mode", "blueprint"];
    }

    #program: CompiledAnimation | null = null;
    #styleEl: Element | null = null;
    #svg: SVGSVGElement | null = null;
    #bgRect: SVGRectElement | null = null;
    #groundPath: SVGPathElement | null = null;
    #controlsEl: Element | null = null;
    #toggleBtn: Element | null = null;
    #scrubberInput: Element | null = null;
    #timecodeOutput: Element | null = null;
    #painter: { draw(frame: SampledFrame): void; dispose(): void } | null = null;
    #timeMs = 0;
    #playing = false;
    #disposed = false;
    #explicitMode: PlaybackMode | null = null;
    #reducedPreference = false;
    #requestId: number | null = null;
    #previousClockMs: number | null = null;
    #emittedMs = -1;
    #detachMedia: (() => void) | null = null;
    #innerScrollBinding: ScrollTimelineBinding | null = null;
    #activeScrollOptions: StickmanPlayerScrollOptions | null = null;
    #scrollSource: "manual" | "attribute" | null = null;

    get durationMs(): number {
      return this.#program?.spec.durationMs ?? 0;
    }

    get currentTimeMs(): number {
      return this.#timeMs;
    }

    #window(): (Window & typeof globalThis) | undefined {
      return (this.ownerDocument?.defaultView as (Window & typeof globalThis) | null) ?? undefined;
    }

    #now(): number {
      const win = this.#window();
      if (win?.performance && typeof win.performance.now === "function") return win.performance.now();
      if (typeof globalThis.performance?.now === "function") return globalThis.performance.now();
      return Date.now();
    }

    #requestFrame(cb: (now: number) => void): number {
      const win = this.#window();
      const raf = win?.requestAnimationFrame?.bind(win) ?? globalThis.requestAnimationFrame?.bind(globalThis);
      if (typeof raf === "function") return raf(cb);
      return Number(setTimeout(() => cb(this.#now()), 16));
    }

    #cancelFrame(id: number): void {
      const win = this.#window();
      const caf = win?.cancelAnimationFrame?.bind(win) ?? globalThis.cancelAnimationFrame?.bind(globalThis);
      if (typeof caf === "function") caf(id);
      else clearTimeout(id);
    }

    #effectiveMode(): PlaybackMode {
      if (this.#explicitMode === "static") return "static";
      if (this.#explicitMode === "reduced") return "reduced";
      if (this.#reducedPreference && this.#explicitMode === null) return "reduced";
      return "normal";
    }

    #effectiveRenderStyle(): RenderStyle {
      const styleMode = this.getAttribute?.("style-mode")?.trim();
      if (styleMode === "blueprint" || styleMode === "default") {
        return styleMode;
      }
      if (this.hasAttribute?.("blueprint") && this.getAttribute?.("blueprint") !== "false") {
        return "blueprint";
      }
      const v2 =
        this.#program?.contractVersion === CONTRACT_VERSION_V2
          ? (this.#program.spec as AnimationSpecV2)
          : undefined;
      return v2?.theme?.style === "blueprint" ? "blueprint" : "default";
    }

    #wantsControls(): boolean {
      return Boolean(this.hasAttribute?.("controls") && this.getAttribute?.("controls") !== "false");
    }

    #wantsDeclarativeScrollScrub(): boolean {
      return Boolean(this.hasAttribute?.("scroll-scrub") && this.getAttribute?.("scroll-scrub") !== "false");
    }

    #stopRaf(): void {
      this.#playing = false;
      this.#previousClockMs = null;
      if (this.#requestId !== null) {
        this.#cancelFrame(this.#requestId);
        this.#requestId = null;
      }
      this.#syncControls();
    }

    #teardownInnerScrollBinding(): void {
      if (this.#innerScrollBinding) {
        const prev = this.#innerScrollBinding;
        this.#innerScrollBinding = null;
        prev.dispose();
      }
    }

    #clearScrollBinding(): void {
      this.#teardownInnerScrollBinding();
      this.#activeScrollOptions = null;
      this.#scrollSource = null;
    }

    #resolveDeclarativeScrollOptions(): StickmanPlayerScrollOptions {
      const raw = this.getAttribute?.("scroll-scrub")?.trim() ?? "";
      const win = this.#window() as unknown as ScrollTimelineContainerLike | undefined;
      if (raw && raw !== "true" && raw !== "window") {
        if (raw === "self") {
          return {
            ...(win ? { container: win } : {}),
            scrollElement: this as unknown as ScrollTimelineElementLike
          };
        }
        const doc = this.ownerDocument as unknown as { querySelector?: (sel: string) => unknown } | null;
        if (typeof doc?.querySelector === "function") {
          try {
            const found = doc.querySelector(raw) as ScrollTimelineContainerLike | null;
            if (found) {
              return { container: found };
            }
          } catch {
            // Fall back to window scroll container on invalid selector.
          }
        }
      }
      return win ? { container: win } : {};
    }

    #mountInnerScrollBinding(options: StickmanPlayerScrollOptions): ScrollTimelineBinding {
      this.#teardownInnerScrollBinding();
      const win = this.#window() as unknown as ScrollTimelineContainerLike | undefined;
      const durationMs = options.durationMs ?? this.durationMs;
      const binding = bindScrollTimeline(
        (timeMs) => {
          if (this.#disposed || !this.#program) return;
          if (this.#playing) this.#stopRaf();
          this.seek(timeMs);
        },
        {
          ...(win ? { container: win } : {}),
          ...options,
          durationMs
        }
      );
      this.#innerScrollBinding = binding;
      return binding;
    }

    #syncDeclarativeScrollScrub(): void {
      if (this.#disposed) return;
      if (this.#wantsDeclarativeScrollScrub()) {
        if (this.#scrollSource !== "manual") {
          const opts = this.#resolveDeclarativeScrollOptions();
          this.#activeScrollOptions = opts;
          this.#scrollSource = "attribute";
          this.#mountInnerScrollBinding(opts);
        }
      } else if (this.#scrollSource === "attribute") {
        this.#clearScrollBinding();
      }
    }

    #teardownControlsDom(): void {
      removeDomNode(this.#controlsEl);
      this.#controlsEl = null;
      this.#toggleBtn = null;
      this.#scrubberInput = null;
      this.#timecodeOutput = null;
    }

    #syncControlsDom(): void {
      if (this.#disposed || !this.#program) {
        if (!this.#wantsControls()) this.#teardownControlsDom();
        return;
      }
      if (!this.#wantsControls()) {
        this.#teardownControlsDom();
        return;
      }
      if (!this.#controlsEl) {
        const doc = this.ownerDocument ?? globalThis.document;
        if (!doc) return;
        const bar = createHtmlNode(doc, "div");
        bar.setAttribute("class", "cp-player-controls");
        bar.setAttribute("data-stickman-controls", "true");
        bar.setAttribute("role", "group");
        bar.setAttribute("aria-label", "Playback controls");

        const toggle = createHtmlNode(doc, "button");
        toggle.setAttribute("type", "button");
        toggle.setAttribute("class", "cp-player-toggle");
        toggle.setAttribute("data-stickman-control", "toggle");
        toggle.setAttribute("aria-label", "Play animation");
        toggle.setAttribute("aria-pressed", "false");
        toggle.textContent = "Play";
        toggle.addEventListener("click", () => {
          if (this.#disposed) return;
          if (this.#playing) this.pause();
          else this.play();
        });

        const scrubber = createHtmlNode(doc, "input");
        scrubber.setAttribute("type", "range");
        scrubber.setAttribute("class", "cp-player-scrubber");
        scrubber.setAttribute("data-stickman-control", "scrubber");
        scrubber.setAttribute("aria-label", "Animation playhead");
        scrubber.setAttribute("min", "0");
        scrubber.setAttribute("max", String(this.durationMs));
        scrubber.setAttribute("step", "1");
        scrubber.setAttribute("value", "0");
        const onScrub = (): void => {
          if (this.#disposed || !this.#program) return;
          const rawVal =
            (scrubber as unknown as { value?: string }).value ?? scrubber.getAttribute("value") ?? "0";
          const nextTime = Number(rawVal);
          if (Number.isFinite(nextTime)) {
            if (this.#playing) this.#stopRaf();
            this.seek(nextTime);
          }
        };
        scrubber.addEventListener("input", onScrub);
        scrubber.addEventListener("change", onScrub);

        const timecode = createHtmlNode(doc, "output");
        timecode.setAttribute("class", "cp-timecode");
        timecode.setAttribute("data-stickman-control", "timecode");
        timecode.setAttribute("data-timecode", "true");
        timecode.textContent = `0.00s / ${(this.durationMs / 1000).toFixed(2)}s`;

        bar.appendChild(toggle);
        bar.appendChild(scrubber);
        bar.appendChild(timecode);
        this.appendChild(bar);

        this.#controlsEl = bar;
        this.#toggleBtn = toggle;
        this.#scrubberInput = scrubber;
        this.#timecodeOutput = timecode;
      } else {
        // Keep control bar positioned after the SVG stage.
        this.appendChild(this.#controlsEl);
      }
      this.#syncControls();
    }

    #syncControls(): void {
      if (!this.#controlsEl) return;
      const duration = this.durationMs;
      const effMode = this.#effectiveMode();
      const shownMs =
        !this.#program
          ? 0
          : effMode === "normal"
            ? Math.max(0, Math.min(duration, this.#timeMs))
            : duration;
      if (this.#toggleBtn) {
        this.#toggleBtn.textContent = this.#playing ? "Pause" : "Play";
        this.#toggleBtn.setAttribute("aria-pressed", this.#playing ? "true" : "false");
        this.#toggleBtn.setAttribute("aria-label", this.#playing ? "Pause animation" : "Play animation");
      }
      if (this.#scrubberInput) {
        const rounded = String(Math.round(shownMs));
        this.#scrubberInput.setAttribute("max", String(duration));
        this.#scrubberInput.setAttribute("value", rounded);
        try {
          (this.#scrubberInput as unknown as { value: string }).value = rounded;
        } catch {
          // Synthetic DOM mock without mutable value setter.
        }
      }
      if (this.#timecodeOutput) {
        this.#timecodeOutput.textContent = `${(shownMs / 1000).toFixed(2)}s / ${(duration / 1000).toFixed(2)}s`;
      }
    }

    #bindReducedMotion(): void {
      this.#detachMedia?.();
      this.#detachMedia = null;
      const win = this.#window();
      const matchMediaFn =
        win?.matchMedia?.bind(win) ??
        (typeof globalThis.matchMedia === "function" ? globalThis.matchMedia.bind(globalThis) : undefined);
      if (!matchMediaFn) {
        this.#reducedPreference = false;
        return;
      }
      const mql = matchMediaFn("(prefers-reduced-motion: reduce)");
      this.#reducedPreference = Boolean(mql.matches);
      if (typeof mql.addEventListener === "function") {
        const onChange = (event: MediaQueryListEvent): void => {
          this.#reducedPreference = Boolean(event.matches);
          if (this.#reducedPreference && this.#explicitMode === null) {
            this.#stopRaf();
          }
          this.#renderCurrent();
        };
        mql.addEventListener("change", onChange);
        this.#detachMedia = () => mql.removeEventListener("change", onChange);
      }
    }

    #mountProgramDom(program: CompiledAnimation): void {
      this.#painter?.dispose();
      this.#painter = null;
      removeDomNode(this.#styleEl);
      this.#styleEl = null;
      removeDomNode(this.#svg);
      this.#svg = null;
      this.#bgRect = null;
      this.#groundPath = null;

      const doc = this.ownerDocument ?? globalThis.document;
      if (!doc) return;

      const styleEl = createHtmlNode(doc, "style");
      styleEl.setAttribute("data-stickman-style", "true");
      styleEl.textContent =
        tagName === "stickman-player"
          ? STICKMAN_PLAYER_STYLE
          : STICKMAN_PLAYER_STYLE.replaceAll("stickman-player", tagName);

      const { width, height } = program.spec.canvas;
      const v2 = program.contractVersion === CONTRACT_VERSION_V2 ? (program.spec as AnimationSpecV2) : undefined;
      const bg = v2?.theme?.background ?? "#ffffff";
      const color = program.spec.actor?.color ?? "#202124";
      const accent = v2?.theme?.accentColor;
      const renderStyle = this.#effectiveRenderStyle();

      const svg = doc.createElementNS(svgNamespace, "svg");
      svg.setAttribute("data-stickman-svg", "true");
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("role", "img");
      if (svg.style) {
        svg.style.display = "block";
        svg.style.width = "100%";
        svg.style.height = "auto";
        svg.style.boxShadow = "var(--cp-card-shadow)";
      }

      if (renderStyle === "blueprint") {
        svg.setAttribute("data-style", "blueprint");
        const initialFrame = sampleAnimation(program, 0, this.#effectiveMode());
        const backdropMarkup = (
          renderBlueprintDefsSvg() +
          `<style>${BLUEPRINT_STAGE_STYLE}</style>` +
          renderBlueprintStageBackdropSvg(width, height, initialFrame.groundY, v2?.anchors, 3)
        ).replace(' id="ground"', "");
        syncSvgMarkupToDom(doc, svg, backdropMarkup);
        const groundDatum = findDescendantByAttr(svg, "data-part", "ground-datum") as SVGPathElement | null;
        const sceneGroup = doc.createElementNS(svgNamespace, "g");
        sceneGroup.setAttribute("data-stickman-scene", "true");
        svg.appendChild(sceneGroup);
        this.appendChild(styleEl);
        this.appendChild(svg);
        this.#styleEl = styleEl;
        this.#svg = svg;
        this.#groundPath = groundDatum;
        this.#painter = {
          draw(frame: SampledFrame) {
            syncSvgMarkupToDom(doc, sceneGroup, renderBlueprintFrameSceneSvg(frame, width, 3));
          },
          dispose() {
            removeDomNode(sceneGroup);
          }
        };
      } else {
        const bgRect = doc.createElementNS(svgNamespace, "rect");
        bgRect.setAttribute("width", "100%");
        bgRect.setAttribute("height", "100%");
        bgRect.setAttribute("fill", bg);
        svg.appendChild(bgRect);

        const ground = doc.createElementNS(svgNamespace, "path");
        ground.setAttribute("data-part", "ground");
        ground.setAttribute("stroke", "#d8dbe0");
        ground.setAttribute("stroke-width", "1");
        svg.appendChild(ground);

        this.appendChild(styleEl);
        this.appendChild(svg);
        this.#styleEl = styleEl;
        this.#svg = svg;
        this.#bgRect = bgRect;
        this.#groundPath = ground;
        this.#painter = createSvgPainter(svg, color, svg, accent);
      }

      this.#syncControlsDom();
    }

    #renderCurrent(): void {
      if (!this.#program || !this.#painter || !this.#svg) return;
      const effMode = this.#effectiveMode();
      const duration = this.#program.spec.durationMs;
      const fps = this.#program.spec.canvas.fps;
      const frameDuration = 1000 / fps;
      const sampleTime =
        effMode === "normal"
          ? Math.min(duration, Math.floor(this.#timeMs / frameDuration + 1e-9) * frameDuration)
          : duration;
      const frame = sampleAnimation(this.#program, sampleTime, effMode);
      if (this.#groundPath) {
        this.#groundPath.setAttribute("d", `M0 ${Number(frame.groundY.toFixed(3))}H${this.#program.spec.canvas.width}`);
      }
      this.#svg.setAttribute(
        "aria-label",
        `Stick figure ${frame.action} at ${Number(frame.timeMs.toFixed(3))} milliseconds`
      );
      this.#painter.draw(frame);
      this.#syncControls();
    }

    #emitMarkers(fromMs: number, toMs: number): void {
      if (!this.#program?.events || this.#program.events.length === 0) return;
      const win = this.#window();
      const EventCtor =
        (win && "CustomEvent" in win ? (win as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent : undefined) ??
        globalThis.CustomEvent;
      if (typeof EventCtor !== "function" || typeof this.dispatchEvent !== "function") return;
      for (const ev of this.#program.events) {
        if (ev.timeMs > fromMs && ev.timeMs <= toMs) {
          this.dispatchEvent(
            new EventCtor("stickman:marker", {
              detail: { ...ev },
              bubbles: true,
              composed: true
            })
          );
        }
      }
    }

    #schedule(): void {
      if (this.#playing && this.#requestId === null && !this.#disposed) {
        this.#requestId = this.#requestFrame((now) => this.#tick(now));
      }
    }

    #tick(now: number): void {
      this.#requestId = null;
      if (!this.#playing || this.#disposed || !this.#program) return;
      finite(now, "clock timestamp");
      const delta = this.#previousClockMs === null ? 0 : Math.max(0, now - this.#previousClockMs);
      this.#previousClockMs = now;
      const duration = this.#program.spec.durationMs;
      const nextTime = Math.min(duration, this.#timeMs + delta);
      const before = this.#emittedMs;
      this.#timeMs = nextTime;
      this.#emittedMs = nextTime;
      if (nextTime >= duration) {
        this.#stopRaf();
      }
      this.#emitMarkers(before, nextTime);
      this.#renderCurrent();
      this.#schedule();
    }

    #tryLoadDeclarativeProgram(): void {
      const attrVal = this.getAttribute?.("program");
      if (attrVal && attrVal.trim()) {
        this.setProgram(attrVal);
        return;
      }
      if (typeof this.querySelector === "function") {
        const jsonScript = this.querySelector('script[type="application/json"]');
        if (jsonScript?.textContent && jsonScript.textContent.trim()) {
          this.setProgram(jsonScript.textContent.trim());
          return;
        }
      }
      const rawText = this.textContent?.trim();
      if (rawText && rawText.startsWith("{")) {
        this.textContent = "";
        this.setProgram(rawText);
      }
    }

    connectedCallback(): void {
      if (this.#disposed) return;
      this.#bindReducedMotion();
      const modeAttr = this.getAttribute?.("mode");
      if (modeAttr === "normal" || modeAttr === "reduced" || modeAttr === "static") {
        this.#explicitMode = modeAttr;
      }
      if (!this.#program) {
        this.#tryLoadDeclarativeProgram();
      } else {
        if (!this.#svg) this.#mountProgramDom(this.#program);
        else this.#syncControlsDom();
        this.#renderCurrent();
      }
      this.#syncDeclarativeScrollScrub();
      if (this.#program && this.hasAttribute?.("autoplay") && this.#effectiveMode() === "normal") {
        this.play();
      }
    }

    disconnectedCallback(): void {
      this.#stopRaf();
      this.#detachMedia?.();
      this.#detachMedia = null;
      this.#teardownInnerScrollBinding();
      if (this.#scrollSource === "manual") {
        this.#activeScrollOptions = null;
        this.#scrollSource = null;
      }
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
      if (oldValue === newValue || this.#disposed) return;
      if (name === "program" && newValue && newValue.trim()) {
        this.setProgram(newValue);
      } else if (name === "mode") {
        if (newValue === "normal" || newValue === "reduced" || newValue === "static") {
          this.setMode(newValue);
        } else if (newValue === null) {
          this.#explicitMode = null;
          if (this.#effectiveMode() !== "normal") this.#stopRaf();
          this.#renderCurrent();
        }
      } else if (name === "autoplay" && newValue !== null && this.#program && this.#effectiveMode() === "normal") {
        this.play();
      } else if (name === "controls") {
        this.#syncControlsDom();
      } else if (name === "scroll-scrub") {
        if (newValue === null || newValue === "false") {
          this.#clearScrollBinding();
        } else {
          const opts = this.#resolveDeclarativeScrollOptions();
          this.#activeScrollOptions = opts;
          this.#scrollSource = "attribute";
          this.#mountInnerScrollBinding(opts);
        }
      } else if ((name === "style-mode" || name === "blueprint") && this.#program) {
        this.#mountProgramDom(this.#program);
        this.#renderCurrent();
      }
    }

    snapshot(): BrowserPlayerState {
      return {
        timeMs: this.#timeMs,
        playing: this.#playing,
        cancelled: false,
        disposed: this.#disposed,
        layoutValid: !this.#disposed,
        mode: this.#effectiveMode()
      };
    }

    setProgram(input: unknown): BrowserPlayerState {
      if (this.#disposed) throw new Error("Stickman player element is disposed.");
      const nextProgram = resolveElementProgramInput(input);
      this.#stopRaf();
      this.#program = nextProgram;
      this.#timeMs = 0;
      this.#emittedMs = -1;
      if (this.#detachMedia === null) {
        this.#bindReducedMotion();
      }
      this.#mountProgramDom(nextProgram);
      this.#renderCurrent();
      if (this.#activeScrollOptions !== null) {
        this.#mountInnerScrollBinding(this.#activeScrollOptions);
      } else if (this.#wantsDeclarativeScrollScrub()) {
        this.#syncDeclarativeScrollScrub();
      }
      return this.snapshot();
    }

    setMode(mode: PlaybackMode): BrowserPlayerState {
      if (mode !== "normal" && mode !== "reduced" && mode !== "static") {
        throw new TypeError('Mode must be "normal", "reduced", or "static".');
      }
      this.#explicitMode = mode;
      if (mode !== "normal") {
        this.#stopRaf();
      }
      this.#renderCurrent();
      return this.snapshot();
    }

    bindScroll(options: StickmanPlayerScrollOptions = {}): ScrollTimelineBinding {
      if (this.#disposed) throw new Error("Stickman player element is disposed.");
      if (typeof options !== "object" || options === null) {
        throw new TypeError("Scroll options must be an object when provided.");
      }
      const stored: StickmanPlayerScrollOptions = { ...options };
      this.#activeScrollOptions = stored;
      this.#scrollSource = "manual";
      this.#mountInnerScrollBinding(stored);
      let handleDisposed = false;
      return {
        update: () => {
          if (handleDisposed || !this.#innerScrollBinding || this.#activeScrollOptions !== stored) {
            return this.#timeMs;
          }
          return this.#innerScrollBinding.update();
        },
        dispose: () => {
          if (handleDisposed) return;
          handleDisposed = true;
          if (this.#activeScrollOptions === stored) {
            this.#clearScrollBinding();
          }
        }
      };
    }

    play(): BrowserPlayerState {
      if (this.#disposed) throw new Error("Stickman player element is disposed.");
      if (!this.#program) return this.snapshot();
      if (this.#effectiveMode() !== "normal") return this.snapshot();
      const duration = this.#program.spec.durationMs;
      if (this.#timeMs >= duration) {
        this.#timeMs = 0;
        this.#emittedMs = -1;
      } else if (this.#timeMs === 0) {
        this.#emittedMs = -1;
      }
      if (!this.#playing) {
        this.#playing = true;
        this.#previousClockMs = this.#now();
        this.#renderCurrent();
        this.#schedule();
      }
      return this.snapshot();
    }

    pause(): BrowserPlayerState {
      this.#stopRaf();
      return this.snapshot();
    }

    seek(timeMs: number): BrowserPlayerState {
      finite(timeMs, "seek timeMs");
      if (this.#disposed) throw new Error("Stickman player element is disposed.");
      if (!this.#program) return this.snapshot();
      const duration = this.#program.spec.durationMs;
      this.#timeMs = Math.max(0, Math.min(duration, timeMs));
      this.#emittedMs = this.#timeMs;
      if (this.#playing) {
        this.#previousClockMs = this.#now();
      }
      if (this.#timeMs >= duration) {
        this.#stopRaf();
      }
      this.#renderCurrent();
      return this.snapshot();
    }

    dispose(): void {
      if (this.#disposed) return;
      this.#stopRaf();
      this.#disposed = true;
      this.#clearScrollBinding();
      this.#detachMedia?.();
      this.#detachMedia = null;
      this.#painter?.dispose();
      this.#painter = null;
      this.#teardownControlsDom();
      removeDomNode(this.#styleEl);
      this.#styleEl = null;
      removeDomNode(this.#svg);
      this.#svg = null;
      this.#bgRect = null;
      this.#groundPath = null;
    }
  }

  g.customElements.define(tagName, StickmanPlayerCustomElement);
  return true;
}

export interface ScrollTimelineMediaQueryListLike {
  readonly matches: boolean;
  addEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
}

export interface ScrollTimelineEventTargetLike {
  addEventListener?: (
    type: string,
    listener: () => void,
    options?: AddEventListenerOptions | boolean
  ) => void;
  removeEventListener?: (
    type: string,
    listener: () => void,
    options?: EventListenerOptions | boolean
  ) => void;
}

export interface ScrollTimelineContainerLike extends ScrollTimelineEventTargetLike {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
  scrollY?: number;
  pageYOffset?: number;
  innerHeight?: number;
  document?: {
    documentElement?: {
      scrollTop?: number;
      scrollHeight?: number;
      clientHeight?: number;
    };
  };
  getBoundingClientRect?: () => { top: number; height: number };
  matchMedia?: (query: string) => ScrollTimelineMediaQueryListLike;
}

export interface ScrollTimelineElementLike extends ScrollTimelineEventTargetLike {
  getBoundingClientRect?: () => { top: number; height: number };
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
}

export type ScrollTimelineTarget =
  | { seek?: (timeMs: number) => void; setTimeMs?: (timeMs: number) => void }
  | ((timeMs: number) => void);

export interface ScrollTimelineOptions {
  durationMs: number;
  container?: ScrollTimelineContainerLike;
  scrollElement?: ScrollTimelineElementLike;
  startOffsetPx?: number;
  endOffsetPx?: number;
  respectReducedMotion?: boolean;
  reducedTimeMs?: number;
  matchMedia?: (query: string) => ScrollTimelineMediaQueryListLike;
}

export interface ScrollTimelineBinding {
  update: () => number;
  dispose: () => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resolveScrollTargetSetter(target: ScrollTimelineTarget): (timeMs: number) => void {
  if (typeof target === "function") {
    return target;
  }
  if (typeof target === "object" && target !== null) {
    if (typeof target.seek === "function") {
      return (timeMs: number) => {
        target.seek!(timeMs);
      };
    }
    if (typeof target.setTimeMs === "function") {
      return (timeMs: number) => {
        target.setTimeMs!(timeMs);
      };
    }
  }
  throw new TypeError(
    "Scroll timeline target must be a callback or an object with seek(timeMs) or setTimeMs(timeMs)."
  );
}

/**
 * Passive scroll-driven playhead binder. Maps clamped 0..1 scroll progress onto
 * [0, durationMs] without scroll-jacking, and deterministically pins to
 * reducedTimeMs ?? durationMs when prefers-reduced-motion: reduce is active.
 */
export function bindScrollTimeline(
  target: ScrollTimelineTarget,
  options: ScrollTimelineOptions
): ScrollTimelineBinding {
  const applyTime = resolveScrollTargetSetter(target);
  if (typeof options !== "object" || options === null) {
    throw new TypeError("ScrollTimelineOptions is required.");
  }
  finite(options.durationMs, "durationMs");
  if (options.durationMs < 0) {
    throw new RangeError("durationMs must be non-negative.");
  }
  const durationMs = options.durationMs;
  const startOffsetPx = options.startOffsetPx ?? 0;
  const endOffsetPx = options.endOffsetPx ?? 0;
  finite(startOffsetPx, "startOffsetPx");
  finite(endOffsetPx, "endOffsetPx");
  if (options.reducedTimeMs !== undefined) {
    finite(options.reducedTimeMs, "reducedTimeMs");
  }

  const respectReducedMotion = options.respectReducedMotion !== false;
  const defaultWin =
    typeof globalThis.window === "object" && globalThis.window !== null
      ? (globalThis.window as unknown as ScrollTimelineContainerLike)
      : undefined;
  const container = options.container ?? defaultWin;
  const scrollElement = options.scrollElement;

  const matchMediaFn =
    options.matchMedia ??
    (typeof container?.matchMedia === "function"
      ? container.matchMedia.bind(container)
      : typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia.bind(globalThis)
        : undefined);
  const mql = matchMediaFn ? matchMediaFn("(prefers-reduced-motion: reduce)") : undefined;

  let disposed = false;
  let lastTimeMs = 0;
  const cleanups: Array<() => void> = [];

  const computeProgress = (): number => {
    if (scrollElement && typeof scrollElement.getBoundingClientRect === "function") {
      const rect = scrollElement.getBoundingClientRect();
      finite(rect.top, "scrollElement rect.top");
      finite(rect.height, "scrollElement rect.height");
      let viewportHeight = 0;
      let viewportTop = 0;
      if (container) {
        if (typeof container.innerHeight === "number") {
          viewportHeight = container.innerHeight;
        } else if (typeof container.clientHeight === "number") {
          viewportHeight = container.clientHeight;
          if (typeof container.getBoundingClientRect === "function") {
            viewportTop = container.getBoundingClientRect().top;
          }
        } else if (typeof container.document?.documentElement?.clientHeight === "number") {
          viewportHeight = container.document.documentElement.clientHeight;
        }
      }
      finite(viewportHeight, "viewportHeight");
      finite(viewportTop, "viewportTop");
      const relTop = rect.top - viewportTop;
      if (viewportHeight > 0 && rect.height > viewportHeight) {
        const span = rect.height - viewportHeight - startOffsetPx - endOffsetPx;
        const scrolled = -relTop - startOffsetPx;
        return span <= 0 ? (scrolled >= 0 ? 1 : 0) : clamp01(scrolled / span);
      }
      const span = viewportHeight + rect.height - startOffsetPx - endOffsetPx;
      const scrolled = viewportHeight - startOffsetPx - relTop;
      return span <= 0 ? (scrolled >= 0 ? 1 : 0) : clamp01(scrolled / span);
    }

    const scroller = container ?? scrollElement;
    if (!scroller) return 0;

    const scrollPos =
      typeof scroller.scrollTop === "number"
        ? scroller.scrollTop
        : typeof (scroller as ScrollTimelineContainerLike).scrollY === "number"
          ? (scroller as ScrollTimelineContainerLike).scrollY!
          : typeof (scroller as ScrollTimelineContainerLike).pageYOffset === "number"
            ? (scroller as ScrollTimelineContainerLike).pageYOffset!
            : ((scroller as ScrollTimelineContainerLike).document?.documentElement?.scrollTop ?? 0);

    const scrollHeight =
      typeof scroller.scrollHeight === "number"
        ? scroller.scrollHeight
        : ((scroller as ScrollTimelineContainerLike).document?.documentElement?.scrollHeight ?? 0);

    const viewportHeight =
      typeof scroller.clientHeight === "number"
        ? scroller.clientHeight
        : typeof (scroller as ScrollTimelineContainerLike).innerHeight === "number"
          ? (scroller as ScrollTimelineContainerLike).innerHeight!
          : ((scroller as ScrollTimelineContainerLike).document?.documentElement?.clientHeight ?? 0);

    finite(scrollPos, "scrollOffset");
    finite(scrollHeight, "scrollHeight");
    finite(viewportHeight, "viewportHeight");

    const maxScroll = Math.max(0, scrollHeight - viewportHeight);
    const start = startOffsetPx;
    const end = maxScroll - endOffsetPx;
    const span = end - start;
    if (span <= 0) {
      return maxScroll > 0 && scrollPos >= start ? 1 : 0;
    }
    return clamp01((scrollPos - start) / span);
  };

  const update = (): number => {
    if (disposed) return lastTimeMs;
    if (respectReducedMotion && mql?.matches) {
      const pinned = Math.max(0, Math.min(durationMs, options.reducedTimeMs ?? durationMs));
      lastTimeMs = pinned;
      applyTime(pinned);
      return pinned;
    }
    const progress = computeProgress();
    const nextTimeMs = Math.max(0, Math.min(durationMs, progress * durationMs));
    lastTimeMs = nextTimeMs;
    applyTime(nextTimeMs);
    return nextTimeMs;
  };

  const attachPassive = (
    eventTarget: ScrollTimelineEventTargetLike | undefined,
    eventType: "scroll" | "resize",
    listener: () => void
  ): void => {
    if (!eventTarget || typeof eventTarget.addEventListener !== "function") return;
    eventTarget.addEventListener(eventType, listener, { passive: true });
    cleanups.push(() => {
      eventTarget.removeEventListener?.(eventType, listener);
    });
  };

  const onViewportEvent = (): void => {
    update();
  };

  const primaryTarget = container ?? scrollElement;
  attachPassive(primaryTarget, "scroll", onViewportEvent);
  attachPassive(primaryTarget, "resize", onViewportEvent);
  if (defaultWin && defaultWin !== primaryTarget) {
    attachPassive(defaultWin, "resize", onViewportEvent);
    if (scrollElement) {
      attachPassive(defaultWin, "scroll", onViewportEvent);
    }
  }

  if (mql && typeof mql.addEventListener === "function") {
    const onMediaChange = (): void => {
      update();
    };
    mql.addEventListener("change", onMediaChange);
    cleanups.push(() => {
      mql.removeEventListener?.("change", onMediaChange);
    });
  }

  update();

  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
    }
  };
}
