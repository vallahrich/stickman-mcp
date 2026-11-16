import type { Point2D, SampledFrame } from "./contract.js";
import { escapeXml } from "./props.js";
import { renderSceneInnerSvg } from "./render.js";

export interface WorldPoint { x: number; z: number }
export interface RoomBox {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}
export interface RoomOptions {
  width: number;
  depth: number;
  canvas: { width: number; height: number };
  unitScale?: number;
  padding?: number;
  objects?: readonly RoomBox[];
}
export interface IsometricRoom {
  readonly width: number;
  readonly depth: number;
  readonly canvas: Readonly<{ width: number; height: number }>;
  readonly objects: readonly Readonly<RoomBox>[];
  project(point: WorldPoint, height?: number): Point2D;
  /** Inverts a point on the floor; height must be supplied for an elevated point. */
  unproject(point: Point2D, height?: number): WorldPoint;
  contains(point: WorldPoint, radius?: number): boolean;
  canOccupy(point: WorldPoint, radius?: number): boolean;
  /** Camera-depth key used for bounded original box/billboard staging. */
  depthAt(point: WorldPoint): number;
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}
function positive(value: number, name: string): void {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive.`);
}
function validPoint(point: WorldPoint): void {
  finite(point.x, "world x"); finite(point.z, "world z");
}

/** Original orthographic 2.5D scene math; no pose generation or physics. */
export function createIsometricRoom(options: RoomOptions): IsometricRoom {
  positive(options.width, "room width"); positive(options.depth, "room depth");
  const { width, depth } = options;
  const canvas = { ...options.canvas };
  if (![canvas.width, canvas.height].every(v => Number.isInteger(v) && v >= 64 && v <= 4096)) {
    throw new RangeError("Room canvas must have integer dimensions from 64 to 4096.");
  }
  const scale = options.unitScale ?? 1;
  positive(scale, "room unitScale");
  const padding = options.padding ?? 40;
  finite(padding, "room padding");
  if (padding < 0) throw new RangeError("Room padding must be non-negative.");
  const horizontal = Math.sqrt(3) / 2 * scale;
  const vertical = scale / 2;
  const originX = canvas.width / 2 - (width - depth) * horizontal / 2;
  const originY = canvas.height - padding - (width + depth) * vertical;
  if ((width + depth) * horizontal + padding * 2 > canvas.width || originY < padding) {
    throw new RangeError("Projected floor does not fit the canvas. Enlarge the canvas or reduce room dimensions/unitScale.");
  }
  const objects = (options.objects ?? []).map(box => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(box.id)) throw new TypeError("Room object IDs must start with a letter and contain letters, numbers, hyphens or underscores.");
    validPoint(box);
    positive(box.width, `${box.id}.width`); positive(box.depth, `${box.id}.depth`); positive(box.height, `${box.id}.height`);
    if (box.x < 0 || box.z < 0 || box.x + box.width > width || box.z + box.depth > depth) {
      throw new RangeError(`Room object "${box.id}" must be inside the floor.`);
    }
    return Object.freeze({ ...box });
  });
  if (new Set(objects.map(box => box.id)).size !== objects.length) throw new TypeError("Room object IDs must be unique.");
  const project = (point: WorldPoint, height = 0): Point2D => {
    validPoint(point); finite(height, "world height");
    return { x: originX + (point.x - point.z) * horizontal, y: originY + (point.x + point.z) * vertical - height * scale };
  };
  for (const box of objects) {
    for (const x of [box.x, box.x + box.width]) {
      for (const z of [box.z, box.z + box.depth]) {
        const point = project({ x, z }, box.height);
        if (point.x < padding || point.x > canvas.width - padding || point.y < padding) {
          throw new RangeError(`Room object "${box.id}" does not fit the camera view; leave more headroom or reduce its height.`);
        }
      }
    }
  }
  const contains = (point: WorldPoint, radius = 0): boolean => {
    validPoint(point); finite(radius, "world radius");
    if (radius < 0) throw new RangeError("World radius must be non-negative.");
    return point.x >= radius && point.z >= radius && point.x <= width - radius && point.z <= depth - radius;
  };
  return {
    width, depth, canvas: Object.freeze(canvas), objects: Object.freeze(objects),
    project,
    unproject(point, height = 0) {
      finite(point.x, "projected x"); finite(point.y, "projected y"); finite(height, "world height");
      const horizontalPart = (point.x - originX) / horizontal;
      const verticalPart = (point.y - originY + height * scale) / vertical;
      return { x: (horizontalPart + verticalPart) / 2, z: (verticalPart - horizontalPart) / 2 };
    },
    contains,
    canOccupy(point, radius = 0) {
      if (!contains(point, radius)) return false;
      return !objects.some(box => {
        const closestX = Math.max(box.x, Math.min(box.x + box.width, point.x));
        const closestZ = Math.max(box.z, Math.min(box.z + box.depth, point.z));
        return Math.hypot(point.x - closestX, point.z - closestZ) <= radius;
      });
    },
    depthAt(point) { validPoint(point); return point.x + point.z; }
  };
}

export interface RoomStage {
  readonly actorLayer: SVGGElement;
  orderActor(position: WorldPoint, height?: number): void;
  dispose(): void;
}

/**
 * Bounded box/paper-actor painter's ordering, not a general 3D z-buffer.
 * The actor stays flat; floor/box geometry comes from actual X/Z/height.
 */
export function mountRoomStage(svg: SVGSVGElement, room: IsometricRoom): RoomStage {
  const ns = "http://www.w3.org/2000/svg";
  const document = svg.ownerDocument;
  const stage = document.createElementNS(ns, "g");
  svg.append(stage);
  const polygon = (points: Point2D[], fill: string, parent: SVGElement): SVGPolygonElement => {
    const node = document.createElementNS(ns, "polygon");
    node.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
    node.setAttribute("fill", fill);
    node.setAttribute("stroke", "var(--cp-border-strong)");
    node.setAttribute("stroke-width", "1.5");
    parent.append(node);
    return node;
  };
  const p = room.project;
  polygon([p({ x: 0, z: 0 }), p({ x: room.width, z: 0 }), p({ x: room.width, z: room.depth }), p({ x: 0, z: room.depth })], "var(--cp-surface-soft)", stage);
  const wallHeight = 100;
  if (p({ x: 0, z: 0 }, wallHeight).y >= 0) {
    polygon([p({ x: 0, z: room.depth }), p({ x: 0, z: 0 }), p({ x: 0, z: 0 }, wallHeight), p({ x: 0, z: room.depth }, wallHeight)], "var(--cp-bg-elevated)", stage);
    polygon([p({ x: 0, z: 0 }), p({ x: room.width, z: 0 }), p({ x: room.width, z: 0 }, wallHeight), p({ x: 0, z: 0 }, wallHeight)], "var(--cp-surface)", stage);
  }
  const objects = room.objects.map(box => {
    const layer = document.createElementNS(ns, "g");
    layer.setAttribute("data-room-object", box.id);
    const a = { x: box.x, z: box.z }, b = { x: box.x + box.width, z: box.z };
    const c = { x: box.x + box.width, z: box.z + box.depth }, d = { x: box.x, z: box.z + box.depth };
    polygon([p(a, box.height), p(b, box.height), p(c, box.height), p(d, box.height)], "var(--cp-accent-soft)", layer);
    polygon([p(b), p(c), p(c, box.height), p(b, box.height)], "var(--cp-bg-elevated)", layer);
    polygon([p(c), p(d), p(d, box.height), p(c, box.height)], "var(--cp-surface)", layer);
    stage.append(layer);
    return { layer, depth: room.depthAt(c) };
  }).sort((a, b) => a.depth - b.depth);
  for (const object of objects) stage.append(object.layer);
  const actorLayer = document.createElementNS(ns, "g");
  actorLayer.setAttribute("data-room-actor", "");
  const shadow = document.createElementNS(ns, "ellipse");
  shadow.setAttribute("fill", "var(--cp-text)");
  shadow.setAttribute("opacity", "0.16");
  actorLayer.append(shadow);
  stage.append(actorLayer);
  let disposed = false;
  return {
    actorLayer,
    orderActor(position, height = 0) {
      if (disposed) throw new Error("Room stage is disposed.");
      finite(height, "actor height");
      if (height < 0) throw new RangeError("Actor height must not be below the room floor.");
      const depth = room.depthAt(position);
      const next = objects.find(object => object.depth > depth);
      stage.insertBefore(actorLayer, next?.layer ?? null);
      const floor = room.project(position);
      const radius = Math.max(12, 20 - height / 10);
      const side = room.project({ x: position.x + radius, z: position.z });
      shadow.setAttribute("cx", String(floor.x));
      shadow.setAttribute("cy", String(floor.y));
      shadow.setAttribute("rx", String(Math.abs(side.x - floor.x)));
      shadow.setAttribute("ry", String(Math.abs(side.y - floor.y)));
      shadow.setAttribute("opacity", String(0.16 / (1 + height / 80)));
    },
    dispose() { if (!disposed) { disposed = true; stage.remove(); } }
  };
}

export type RoomBlueprintActorState =
  | {
      readonly x: number;
      readonly z: number;
      readonly height?: number;
      readonly radius?: number;
      readonly label?: string;
      readonly frame?: SampledFrame;
    }
  | {
      readonly position: WorldPoint;
      readonly height?: number;
      readonly radius?: number;
      readonly label?: string;
      readonly frame?: SampledFrame;
    }
  | {
      readonly worldRoot: WorldPoint;
      readonly worldHeight?: number;
      readonly radius?: number;
      readonly label?: string;
      readonly status?: string;
      readonly frame?: SampledFrame;
    };

export interface RoomBlueprintOptions {
  gridStep?: number;
  wallHeight?: number;
  title?: string;
}

function fmtNum(value: number, decimals = 1): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return (Math.abs(rounded) < 1e-6 ? 0 : rounded).toString();
}

function ptsAttr(points: readonly Point2D[]): string {
  return points.map((pt) => `${fmtNum(pt.x, 1)},${fmtNum(pt.y, 1)}`).join(" ");
}

function resolveBlueprintActorState(state: RoomBlueprintActorState | undefined): {
  position: WorldPoint;
  height: number;
  radius: number;
  label: string;
  frame?: SampledFrame;
} | null {
  if (!state) return null;
  let position: WorldPoint;
  let height = 0;
  if ("worldRoot" in state) {
    position = state.worldRoot;
    height = state.worldHeight ?? 0;
  } else if ("position" in state) {
    position = state.position;
    height = state.height ?? 0;
  } else {
    position = { x: state.x, z: state.z };
    height = state.height ?? 0;
  }
  validPoint(position);
  finite(height, "actor height");
  if (height < 0) throw new RangeError("Actor height must not be below the room floor.");
  const radius = state.radius ?? 14;
  finite(radius, "actor radius");
  if (radius < 0) throw new RangeError("Actor radius must be non-negative.");
  const statusPart = "status" in state && state.status ? ` [${state.status}]` : "";
  const label = state.label ?? `actor${statusPart}`;
  return {
    position,
    height,
    radius,
    label,
    ...(state.frame !== undefined ? { frame: state.frame } : {})
  };
}

/**
 * Pure deterministic scriptless 2.5D isometric dimensional-drawing SVG diagnostic.
 * Renders isometric floor grid, obstacle footprints with W×D×H dimension callouts,
 * dashed vertical projection lines to the ground plane, and projected actor marker.
 */
export function renderRoomBlueprintSvg(
  room: IsometricRoom,
  state?: RoomBlueprintActorState,
  options: RoomBlueprintOptions = {}
): string {
  const { width, depth, canvas } = room;
  const step = options.gridStep ?? Math.max(25, Math.round(Math.max(width, depth) / 10));
  positive(step, "gridStep");
  const wallHeight = options.wallHeight ?? 100;
  finite(wallHeight, "wallHeight");
  if (wallHeight < 0) throw new RangeError("wallHeight must be non-negative.");

  const actor = resolveBlueprintActorState(state);
  const p = room.project;

  const gridLines: string[] = [];
  for (let x = step; x < width; x += step) {
    const a = p({ x, z: 0 });
    const b = p({ x, z: depth });
    gridLines.push(
      `<line x1="${fmtNum(a.x, 1)}" y1="${fmtNum(a.y, 1)}" x2="${fmtNum(b.x, 1)}" y2="${fmtNum(b.y, 1)}" stroke="#cbd5e1" stroke-width=".8"/>`
    );
  }
  for (let z = step; z < depth; z += step) {
    const a = p({ x: 0, z });
    const b = p({ x: width, z });
    gridLines.push(
      `<line x1="${fmtNum(a.x, 1)}" y1="${fmtNum(a.y, 1)}" x2="${fmtNum(b.x, 1)}" y2="${fmtNum(b.y, 1)}" stroke="#cbd5e1" stroke-width=".8"/>`
    );
  }

  const originPt = p({ x: 0, z: 0 });
  const xEndPt = p({ x: width, z: 0 });
  const zEndPt = p({ x: 0, z: depth });
  const farCornerPt = p({ x: width, z: depth });

  const backWalls =
    wallHeight > 0 && p({ x: 0, z: 0 }, wallHeight).y >= 24
      ? `<g data-part="reference-walls" fill="none" stroke="#94a3b8" stroke-width=".9" stroke-dasharray="4 3">` +
        `<polygon points="${ptsAttr([p({ x: 0, z: depth }), originPt, p({ x: 0, z: 0 }, wallHeight), p({ x: 0, z: depth }, wallHeight)])}"/>` +
        `<polygon points="${ptsAttr([originPt, xEndPt, p({ x: width, z: 0 }, wallHeight), p({ x: 0, z: 0 }, wallHeight)])}"/>` +
        `</g>`
      : "";

  const floorMarkup =
    `<g data-part="floor-grid">` +
    `<polygon points="${ptsAttr([originPt, xEndPt, farCornerPt, zEndPt])}" fill="#f1f5f9" stroke="#1e3a5f" stroke-width="1.4"/>` +
    `${gridLines.join("")}` +
    `<polygon points="${ptsAttr([originPt, xEndPt, farCornerPt, zEndPt])}" fill="none" stroke="#1e3a5f" stroke-width="1.4"/>` +
    `<text class="rb-d" x="${fmtNum(originPt.x, 1)}" y="${fmtNum(originPt.y - 6, 1)}" text-anchor="middle">(0,0)</text>` +
    `<text class="rb-d" x="${fmtNum(xEndPt.x + 6, 1)}" y="${fmtNum(xEndPt.y + 4, 1)}">X=${fmtNum(width, 0)}</text>` +
    `<text class="rb-d" x="${fmtNum(zEndPt.x - 6, 1)}" y="${fmtNum(zEndPt.y + 4, 1)}" text-anchor="end">Z=${fmtNum(depth, 0)}</text>` +
    `</g>`;

  const sortedObjects = [...room.objects].sort(
    (a, b) => room.depthAt({ x: a.x + a.width, z: a.z + a.depth }) - room.depthAt({ x: b.x + b.width, z: b.z + b.depth })
  );

  const renderObstacle = (box: RoomBox): string => {
    const a = { x: box.x, z: box.z };
    const b = { x: box.x + box.width, z: box.z };
    const c = { x: box.x + box.width, z: box.z + box.depth };
    const d = { x: box.x, z: box.z + box.depth };
    const a0 = p(a, 0), b0 = p(b, 0), c0 = p(c, 0), d0 = p(d, 0);
    const aH = p(a, box.height), bH = p(b, box.height), cH = p(c, box.height), dH = p(d, box.height);
    const topCenter = p({ x: box.x + box.width / 2, z: box.z + box.depth / 2 }, box.height);
    const dimText = `${box.id}: ${fmtNum(box.width, 0)}×${fmtNum(box.depth, 0)}×${fmtNum(box.height, 0)}`;

    const projections = [
      [aH, a0],
      [bH, b0],
      [cH, c0],
      [dH, d0]
    ]
      .map(
        ([top, ground]) =>
          `<line data-part="projection-line" x1="${fmtNum(top!.x, 1)}" y1="${fmtNum(top!.y, 1)}" x2="${fmtNum(ground!.x, 1)}" y2="${fmtNum(ground!.y, 1)}" stroke="#1e3a5f" stroke-width=".9" stroke-dasharray="4 3"/>`
      )
      .join("");

    return (
      `<g data-room-object="${escapeXml(box.id)}">` +
      `<polygon data-part="obstacle-footprint" points="${ptsAttr([a0, b0, c0, d0])}" fill="#e2e8f0" fill-opacity=".65" stroke="#1e3a5f" stroke-width="1" stroke-dasharray="3 3"/>` +
      `<polygon points="${ptsAttr([b0, c0, cH, bH])}" fill="#e2e8f0" fill-opacity=".75" stroke="#0f172a" stroke-width="1.1"/>` +
      `<polygon points="${ptsAttr([c0, d0, dH, cH])}" fill="#f8fafc" fill-opacity=".85" stroke="#0f172a" stroke-width="1.1"/>` +
      `<polygon points="${ptsAttr([aH, bH, cH, dH])}" fill="#dbeafe" fill-opacity=".55" stroke="#0f172a" stroke-width="1.2"/>` +
      `${projections}` +
      `<g data-part="dimension-callout">` +
      `<line x1="${fmtNum(topCenter.x, 1)}" y1="${fmtNum(topCenter.y, 1)}" x2="${fmtNum(topCenter.x, 1)}" y2="${fmtNum(topCenter.y - 12, 1)}" stroke="#1e3a5f" stroke-width=".85"/>` +
      `<text class="rb-c" x="${fmtNum(topCenter.x, 1)}" y="${fmtNum(topCenter.y - 15, 1)}" text-anchor="middle">${escapeXml(dimText)}</text>` +
      `</g>` +
      `</g>`
    );
  };

  let actorMarkup = "";
  if (actor) {
    const floorPt = p(actor.position, 0);
    const elevPt = p(actor.position, actor.height);
    const datumTopPt = p(actor.position, Math.max(actor.height, 48));
    const radRef = Math.max(8, actor.radius);
    const rxPt = p({ x: Math.min(width, actor.position.x + radRef), z: actor.position.z }, 0);
    const rx = Math.max(6, Math.abs(rxPt.x - floorPt.x));
    const ry = Math.max(3.5, Math.abs(rxPt.y - floorPt.y));
    const occupiable = room.canOccupy(actor.position, actor.radius);
    const coordLabel = `${actor.label} (${Math.round(actor.position.x)},${Math.round(actor.position.z)},h=${Math.round(actor.height)})`;
    const figureSvg = actor.frame
      ? renderSceneInnerSvg(actor.frame, { defaultColor: "#0f172a", themeAccentColor: "#1e3a5f", decimals: 1 })
      : "";

    actorMarkup =
      `<g data-part="actor-marker" data-occupiable="${occupiable ? "true" : "false"}">` +
      `<ellipse data-part="actor-ground-projection" cx="${fmtNum(floorPt.x, 1)}" cy="${fmtNum(floorPt.y, 1)}" rx="${fmtNum(rx, 1)}" ry="${fmtNum(ry, 1)}" fill="#dbeafe" fill-opacity=".5" stroke="#1e3a5f" stroke-width="1" stroke-dasharray="3 2"/>` +
      `<line data-part="actor-projection-line" x1="${fmtNum(datumTopPt.x, 1)}" y1="${fmtNum(datumTopPt.y, 1)}" x2="${fmtNum(floorPt.x, 1)}" y2="${fmtNum(floorPt.y, 1)}" stroke="#1e3a5f" stroke-width="1" stroke-dasharray="4 3"/>` +
      `<path d="M${fmtNum(floorPt.x - 5, 1)} ${fmtNum(floorPt.y, 1)}H${fmtNum(floorPt.x + 5, 1)}M${fmtNum(floorPt.x, 1)} ${fmtNum(floorPt.y - 3, 1)}V${fmtNum(floorPt.y + 3, 1)}" stroke="#0f172a" stroke-width="1"/>` +
      `${figureSvg}` +
      `<circle cx="${fmtNum(elevPt.x, 1)}" cy="${fmtNum(elevPt.y, 1)}" r="4.5" fill="#0f172a" stroke="#f8fafc" stroke-width="1.2"/>` +
      `<text class="rb-c" x="${fmtNum(elevPt.x + 8, 1)}" y="${fmtNum(elevPt.y - 6, 1)}">${escapeXml(coordLabel)}</text>` +
      `</g>`;
  }

  const orderedLayers: string[] = [];
  let actorInserted = actor === null;
  const actorDepth = actor ? room.depthAt(actor.position) : Infinity;
  for (const box of sortedObjects) {
    const boxDepth = room.depthAt({ x: box.x + box.width, z: box.z + box.depth });
    if (!actorInserted && actorDepth <= boxDepth) {
      orderedLayers.push(actorMarkup);
      actorInserted = true;
    }
    orderedLayers.push(renderObstacle(box));
  }
  if (!actorInserted) {
    orderedLayers.push(actorMarkup);
  }

  const titleText = options.title ?? "ISOMETRIC 2.5D ROOM BLUEPRINT";
  const metaRight = `FLOOR ${fmtNum(width, 0)}×${fmtNum(depth, 0)} | OBSTACLES ${room.objects.length} | CANVAS ${canvas.width}×${canvas.height}`;
  const regMark = (cx: number, cy: number): string =>
    `<path data-part="registration-mark" d="M${cx - 5} ${cy}H${cx + 5}M${cx} ${cy - 5}V${cy + 5}" stroke="#1e3a5f" stroke-width="1"/>`;

  const titleBlock =
    `<g data-part="blueprint-title-block">` +
    `<rect x="12" y="12" width="${canvas.width - 24}" height="28" fill="#f8fafc" fill-opacity=".92" stroke="#1e3a5f" stroke-width="1"/>` +
    `<text class="rb-t" x="22" y="30">${escapeXml(titleText)}</text>` +
    `<text class="rb-m" x="${canvas.width - 22}" y="30" text-anchor="end">${escapeXml(metaRight)}</text>` +
    `</g>`;

  const style =
    `.rb-t{font:700 12px Consolas,"Courier New",monospace;fill:#0f172a;letter-spacing:.06em}` +
    `.rb-m{font:10.5px Consolas,"Courier New",monospace;fill:#1e3a5f}` +
    `.rb-c{font:700 10.5px Consolas,"Courier New",monospace;fill:#0f172a}` +
    `.rb-d{font:10px Consolas,"Courier New",monospace;fill:#1e3a5f}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-theme="blueprint" role="img" aria-label="Isometric room blueprint (${fmtNum(width, 0)} by ${fmtNum(depth, 0)})" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">` +
    `<defs><style>${style}</style></defs>` +
    `<rect width="100%" height="100%" fill="#f8fafc"/>` +
    `<rect x="2" y="2" width="${canvas.width - 4}" height="${canvas.height - 4}" fill="none" stroke="#1e3a5f" stroke-width="1"/>` +
    `${regMark(8, 8)}${regMark(canvas.width - 8, 8)}${regMark(8, canvas.height - 8)}${regMark(canvas.width - 8, canvas.height - 8)}` +
    `${backWalls}${floorMarkup}${orderedLayers.join("")}${titleBlock}</svg>`
  );
}
