import type { Point2D } from "./contract.js";

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
