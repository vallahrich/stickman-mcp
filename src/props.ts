import type {
  ActionName,
  AddonConfig,
  AddonEnterStyle,
  AddonExitStyle,
  AddonFlightConfig,
  AddonKeyframe,
  AddonSlideDirection,
  AddonSocket,
  AddonType,
  Point2D,
  SampledAddon,
  Segment
} from "./contract.js";

export type {
  AddonConfig,
  AddonEnterStyle,
  AddonExitStyle,
  AddonFlightConfig,
  AddonKeyframe,
  AddonSlideDirection,
  AddonSocket,
  AddonType,
  SampledAddon
} from "./contract.js";

export const PROP_CATALOG_VERSION = 1 as const;

export type PropCategory = "sport" | "presentation" | "furniture" | "wearable" | "object" | "stage";

export interface PropSizeSpec {
  readonly w: number;
  readonly h: number;
  readonly r?: number;
  readonly rungs?: number;
  readonly steps?: number;
}

export interface PropDefinition {
  readonly type: AddonType;
  readonly label: string;
  readonly category: PropCategory;
  readonly defaultSize: PropSizeSpec;
  readonly defaultColor: string;
  readonly socket: AddonSocket;
}

export const PROP_DEFINITIONS: Readonly<Record<AddonType, PropDefinition>> = Object.freeze({
  "anger-mark": {
    type: "anger-mark",
    label: "Anger Mark",
    category: "presentation",
    defaultSize: { w: 28, h: 28 },
    defaultColor: "#d74240",
    socket: "aboveHead"
  },
  ball: {
    type: "ball",
    label: "Ball",
    category: "sport",
    defaultSize: { w: 18, h: 18, r: 9 },
    defaultColor: "#ffffff",
    socket: "rHand"
  },
  banner: {
    type: "banner",
    label: "Banner",
    category: "presentation",
    defaultSize: { w: 94, h: 44 },
    defaultColor: "#b11f4b",
    socket: "bothHands"
  },
  bar: {
    type: "bar",
    label: "Overhead Bar",
    category: "sport",
    defaultSize: { w: 80, h: 6 },
    defaultColor: "#4a4f57",
    socket: "bothHands"
  },
  basketball: {
    type: "basketball",
    label: "Basketball",
    category: "sport",
    defaultSize: { w: 20, h: 20, r: 10 },
    defaultColor: "#f28c28",
    socket: "bothHands"
  },
  bench: {
    type: "bench",
    label: "Bench",
    category: "furniture",
    defaultSize: { w: 72, h: 52 },
    defaultColor: "#8b5a2b",
    socket: "stage"
  },
  binoculars: {
    type: "binoculars",
    label: "Binoculars",
    category: "wearable",
    defaultSize: { w: 50, h: 25 },
    defaultColor: "#202124",
    socket: "bothHands"
  },
  board: {
    type: "board",
    label: "Whiteboard",
    category: "presentation",
    defaultSize: { w: 92, h: 118 },
    defaultColor: "#ffffff",
    socket: "stage"
  },
  box: {
    type: "box",
    label: "Box",
    category: "object",
    defaultSize: { w: 50, h: 40 },
    defaultColor: "#b78345",
    socket: "bothHands"
  },
  bulb: {
    type: "bulb",
    label: "Idea Bulb",
    category: "presentation",
    defaultSize: { w: 24, h: 32 },
    defaultColor: "#ffd43b",
    socket: "aboveHead"
  },
  cable: {
    type: "cable",
    label: "Network Cable",
    category: "object",
    defaultSize: { w: 64, h: 32 },
    defaultColor: "#5278ad",
    socket: "rHand"
  },
  card: {
    type: "card",
    label: "Presentation Card",
    category: "presentation",
    defaultSize: { w: 30, h: 20 },
    defaultColor: "#b11f4b",
    socket: "rHand"
  },
  chair: {
    type: "chair",
    label: "Chair",
    category: "furniture",
    defaultSize: { w: 60, h: 100 },
    defaultColor: "#202124",
    socket: "stage"
  },
  cone: {
    type: "cone",
    label: "Marker Cone",
    category: "sport",
    defaultSize: { w: 14, h: 18 },
    defaultColor: "#f28c28",
    socket: "stage"
  },
  crate: {
    type: "crate",
    label: "Crate",
    category: "object",
    defaultSize: { w: 60, h: 65 },
    defaultColor: "#b78345",
    socket: "bothHands"
  },
  cursor: {
    type: "cursor",
    label: "Pointer Cursor",
    category: "presentation",
    defaultSize: { w: 12, h: 18 },
    defaultColor: "#e2a532",
    socket: "rHand"
  },
  desk: {
    type: "desk",
    label: "Workstation Desk",
    category: "furniture",
    defaultSize: { w: 110, h: 92 },
    defaultColor: "#202124",
    socket: "stage"
  },
  "detective-hat": {
    type: "detective-hat",
    label: "Detective Hat",
    category: "wearable",
    defaultSize: { w: 46, h: 20 },
    defaultColor: "#9e784c",
    socket: "aboveHead"
  },
  door: {
    type: "door",
    label: "Doorway",
    category: "stage",
    defaultSize: { w: 67, h: 185 },
    defaultColor: "#202124",
    socket: "stage"
  },
  football: {
    type: "football",
    label: "Football",
    category: "sport",
    defaultSize: { w: 18, h: 18, r: 9 },
    defaultColor: "#ffffff",
    socket: "stage"
  },
  glasses: {
    type: "glasses",
    label: "Glasses",
    category: "wearable",
    defaultSize: { w: 24, h: 10 },
    defaultColor: "#202124",
    socket: "eyes"
  },
  glove: {
    type: "glove",
    label: "Boxing Glove",
    category: "sport",
    defaultSize: { w: 16, h: 12 },
    defaultColor: "#202124",
    socket: "rHand"
  },
  gloves: {
    type: "gloves",
    label: "Boxing Gloves",
    category: "sport",
    defaultSize: { w: 16, h: 12 },
    defaultColor: "#202124",
    socket: "bothHands"
  },
  goal: {
    type: "goal",
    label: "Goal Net",
    category: "sport",
    defaultSize: { w: 84, h: 99 },
    defaultColor: "#dddddd",
    socket: "stage"
  },
  headphones: {
    type: "headphones",
    label: "Headset",
    category: "wearable",
    defaultSize: { w: 42, h: 40 },
    defaultColor: "#367ea8",
    socket: "eyes"
  },
  hoop: {
    type: "hoop",
    label: "Basketball Hoop",
    category: "sport",
    defaultSize: { w: 72, h: 64 },
    defaultColor: "#d84a2b",
    socket: "stage"
  },
  hurdle: {
    type: "hurdle",
    label: "Track Hurdle",
    category: "sport",
    defaultSize: { w: 26, h: 40 },
    defaultColor: "#b11f4b",
    socket: "stage"
  },
  ladder: {
    type: "ladder",
    label: "Ladder",
    category: "stage",
    defaultSize: { w: 40, h: 240, rungs: 7 },
    defaultColor: "#202124",
    socket: "stage"
  },
  laptop: {
    type: "laptop",
    label: "Laptop",
    category: "object",
    defaultSize: { w: 48, h: 34 },
    defaultColor: "#6675cc",
    socket: "stage"
  },
  ledge: {
    type: "ledge",
    label: "Ledge",
    category: "stage",
    defaultSize: { w: 50, h: 16 },
    defaultColor: "#202124",
    socket: "stage"
  },
  magnifier: {
    type: "magnifier",
    label: "Magnifier",
    category: "object",
    defaultSize: { w: 24, h: 34 },
    defaultColor: "#e2a532",
    socket: "rHand"
  },
  notebook: {
    type: "notebook",
    label: "Notebook",
    category: "presentation",
    defaultSize: { w: 30, h: 36 },
    defaultColor: "#cf647e",
    socket: "lHand"
  },
  palm: {
    type: "palm",
    label: "Open Palm",
    category: "wearable",
    defaultSize: { w: 24, h: 26 },
    defaultColor: "#ffffff",
    socket: "rHand"
  },
  pen: {
    type: "pen",
    label: "Pen",
    category: "presentation",
    defaultSize: { w: 4, h: 22 },
    defaultColor: "#4169c1",
    socket: "rHand"
  },
  phone: {
    type: "phone",
    label: "Smartphone",
    category: "object",
    defaultSize: { w: 7, h: 12 },
    defaultColor: "#202124",
    socket: "rHand"
  },
  platform: {
    type: "platform",
    label: "Step Platform",
    category: "stage",
    defaultSize: { w: 82, h: 24 },
    defaultColor: "#202124",
    socket: "stage"
  },
  pointer: {
    type: "pointer",
    label: "Presenter Pointer",
    category: "presentation",
    defaultSize: { w: 36, h: 4 },
    defaultColor: "#202124",
    socket: "rHand"
  },
  "sand-pit": {
    type: "sand-pit",
    label: "Sand Pit",
    category: "sport",
    defaultSize: { w: 104, h: 14 },
    defaultColor: "#e8c872",
    socket: "stage"
  },
  "sand-puff": {
    type: "sand-puff",
    label: "Sand Puff",
    category: "sport",
    defaultSize: { w: 32, h: 16 },
    defaultColor: "#e8c872",
    socket: "stage"
  },
  server: {
    type: "server",
    label: "Server Tower",
    category: "stage",
    defaultSize: { w: 64, h: 120 },
    defaultColor: "#59677d",
    socket: "stage"
  },
  "server-module": {
    type: "server-module",
    label: "Server Blade Module",
    category: "object",
    defaultSize: { w: 52, h: 16 },
    defaultColor: "#839bb8",
    socket: "bothHands"
  },
  "server-rack": {
    type: "server-rack",
    label: "Server Rack",
    category: "stage",
    defaultSize: { w: 64, h: 120 },
    defaultColor: "#59677d",
    socket: "stage"
  },
  sign: {
    type: "sign",
    label: "Handheld Sign",
    category: "presentation",
    defaultSize: { w: 90, h: 55 },
    defaultColor: "#fff7d6",
    socket: "rHand"
  },
  socket: {
    type: "socket",
    label: "Wall Socket",
    category: "stage",
    defaultSize: { w: 18, h: 22 },
    defaultColor: "#7a8799",
    socket: "stage"
  },
  spear: {
    type: "spear",
    label: "Javelin Spear",
    category: "sport",
    defaultSize: { w: 48, h: 6 },
    defaultColor: "#8b5a2b",
    socket: "rHand"
  },
  stairs: {
    type: "stairs",
    label: "Stairs",
    category: "stage",
    defaultSize: { w: 90, h: 54, steps: 4 },
    defaultColor: "#202124",
    socket: "stage"
  },
  tablet: {
    type: "tablet",
    label: "Tablet",
    category: "object",
    defaultSize: { w: 22, h: 30 },
    defaultColor: "#259b91",
    socket: "lHand"
  },
  target: {
    type: "target",
    label: "Bullseye Target",
    category: "sport",
    defaultSize: { w: 24, h: 24, r: 12 },
    defaultColor: "#d62828",
    socket: "stage"
  },
  "thought-cloud": {
    type: "thought-cloud",
    label: "Thought Cloud",
    category: "presentation",
    defaultSize: { w: 52, h: 36 },
    defaultColor: "#f5f1df",
    socket: "aboveHead"
  },
  thumb: {
    type: "thumb",
    label: "Thumbs Up Hand",
    category: "wearable",
    defaultSize: { w: 13, h: 20 },
    defaultColor: "#ffffff",
    socket: "rHand"
  },
  wall: {
    type: "wall",
    label: "Climbing Wall",
    category: "stage",
    defaultSize: { w: 60, h: 140 },
    defaultColor: "#202124",
    socket: "stage"
  },
  watch: {
    type: "watch",
    label: "Wristwatch",
    category: "wearable",
    defaultSize: { w: 15, h: 13 },
    defaultColor: "#ffffff",
    socket: "wrist"
  },
  window: {
    type: "window",
    label: "App Window",
    category: "presentation",
    defaultSize: { w: 80, h: 54 },
    defaultColor: "#6675cc",
    socket: "rHand"
  }
});

export const ADDON_TYPES: readonly AddonType[] = Object.freeze(Object.keys(PROP_DEFINITIONS) as AddonType[]);

const BRAND_ACCENT_HEX = "#b11f4b";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function round3(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatSvgNumber(value: number): string {
  return round3(value).toString();
}

export function escapeXml(value: string): string {
  // Strip invalid XML 1.0 control characters before entity encoding.
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function linePath(a: Point2D, b: Point2D): string {
  return `M${formatSvgNumber(a.x)} ${formatSvgNumber(a.y)}L${formatSvgNumber(b.x)} ${formatSvgNumber(b.y)}`;
}

export interface AddonLifecycleEnterInput {
  style: AddonEnterStyle;
  at?: number;
  frame?: number;
  duration?: number;
  dur?: number;
  from?: AddonSlideDirection;
}

export interface AddonLifecycleExitInput {
  style: AddonExitStyle;
  at?: number;
  frame?: number;
  duration?: number;
  dur?: number;
}

export interface AddonLifecycleDescriptor {
  enter?: AddonEnterStyle | AddonLifecycleEnterInput;
  enterAt?: number;
  enterDuration?: number;
  slideFrom?: AddonSlideDirection;
  exit?: AddonExitStyle | AddonLifecycleExitInput;
  exitAt?: number;
  exitDuration?: number;
  persist?: boolean;
}

export interface AddonLifecycleStage {
  rootX?: number;
  groundY?: number;
  scale?: number;
  slideDistanceX?: number;
  slideDistanceY?: number;
}

export interface AddonLifecycleState {
  visible: boolean;
  opacity: number;
  scale: number;
  rotation: number;
  dx: number;
  dy: number;
  puff: boolean;
  tip: boolean;
}

export function addonLifecycleState(
  descriptor: AddonLifecycleDescriptor = {},
  progress = 0,
  stage: AddonLifecycleStage = {}
): AddonLifecycleState {
  const state: AddonLifecycleState = {
    visible: true,
    opacity: 1,
    scale: 1,
    rotation: 0,
    dx: 0,
    dy: 0,
    puff: false,
    tip: false
  };

  const enterObj: AddonLifecycleEnterInput | undefined =
    typeof descriptor.enter === "string"
      ? {
          style: descriptor.enter,
          ...(descriptor.enterAt !== undefined ? { at: descriptor.enterAt } : {}),
          ...(descriptor.enterDuration !== undefined ? { duration: descriptor.enterDuration } : {}),
          ...(descriptor.slideFrom !== undefined ? { from: descriptor.slideFrom } : {})
        }
      : descriptor.enter;

  if (enterObj) {
    const start = enterObj.at ?? enterObj.frame ?? descriptor.enterAt ?? 0;
    if (progress < start - 1e-9) {
      return { ...state, visible: false, opacity: 0, scale: 0 };
    }
    const rawDur = enterObj.duration ?? enterObj.dur ?? descriptor.enterDuration ?? (enterObj.style === "instant" ? 0 : 0.1);
    if (enterObj.style !== "instant" && rawDur > 0) {
      const dur = Math.max(1e-6, rawDur);
      const t = clamp01((progress - start) / dur);
      if (t < 1) {
        if (enterObj.style === "pop") {
          state.scale *= t < 0.5 ? lerp(0, 1.12, t / 0.5) : lerp(1.12, 1, (t - 0.5) / 0.5);
          state.puff = t > 0;
        } else if (enterObj.style === "fade") {
          state.opacity *= t;
        } else if (enterObj.style === "slide") {
          const distX = stage.slideDistanceX ?? (stage.rootX !== undefined ? stage.rootX + 140 : 220);
          const distY = stage.slideDistanceY ?? (stage.groundY !== undefined ? stage.groundY + 120 : 180);
          const d = 1 - t;
          const from = enterObj.from ?? descriptor.slideFrom ?? "left";
          if (from === "right") state.dx += distX * d;
          else if (from === "top") state.dy -= distY * d;
          else if (from === "bottom") state.dy += distY * d;
          else state.dx -= distX * d;
        }
      }
    }
  }

  const exitObj: AddonLifecycleExitInput | undefined =
    typeof descriptor.exit === "string"
      ? {
          style: descriptor.exit,
          ...(descriptor.exitAt !== undefined ? { at: descriptor.exitAt } : {}),
          ...(descriptor.exitDuration !== undefined ? { duration: descriptor.exitDuration } : {})
        }
      : descriptor.exit;

  if (exitObj && !descriptor.persist && exitObj.style !== "persist") {
    const start = exitObj.at ?? exitObj.frame ?? descriptor.exitAt ?? 1;
    if (exitObj.style === "instant") {
      if (progress >= start - 1e-9) {
        return { ...state, visible: false, opacity: 0 };
      }
    } else {
      const dur = Math.max(1e-6, exitObj.duration ?? exitObj.dur ?? descriptor.exitDuration ?? 0.1);
      if (progress >= start + dur - 1e-9) {
        return { ...state, visible: false, opacity: 0, scale: exitObj.style === "shrink" ? 0 : state.scale };
      }
      if (progress > start) {
        const t = clamp01((progress - start) / dur);
        if (exitObj.style === "shrink") {
          state.scale *= 1 - t;
        } else if (exitObj.style === "tip") {
          state.opacity *= 1 - t;
          state.rotation += 15 * t;
          state.tip = true;
        } else {
          state.opacity *= 1 - t;
        }
      }
    }
  }

  state.opacity = round3(clamp01(state.opacity));
  state.scale = round3(Math.max(0, state.scale));
  state.rotation = round3(state.rotation);
  state.dx = round3(state.dx);
  state.dy = round3(state.dy);
  state.visible = state.opacity > 0.001 && state.scale > 0.001;
  return state;
}

export interface AddonFlightSpec {
  from?: number;
  to?: number;
  apex?: number;
  spin?: number;
}

export interface ComputedFlightPoint {
  x: number;
  y: number;
  rotation: number;
  rot: number;
  t: number;
}

export function computeAddonFlightPoint(
  start: Point2D,
  end: Point2D,
  flight: AddonFlightSpec = {},
  progress = 0,
  scaleOrStage: number | { scale?: number } = 1
): ComputedFlightPoint {
  const scale = typeof scaleOrStage === "number" ? scaleOrStage : (scaleOrStage.scale ?? 1);
  const from = flight.from ?? 0;
  const rawSpan = (flight.to ?? from + 1) - from;
  const span = rawSpan > 1e-6 ? rawSpan : 1e-6;
  const t = clamp01((progress - from) / span);
  const apex = (flight.apex ?? 0) * scale;
  const rotation = round3((flight.spin ?? 0) * t);
  return {
    x: round3(lerp(start.x, end.x, t)),
    y: round3(lerp(start.y, end.y, t) - apex * 4 * t * (1 - t)),
    rotation,
    rot: rotation,
    t: round3(t)
  };
}

export interface DoorGeometryInput {
  x: number;
  y: number;
  width?: number;
  height?: number;
  w?: number;
  h?: number;
  open?: number;
  hinge?: "left" | "right";
}

export interface DoorGeometryResult {
  x: number;
  y: number;
  width: number;
  height: number;
  open: number;
  hingeLeft: boolean;
  hingeX: number;
  freeX: number;
  nearTop: Point2D;
  nearBottom: Point2D;
  farTop: Point2D;
  farBottom: Point2D;
  handleX: number;
  handleY: number;
}

export function doorGeometry(prop: DoorGeometryInput, strokeWidth = 3): DoorGeometryResult {
  const x = prop.x;
  const y = prop.y;
  const width = prop.width ?? prop.w ?? 67;
  const height = prop.height ?? prop.h ?? 185;
  const open = clamp01(prop.open ?? 0);
  const hingeLeft = prop.hinge === "left";
  const hingeX = hingeLeft ? x : x + width;
  const angle = open * (Math.PI / 2);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const freeX = hingeLeft ? x + width * c : x + width - width * c;
  const inset = height * 0.04 * s;
  const nearTop = { x: round3(hingeX), y: round3(y) };
  const nearBottom = { x: round3(hingeX), y: round3(y + height) };
  const farTop = { x: round3(freeX), y: round3(y + inset) };
  const farBottom = { x: round3(freeX), y: round3(y + height - inset) };
  const handleInset = Math.min(width * 0.18, Math.max(strokeWidth, width * 0.1));
  const towardHinge = hingeLeft ? -1 : 1;
  const gap = Math.abs(hingeX - freeX);
  const handleX = round3(freeX + towardHinge * Math.min(handleInset, gap * 0.45));
  const handleY = round3(y + height * 0.52);
  return {
    x: round3(x),
    y: round3(y),
    width: round3(width),
    height: round3(height),
    open: round3(open),
    hingeLeft,
    hingeX: round3(hingeX),
    freeX: round3(freeX),
    nearTop,
    nearBottom,
    farTop,
    farBottom,
    handleX,
    handleY
  };
}

const DOOR_OPEN_KEYFRAMES: readonly AddonKeyframe[] = Object.freeze([
  { at: 0, open: 0 },
  { at: 0.3, open: 0 },
  { at: 0.38, open: 0.5 },
  { at: 0.46, open: 0.9 },
  { at: 0.56, open: 0.95 },
  { at: 0.66, open: 0.95 },
  { at: 0.74, open: 0.55 },
  { at: 0.84, open: 0 },
  { at: 1, open: 0 }
]);

const ACTION_DEFAULT_ADDONS: Readonly<Record<string, readonly AddonConfig[]>> = Object.freeze({
  idea: [
    {
      id: "bulb",
      type: "bulb",
      socket: "aboveHead",
      layer: "front",
      width: 24,
      height: 32,
      dy: 4,
      color: "#f59e0b",
      secondaryColor: "#ffd43b",
      enter: "pop",
      enterAt: 0.56,
      enterDuration: 0.12,
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "present-card": [
    {
      id: "card",
      type: "card",
      socket: "rHand",
      layer: "front",
      width: 30,
      height: 20,
      dx: 3,
      dy: 2,
      color: BRAND_ACCENT_HEX,
      enter: "pop",
      enterAt: 0.2,
      enterDuration: 0.09,
      attachWindow: {
        from: 0.2,
        until: 0.507,
        pinOnRelease: true,
        pinnedPoint: { x: 63.2, y: 130.9 }
      },
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  reveal: [
    {
      id: "card",
      type: "card",
      socket: "rHand",
      layer: "front",
      width: 34,
      height: 22,
      dx: 4,
      dy: 4,
      color: BRAND_ACCENT_HEX,
      enter: "pop",
      enterAt: 0.44,
      enterDuration: 0.1,
      attachWindow: {
        from: 0.44,
        until: 0.68,
        pinOnRelease: true,
        pinnedPoint: { x: 53.2, y: 101.7 }
      },
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "hand-over": [
    {
      id: "card",
      type: "card",
      socket: "rHand",
      layer: "front",
      width: 26,
      height: 18,
      dx: 4,
      dy: 3,
      color: BRAND_ACCENT_HEX,
      enter: "fade",
      enterAt: 0.084,
      enterDuration: 0.04,
      attachWindow: {
        from: 0.084,
        until: 0.571
      },
      flight: {
        from: 0.571,
        to: 0.672,
        target: { x: 104, y: 111.5 },
        apex: 0,
        spin: 0,
        releaseOffset: { x: 66.1, y: 111.5 }
      },
      exit: "fade",
      exitAt: 0.74,
      exitDuration: 0.12
    }
  ],
  "tap-element": [
    {
      id: "window",
      type: "window",
      socket: "stage",
      layer: "back",
      x: 42,
      y: 92,
      width: 56,
      height: 38,
      color: "#6675cc",
      enter: "pop",
      enterAt: 0.08,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.88,
      exitDuration: 0.12
    }
  ],
  "write-board": [
    {
      id: "board",
      type: "board",
      socket: "stage",
      layer: "back",
      x: 75,
      y: 0,
      width: 68,
      height: 142,
      color: "#ffffff",
      enter: "instant",
      exit: "fade",
      exitAt: 0.94,
      exitDuration: 0.06,
      keyframes: [
        { at: 0, ink: 0 },
        { at: 0.21, ink: 0 },
        { at: 0.37, ink: 0.3 },
        { at: 0.56, ink: 0.55 },
        { at: 0.72, ink: 0.75 },
        { at: 0.88, ink: 1 },
        { at: 1, ink: 1 }
      ]
    }
  ],
  "open-door": [
    {
      id: "door",
      type: "door",
      socket: "stage",
      layer: "back",
      x: 42,
      y: 0,
      width: 67,
      height: 185,
      hinge: "right",
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.88,
      exitDuration: 0.12,
      keyframes: DOOR_OPEN_KEYFRAMES
    },
    {
      id: "door-frame",
      type: "door",
      socket: "stage",
      layer: "front",
      x: 42,
      y: 0,
      width: 67,
      height: 185,
      hinge: "right",
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.88,
      exitDuration: 0.12,
      keyframes: DOOR_OPEN_KEYFRAMES
    }
  ],
  "enter-door": [
    {
      id: "door",
      type: "door",
      socket: "stage",
      layer: "back",
      x: 75,
      y: 0,
      width: 85,
      height: 185,
      hinge: "left",
      open: 0.9,
      color: "#202124",
      enter: "fade",
      enterAt: 0,
      enterDuration: 0.058,
      exit: "fade",
      exitAt: 0.808,
      exitDuration: 0.115
    },
    {
      id: "door-frame",
      type: "door",
      socket: "stage",
      layer: "front",
      x: 75,
      y: 0,
      width: 85,
      height: 185,
      hinge: "left",
      open: 0.9,
      color: "#202124",
      enter: "fade",
      enterAt: 0,
      enterDuration: 0.058,
      exit: "fade",
      exitAt: 0.808,
      exitDuration: 0.115
    }
  ],
  "exit-door": [
    {
      id: "door",
      type: "door",
      socket: "stage",
      layer: "back",
      x: 102,
      y: 0,
      width: 70,
      height: 185,
      hinge: "right",
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.1,
      keyframes: [
        { at: 0, open: 0 },
        { at: 0.264, open: 0 },
        { at: 0.455, open: 0.9 },
        { at: 0.791, open: 0.9 },
        { at: 0.9, open: 0 },
        { at: 1, open: 0 }
      ]
    },
    {
      id: "door-frame",
      type: "door",
      socket: "stage",
      layer: "front",
      x: 102,
      y: 0,
      width: 70,
      height: 185,
      hinge: "right",
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.1,
      keyframes: [
        { at: 0, open: 0 },
        { at: 0.264, open: 0 },
        { at: 0.455, open: 0.9 },
        { at: 0.791, open: 0.9 },
        { at: 0.9, open: 0 },
        { at: 1, open: 0 }
      ]
    }
  ],
  "type-at-desk": [
    {
      id: "chair",
      type: "chair",
      socket: "stage",
      layer: "back",
      x: -54,
      y: 0,
      width: 60,
      height: 100,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "desk",
      type: "desk",
      socket: "stage",
      layer: "front",
      x: -4,
      y: 0,
      width: 110,
      height: 92,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "sit-down": [
    {
      id: "chair",
      type: "chair",
      socket: "stage",
      layer: "back",
      x: -54,
      y: 0,
      width: 60,
      height: 100,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.1
    }
  ],
  "stand-up": [
    {
      id: "chair",
      type: "chair",
      socket: "stage",
      layer: "back",
      x: -54,
      y: 0,
      width: 60,
      height: 100,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.1
    }
  ],
  "basketball-shot": [
    {
      id: "hoop",
      type: "hoop",
      socket: "stage",
      layer: "back",
      x: 148,
      y: 153,
      width: 72,
      height: 64,
      color: "#d84a2b",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.065,
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.08,
      impact: {
        at: 0.629,
        duration: 0.12,
        peakBulge: 1
      }
    },
    {
      id: "basketball",
      type: "basketball",
      socket: "rHand",
      layer: "front",
      width: 20,
      height: 20,
      color: "#f28c28",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.065,
      attachWindow: {
        from: 0,
        until: 0.468
      },
      flight: {
        from: 0.468,
        to: 0.629,
        target: "hoop",
        apex: 44,
        spin: 720,
        releaseOffset: { x: 31.85, y: 184.74 },
        dropToGroundAt: 0.72
      },
      exit: "shrink",
      exitAt: 0.9,
      exitDuration: 0.08
    }
  ],
  "kick-ball": [
    {
      id: "goal",
      type: "goal",
      socket: "stage",
      layer: "back",
      x: 182,
      y: 0,
      width: 84,
      height: 99,
      color: "#dddddd",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.04,
      exit: "fade",
      exitAt: 0.833,
      exitDuration: 0.095,
      impact: {
        at: 0.718,
        duration: 0.1,
        peakBulge: 1
      }
    },
    {
      id: "football",
      type: "football",
      socket: "stage",
      layer: "front",
      x: 36,
      y: 0,
      width: 18,
      height: 18,
      color: "#ffffff",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.04,
      flight: {
        from: 0.419,
        to: 0.718,
        target: "goal",
        apex: 38,
        spin: 1080,
        dropToGroundAt: 0.78
      },
      exit: "shrink",
      exitAt: 0.833,
      exitDuration: 0.085
    }
  ],
  "throw-ball": [
    {
      id: "ball",
      type: "ball",
      socket: "rHand",
      layer: "front",
      width: 14,
      height: 14,
      color: "#ffffff",
      secondaryColor: "#c62828",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.072,
      attachWindow: {
        from: 0,
        until: 0.495
      },
      flight: {
        from: 0.495,
        to: 0.62,
        target: { x: 220, y: 150 },
        apex: 18,
        spin: 1440,
        releaseOffset: { x: 39.6, y: 158.6 }
      },
      exit: "fade",
      exitAt: 0.62,
      exitDuration: 0.06
    }
  ],
  throw: [
    {
      id: "ball",
      type: "ball",
      socket: "rHand",
      layer: "front",
      width: 14,
      height: 14,
      color: "#ffffff",
      secondaryColor: "#c62828",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.08,
      attachWindow: {
        from: 0,
        until: 0.495
      },
      flight: {
        from: 0.495,
        to: 0.66,
        target: { x: 210, y: 140 },
        apex: 22,
        spin: 1080,
        releaseOffset: { x: 39.6, y: 158.6 }
      },
      exit: "fade",
      exitAt: 0.66,
      exitDuration: 0.07
    }
  ],
  catch: [
    {
      id: "ball",
      type: "ball",
      socket: "bothHands",
      layer: "front",
      width: 14,
      height: 14,
      color: "#ffffff",
      secondaryColor: "#c62828",
      enter: "fade",
      enterAt: 0.086,
      enterDuration: 0.04,
      exit: "fade",
      exitAt: 0.74,
      exitDuration: 0.08,
      keyframes: [
        { at: 0.086, x: 96, y: 28, rotation: 0 },
        { at: 0.276, x: 0, y: 0, rotation: -360 },
        { at: 1, x: 0, y: 0, rotation: -360 }
      ]
    }
  ],
  hurdle: [
    {
      id: "hurdle",
      type: "hurdle",
      socket: "stage",
      layer: "front",
      x: 138,
      y: 0,
      width: 26,
      height: 40,
      color: BRAND_ACCENT_HEX,
      secondaryColor: "#ffffff",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.064,
      exit: "fade",
      exitAt: 0.928,
      exitDuration: 0.064
    }
  ],
  "phone-call": [
    {
      id: "phone",
      type: "phone",
      socket: "rHand",
      layer: "front",
      width: 8,
      height: 14,
      color: "#202124",
      enter: "pop",
      enterAt: 0.058,
      enterDuration: 0.05,
      attachWindow: {
        from: 0.058,
        until: 0.92
      },
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.086,
      keyframes: [
        { at: 0.058, rotation: -10 },
        { at: 0.17, rotation: -35 },
        { at: 0.24, rotation: -82 },
        { at: 0.78, rotation: -82 },
        { at: 0.85, rotation: -35 },
        { at: 0.92, rotation: -6 }
      ]
    }
  ],
  "hold-sign": [
    {
      id: "sign",
      type: "sign",
      socket: "rHand",
      layer: "front",
      width: 90,
      height: 55,
      color: "#fff7d6",
      enter: "pop",
      enterAt: 0.075,
      enterDuration: 0.075,
      attachWindow: {
        from: 0.075,
        until: 0.953
      },
      exit: "fade",
      exitAt: 0.897,
      exitDuration: 0.056,
      keyframes: [
        { at: 0.075, rotation: 0 },
        { at: 0.355, rotation: 0 },
        { at: 0.467, rotation: 2 },
        { at: 0.579, rotation: -2 },
        { at: 0.692, rotation: 1 },
        { at: 0.953, rotation: 0 }
      ]
    }
  ],
  "pull-banner": [
    {
      id: "banner",
      type: "banner",
      socket: "stage",
      layer: "front",
      x: 34,
      y: 112,
      width: 94,
      height: 44,
      color: BRAND_ACCENT_HEX,
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08,
      keyframes: [
        { at: 0, y: 38 },
        { at: 0.145, y: 38 },
        { at: 0.506, y: 0 },
        { at: 1, y: 0 }
      ]
    }
  ],
  "pull-banner-top": [
    {
      id: "banner",
      type: "banner",
      socket: "stage",
      layer: "front",
      x: 34,
      y: 112,
      width: 94,
      height: 44,
      color: BRAND_ACCENT_HEX,
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08,
      keyframes: [
        { at: 0, y: 96 },
        { at: 0.145, y: 42 },
        { at: 0.289, y: 26 },
        { at: 0.434, y: 10 },
        { at: 0.554, y: 0 },
        { at: 1, y: 0 }
      ]
    }
  ],
  "pull-banner-bottom": [
    {
      id: "banner",
      type: "banner",
      socket: "stage",
      layer: "front",
      x: 34,
      y: 112,
      width: 94,
      height: 44,
      color: BRAND_ACCENT_HEX,
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08,
      keyframes: [
        { at: 0, y: -112 },
        { at: 0.145, y: -80 },
        { at: 0.361, y: -68 },
        { at: 0.554, y: 0 },
        { at: 1, y: 0 }
      ]
    }
  ],
  "pull-banner-left": [
    {
      id: "banner",
      type: "banner",
      socket: "stage",
      layer: "front",
      x: 148,
      y: 36,
      width: 94,
      height: 44,
      color: BRAND_ACCENT_HEX,
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08,
      keyframes: [
        { at: 0, x: 0 },
        { at: 0.348, x: 0 },
        { at: 0.83, x: -48 },
        { at: 1, x: -48 }
      ]
    }
  ],
  "pull-banner-right": [
    {
      id: "banner",
      type: "banner",
      socket: "stage",
      layer: "front",
      x: 148,
      y: 36,
      width: 94,
      height: 44,
      color: BRAND_ACCENT_HEX,
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08,
      keyframes: [
        { at: 0, x: 0 },
        { at: 0.348, x: 0 },
        { at: 0.83, x: -48 },
        { at: 1, x: -48 }
      ]
    }
  ],
  punch: [
    {
      id: "gloves-r",
      type: "gloves",
      socket: "rHand",
      layer: "front",
      width: 16,
      height: 12,
      color: "#202124",
      secondaryColor: "#ffffff",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "gloves-l",
      type: "gloves",
      socket: "lHand",
      layer: "back",
      width: 16,
      height: 12,
      color: "#202124",
      secondaryColor: "#ffffff",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "check-watch": [
    {
      id: "watch",
      type: "watch",
      socket: "wrist",
      layer: "front",
      width: 15,
      height: 13,
      color: "#ffffff",
      enter: "fade",
      enterAt: 0.2,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.8,
      exitDuration: 0.1
    }
  ],
  "look-around": [
    {
      id: "binoculars",
      type: "binoculars",
      socket: "bothHands",
      layer: "front",
      width: 50,
      height: 25,
      color: "#202124",
      enter: "pop",
      enterAt: 0.059,
      enterDuration: 0.05,
      exit: "fade",
      exitAt: 0.84,
      exitDuration: 0.06
    }
  ],
  "climb-ladder": [
    {
      id: "ladder",
      type: "ladder",
      socket: "stage",
      layer: "back",
      x: 30,
      y: 0,
      width: 28,
      height: 220,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "climb-down": [
    {
      id: "ladder",
      type: "ladder",
      socket: "stage",
      layer: "back",
      x: 18,
      y: 0,
      width: 34,
      height: 220,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.08
    }
  ],
  "climb-ledge": [
    {
      id: "ledge",
      type: "ledge",
      socket: "stage",
      layer: "back",
      x: 62,
      y: 0,
      width: 64,
      height: 46,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "hang-swing": [
    {
      id: "bar",
      type: "bar",
      socket: "stage",
      layer: "back",
      x: -22,
      y: 182,
      width: 80,
      height: 6,
      color: "#4a4f57",
      enter: "instant",
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.08
    }
  ],
  "step-up": [
    {
      id: "stairs",
      type: "stairs",
      socket: "stage",
      layer: "back",
      x: 25,
      y: 0,
      width: 55,
      height: 20,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "stairs-up": [
    {
      id: "stairs",
      type: "stairs",
      socket: "stage",
      layer: "back",
      x: 50,
      y: 0,
      width: 90,
      height: 54,
      hinge: "right",
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "stairs-down": [
    {
      id: "stairs",
      type: "stairs",
      socket: "stage",
      layer: "back",
      x: -2,
      y: 0,
      width: 114,
      height: 54,
      hinge: "left",
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "pick-up": [
    {
      id: "box",
      type: "box",
      socket: "bothHands",
      layer: "front",
      width: 50,
      height: 40,
      dx: 24,
      dy: -10,
      color: "#b78345",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.06,
      attachWindow: {
        from: 0.4,
        until: 1,
        pinOnRelease: true
      },
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "put-down": [
    {
      id: "box",
      type: "box",
      socket: "bothHands",
      layer: "front",
      width: 50,
      height: 40,
      dx: 15,
      dy: -21.5,
      color: "#b78345",
      enter: "instant",
      attachWindow: {
        from: 0,
        until: 0.584,
        pinOnRelease: true
      },
      exit: "fade",
      exitAt: 0.85,
      exitDuration: 0.15
    }
  ],
  "lift-carry": [
    {
      id: "box",
      type: "box",
      socket: "bothHands",
      layer: "front",
      width: 50,
      height: 40,
      dx: 24,
      dy: -10.2,
      color: "#b78345",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.04,
      attachWindow: {
        from: 0.111,
        until: 0.861,
        pinOnRelease: true
      },
      exit: "fade",
      exitAt: 0.94,
      exitDuration: 0.06
    }
  ],
  "drag-object": [
    {
      id: "box",
      type: "box",
      socket: "bothHands",
      layer: "front",
      width: 76,
      height: 62,
      dx: -38,
      dy: -30,
      color: "#35a69a",
      enter: "fade",
      enterAt: 0,
      enterDuration: 0.06,
      attachWindow: {
        from: 0.194,
        until: 0.748,
        pinOnRelease: true
      },
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  pull: [
    {
      id: "box",
      type: "box",
      socket: "bothHands",
      layer: "front",
      width: 70,
      height: 55,
      dx: 35,
      dy: -26.5,
      color: "#b78345",
      enter: "instant",
      attachWindow: {
        from: 0.125,
        until: 0.83,
        pinOnRelease: true
      },
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "push-walk": [
    {
      id: "box",
      type: "box",
      socket: "bothHands",
      layer: "front",
      width: 64,
      height: 84,
      dx: 32,
      dy: -32,
      color: "#e5a33b",
      enter: "fade",
      enterAt: 0,
      enterDuration: 0.05,
      attachWindow: {
        from: 0.12,
        until: 0.79,
        pinOnRelease: true
      },
      exit: "fade",
      exitAt: 0.93,
      exitDuration: 0.07
    }
  ],
  vault: [
    {
      id: "box",
      type: "box",
      socket: "stage",
      layer: "back",
      x: 121,
      y: 0,
      width: 60,
      height: 55,
      color: "#b78345",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.072,
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.09
    }
  ],
  kick: [
    {
      id: "ball",
      type: "ball",
      socket: "stage",
      layer: "front",
      x: 35,
      y: 0,
      width: 20,
      height: 20,
      color: "#ffffff",
      secondaryColor: "#c62828",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.08,
      flight: {
        from: 0.419,
        to: 0.78,
        target: { x: 195, y: 12 },
        apex: 32,
        spin: 720
      },
      exit: "fade",
      exitAt: 0.78,
      exitDuration: 0.1
    }
  ],
  dodge: [
    {
      id: "ball",
      type: "ball",
      socket: "stage",
      layer: "front",
      x: 136,
      y: 118,
      width: 18,
      height: 18,
      color: "#ffffff",
      secondaryColor: "#c62828",
      enter: "fade",
      enterAt: 0,
      enterDuration: 0.06,
      exit: "fade",
      exitAt: 0.36,
      exitDuration: 0.1,
      keyframes: [
        { at: 0, x: 0, y: 0 },
        { at: 0.137, x: -36, y: 0 },
        { at: 0.294, x: -144, y: 0 },
        { at: 0.373, x: -198, y: -1 },
        { at: 0.46, x: -240, y: -2 },
        { at: 1, x: -240, y: -2 }
      ]
    }
  ],
  "long-jump": [
    {
      id: "sand-pit",
      type: "sand-pit",
      socket: "stage",
      layer: "back",
      x: 144,
      y: 0,
      width: 104,
      height: 14,
      color: "#e8c872",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.067,
      exit: "fade",
      exitAt: 0.925,
      exitDuration: 0.067
    },
    {
      id: "sand-puff",
      type: "sand-puff",
      socket: "stage",
      layer: "front",
      x: 171,
      y: 0,
      width: 32,
      height: 16,
      color: "#e8c872",
      enter: "pop",
      enterAt: 0.66,
      enterDuration: 0.04,
      exit: "fade",
      exitAt: 0.76,
      exitDuration: 0.09
    }
  ],
  "open-laptop": [
    {
      id: "platform",
      type: "platform",
      socket: "stage",
      layer: "back",
      x: 30,
      y: 0,
      width: 62,
      height: 68,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "laptop",
      type: "laptop",
      socket: "stage",
      layer: "front",
      x: 33,
      y: 67,
      width: 48,
      height: 34,
      color: "#6675cc",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08,
      keyframes: [
        { at: 0, open: 0 },
        { at: 0.246, open: 0 },
        { at: 0.536, open: 0.78 },
        { at: 0.67, open: 1 },
        { at: 1, open: 1 }
      ]
    }
  ],
  "tablet-tap": [
    {
      id: "tablet",
      type: "tablet",
      socket: "lHand",
      layer: "front",
      width: 34,
      height: 44,
      dx: 17,
      dy: 22,
      color: "#259b91",
      enter: "fade",
      enterAt: 0.04,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.88,
      exitDuration: 0.08
    }
  ],
  "inspect-magnifier": [
    {
      id: "detective-hat",
      type: "detective-hat",
      socket: "aboveHead",
      layer: "front",
      y: -18,
      width: 46,
      height: 20,
      color: "#9e784c",
      enter: "fade",
      enterAt: 0,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "notebook",
      type: "notebook",
      socket: "lHand",
      layer: "front",
      width: 22,
      height: 28,
      dx: 11,
      dy: 14,
      color: "#cf647e",
      enter: "fade",
      enterAt: 0.04,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "magnifier",
      type: "magnifier",
      socket: "rHand",
      layer: "front",
      width: 28,
      height: 40,
      dx: -7.3,
      dy: 13.2,
      rotation: 10,
      color: "#e2a532",
      enter: "pop",
      enterAt: 0.04,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "write-notes": [
    {
      id: "notebook",
      type: "notebook",
      socket: "lHand",
      layer: "front",
      width: 24,
      height: 28,
      dx: 12,
      dy: 14,
      color: "#cf647e",
      enter: "fade",
      enterAt: 0.04,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.08,
      keyframes: [
        { at: 0, ink: 0 },
        { at: 0.22, ink: 0 },
        { at: 0.76, ink: 1 },
        { at: 1, ink: 1 }
      ]
    },
    {
      id: "pen",
      type: "pen",
      socket: "rHand",
      layer: "front",
      width: 4,
      height: 18,
      dx: 0,
      dy: 1.4,
      rotation: 25,
      color: "#4169c1",
      enter: "fade",
      enterAt: 0.04,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.9,
      exitDuration: 0.08
    }
  ],
  "plug-cable": [
    {
      id: "socket",
      type: "socket",
      socket: "stage",
      layer: "back",
      x: 44,
      y: 89,
      width: 18,
      height: 22,
      color: "#7a8799",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "cable",
      type: "cable",
      socket: "rHand",
      layer: "front",
      width: 64,
      height: 32,
      dx: -26,
      dy: -8.3,
      color: "#5278ad",
      enter: "fade",
      enterAt: 0,
      enterDuration: 0.08,
      attachWindow: {
        from: 0.179,
        until: 0.737,
        pinOnRelease: true
      },
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "rack-server": [
    {
      id: "server-rack",
      type: "server-rack",
      socket: "stage",
      layer: "back",
      x: 38,
      y: 0,
      width: 64,
      height: 120,
      color: "#59677d",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "server-module",
      type: "server-module",
      socket: "bothHands",
      layer: "front",
      width: 52,
      height: 16,
      dx: 19.5,
      dy: 4.6,
      color: "#839bb8",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.08,
      attachWindow: {
        from: 0.144,
        until: 0.871,
        pinOnRelease: true,
        pinnedPoint: { x: 70, y: 97.6 }
      },
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "drag-window": [
    {
      id: "window",
      type: "window",
      socket: "rHand",
      layer: "back",
      width: 64,
      height: 43.2,
      dx: 5.12,
      dy: -16.4,
      color: "#6675cc",
      enter: "pop",
      enterAt: 0,
      enterDuration: 0.08,
      attachWindow: {
        from: 0.354,
        until: 0.69,
        pinOnRelease: true,
        pinnedPoint: { x: 53.5, y: 94.2 }
      },
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "cursor",
      type: "cursor",
      socket: "rHand",
      layer: "front",
      width: 10,
      height: 15,
      dx: 5,
      dy: -7.5,
      color: "#e2a532",
      enter: "fade",
      enterAt: 0,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "video-call": [
    {
      id: "chair",
      type: "chair",
      socket: "stage",
      layer: "back",
      x: -54,
      y: 0,
      width: 60,
      height: 100,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "desk",
      type: "desk",
      socket: "stage",
      layer: "front",
      x: -4,
      y: 0,
      width: 110,
      height: 92,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "headphones",
      type: "headphones",
      socket: "eyes",
      layer: "front",
      dx: -7,
      dy: 1,
      width: 42,
      height: 40,
      color: "#367ea8",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ],
  "frustrated-pc": [
    {
      id: "chair",
      type: "chair",
      socket: "stage",
      layer: "back",
      x: -54,
      y: 0,
      width: 60,
      height: 100,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "desk",
      type: "desk",
      socket: "stage",
      layer: "front",
      x: -4,
      y: 0,
      width: 110,
      height: 92,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    },
    {
      id: "anger-mark",
      type: "anger-mark",
      socket: "aboveHead",
      layer: "front",
      dx: 24,
      dy: -16,
      width: 28,
      height: 28,
      color: "#d74240",
      enter: "pop",
      enterAt: 0.38,
      enterDuration: 0.08,
      exit: "fade",
      exitAt: 0.88,
      exitDuration: 0.12
    }
  ],
  "seated-idle": [
    {
      id: "chair",
      type: "chair",
      socket: "stage",
      layer: "back",
      x: -54,
      y: 0,
      width: 60,
      height: 100,
      color: "#202124",
      enter: "instant",
      exit: "fade",
      exitAt: 0.92,
      exitDuration: 0.08
    }
  ]
});

export const AUTO_MAPPED_ACTIONS: readonly string[] = Object.freeze(Object.keys(ACTION_DEFAULT_ADDONS).sort());

function cloneAddonConfig(config: AddonConfig): AddonConfig {
  return {
    ...config,
    ...(config.attachWindow
      ? {
          attachWindow: {
            ...config.attachWindow,
            ...(config.attachWindow.pinnedPoint ? { pinnedPoint: { ...config.attachWindow.pinnedPoint } } : {})
          }
        }
      : {}),
    ...(config.flight
      ? {
          flight: {
            ...config.flight,
            ...(typeof config.flight.target === "object" && config.flight.target !== null
              ? { target: { ...config.flight.target } }
              : {}),
            ...(config.flight.releaseOffset ? { releaseOffset: { ...config.flight.releaseOffset } } : {})
          }
        }
      : {}),
    ...(config.impact ? { impact: { ...config.impact } } : {}),
    ...(config.keyframes ? { keyframes: config.keyframes.map((kf) => ({ ...kf })) } : {})
  };
}

export function defaultAddonsForAction(actionName: ActionName): AddonConfig[] {
  const exact = ACTION_DEFAULT_ADDONS[actionName];
  if (exact) return exact.map(cloneAddonConfig);
  if (actionName.startsWith("pull-banner")) {
    return ACTION_DEFAULT_ADDONS["pull-banner"]!.map(cloneAddonConfig);
  }
  return [];
}

export interface AddonPoseSnapshot {
  x: number;
  groundY: number;
  head: Point2D;
  segments: readonly Segment[];
  facing?: number;
  scale?: number;
}

export interface AdjacentActionContext {
  action: ActionName;
  addons?: readonly AddonConfig[];
  mergeDefaults?: boolean;
}

export interface SampleActionAddonsParams {
  action: ActionName;
  progress: number;
  pose: AddonPoseSnapshot;
  originX?: number;
  poseAtProgress?: (progress: number) => AddonPoseSnapshot;
  actorId?: string;
  canvas?: { width: number; height: number };
  addons?: readonly AddonConfig[];
  mergeDefaults?: boolean;
  themeAccentColor?: string;
  persist?: boolean;
  previousAction?: ActionName | AdjacentActionContext;
  nextAction?: ActionName | AdjacentActionContext;
  persistedStageIds?: {
    fromPrevious?: ReadonlySet<string> | readonly string[];
    toNext?: ReadonlySet<string> | readonly string[];
  };
}

interface ResolvedSocketPoint {
  x: number;
  y: number;
  angleDeg: number;
  facing: number;
  headRadius: number;
}

function inferScale(pose: AddonPoseSnapshot): number {
  if (pose.scale !== undefined && Number.isFinite(pose.scale) && pose.scale > 0) return pose.scale;
  const torso = pose.segments.find((s) => s.id === "torso");
  if (!torso) return 1;
  const torsoLen = Math.hypot(torso.x2 - torso.x1, torso.y2 - torso.y1);
  return torsoLen > 1e-6 ? torsoLen / 45 : 1;
}

function inferFacing(pose: AddonPoseSnapshot): number {
  if (pose.facing !== undefined && Number.isFinite(pose.facing)) return Math.max(-1, Math.min(1, pose.facing));
  const torso = pose.segments.find((s) => s.id === "torso");
  if (!torso) return 1;
  const dx = torso.x2 - torso.x1;
  return Math.abs(dx) > 1e-3 ? (dx < 0 ? -1 : 1) : 1;
}

function resolveHeadCenter(pose: AddonPoseSnapshot, unit: number): { center: Point2D; radius: number } {
  const radius = 16.5 * unit;
  const torso = pose.segments.find((s) => s.id === "torso");
  if (!torso) return { center: { x: pose.head.x, y: pose.head.y }, radius };
  const vx = pose.head.x - torso.x2;
  const vy = pose.head.y - torso.y2;
  const len = Math.hypot(vx, vy);
  if (len <= 1e-6) return { center: { x: pose.head.x, y: pose.head.y }, radius };
  return {
    center: {
      x: torso.x2 + (vx / len) * radius,
      y: torso.y2 + (vy / len) * radius
    },
    radius
  };
}

function resolveSocketPoint(pose: AddonPoseSnapshot, socket: AddonSocket, unit: number): ResolvedSocketPoint {
  const facing = inferFacing(pose);
  const { center: headCenter, radius: headRadius } = resolveHeadCenter(pose, unit);
  const seg = (id: string): Segment | undefined => pose.segments.find((s) => s.id === id);

  if (socket === "aboveHead") {
    return { x: headCenter.x, y: headCenter.y - headRadius, angleDeg: 0, facing, headRadius };
  }
  if (socket === "eyes") {
    return {
      x: headCenter.x + facing * headRadius * 0.42,
      y: headCenter.y - headRadius * 0.08,
      angleDeg: 0,
      facing,
      headRadius
    };
  }
  if (socket === "wrist") {
    const rFore = seg("right-forearm");
    if (rFore) {
      return {
        x: lerp(rFore.x1, rFore.x2, 0.82),
        y: lerp(rFore.y1, rFore.y2, 0.82),
        angleDeg: (Math.atan2(rFore.y2 - rFore.y1, rFore.x2 - rFore.x1) * 180) / Math.PI,
        facing,
        headRadius
      };
    }
  }
  if (socket === "rHand" || socket === "lHand") {
    const fore = seg(socket === "rHand" ? "right-forearm" : "left-forearm");
    if (fore) {
      return {
        x: fore.x2,
        y: fore.y2,
        angleDeg: (Math.atan2(fore.y2 - fore.y1, fore.x2 - fore.x1) * 180) / Math.PI,
        facing,
        headRadius
      };
    }
  }
  if (socket === "bothHands") {
    const rFore = seg("right-forearm");
    const lFore = seg("left-forearm");
    if (rFore && lFore) {
      return {
        x: (rFore.x2 + lFore.x2) / 2,
        y: (rFore.y2 + lFore.y2) / 2,
        angleDeg: 0,
        facing,
        headRadius
      };
    }
  }
  if (socket === "rFoot" || socket === "lFoot") {
    const shin = seg(socket === "rFoot" ? "right-shin" : "left-shin");
    if (shin) {
      return {
        x: shin.x2,
        y: shin.y2,
        angleDeg: (Math.atan2(shin.y2 - shin.y1, shin.x2 - shin.x1) * 180) / Math.PI,
        facing,
        headRadius
      };
    }
  }
  return { x: pose.x, y: pose.groundY, angleDeg: 0, facing, headRadius };
}

interface InterpolatedKeyState {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  opacity: number;
  open?: number;
  ink?: number;
  netBulge?: number;
}

function interpolateKeyframes(keyframes: readonly AddonKeyframe[] | undefined, progress: number): InterpolatedKeyState {
  if (!keyframes || keyframes.length === 0) {
    return { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };
  }
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);
  let a = sorted[0]!;
  let b = sorted[sorted.length - 1]!;
  if (progress <= a.at) {
    b = a;
  } else if (progress >= b.at) {
    a = b;
  } else {
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i]!;
      const nxt = sorted[i + 1]!;
      if (progress >= cur.at && progress <= nxt.at) {
        a = cur;
        b = nxt;
        break;
      }
    }
  }
  const span = b.at - a.at;
  const t = span > 1e-6 ? clamp01((progress - a.at) / span) : 0;
  const interpOptional = (va: number | undefined, vb: number | undefined): number | undefined => {
    if (va === undefined && vb === undefined) return undefined;
    return lerp(va ?? vb ?? 0, vb ?? va ?? 0, t);
  };
  const open = interpOptional(a.open, b.open);
  const ink = interpOptional(a.ink, b.ink);
  const netBulge = interpOptional(a.netBulge, b.netBulge);
  return {
    x: lerp(a.x ?? 0, b.x ?? a.x ?? 0, t),
    y: lerp(a.y ?? 0, b.y ?? a.y ?? 0, t),
    rotation: lerp(a.rotation ?? 0, b.rotation ?? a.rotation ?? 0, t),
    scale: lerp(a.scale ?? 1, b.scale ?? a.scale ?? 1, t),
    opacity: lerp(a.opacity ?? 1, b.opacity ?? a.opacity ?? 1, t),
    ...(open !== undefined ? { open } : {}),
    ...(ink !== undefined ? { ink } : {}),
    ...(netBulge !== undefined ? { netBulge } : {})
  };
}

function mergeActionConfigs(
  action: ActionName,
  overrides: readonly AddonConfig[] | undefined,
  mergeDefaults = true
): AddonConfig[] {
  if (overrides === undefined) return defaultAddonsForAction(action);
  if (overrides.length === 0) return [];
  if (!mergeDefaults) return overrides.map(cloneAddonConfig);

  const defaults = defaultAddonsForAction(action);
  if (defaults.length === 0) return overrides.map(cloneAddonConfig);

  const usedOverrideIndices = new Set<number>();
  const merged = defaults.map((def) => {
    const defId = def.id ?? def.type;
    let matchIdx = overrides.findIndex((ov, idx) => !usedOverrideIndices.has(idx) && ov.id !== undefined && ov.id === defId);
    if (matchIdx < 0) {
      matchIdx = overrides.findIndex((ov, idx) => !usedOverrideIndices.has(idx) && ov.id === undefined && ov.type === def.type);
    }
    if (matchIdx < 0) return def;
    usedOverrideIndices.add(matchIdx);
    const ov = overrides[matchIdx]!;
    return cloneAddonConfig({
      ...def,
      ...ov,
      ...(def.attachWindow && ov.attachWindow
        ? { attachWindow: { ...def.attachWindow, ...ov.attachWindow } }
        : {}),
      ...(def.flight && ov.flight
        ? { flight: { ...def.flight, ...ov.flight } }
        : {}),
      ...(def.impact && ov.impact
        ? { impact: { ...def.impact, ...ov.impact } }
        : {})
    });
  });

  overrides.forEach((ov, idx) => {
    if (!usedOverrideIndices.has(idx)) {
      merged.push(cloneAddonConfig(ov));
    }
  });

  return merged;
}

function extractStagePropIds(context: ActionName | AdjacentActionContext | undefined): Set<string> {
  if (!context) return new Set<string>();
  const configs =
    typeof context === "string"
      ? defaultAddonsForAction(context)
      : mergeActionConfigs(context.action, context.addons, context.mergeDefaults ?? true);
  const ids = new Set<string>();
  for (const cfg of configs) {
    const def = PROP_DEFINITIONS[cfg.type];
    const socket = cfg.socket ?? def.socket;
    if (socket === "stage") {
      ids.add(cfg.id ?? cfg.type);
    }
  }
  return ids;
}

function toStringSet(items: ReadonlySet<string> | readonly string[] | undefined): Set<string> {
  if (!items) return new Set<string>();
  return new Set<string>(items);
}

function autoAlignsWithLimb(type: AddonType, socket: AddonSocket): boolean {
  if (socket === "wrist") return true;
  if (socket === "rHand" || socket === "lHand") {
    return type === "glove" || type === "gloves" || type === "pointer" || type === "spear" || type === "watch";
  }
  return false;
}

function resolveColor(config: AddonConfig, def: PropDefinition, themeAccentColor?: string): string {
  if (config.color !== undefined) {
    // Allow themeAccentColor to override action-default brand accent when caller did not pass custom color,
    // handled before merging, or if config.color equals BRAND_ACCENT_HEX and came from defaults.
    return config.color;
  }
  if (themeAccentColor && def.defaultColor.toLowerCase() === BRAND_ACCENT_HEX) {
    return themeAccentColor;
  }
  return def.defaultColor;
}

function targetSweetSpot(addon: { type: AddonType; x: number; y: number; width: number; height: number }): Point2D {
  if (addon.type === "hoop") {
    return { x: addon.x + addon.width * 0.7, y: addon.y + addon.height * 0.48 };
  }
  if (addon.type === "goal") {
    return { x: addon.x + addon.width * 0.52, y: addon.y + addon.height * 0.58 };
  }
  return { x: addon.x + addon.width / 2, y: addon.y + addon.height / 2 };
}

function clampStageBoxToCanvas(
  x: number,
  y: number,
  width: number,
  height: number,
  canvas: { width: number; height: number } | undefined
): Point2D {
  if (!canvas) return { x, y };
  const pad = 4;
  const clampedX =
    width <= canvas.width - pad * 2
      ? Math.max(pad, Math.min(canvas.width - width - pad, x))
      : x;
  const clampedY =
    height <= canvas.height - pad * 2
      ? Math.max(pad, Math.min(canvas.height - height - pad, y))
      : y;
  return { x: clampedX, y: clampedY };
}

export function sampleActionAddons(params: SampleActionAddonsParams): SampledAddon[] {
  const progress = clamp01(params.progress);
  const pose = params.pose;
  const unit = inferScale(pose);
  const facing = inferFacing(pose);
  const dir = facing < 0 ? -1 : 1;
  const stageRootX = params.originX ?? params.poseAtProgress?.(0).x ?? pose.x;

  // Track which overrides explicitly supplied `color` so `themeAccentColor` applies cleanly to brand-accent defaults.
  const explicitColorIds = new Set<string>();
  const explicitColorTypes = new Set<AddonType>();
  for (const ov of params.addons ?? []) {
    if (ov.color !== undefined) {
      if (ov.id !== undefined) explicitColorIds.add(ov.id);
      else explicitColorTypes.add(ov.type);
    }
  }

  const configs = mergeActionConfigs(params.action, params.addons, params.mergeDefaults ?? true);
  if (configs.length === 0) return [];

  const prevStageIds = extractStagePropIds(params.previousAction);
  for (const id of toStringSet(params.persistedStageIds?.fromPrevious)) prevStageIds.add(id);

  const nextStageIds = extractStagePropIds(params.nextAction);
  for (const id of toStringSet(params.persistedStageIds?.toNext)) nextStageIds.add(id);

  // First pass: compute base stage positions so projectiles targeting "hoop" / "goal" hit the exact laid-out target.
  const stageBoxes = new Map<string, { type: AddonType; x: number; y: number; width: number; height: number }>();
  for (const cfg of configs) {
    const def = PROP_DEFINITIONS[cfg.type];
    const id = cfg.id ?? cfg.type;
    const socket = cfg.socket ?? def.socket;
    if (socket !== "stage") continue;
    const wLocal = cfg.width ?? def.defaultSize.w;
    const hLocal = cfg.height ?? def.defaultSize.h;
    const width = wLocal * unit;
    const height = hLocal * unit;
    const keys = interpolateKeyframes(cfg.keyframes, progress);
    const xLocal = (cfg.x ?? 0) + (cfg.dx ?? 0) + keys.x;
    const yLocal = (cfg.y ?? 0) + (cfg.dy ?? 0) + keys.y;
    const rawX = dir >= 0 ? stageRootX + xLocal * unit : stageRootX - xLocal * unit - width;
    const rawY = pose.groundY - (yLocal + hLocal) * unit;
    const clamped = clampStageBoxToCanvas(rawX, rawY, width, height, params.canvas);
    stageBoxes.set(id, { type: cfg.type, x: clamped.x, y: clamped.y, width, height });
  }

  const sampled: SampledAddon[] = [];

  for (const cfg of configs) {
    const def = PROP_DEFINITIONS[cfg.type];
    const id = cfg.id ?? cfg.type;
    const socket = cfg.socket ?? def.socket;
    const isStage = socket === "stage";
    const persistedIn = isStage && prevStageIds.has(id);
    const persistedOut = Boolean(params.persist || cfg.persist || (isStage && nextStageIds.has(id)));

    const slideDistanceX = params.canvas ? Math.max(120 * unit, params.canvas.width * 0.35) : 200 * unit;
    const slideDistanceY = params.canvas ? Math.max(100 * unit, params.canvas.height * 0.35) : 160 * unit;

    const life = addonLifecycleState(
      {
        ...(persistedIn ? { enter: "instant", enterAt: 0 } : cfg.enter !== undefined ? { enter: cfg.enter } : {}),
        ...(cfg.enterAt !== undefined && !persistedIn ? { enterAt: cfg.enterAt } : {}),
        ...(cfg.enterDuration !== undefined && !persistedIn ? { enterDuration: cfg.enterDuration } : {}),
        ...(cfg.slideFrom !== undefined ? { slideFrom: cfg.slideFrom } : {}),
        ...(persistedOut ? { exit: "persist", persist: true } : cfg.exit !== undefined ? { exit: cfg.exit } : {}),
        ...(cfg.exitAt !== undefined && !persistedOut ? { exitAt: cfg.exitAt } : {}),
        ...(cfg.exitDuration !== undefined && !persistedOut ? { exitDuration: cfg.exitDuration } : {}),
        persist: persistedOut
      },
      progress,
      { rootX: stageRootX, groundY: pose.groundY, scale: unit, slideDistanceX, slideDistanceY }
    );

    if (!life.visible) continue;

    const wLocal = cfg.width ?? def.defaultSize.w;
    const hLocal = cfg.height ?? def.defaultSize.h;
    const width = wLocal * unit;
    const height = hLocal * unit;
    const keys = interpolateKeyframes(cfg.keyframes, progress);

    const placeOnSocket = (targetPose: AddonPoseSnapshot): { x: number; y: number; rot: number } => {
      const targetUnit = inferScale(targetPose);
      const pt = resolveSocketPoint(targetPose, socket, targetUnit);
      const dx = ((cfg.dx ?? 0) + (isStage ? 0 : cfg.x ?? 0) + keys.x) * targetUnit * (pt.facing < 0 ? -1 : 1);
      const dy = ((cfg.dy ?? 0) + (isStage ? 0 : cfg.y ?? 0) + keys.y) * targetUnit;
      let px = pt.x - width / 2 + dx;
      let py = pt.y - height / 2 - dy;
      if (socket === "aboveHead") {
        py = pt.y - height - (10 * targetUnit + dy);
      } else if (cfg.type === "sign" && (socket === "rHand" || socket === "lHand" || socket === "bothHands")) {
        const stickLen = height * 1.02;
        const gripOffset = height * 0.25;
        py = pt.y - (height + stickLen - gripOffset) - dy;
      }
      const baseRot = autoAlignsWithLimb(cfg.type, socket) ? pt.angleDeg : 0;
      return { x: px, y: py, rot: baseRot };
    };

    let x = 0;
    let y = 0;
    let limbRot = 0;

    if (isStage) {
      const box = stageBoxes.get(id)!;
      x = box.x;
      y = box.y;
    } else {
      const attachFrom = cfg.attachWindow?.from ?? 0;
      const attachUntil = cfg.attachWindow?.until ?? 1;
      if (progress <= attachUntil + 1e-9 && progress >= attachFrom - 1e-9) {
        const placed = placeOnSocket(pose);
        x = placed.x;
        y = placed.y;
        limbRot = placed.rot;
      } else if (progress < attachFrom - 1e-9 && cfg.attachWindow?.pinOnRelease) {
        if (params.poseAtProgress) {
          const placed = placeOnSocket(params.poseAtProgress(attachFrom));
          x = placed.x;
          y = placed.y;
        } else {
          const placed = placeOnSocket(pose);
          x = placed.x;
          y = (cfg.dy ?? 0) < -8 ? pose.groundY - height : placed.y;
        }
      } else if (progress > attachUntil && cfg.attachWindow?.pinOnRelease) {
        if (params.poseAtProgress) {
          const placed = placeOnSocket(params.poseAtProgress(attachUntil));
          x = placed.x;
          y = placed.y;
        } else if (cfg.attachWindow.pinnedPoint) {
          const pin = cfg.attachWindow.pinnedPoint;
          x = stageRootX + dir * pin.x * unit - width / 2 + (cfg.dx ?? 0) * unit * dir;
          y = pose.groundY - pin.y * unit - height / 2 - (cfg.dy ?? 0) * unit;
        } else {
          const placed = placeOnSocket(pose);
          x = placed.x;
          y = placed.y;
        }
      } else {
        const placed = placeOnSocket(pose);
        x = placed.x;
        y = placed.y;
        limbRot = placed.rot;
      }
    }

    let flightRot = 0;
    if (cfg.flight && progress >= cfg.flight.from - 1e-9) {
      let startCenter: Point2D;
      if (isStage) {
        const box = stageBoxes.get(id)!;
        startCenter = { x: box.x + width / 2, y: box.y + height / 2 };
      } else if (params.poseAtProgress) {
        const releasePlaced = placeOnSocket(params.poseAtProgress(cfg.flight.from));
        startCenter = { x: releasePlaced.x + width / 2, y: releasePlaced.y + height / 2 };
      } else if (cfg.flight.releaseOffset) {
        startCenter = {
          x: stageRootX + dir * cfg.flight.releaseOffset.x * unit,
          y: pose.groundY - cfg.flight.releaseOffset.y * unit
        };
      } else {
        startCenter = { x: x + width / 2, y: y + height / 2 };
      }

      let endCenter: Point2D;
      if (typeof cfg.flight.target === "string") {
        const targetBox = stageBoxes.get(cfg.flight.target);
        endCenter = targetBox
          ? targetSweetSpot(targetBox)
          : { x: startCenter.x + dir * 150 * unit, y: pose.groundY - height / 2 };
      } else if (cfg.flight.target) {
        endCenter = {
          x: stageRootX + dir * cfg.flight.target.x * unit,
          y: pose.groundY - cfg.flight.target.y * unit
        };
      } else {
        endCenter = { x: startCenter.x + dir * 120 * unit, y: pose.groundY - height / 2 };
      }

      const fp = computeAddonFlightPoint(startCenter, endCenter, cfg.flight, Math.min(progress, cfg.flight.to), unit);
      x = fp.x - width / 2;
      y = fp.y - height / 2;
      flightRot = fp.rotation;
      limbRot = 0;

      if (progress > cfg.flight.to) {
        const dropEnd = cfg.flight.dropToGroundAt;
        if (dropEnd !== undefined && dropEnd > cfg.flight.to) {
          const dropT = clamp01((progress - cfg.flight.to) / (dropEnd - cfg.flight.to));
          const easedDrop = dropT * dropT;
          y = lerp(endCenter.y - height / 2, pose.groundY - height, easedDrop);
          flightRot = round3((cfg.flight.spin ?? 0) + 180 * dropT);
        } else if (!cfg.flight.target) {
          y = pose.groundY - height;
        }
      }
    }

    x += life.dx;
    y += life.dy;

    const rotation = round3((cfg.rotation ?? 0) + limbRot + keys.rotation + flightRot + life.rotation);
    const scale = round3((cfg.scale ?? 1) * keys.scale * life.scale);
    const opacity = round3(clamp01((cfg.opacity ?? 1) * keys.opacity * life.opacity));
    if (opacity <= 0.001 || scale <= 0.001) continue;

    const hasExplicitColor = explicitColorIds.has(id) || explicitColorTypes.has(cfg.type);
    const baseColor = resolveColor(cfg, def, params.themeAccentColor);
    const color =
      !hasExplicitColor && params.themeAccentColor && baseColor.toLowerCase() === BRAND_ACCENT_HEX
        ? params.themeAccentColor
        : baseColor;

    const secondaryColor =
      cfg.secondaryColor ?? (cfg.type === "board" && params.themeAccentColor ? params.themeAccentColor : undefined);

    const openVal = keys.open ?? cfg.open;
    const inkVal = keys.ink ?? cfg.ink;

    let netBulgeVal = keys.netBulge ?? cfg.netBulge;
    if (cfg.impact) {
      const dur = Math.max(1e-6, cfg.impact.duration ?? 0.1);
      if (progress >= cfg.impact.at && progress <= cfg.impact.at + dur) {
        const localT = clamp01((progress - cfg.impact.at) / dur);
        netBulgeVal = Math.sin(localT * Math.PI) * (cfg.impact.peakBulge ?? 1);
      } else if (netBulgeVal === undefined) {
        netBulgeVal = 0;
      }
    }

    const layer: "back" | "front" = cfg.layer ?? (isStage ? "back" : "front");

    const item: SampledAddon = {
      id,
      type: cfg.type,
      ...(cfg.actorId !== undefined
        ? { actorId: cfg.actorId }
        : params.actorId !== undefined
          ? { actorId: params.actorId }
          : {}),
      layer,
      x: round3(x),
      y: round3(y),
      width: round3(width),
      height: round3(height),
      rotation,
      scale,
      opacity,
      color,
      ...(secondaryColor !== undefined ? { secondaryColor } : {}),
      ...(life.puff ? { puff: true } : {}),
      ...(openVal !== undefined ? { open: round3(clamp01(openVal)) } : {}),
      ...(cfg.hinge !== undefined ? { hinge: cfg.hinge } : {}),
      ...(inkVal !== undefined ? { ink: round3(clamp01(inkVal)) } : {}),
      ...(netBulgeVal !== undefined ? { netBulge: round3(Math.max(0, netBulgeVal)) } : {}),
      ...(cfg.text !== undefined ? { text: cfg.text } : {})
    };

    sampled.push(item);
  }

  return sampled;
}

export interface RenderAddonSvgOptions {
  strokeWidth?: number;
  themeColor?: string;
  blueprint?: boolean;
  hatchPatternId?: string;
}

export interface BlueprintDefsOptions {
  gridPatternId?: string;
  hatchPatternId?: string;
}

export function renderBlueprintPatternsSvg(options: BlueprintDefsOptions = {}): string {
  const gridId = escapeXml(options.gridPatternId ?? "sm-bp-grid");
  const hatchId = escapeXml(options.hatchPatternId ?? "sm-bp-hatch");
  return (
    `<pattern id="${gridId}" width="24" height="24" patternUnits="userSpaceOnUse">` +
    `<path d="M24 0H0V24" fill="none" stroke="#e2e8f0" stroke-width="0.75"/>` +
    `</pattern>` +
    `<pattern id="${hatchId}" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">` +
    `<rect width="6" height="6" fill="#f8fafc"/>` +
    `<line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" stroke-width="1"/>` +
    `</pattern>`
  );
}

export function renderBlueprintDefsSvg(options: BlueprintDefsOptions = {}): string {
  return `<defs>${renderBlueprintPatternsSvg(options)}</defs>`;
}

function partialPolylinePath(points: readonly Point2D[], amount: number): string {
  const t = clamp01(amount);
  if (t <= 0 || points.length < 2) return "";
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(d);
    total += d;
  }
  if (total <= 1e-6) return "";
  let remaining = total * t;
  const first = points[0]!;
  let d = `M${formatSvgNumber(first.x)} ${formatSvgNumber(first.y)}`;
  for (let i = 0; i < lengths.length; i++) {
    const segLen = lengths[i]!;
    const a = points[i]!;
    const b = points[i + 1]!;
    if (remaining >= segLen - 1e-9) {
      d += `L${formatSvgNumber(b.x)} ${formatSvgNumber(b.y)}`;
      remaining -= segLen;
    } else {
      const u = segLen <= 1e-9 ? 0 : remaining / segLen;
      d += `L${formatSvgNumber(a.x + (b.x - a.x) * u)} ${formatSvgNumber(a.y + (b.y - a.y) * u)}`;
      break;
    }
  }
  return d;
}

function renderBoardInkSvg(addon: SampledAddon, strokeWidth: number, inkColor: string): string {
  const ink = clamp01(addon.ink ?? 0);
  if (ink <= 0) return "";
  const x = addon.x;
  const y = addon.y;
  const w = addon.width;
  const bh = addon.height * 0.62;
  const sx = (v: number): number => x + w * (v + 0.24);
  const sy = (v: number): number => y + bh * v;
  const strokes: readonly (readonly Point2D[])[] = [
    [{ x: sx(0), y: sy(0.62) }, { x: sx(0.1), y: sy(0.2) }, { x: sx(0.2), y: sy(0.62) }],
    [{ x: sx(0.05), y: sy(0.43) }, { x: sx(0.16), y: sy(0.43) }],
    [{ x: sx(0.26), y: sy(0.22) }, { x: sx(0.39), y: sy(0.22) }],
    [{ x: sx(0.325), y: sy(0.22) }, { x: sx(0.325), y: sy(0.62) }],
    [{ x: sx(0.26), y: sy(0.62) }, { x: sx(0.41), y: sy(0.62) }],
    [{ x: sx(0), y: sy(0.72) }, { x: sx(0.38), y: sy(0.72) }],
    [{ x: sx(0.42), y: sy(0.58) }, { x: sx(0.47), y: sy(0.68) }, { x: sx(0.55), y: sy(0.48) }]
  ];
  const ranges = [0.28, 0.1, 0.13, 0.12, 0.1, 0.13, 0.14] as const;
  let used = 0;
  const parts: string[] = [];
  const sw = formatSvgNumber(Math.max(1, strokeWidth * 0.58));
  const escapedInk = escapeXml(inkColor);
  for (let i = 0; i < strokes.length; i++) {
    const range = ranges[i]!;
    const local = clamp01((ink - used) / range);
    if (local > 0) {
      const pathD = partialPolylinePath(strokes[i]!, local);
      if (pathD) {
        parts.push(
          `<path data-part="board-ink" d="${pathD}" fill="none" stroke="${escapedInk}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
        );
      }
    }
    used += range;
  }
  return parts.join("");
}

function renderPuffSvg(addon: SampledAddon, strokeColor: string): string {
  const cx = addon.x + addon.width / 2;
  const cy = addon.y + addon.height / 2;
  const r = Math.max(addon.width, addon.height) * 0.7;
  const rays: readonly [Point2D, Point2D][] = [
    [{ x: cx - r, y: cy }, { x: cx - r * 1.24, y: cy }],
    [{ x: cx + r, y: cy }, { x: cx + r * 1.24, y: cy }],
    [{ x: cx, y: cy - r }, { x: cx, y: cy - r * 1.24 }],
    [{ x: cx, y: cy + r }, { x: cx, y: cy + r * 1.24 }]
  ];
  return `<g data-part="puff" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="1.2" opacity="0.38" stroke-linecap="round">${rays
    .map(([a, b]) => `<path d="${linePath(a, b)}"/>`)
    .join("")}</g>`;
}

function renderCenteredLabelSvg(
  text: string | undefined,
  cx: number,
  cy: number,
  maxWidth: number,
  maxHeight: number,
  fillColor: string
): string {
  if (!text) return "";
  const trimmed = text.trim().slice(0, 80);
  if (!trimmed) return "";
  const fontSize = Math.max(4, Math.min(maxHeight * 0.46, maxWidth / Math.max(1.6, trimmed.length * 0.62)));
  return `<text x="${formatSvgNumber(cx)}" y="${formatSvgNumber(cy)}" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${formatSvgNumber(fontSize)}" fill="${escapeXml(fillColor)}" stroke="none">${escapeXml(trimmed)}</text>`;
}

function renderAddonGeometrySvg(addon: SampledAddon, strokeWidth: number, strokeColor: string): string {
  const n = formatSvgNumber;
  const x = addon.x;
  const y = addon.y;
  const w = addon.width;
  const h = addon.height;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sw = n(strokeWidth);
  const stroke = escapeXml(strokeColor);
  const fill = escapeXml(addon.color);
  const secondary = addon.secondaryColor ? escapeXml(addon.secondaryColor) : undefined;

  switch (addon.type) {
    case "bulb": {
      const glow = secondary ?? "#f59e0b";
      const bulbFill = addon.color.toLowerCase() === "#ffd43b" ? "#f59e0b" : fill;
      const innerFill = addon.color.toLowerCase() === "#f59e0b" ? (secondary ?? "#ffd43b") : fill;
      const glassR = w * 0.34;
      const glassCy = y + h * 0.36;
      const baseY = y + h * 0.66;
      const raySw = n(Math.max(1.2, strokeWidth * 0.72));
      const ray = (a: Point2D, b: Point2D): string =>
        `<path data-part="bulb-ray" d="${linePath(a, b)}" fill="none" stroke="${glow}" stroke-width="${raySw}" stroke-linecap="round"/>`;
      return (
        `<circle cx="${n(cx)}" cy="${n(glassCy)}" r="${n(glassR)}" fill="${bulbFill}"/>` +
        `<circle cx="${n(cx)}" cy="${n(glassCy)}" r="${n(glassR * 0.74)}" fill="${innerFill}" stroke="none"/>` +
        `<path d="M${n(cx - glassR * 0.5)} ${n(y + h * 0.52)}L${n(cx - w * 0.18)} ${n(baseY)}H${n(cx + w * 0.18)}L${n(cx + glassR * 0.5)} ${n(y + h * 0.52)}Z" fill="${bulbFill}"/>` +
        `<path data-part="bulb-filament" d="M${n(cx - w * 0.11)} ${n(baseY - h * 0.04)}L${n(cx - w * 0.07)} ${n(glassCy)}Q${n(cx)} ${n(glassCy - h * 0.1)} ${n(cx + w * 0.07)} ${n(glassCy)}L${n(cx + w * 0.11)} ${n(baseY - h * 0.04)}" fill="none" stroke="${stroke}" stroke-width="${n(strokeWidth * 0.55)}"/>` +
        `<path d="${linePath({ x: cx - w * 0.18, y: baseY }, { x: cx + w * 0.18, y: baseY })}" stroke="#4a4f57"/>` +
        `<path d="${linePath({ x: cx - w * 0.15, y: baseY + h * 0.1 }, { x: cx + w * 0.15, y: baseY + h * 0.1 })}" stroke="#4a4f57"/>` +
        `<path d="${linePath({ x: cx - w * 0.11, y: baseY + h * 0.19 }, { x: cx + w * 0.11, y: baseY + h * 0.19 })}" stroke="#4a4f57"/>` +
        ray({ x: cx, y: y - h * 0.06 }, { x: cx, y: y - h * 0.24 }) +
        ray({ x: x + w * 0.08, y: y + h * 0.14 }, { x: x - w * 0.1, y: y + h * 0.02 }) +
        ray({ x: x + w * 0.92, y: y + h * 0.14 }, { x: x + w * 1.1, y: y + h * 0.02 }) +
        ray({ x: x - w * 0.02, y: glassCy }, { x: x - w * 0.18, y: glassCy }) +
        ray({ x: x + w * 1.02, y: glassCy }, { x: x + w * 1.18, y: glassCy })
      );
    }

    case "card": {
      const label = renderCenteredLabelSvg(addon.text, cx, y + h * 0.62, w * 0.84, h * 0.65, strokeColor);
      const copyLines = label
        ? ""
        : `<path d="${linePath({ x: x + w * 0.16, y: y + h * 0.5 }, { x: x + w * 0.78, y: y + h * 0.5 })}" stroke="${stroke}" stroke-width="${n(strokeWidth * 0.48)}"/>` +
          `<path d="${linePath({ x: x + w * 0.16, y: y + h * 0.7 }, { x: x + w * 0.58, y: y + h * 0.7 })}" stroke="${stroke}" stroke-width="${n(strokeWidth * 0.48)}"/>`;
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="#ffffff"/>` +
        `<path d="${linePath({ x: x + w * 0.12, y: y + h * 0.22 }, { x: x + w * 0.88, y: y + h * 0.22 })}" stroke="${fill}" stroke-width="${n(strokeWidth * 0.85)}"/>` +
        copyLines +
        label
      );
    }

    case "board": {
      const bh = h * 0.62;
      const inkColor = addon.secondaryColor ?? strokeColor;
      const inkMarkup = renderBoardInkSvg(addon, strokeWidth, inkColor);
      const textLabel =
        addon.text && (addon.ink ?? 1) > 0.1
          ? renderCenteredLabelSvg(addon.text, cx, y + bh * 0.45, w * 0.82, bh * 0.5, inkColor)
          : "";
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(bh)}" rx="2" fill="${fill}"/>` +
        inkMarkup +
        textLabel +
        `<path d="${linePath({ x: x + w * 0.2, y: y + bh }, { x: x + w * 0.12, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.8, y: y + bh }, { x: x + w * 0.88, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.16, y: y + bh + strokeWidth * 0.9 }, { x: x + w * 0.84, y: y + bh + strokeWidth * 0.9 })}" fill="none"/>`
      );
    }

    case "door": {
      const g = doorGeometry(addon, strokeWidth);
      if (addon.layer === "front") {
        const postX = g.hingeLeft ? g.x : g.x + g.width;
        return (
          `<rect data-part="door-frame" x="${n(g.x)}" y="${n(g.y)}" width="${n(g.width)}" height="${n(g.height)}" rx="2" fill="none" stroke="${stroke}" stroke-width="${sw}"/>` +
          `<path data-part="door-post" d="${linePath({ x: postX, y: g.y }, { x: postX, y: g.y + g.height })}" fill="none" stroke="${stroke}" stroke-width="${n(strokeWidth * 1.25)}"/>`
        );
      }
      const opening =
        g.open > 0.02
          ? `<rect data-part="door-opening" x="${n(g.x)}" y="${n(g.y)}" width="${n(g.width)}" height="${n(g.height)}" fill="#4a4f57" opacity="0.85" stroke="none"/>`
          : "";
      const leaf = `<path data-part="door-leaf" d="M${n(g.nearTop.x)} ${n(g.nearTop.y)}L${n(g.farTop.x)} ${n(g.farTop.y)}L${n(g.farBottom.x)} ${n(g.farBottom.y)}L${n(g.nearBottom.x)} ${n(g.nearBottom.y)}Z" fill="#ffffff" stroke="${stroke}" stroke-width="${sw}"/>`;
      const hinge = `<path data-part="door-hinge" d="${linePath(g.nearTop, g.nearBottom)}" fill="none" stroke="${stroke}" stroke-width="${n(strokeWidth * 1.15)}"/>`;
      const handle = `<circle data-part="door-handle" cx="${n(g.handleX)}" cy="${n(g.handleY)}" r="${n(Math.max(2, strokeWidth * 0.95))}" fill="#ffffff" stroke="${stroke}" stroke-width="${sw}"/>`;
      return `${opening}${leaf}${hinge}${handle}`;
    }

    case "desk": {
      const top = y + h * 0.42;
      const mw = w * 0.54;
      const mh = h * 0.44;
      const mx = x + w * 0.4;
      const my = top - h * 0.1 - mh;
      const accent = secondary ?? "#0078d4";
      return (
        `<path d="${linePath({ x, y: top }, { x: x + w, y: top })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.08, y: top }, { x: x + w * 0.08, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.92, y: top }, { x: x + w * 0.92, y: y + h })}" fill="none"/>` +
        `<rect data-part="desk-monitor" x="${n(mx)}" y="${n(my)}" width="${n(mw)}" height="${n(mh)}" rx="2" fill="#ffffff"/>` +
        `<path d="${linePath({ x: mx + mw / 2, y: my + mh }, { x: mx + mw / 2, y: top })}" fill="none"/>` +
        `<path d="${linePath({ x: mx + mw * 0.16, y: my + mh * 0.32 }, { x: mx + mw * 0.72, y: my + mh * 0.32 })}" stroke="${accent}" stroke-width="${n(strokeWidth * 0.5)}"/>` +
        `<path d="${linePath({ x: mx + mw * 0.16, y: my + mh * 0.56 }, { x: mx + mw * 0.56, y: my + mh * 0.56 })}" stroke-width="${n(strokeWidth * 0.48)}"/>` +
        `<path data-part="desk-keyboard" d="${linePath({ x: x + w * 0.06, y: top - strokeWidth * 0.95 }, { x: x + w * 0.36, y: top - strokeWidth * 0.95 })}" fill="none"/>`
      );
    }

    case "chair": {
      const seatY = y + h * 0.58;
      return (
        `<path d="M${n(x + w * 0.2)} ${n(y)}L${n(x + w * 0.2)} ${n(seatY)}L${n(x + w * 0.82)} ${n(seatY)}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.28, y: seatY }, { x: x + w * 0.18, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.76, y: seatY }, { x: x + w * 0.88, y: y + h })}" fill="none"/>`
      );
    }

    case "bench": {
      const seatY = y + h * 0.56;
      const backY = y + h * 0.18;
      return (
        `<rect x="${n(x + w * 0.06)}" y="${n(backY)}" width="${n(w * 0.88)}" height="${n(h * 0.16)}" rx="2" fill="${fill}"/>` +
        `<rect x="${n(x)}" y="${n(seatY)}" width="${n(w)}" height="${n(h * 0.14)}" rx="2" fill="${fill}"/>` +
        `<path d="${linePath({ x: x + w * 0.16, y: backY + h * 0.16 }, { x: x + w * 0.16, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.84, y: backY + h * 0.16 }, { x: x + w * 0.84, y: y + h })}" fill="none"/>`
      );
    }

    case "basketball": {
      const r = Math.min(w, h) / 2;
      return (
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>` +
        `<path d="${linePath({ x: cx - r, y: cy }, { x: cx + r, y: cy })}" fill="none"/>` +
        `<path d="${linePath({ x: cx, y: cy - r }, { x: cx, y: cy + r })}" fill="none"/>` +
        `<path d="M${n(cx - r * 0.72)} ${n(cy - r * 0.7)}Q${n(cx)} ${n(cy)} ${n(cx - r * 0.72)} ${n(cy + r * 0.7)}" fill="none"/>` +
        `<path d="M${n(cx + r * 0.72)} ${n(cy - r * 0.7)}Q${n(cx)} ${n(cy)} ${n(cx + r * 0.72)} ${n(cy + r * 0.7)}" fill="none"/>`
      );
    }

    case "hoop": {
      const bulge = clamp01(addon.netBulge ?? 0);
      const rimY = y + h * 0.48 + bulge * h * 0.04;
      const rimLeft = x + w * 0.48;
      const rimRight = x + w * 0.92;
      const rimMid = (rimLeft + rimRight) / 2;
      const netBotY = y + h * (0.82 + bulge * 0.12);
      const flare = bulge * w * 0.1;
      return (
        `<rect data-part="backboard" x="${n(x)}" y="${n(y)}" width="${n(w * 0.48)}" height="${n(h * 0.56)}" rx="2" fill="#ffffff"/>` +
        `<rect x="${n(x + w * 0.18)}" y="${n(y + h * 0.24)}" width="${n(w * 0.22)}" height="${n(h * 0.2)}" fill="none" stroke="${fill}" stroke-width="${n(strokeWidth * 0.5)}"/>` +
        `<path data-part="hoop-net" d="M${n(rimLeft + w * 0.03)} ${n(rimY)}Q${n(rimLeft - flare)} ${n((rimY + netBotY) / 2)} ${n(rimMid - w * 0.1 - flare * 0.4)} ${n(netBotY)}M${n(rimRight - w * 0.03)} ${n(rimY)}Q${n(rimRight + flare)} ${n((rimY + netBotY) / 2)} ${n(rimMid + w * 0.1 + flare * 0.4)} ${n(netBotY)}M${n(rimLeft + w * 0.06)} ${n((rimY + netBotY) / 2)}L${n(rimRight - w * 0.06)} ${n((rimY + netBotY) / 2 + bulge * 2)}" fill="none" stroke="#9aa0a6" stroke-width="${n(strokeWidth * 0.48)}"/>` +
        `<path data-part="hoop-rim" d="${linePath({ x: rimLeft, y: rimY }, { x: rimRight, y: rimY })}" fill="none" stroke="${fill}" stroke-width="${n(strokeWidth * 1.18)}"/>`
      );
    }

    case "football": {
      const r = Math.min(w, h) / 2;
      const patch = `M${n(cx)} ${n(cy - r * 0.38)}L${n(cx + r * 0.36)} ${n(cy - r * 0.12)}L${n(cx + r * 0.22)} ${n(cy + r * 0.32)}L${n(cx - r * 0.22)} ${n(cy + r * 0.32)}L${n(cx - r * 0.36)} ${n(cy - r * 0.12)}Z`;
      return (
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>` +
        `<path d="${patch}" fill="${stroke}"/>` +
        `<path d="${linePath({ x: cx - r * 0.82, y: cy - r * 0.16 }, { x: cx - r * 0.36, y: cy - r * 0.12 })}" fill="none"/>` +
        `<path d="${linePath({ x: cx + r * 0.36, y: cy - r * 0.12 }, { x: cx + r * 0.82, y: cy - r * 0.16 })}" fill="none"/>`
      );
    }

    case "goal": {
      const bulge = clamp01(addon.netBulge ?? 0);
      const bulgeDx = bulge * w * 0.16;
      const topY = y + h * 0.14;
      const netSw = n(strokeWidth * 0.42);
      const vCols = [0.33, 0.66]
        .map((t) => {
          const gx = x + w * t;
          return `<path d="M${n(gx)} ${n(topY)}Q${n(gx + bulgeDx)} ${n((topY + y + h) / 2)} ${n(gx)} ${n(y + h)}" fill="none" stroke="#9aa0a6" stroke-width="${netSw}"/>`;
        })
        .join("");
      const hRows = [0.42, 0.72]
        .map((t) => {
          const gy = y + h * t;
          return `<path d="M${n(x)} ${n(gy)}Q${n(cx + bulgeDx)} ${n(gy - bulge * h * 0.04)} ${n(x + w + bulgeDx * 0.5)} ${n(gy)}" fill="none" stroke="#9aa0a6" stroke-width="${netSw}"/>`;
        })
        .join("");
      const backStay = `<path data-part="goal-net-back" d="M${n(x + w)} ${n(topY)}Q${n(x + w + bulgeDx * 1.25)} ${n((topY + y + h) / 2)} ${n(x + w)} ${n(y + h)}" fill="none" stroke="#9aa0a6" stroke-width="${n(strokeWidth * 0.55)}"/>`;
      return (
        `<g data-part="goal-net">${vCols}${hRows}${backStay}</g>` +
        `<path data-part="goal-frame" d="M${n(x)} ${n(y + h)}V${n(topY)}H${n(x + w)}V${n(y + h)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`
      );
    }

    case "ball": {
      const r = Math.min(w, h) / 2;
      const seamColor = secondary ?? "#c62828";
      return (
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>` +
        `<path d="M${n(cx - r * 0.36)} ${n(cy - r * 0.78)}Q${n(cx - r * 0.68)} ${n(cy)} ${n(cx - r * 0.36)} ${n(cy + r * 0.78)}" fill="none" stroke="${seamColor}" stroke-width="${n(strokeWidth * 0.45)}"/>` +
        `<path d="M${n(cx + r * 0.36)} ${n(cy - r * 0.78)}Q${n(cx + r * 0.68)} ${n(cy)} ${n(cx + r * 0.36)} ${n(cy + r * 0.78)}" fill="none" stroke="${seamColor}" stroke-width="${n(strokeWidth * 0.45)}"/>`
      );
    }

    case "hurdle": {
      const barH = h * 0.22;
      const stripeFill = secondary ?? "#ffffff";
      return (
        `<path d="${linePath({ x: x + w * 0.14, y: y + barH }, { x: x + w * 0.14, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.86, y: y + barH }, { x: x + w * 0.86, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.04, y: y + h }, { x: x + w * 0.3, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.7, y: y + h }, { x: x + w * 0.96, y: y + h })}" fill="none"/>` +
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(barH)}" rx="2" fill="${stripeFill}"/>` +
        `<rect x="${n(x + w * 0.2)}" y="${n(y)}" width="${n(w * 0.22)}" height="${n(barH)}" fill="${fill}" stroke="none"/>` +
        `<rect x="${n(x + w * 0.6)}" y="${n(y)}" width="${n(w * 0.22)}" height="${n(barH)}" fill="${fill}" stroke="none"/>` +
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(barH)}" rx="2" fill="none"/>`
      );
    }

    case "phone": {
      const rx = Math.min(w * 0.22, h * 0.14);
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}" fill="${fill}" stroke-width="${n(strokeWidth * 0.55)}"/>` +
        `<rect x="${n(x + w * 0.16)}" y="${n(y + h * 0.15)}" width="${n(w * 0.68)}" height="${n(h * 0.68)}" rx="${n(rx * 0.45)}" fill="#dfe5ee" stroke="none"/>` +
        `<circle cx="${n(cx)}" cy="${n(y + h * 0.91)}" r="${n(Math.max(0.5, w * 0.08))}" fill="#dfe5ee" stroke="none"/>`
      );
    }

    case "sign": {
      const stickLen = h * 1.02;
      const label = renderCenteredLabelSvg(addon.text, cx, y + h * 0.52, w * 0.84, h * 0.72, strokeColor);
      const fallbackLines = label
        ? ""
        : `<path d="${linePath({ x: x + w * 0.18, y: y + h * 0.42 }, { x: x + w * 0.82, y: y + h * 0.42 })}" stroke="${stroke}" stroke-width="${n(strokeWidth * 0.6)}"/>` +
          `<path d="${linePath({ x: x + w * 0.28, y: y + h * 0.66 }, { x: x + w * 0.72, y: y + h * 0.66 })}" stroke="${stroke}" stroke-width="${n(strokeWidth * 0.45)}"/>`;
      return (
        `<path data-part="sign-stick" d="${linePath({ x: cx, y: y + h }, { x: cx, y: y + h + stickLen })}" fill="none" stroke="#8b5a2b" stroke-width="${n(Math.max(strokeWidth * 0.85, w * 0.06))}"/>` +
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="3" fill="${fill}"/>` +
        fallbackLines +
        label
      );
    }

    case "banner": {
      const label = renderCenteredLabelSvg(addon.text, cx, y + h * 0.58, w * 0.84, h * 0.68, strokeColor);
      const fallbackLines = label
        ? ""
        : `<path d="${linePath({ x: x + w * 0.14, y: y + h * 0.48 }, { x: x + w * 0.86, y: y + h * 0.48 })}" stroke="${fill}" stroke-width="${n(strokeWidth * 0.75)}"/>` +
          `<path d="${linePath({ x: x + w * 0.22, y: y + h * 0.72 }, { x: x + w * 0.72, y: y + h * 0.72 })}" stroke="${stroke}" stroke-width="${n(strokeWidth * 0.48)}"/>`;
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="#ffffff"/>` +
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h * 0.2)}" rx="1" fill="${fill}" stroke="none"/>` +
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="none"/>` +
        fallbackLines +
        label
      );
    }

    case "glove":
    case "gloves": {
      const cuffFill = secondary ?? "#ffffff";
      return (
        `<rect x="${n(x)}" y="${n(cy - h * 0.34)}" width="${n(w * 0.32)}" height="${n(h * 0.68)}" rx="${n(h * 0.14)}" fill="${cuffFill}"/>` +
        `<rect x="${n(x + w * 0.24)}" y="${n(y)}" width="${n(w * 0.76)}" height="${n(h)}" rx="${n(h * 0.44)}" fill="${fill}"/>` +
        `<path d="${linePath({ x: x + w * 0.54, y: y + h * 0.24 }, { x: x + w * 0.52, y: y + h * 0.62 })}" fill="none" stroke="${cuffFill}" stroke-width="${n(strokeWidth * 0.45)}"/>`
      );
    }

    case "watch": {
      const r = Math.min(w, h) * 0.34;
      return (
        `<path d="${linePath({ x: cx, y }, { x: cx, y: y + h })}" fill="none" stroke="${stroke}" stroke-width="${n(strokeWidth * 1.15)}"/>` +
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>` +
        `<path d="${linePath({ x: cx, y: cy }, { x: cx, y: cy - r * 0.6 })}" fill="none" stroke-width="${n(strokeWidth * 0.45)}"/>` +
        `<path d="${linePath({ x: cx, y: cy }, { x: cx + r * 0.52, y: cy + r * 0.12 })}" fill="none" stroke-width="${n(strokeWidth * 0.45)}"/>`
      );
    }

    case "binoculars": {
      const barrelW = w * 0.34;
      const barrelH = h * 0.68;
      const gap = w * 0.12;
      const leftX = cx - gap / 2 - barrelW;
      const rightX = cx + gap / 2;
      const by = cy - barrelH / 2;
      const lensR = barrelH * 0.4;
      return (
        `<path d="M${n(cx - w * 0.36)} ${n(cy + h * 0.16)}Q${n(cx)} ${n(cy + h * 0.74)} ${n(cx + w * 0.36)} ${n(cy + h * 0.16)}" fill="none" stroke-width="${n(strokeWidth * 0.45)}"/>` +
        `<rect x="${n(leftX)}" y="${n(by)}" width="${n(barrelW)}" height="${n(barrelH)}" rx="${n(barrelH * 0.25)}" fill="#ffffff"/>` +
        `<rect x="${n(rightX)}" y="${n(by)}" width="${n(barrelW)}" height="${n(barrelH)}" rx="${n(barrelH * 0.25)}" fill="#ffffff"/>` +
        `<circle cx="${n(leftX + barrelW * 0.76)}" cy="${n(cy)}" r="${n(lensR)}" fill="#dfe5ee"/>` +
        `<circle cx="${n(rightX + barrelW * 0.76)}" cy="${n(cy)}" r="${n(lensR)}" fill="#dfe5ee"/>` +
        `<path d="${linePath({ x: leftX + barrelW, y: cy }, { x: rightX, y: cy })}" fill="none"/>`
      );
    }

    case "glasses": {
      const r = Math.min(w * 0.22, h * 0.38);
      const c1x = cx - w * 0.2;
      const c2x = cx + w * 0.2;
      return (
        `<circle cx="${n(c1x)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke-width="${n(strokeWidth * 0.72)}"/>` +
        `<circle cx="${n(c2x)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke-width="${n(strokeWidth * 0.72)}"/>` +
        `<path d="${linePath({ x: c1x + r, y: cy }, { x: c2x - r, y: cy })}" fill="none" stroke-width="${n(strokeWidth * 0.72)}"/>` +
        `<path d="${linePath({ x, y: cy + h * 0.08 }, { x: c1x - r, y: cy })}" fill="none" stroke-width="${n(strokeWidth * 0.72)}"/>`
      );
    }

    case "ladder": {
      const rungs = 7;
      const rungPaths = Array.from({ length: rungs }, (_, i) => {
        const ry = y + (h * (i + 1)) / (rungs + 1);
        return `<path d="${linePath({ x: x + w * 0.16, y: ry }, { x: x + w * 0.84, y: ry })}" fill="none"/>`;
      }).join("");
      return (
        `<path d="${linePath({ x: x + w * 0.14, y }, { x: x + w * 0.14, y: y + h })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.86, y }, { x: x + w * 0.86, y: y + h })}" fill="none"/>` +
        rungPaths
      );
    }

    case "stairs": {
      const steps = h / Math.max(1, w) <= 0.4 ? 1 : 3;
      if (addon.hinge === "left") {
        // Descending left-to-right profile for stairs-down.
        const segs = Array.from(
          { length: steps },
          (_, i) => `H${n(x + (w * (i + 1)) / steps)}V${n(y + (h * (i + 1)) / steps)}`
        ).join("");
        return `<path d="M${n(x)} ${n(y)}${segs}H${n(x)}Z" fill="#ffffff"/>`;
      }
      const segs = Array.from(
        { length: steps },
        (_, i) => `V${n(y + h * (1 - (i + 1) / steps))}H${n(x + (w * (i + 1)) / steps)}`
      ).join("");
      return `<path d="M${n(x)} ${n(y + h)}${segs}V${n(y + h)}Z" fill="#ffffff"/>`;
    }

    case "box": {
      const flapY = y + h * 0.24;
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="${fill}"/>` +
        `<path d="${linePath({ x, y: flapY }, { x: x + w, y: flapY })}" fill="none"/>` +
        `<rect x="${n(cx - w * 0.08)}" y="${n(y)}" width="${n(w * 0.16)}" height="${n(h * 0.42)}" fill="#e8c872" stroke="none" opacity="0.85"/>`
      );
    }

    case "crate": {
      const pad = Math.min(w, h) * 0.12;
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="${fill}"/>` +
        `<rect x="${n(x + pad)}" y="${n(y + pad)}" width="${n(w - pad * 2)}" height="${n(h - pad * 2)}" fill="none"/>` +
        `<path d="${linePath({ x: x + pad, y: y + pad }, { x: x + w - pad, y: y + h - pad })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w - pad, y: y + pad }, { x: x + pad, y: y + h - pad })}" fill="none"/>`
      );
    }

    case "pointer": {
      const tipColor = secondary ?? BRAND_ACCENT_HEX;
      return (
        `<path d="${linePath({ x, y: cy }, { x: x + w * 0.88, y: cy })}" fill="none" stroke="${fill}" stroke-width="${n(Math.max(1.8, h * 0.65))}"/>` +
        `<circle cx="${n(x + w * 0.92)}" cy="${n(cy)}" r="${n(Math.max(2, h * 0.6))}" fill="${tipColor}"/>`
      );
    }

    case "cone": {
      return (
        `<path d="M${n(cx)} ${n(y)}L${n(x + w * 0.88)} ${n(y + h * 0.88)}H${n(x + w * 0.12)}Z" fill="${fill}"/>` +
        `<path d="${linePath({ x: x + w * 0.26, y: y + h * 0.54 }, { x: x + w * 0.74, y: y + h * 0.54 })}" stroke="#ffffff" stroke-width="${n(strokeWidth * 0.85)}"/>` +
        `<path d="${linePath({ x, y: y + h }, { x: x + w, y: y + h })}" fill="none"/>`
      );
    }

    case "spear": {
      return (
        `<path d="${linePath({ x, y: cy }, { x: x + w * 0.82, y: cy })}" fill="none" stroke="${fill}" stroke-width="${n(strokeWidth * 0.8)}"/>` +
        `<path d="M${n(x + w * 0.82)} ${n(y + h * 0.15)}L${n(x + w)} ${n(cy)}L${n(x + w * 0.82)} ${n(y + h * 0.85)}Z" fill="#9aa0a6"/>`
      );
    }

    case "target": {
      const r = Math.min(w, h) / 2;
      return (
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>` +
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.66)}" fill="#ffffff"/>` +
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.34)}" fill="${fill}"/>`
      );
    }

    case "sand-pit": {
      const grains = [
        [0.18, 0.38],
        [0.36, 0.66],
        [0.54, 0.35],
        [0.72, 0.62],
        [0.86, 0.44]
      ]
        .map(
          ([gx, gy]) =>
            `<circle cx="${n(x + w * gx!)}" cy="${n(y + h * gy!)}" r="${n(Math.max(0.8, strokeWidth * 0.25))}" fill="#b89543" stroke="none"/>`
        )
        .join("");
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(3, h * 0.28))}" fill="${fill}"/>${grains}`;
    }

    case "sand-puff": {
      const puffs = [
        [0, 0, 0.22],
        [-0.3, -0.14, 0.16],
        [0.3, -0.12, 0.15],
        [-0.2, 0.22, 0.14],
        [0.22, 0.2, 0.15]
      ]
        .map(
          ([dx, dy, rr]) =>
            `<circle cx="${n(cx + w * dx!)}" cy="${n(cy + h * dy!)}" r="${n(Math.max(1.2, Math.min(w, h) * rr!))}" fill="${fill}" stroke="#b89543" stroke-width="${n(strokeWidth * 0.3)}"/>`
        )
        .join("");
      return puffs;
    }

    case "palm": {
      const palmW = w * 0.76;
      const palmH = h * 0.56;
      const px = cx - palmW / 2;
      const py = y + h * 0.4;
      const fingers = [-1.5, -0.5, 0.5, 1.5]
        .map((slot) => {
          const fw = palmW * 0.2;
          const fx = cx + slot * (fw + palmW * 0.04) - fw / 2;
          return `<rect x="${n(fx)}" y="${n(y)}" width="${n(fw)}" height="${n(h * 0.5)}" rx="${n(fw * 0.45)}" fill="${fill}"/>`;
        })
        .join("");
      return (
        `${fingers}` +
        `<rect x="${n(px)}" y="${n(py)}" width="${n(palmW)}" height="${n(palmH)}" rx="${n(palmW * 0.22)}" fill="${fill}"/>` +
        `<path d="${linePath({ x: px, y: py + palmH * 0.55 }, { x: x, y: py + palmH * 0.2 })}" fill="none" stroke-width="${n(strokeWidth * 1.2)}"/>`
      );
    }

    case "thumb": {
      const fistW = w * 0.74;
      const fistH = h * 0.66;
      const fx = cx - fistW * 0.35;
      const fy = y + h * 0.32;
      return (
        `<rect x="${n(fx - fistW * 0.24)}" y="${n(y)}" width="${n(fistW * 0.38)}" height="${n(h * 0.5)}" rx="${n(fistW * 0.18)}" fill="${fill}"/>` +
        `<rect x="${n(fx)}" y="${n(fy)}" width="${n(fistW)}" height="${n(fistH)}" rx="${n(fistW * 0.3)}" fill="${fill}"/>`
      );
    }

    case "bar": {
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="${fill}"/>` +
        `<circle cx="${n(x)}" cy="${n(cy)}" r="${n(h * 0.65)}" fill="${fill}"/>` +
        `<circle cx="${n(x + w)}" cy="${n(cy)}" r="${n(h * 0.65)}" fill="${fill}"/>`
      );
    }

    case "wall": {
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="#ffffff"/>` +
        `<path d="${linePath({ x: x + w * 0.18, y: y + h * 0.28 }, { x: x + w * 0.42, y: y + h * 0.28 })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.52, y: y + h * 0.54 }, { x: x + w * 0.8, y: y + h * 0.54 })}" fill="none"/>` +
        `<path d="${linePath({ x: x + w * 0.22, y: y + h * 0.78 }, { x: x + w * 0.48, y: y + h * 0.78 })}" fill="none"/>`
      );
    }

    case "platform":
    case "ledge": {
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="3" fill="#ffffff"/>`;
    }

    case "laptop": {
      const open = clamp01(addon.open ?? 0.9);
      const hingeY = y + h * 0.76;
      const lidTop = y + h * (0.72 - open * 0.68);
      const lid = `M${n(x + w * (0.08 + open * 0.05))} ${n(lidTop)}L${n(x + w * (0.92 - open * 0.05))} ${n(lidTop)}L${n(x + w * 0.92)} ${n(hingeY)}L${n(x + w * 0.08)} ${n(hingeY)}Z`;
      const screen = open > 0.05
        ? `<path data-part="laptop-screen" d="M${n(x + w * 0.18)} ${n(lidTop + h * open * 0.08)}L${n(x + w * 0.82)} ${n(lidTop + h * open * 0.08)}L${n(x + w * 0.84)} ${n(hingeY - h * open * 0.08)}L${n(x + w * 0.16)} ${n(hingeY - h * open * 0.08)}Z" fill="#c8ecf6"/>`
        : "";
      const base = `M${n(x + w * 0.08)} ${n(hingeY)}L${n(x + w * 0.92)} ${n(hingeY)}L${n(x + w)} ${n(y + h * 0.97)}L${n(x)} ${n(y + h * 0.97)}Z`;
      return (
        `<path data-part="laptop-base" d="${base}" fill="${fill}"/>` +
        `<path data-part="laptop-lid" d="${lid}" fill="${fill}"/>` +
        screen +
        `<path data-part="laptop-hinge" d="${linePath({ x: x + w * 0.08, y: hingeY }, { x: x + w * 0.92, y: hingeY })}" fill="none"/>`
      );
    }

    case "tablet": {
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(w, h) * 0.12)}" fill="${fill}"/>` +
        `<rect x="${n(x + w * 0.12)}" y="${n(y + h * 0.1)}" width="${n(w * 0.76)}" height="${n(h * 0.78)}" rx="${n(Math.min(w, h) * 0.04)}" fill="#c8ecf6"/>` +
        `<circle cx="${n(cx)}" cy="${n(y + h * 0.94)}" r="${n(Math.max(0.8, w * 0.04))}" fill="#ffffff"/>`
      );
    }

    case "magnifier": {
      const lensX = x + w * 0.4;
      const lensY = y + h * 0.3;
      const lensR = Math.min(w * 0.34, h * 0.25);
      return (
        `<path d="M${n(x + w * 0.52)} ${n(y + h * 0.51)}L${n(x + w * 0.64)} ${n(y + h * 0.46)}L${n(x + w * 0.94)} ${n(y + h * 0.92)}L${n(x + w * 0.8)} ${n(y + h)}Z" fill="${fill}"/>` +
        `<circle cx="${n(lensX)}" cy="${n(lensY)}" r="${n(lensR)}" fill="#bdeaf6" fill-opacity="0.35"/>` +
        `<circle cx="${n(lensX)}" cy="${n(lensY)}" r="${n(lensR)}" fill="none" stroke="${fill}" stroke-width="${n(Math.max(strokeWidth, lensR * 0.24))}"/>` +
        `<circle cx="${n(lensX)}" cy="${n(lensY)}" r="${n(lensR)}" fill="none"/>`
      );
    }

    case "notebook": {
      const inkAmount = clamp01(addon.ink ?? 0.5);
      const rules = [0.3, 0.46, 0.62, 0.78]
        .map((ry, idx) => {
          const rule = `<path d="${linePath({ x: x + w * 0.24, y: y + h * ry }, { x: x + w * 0.86, y: y + h * ry })}" stroke="#a6bbd8" stroke-width="${n(strokeWidth * 0.35)}"/>`;
          const t = clamp01(inkAmount * 4 - idx);
          const ink = t > 0
            ? `<path data-part="notebook-ink" d="${linePath({ x: x + w * 0.26, y: y + h * (ry - 0.02) }, { x: x + w * (0.26 + 0.52 * t), y: y + h * (ry - 0.02) })}" stroke="#334d87" stroke-width="${n(strokeWidth * 0.45)}"/>`
            : "";
          return rule + ink;
        })
        .join("");
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(w, h) * 0.06)}" fill="${fill}"/>` +
        `<rect x="${n(x + w * 0.16)}" y="${n(y + h * 0.06)}" width="${n(w * 0.78)}" height="${n(h * 0.88)}" rx="1" fill="#fff9ed"/>` +
        rules
      );
    }

    case "pen": {
      return (
        `<rect x="${n(x + w * 0.15)}" y="${n(y + h * 0.06)}" width="${n(w * 0.7)}" height="${n(h * 0.72)}" rx="1" fill="${fill}"/>` +
        `<path d="M${n(x + w * 0.15)} ${n(y + h * 0.78)}L${n(x + w * 0.85)} ${n(y + h * 0.78)}L${n(cx)} ${n(y + h)}Z" fill="#e3c591"/>`
      );
    }

    case "headphones": {
      return (
        `<path d="M${n(x + w * 0.1)} ${n(y + h * 0.6)}C${n(x + w * 0.05)} ${n(y - h * 0.08)} ${n(x + w * 0.95)} ${n(y - h * 0.08)} ${n(x + w * 0.9)} ${n(y + h * 0.6)}" fill="none" stroke="${fill}" stroke-width="${n(strokeWidth * 1.15)}"/>` +
        `<rect x="${n(x + w * 0.03)}" y="${n(y + h * 0.38)}" width="${n(w * 0.18)}" height="${n(h * 0.32)}" rx="${n(Math.min(w, h) * 0.06)}" fill="${fill}"/>` +
        `<rect x="${n(x + w * 0.79)}" y="${n(y + h * 0.38)}" width="${n(w * 0.18)}" height="${n(h * 0.32)}" rx="${n(Math.min(w, h) * 0.06)}" fill="${fill}"/>`
      );
    }

    case "detective-hat": {
      return (
        `<path d="M${n(x + w * 0.18)} ${n(y + h * 0.72)}Q${n(x + w * 0.22)} ${n(y + h * 0.06)} ${n(cx)} ${n(y + h * 0.14)}Q${n(x + w * 0.78)} ${n(y + h * 0.06)} ${n(x + w * 0.82)} ${n(y + h * 0.72)}Z" fill="${fill}"/>` +
        `<path d="M${n(x)} ${n(y + h * 0.84)}Q${n(cx)} ${n(y + h * 0.58)} ${n(x + w)} ${n(y + h * 0.84)}Q${n(cx)} ${n(y + h)} ${n(x)} ${n(y + h * 0.84)}Z" fill="${fill}"/>`
      );
    }

    case "thought-cloud": {
      return (
        `<path d="M${n(x + w * 0.2)} ${n(y + h * 0.68)}C${n(x)} ${n(y + h * 0.68)} ${n(x)} ${n(y + h * 0.24)} ${n(x + w * 0.22)} ${n(y + h * 0.24)}C${n(x + w * 0.24)} ${n(y)} ${n(x + w * 0.62)} ${n(y)} ${n(x + w * 0.66)} ${n(y + h * 0.18)}C${n(x + w * 0.98)} ${n(y + h * 0.08)} ${n(x + w)} ${n(y + h * 0.58)} ${n(x + w * 0.8)} ${n(y + h * 0.64)}C${n(x + w * 0.74)} ${n(y + h * 0.84)} ${n(x + w * 0.36)} ${n(y + h * 0.86)} ${n(x + w * 0.2)} ${n(y + h * 0.68)}Z" fill="${fill}"/>` +
        `<circle cx="${n(x + w * 0.16)}" cy="${n(y + h * 0.85)}" r="${n(Math.max(1, h * 0.07))}" fill="${fill}"/>` +
        `<circle cx="${n(x + w * 0.08)}" cy="${n(y + h * 0.96)}" r="${n(Math.max(0.8, h * 0.045))}" fill="${fill}"/>`
      );
    }

    case "anger-mark": {
      const q = (px: number, py: number) => `${n(x + w * px)} ${n(y + h * py)}`;
      return `<path data-part="anger-veins" d="M${q(0.2, 0.42)}Q${q(0.43, 0.43)} ${q(0.42, 0.2)}M${q(0.58, 0.2)}Q${q(0.57, 0.43)} ${q(0.8, 0.42)}M${q(0.8, 0.58)}Q${q(0.57, 0.57)} ${q(0.58, 0.8)}M${q(0.42, 0.8)}Q${q(0.43, 0.57)} ${q(0.2, 0.58)}" fill="none" stroke="${fill}" stroke-width="${n(Math.max(strokeWidth * 0.85, Math.min(w, h) * 0.08))}"/>`;
    }

    case "cable": {
      const tailX = x;
      const tailY = y + h * 0.82;
      const neckX = x + w * 0.74;
      const neckY = y + h * 0.24;
      const plugW = w * 0.18;
      const plugH = h * 0.28;
      return (
        `<path d="M${n(tailX)} ${n(tailY)}C${n(x + w * 0.16)} ${n(y + h * 0.24)} ${n(x + w * 0.52)} ${n(y + h * 0.98)} ${n(neckX)} ${n(neckY)}" fill="none" stroke="${fill}" stroke-width="${n(Math.max(strokeWidth, h * 0.09))}"/>` +
        `<rect x="${n(neckX)}" y="${n(neckY - plugH / 2)}" width="${n(plugW)}" height="${n(plugH)}" rx="1.5" fill="${fill}"/>` +
        `<path d="${linePath({ x: neckX + plugW, y: neckY - plugH * 0.24 }, { x: x + w, y: neckY - plugH * 0.24 })}" fill="none"/>` +
        `<path d="${linePath({ x: neckX + plugW, y: neckY + plugH * 0.24 }, { x: x + w, y: neckY + plugH * 0.24 })}" fill="none"/>`
      );
    }

    case "socket": {
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="${fill}"/>` +
        `<rect x="${n(x + w * 0.2)}" y="${n(y + h * 0.34)}" width="${n(w * 0.6)}" height="${n(h * 0.32)}" rx="1" fill="#263345"/>` +
        `<circle cx="${n(cx)}" cy="${n(y + h * 0.14)}" r="${n(Math.max(0.7, w * 0.05))}" fill="#d8e1ee"/>` +
        `<circle cx="${n(cx)}" cy="${n(y + h * 0.86)}" r="${n(Math.max(0.7, w * 0.05))}" fill="#d8e1ee"/>`
      );
    }

    case "server":
    case "server-rack": {
      const slots = [0.14, 0.32, 0.5, 0.68].map((top) =>
        `<rect x="${n(x + w * 0.15)}" y="${n(y + h * top)}" width="${n(w * 0.7)}" height="${n(h * 0.13)}" rx="1.5" fill="${fill}"/>` +
        `<circle cx="${n(x + w * 0.74)}" cy="${n(y + h * (top + 0.065))}" r="${n(Math.max(0.8, w * 0.025))}" fill="#58cf96" stroke="none"/>`
      ).join("");
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2.5" fill="#e6ebf2"/>` +
        `<rect x="${n(x + w * 0.1)}" y="${n(y + h * 0.06)}" width="${n(w * 0.8)}" height="${n(h * 0.86)}" rx="1.5" fill="#263345"/>` +
        slots
      );
    }

    case "server-module": {
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="${fill}"/>` +
        `<rect x="${n(x + w * 0.12)}" y="${n(y + h * 0.22)}" width="${n(w * 0.76)}" height="${n(h * 0.56)}" rx="1" fill="#263345"/>` +
        `<circle cx="${n(x + w * 0.78)}" cy="${n(cy)}" r="${n(Math.max(0.9, h * 0.14))}" fill="#58cf96" stroke="none"/>`
      );
    }

    case "window": {
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="3" fill="#ffffff"/>` +
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h * 0.24)}" rx="2" fill="${fill}"/>` +
        `<circle cx="${n(x + w * 0.8)}" cy="${n(y + h * 0.12)}" r="${n(Math.max(0.8, h * 0.035))}" fill="#ffffff" stroke="none"/>` +
        `<circle cx="${n(x + w * 0.88)}" cy="${n(y + h * 0.12)}" r="${n(Math.max(0.8, h * 0.035))}" fill="#ffffff" stroke="none"/>` +
        `<rect x="${n(x + w * 0.08)}" y="${n(y + h * 0.34)}" width="${n(w * 0.22)}" height="${n(h * 0.54)}" rx="1.5" fill="#dce6f4"/>` +
        `<rect x="${n(x + w * 0.36)}" y="${n(y + h * 0.34)}" width="${n(w * 0.56)}" height="${n(h * 0.24)}" rx="1.5" fill="#c8ecf6"/>`
      );
    }

    case "cursor": {
      return `<path d="M${n(x)} ${n(y)}L${n(x + w * 0.9)} ${n(y + h * 0.57)}L${n(x + w * 0.52)} ${n(y + h * 0.62)}L${n(x + w * 0.78)} ${n(y + h * 0.93)}L${n(x + w * 0.58)} ${n(y + h)}L${n(x + w * 0.32)} ${n(y + h * 0.69)}L${n(x + w * 0.1)} ${n(y + h * 0.9)}Z" fill="${fill}"/>`;
    }
  }
}

function toBlueprintAddonGeometrySvg(markup: string, hatchPatternId: string): string {
  const hatchFill = `url(#${escapeXml(hatchPatternId)})`;
  return markup.replace(/<([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g, (_full, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (tag === "text") {
      const updatedTextAttrs = attrs
        .replace(/\bfill="([^"]*)"/g, (_m, val: string) =>
          val === "none" ? 'fill="none"' : 'fill="#0f172a"'
        )
        .replace(/\bstroke="([^"]*)"/g, (_m, val: string) =>
          val === "none" ? 'stroke="none"' : 'stroke="#0f172a"'
        );
      return `<${rawTag}${updatedTextAttrs}>`;
    }
    const updatedAttrs = attrs
      .replace(/\bfill="([^"]*)"/g, (_m, val: string) =>
        val === "none" ? 'fill="none"' : `fill="${hatchFill}"`
      )
      .replace(/\bstroke="([^"]*)"/g, (_m, val: string) => {
        if (val === "none") return 'stroke="none"';
        const lower = val.toLowerCase();
        if (lower === "#0f172a" || lower === "#1e3a5f") return `stroke="${val}"`;
        return 'stroke="#1e3a5f"';
      });
    return `<${rawTag}${updatedAttrs}>`;
  });
}

export function renderAddonSvg(addon: SampledAddon, options: RenderAddonSvgOptions = {}): string {
  if (addon.opacity <= 0.001 || addon.scale <= 0.001 || addon.width <= 0 || addon.height <= 0) {
    return "";
  }
  const isBlueprint = options.blueprint === true;
  const hatchPatternId = options.hatchPatternId ?? "sm-bp-hatch";
  const strokeWidth = options.strokeWidth ?? 2.5;
  const strokeColor = isBlueprint
    ? (options.themeColor === "#0f172a" ? "#0f172a" : "#1e3a5f")
    : (options.themeColor ?? "#202124");
  const n = formatSvgNumber;

  const effectiveAddon =
    isBlueprint && addon.type === "board"
      ? { ...addon, secondaryColor: "#0f172a" }
      : addon;
  const rawInner = renderAddonGeometrySvg(effectiveAddon, strokeWidth, strokeColor);
  if (!rawInner) return "";
  const inner = isBlueprint ? toBlueprintAddonGeometrySvg(rawInner, hatchPatternId) : rawInner;

  const attrs: string[] = [
    `data-addon="${escapeXml(addon.type)}"`,
    `data-addon-id="${escapeXml(addon.id)}"`,
    `data-layer="${addon.layer}"`
  ];
  if (isBlueprint) {
    attrs.push(`data-style="blueprint"`);
  }
  if (addon.actorId !== undefined) {
    attrs.push(`data-actor-id="${escapeXml(addon.actorId)}"`);
  }
  attrs.push(
    `stroke="${escapeXml(strokeColor)}"`,
    `stroke-width="${n(strokeWidth)}"`,
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`
  );

  if (Math.abs(addon.opacity - 1) > 0.001) {
    attrs.push(`opacity="${n(clamp01(addon.opacity))}"`);
  }
  if (Math.abs(addon.scale - 1) > 0.001 || Math.abs(addon.rotation) > 0.001) {
    const cx = addon.x + addon.width / 2;
    const cy = addon.y + addon.height / 2;
    attrs.push(
      `transform="translate(${n(cx)} ${n(cy)}) rotate(${n(addon.rotation)}) scale(${n(addon.scale)}) translate(${n(-cx)} ${n(-cy)})"`
    );
  }

  const puff = addon.puff ? renderPuffSvg(addon, strokeColor) : "";
  return `<g ${attrs.join(" ")}>${inner}${puff}</g>`;
}

export function renderAddonsLayerSvg(
  addons: readonly SampledAddon[] | undefined,
  layer: "back" | "front",
  options?: RenderAddonSvgOptions
): string {
  if (!addons || addons.length === 0) return "";
  return addons
    .filter((addon) => addon.layer === layer)
    .map((addon) => renderAddonSvg(addon, options))
    .join("");
}
