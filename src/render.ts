import {
  CONTRACT_VERSION_V2,
  type AnimationSpec,
  type AnimationSpecV2,
  type CompiledAnimation,
  type PlaybackMode,
  type Point2D,
  type RenderStyle,
  type SampledActorFrame,
  type SampledAddon,
  type SampledFrame
} from "./contract.js";
import { resolveStageAnchors } from "./choreograph.js";
import { sampleAnimation } from "./compiler.js";
import { sampleClipMotion } from "./motion-clips.js";
import { RUNTIME_MOTION_LIBRARY } from "./motion-library.js";
import { renderAddonSvg, renderBlueprintDefsSvg } from "./props.js";

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function number(value: number, decimals = 3): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return (Math.abs(rounded) < 1e-6 ? 0 : rounded).toString();
}

export function frameGeometry(frame: SampledFrame) {
  const torso = frame.segments.find(segment => segment.id === "torso");
  const leftUpperArm = frame.segments.find(segment => segment.id === "left-upper-arm");
  const rightUpperArm = frame.segments.find(segment => segment.id === "right-upper-arm");
  const leftThigh = frame.segments.find(segment => segment.id === "left-thigh");
  const rightThigh = frame.segments.find(segment => segment.id === "right-thigh");
  const leftShin = frame.segments.find(segment => segment.id === "left-shin");
  const rightShin = frame.segments.find(segment => segment.id === "right-shin");
  const leftForearm = frame.segments.find(segment => segment.id === "left-forearm");
  const rightForearm = frame.segments.find(segment => segment.id === "right-forearm");
  if (!torso || !leftUpperArm || !rightUpperArm || !leftThigh || !rightThigh || !leftShin || !rightShin || !leftForearm || !rightForearm) throw new Error("Pose is missing required torso or limb segments.");
  const scale = Math.hypot(torso.x2 - torso.x1, torso.y2 - torso.y1) / 30;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Pose has an invalid torso length.");
  const headRadius = 11 * scale;
  const strokeWidth = Math.max(2.5, headRadius * 2 * 0.09);
  const torsoDirection = frame.facing ?? (torso.x2 - torso.x1);
  const kneeDirection = (leftThigh.x2 + rightThigh.x2) / 2 - torso.x1;
  const direction = Math.abs(torsoDirection) > 0.1 * scale ? torsoDirection : kneeDirection;
  const nearSide = direction < 0 ? "left" : "right";
  const farSide = nearSide === "left" ? "right" : "left";
  const frontView = frame.facing !== undefined && Math.abs(frame.facing) < 0.3;
  const frontArm = frame.action === "point" ? "right" : nearSide;
  const backArm = frontArm === "left" ? "right" : "left";
  const farLeg = `${farSide}-leg`;
  const nearLeg = `${nearSide}-leg`;
  const farArm = `${backArm}-arm`;
  const nearArm = `${frontArm}-arm`;
  const segmentOrder = frontView ? ["left-leg", "right-leg", "torso", "left-arm", "right-arm"] : [farArm, farLeg, "torso", nearLeg, nearArm];
  const format = (value: number): string => Number(value.toFixed(3)).toString();
  const path = (x1: number, y1: number, x2: number, y2: number): string =>
    `M${format(x1)} ${format(y1)}L${format(x2)} ${format(y2)}`;
  const curve = (
    root: { x: number; y: number }, joint: { x: number; y: number }, end: { x: number; y: number }
  ): string => {
    const dx = end.x - root.x;
    const dy = end.y - root.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) return path(root.x, root.y, end.x, end.y);
    const signedDistance = ((joint.x - root.x) * dy - (joint.y - root.y) * dx) / length;
    if (Math.abs(signedDistance) < 0.85 * scale) return path(root.x, root.y, end.x, end.y);
    const limitedDistance = Math.max(-0.15 * length, Math.min(0.15 * length, signedDistance));
    const midX = (root.x + end.x) / 2;
    const midY = (root.y + end.y) / 2;
    const cx = midX + dy / length * limitedDistance * 2;
    const cy = midY - dx / length * limitedDistance * 2;
    return `M${format(root.x)} ${format(root.y)}Q${format(cx)} ${format(cy)} ${format(end.x)} ${format(end.y)}`;
  };
  // Passes through the real joint with a softly rounded corner, so deep knee/elbow bends stay readable.
  const jointed = (
    root: { x: number; y: number }, joint: { x: number; y: number }, end: { x: number; y: number }
  ): string => {
    const l1 = Math.hypot(joint.x - root.x, joint.y - root.y), l2 = Math.hypot(end.x - joint.x, end.y - joint.y);
    const dx = end.x - root.x, dy = end.y - root.y, length = Math.hypot(dx, dy);
    if (l1 <= 1e-6 || l2 <= 1e-6 || length <= 1e-6) return path(root.x, root.y, end.x, end.y);
    const signedDistance = ((joint.x - root.x) * dy - (joint.y - root.y) * dx) / length;
    if (Math.abs(signedDistance) < 0.85 * scale) return path(root.x, root.y, end.x, end.y);
    const r = Math.min(l1, l2) * 0.22;
    const a = { x: joint.x + (root.x - joint.x) * r / l1, y: joint.y + (root.y - joint.y) * r / l1 };
    const b = { x: joint.x + (end.x - joint.x) * r / l2, y: joint.y + (end.y - joint.y) * r / l2 };
    return `M${format(root.x)} ${format(root.y)}L${format(a.x)} ${format(a.y)}Q${format(joint.x)} ${format(joint.y)} ${format(b.x)} ${format(b.y)}L${format(end.x)} ${format(end.y)}`;
  };
  const limb = (id: string, upper: typeof leftUpperArm, lower: typeof leftForearm, kind: "arm" | "leg", near: boolean) => ({
    id, kind, near,
    d: frame.articulated
      ? jointed({ x: upper.x1, y: upper.y1 }, { x: upper.x2, y: upper.y2 }, { x: lower.x2, y: lower.y2 })
      : curve({ x: upper.x1, y: upper.y1 }, { x: upper.x2, y: upper.y2 }, { x: lower.x2, y: lower.y2 })
  });
  const headVectorLength = Math.hypot(frame.head.x - torso.x2, frame.head.y - torso.y2);
  const head = headVectorLength > 1e-6
    ? {
        x: torso.x2 + (frame.head.x - torso.x2) / headVectorLength * headRadius,
        y: torso.y2 + (frame.head.y - torso.y2) / headVectorLength * headRadius
      }
    : frame.head;
  const footPath = (shin: typeof leftShin): string => {
    const halfLength = 5.5 * scale;
    const clearance = Math.max(0, frame.groundY - shin.y2);
    const desiredAngle = Math.atan2(shin.x2 - shin.x1, shin.y2 - shin.y1) * 0.3;
    const limit = Math.asin(Math.min(1, clearance / halfLength));
    const angle = Math.max(-Math.min(0.3, limit), Math.min(Math.min(0.3, limit), desiredAngle));
    const dx = Math.cos(angle) * halfLength;
    const dy = Math.sin(angle) * halfLength;
    return path(shin.x2 - dx, shin.y2 - dy, shin.x2 + dx, shin.y2 + dy);
  };
  const limbs = [
    limb("left-arm", leftUpperArm, leftForearm, "arm", frontArm === "left"),
    limb("right-arm", rightUpperArm, rightForearm, "arm", frontArm === "right"),
    limb("left-leg", leftThigh, leftShin, "leg", nearSide === "left"),
    limb("right-leg", rightThigh, rightShin, "leg", nearSide === "right")
  ];
  return {
    scale, headRadius, strokeWidth, head, nearSide, frontArm,
    rearSegments: [] as string[], segmentOrder, limbs,
    handlePath: frame.prop ? path(frame.prop.handleX, frame.prop.handleY - 5 * scale, frame.prop.handleX, frame.prop.handleY + 5 * scale) : null,
    paths: [
      { id: "torso", d: path(torso.x1, torso.y1, torso.x2, torso.y2), near: true },
      { id: "left-foot", d: footPath(leftShin), near: nearSide === "left" },
      { id: "right-foot", d: footPath(rightShin), near: nearSide === "right" },
      {
        id: "point-finger",
        d: (() => {
          const dx = rightForearm.x2 - torso.x2, dy = rightForearm.y2 - torso.y2;
          const reach = Math.hypot(dx, dy);
          if (!Number.isFinite(reach) || reach <= 0) throw new Error("Pointing pose has an invalid arm reach.");
          const extension = frame.action === "point" ? 7 * scale : 0;
          return path(rightForearm.x2, rightForearm.y2,
            rightForearm.x2 + dx / reach * extension, rightForearm.y2 + dy / reach * extension);
        })(),
        near: true, strokeWidth: strokeWidth
      }
    ]
  };
}

export interface RenderStyleOptions {
  style?: RenderStyle;
}

export interface SceneRenderOptions {
  defaultColor?: string;
  themeAccentColor?: string;
  minStrokeWidth?: number;
  decimals?: number;
  compact?: boolean;
  blueprint?: boolean;
  hatchPatternId?: string;
}

function compactPathNumbers(d: string, decimals: number): string {
  if (decimals >= 3) return d;
  return d.replace(/-?\d+\.\d+/g, (raw) => number(Number(raw), decimals));
}

function compactAddonSvgNumbers(svg: string, decimals: number, stripLineJoins = false): string {
  let out =
    decimals >= 3
      ? svg
      : svg.replace(
          /\b(d|x|y|cx|cy|r|rx|ry|width|height|stroke-width|font-size|opacity|transform|points)="([^"]+)"/g,
          (_full, attr: string, val: string) => `${attr}="${compactPathNumbers(val, decimals)}"`
        );
  if (stripLineJoins) {
    out = out
      .replaceAll(' stroke-linecap="round"', "")
      .replaceAll(' stroke-linejoin="round"', "");
  }
  return out;
}

export function actorToSampledFrame(actor: SampledActorFrame, timeMs = 0): SampledFrame {
  return {
    timeMs,
    action: actor.action,
    x: actor.x,
    groundY: actor.groundY,
    head: actor.head,
    segments: actor.segments,
    prop: null,
    ...(actor.facing !== undefined ? { facing: actor.facing } : {}),
    ...(actor.articulated ? { articulated: true } : {})
  };
}

export function renderActorAccessorySvg(
  actor: SampledActorFrame,
  geometry: ReturnType<typeof frameGeometry>,
  themeAccentColor?: string,
  decimals = 3
): string {
  const accessory = actor.accessory;
  if (!accessory || accessory === "none") return "";

  const torso = actor.segments.find((segment) => segment.id === "torso");
  if (!torso) return "";

  const accent = xml(actor.accentColor ?? themeAccentColor ?? "#2563eb");
  const stroke = xml(actor.color);
  const n = (value: number): string => number(value, decimals);
  const sw = geometry.strokeWidth;
  const hr = geometry.headRadius;
  const hx = geometry.head.x;
  const hy = geometry.head.y;

  const torsoDx = torso.x1 - torso.x2;
  const torsoDy = torso.y1 - torso.y2;
  const torsoLen = Math.hypot(torsoDx, torsoDy) || 30 * geometry.scale;
  const downX = torsoDx / torsoLen;
  const downY = torsoDy / torsoLen;

  const neckToHeadLen = Math.hypot(hx - torso.x2, hy - torso.y2);
  const upX = neckToHeadLen > 1e-6 ? (hx - torso.x2) / neckToHeadLen : -downX;
  const upY = neckToHeadLen > 1e-6 ? (hy - torso.y2) / neckToHeadLen : -downY;
  const tanX = -upY;
  const tanY = upX;

  const facingVal =
    actor.facing !== undefined
      ? Math.max(-1, Math.min(1, actor.facing))
      : geometry.nearSide === "left"
        ? -1
        : 1;
  const dirSign = facingVal < 0 ? -1 : 1;

  if (accessory === "tie") {
    const chestShift = facingVal * hr * 0.14;
    const perpX = -downY;
    const perpY = downX;
    const startX = torso.x2 + downX * (torsoLen * 0.06) + perpX * chestShift;
    const startY = torso.y2 + downY * (torsoLen * 0.06) + perpY * chestShift;
    const knotY = torsoLen * 0.08;
    const midDist = torsoLen * 0.3;
    const tipDist = torsoLen * 0.44;
    const wTop = hr * 0.14;
    const wMid = hr * 0.23;

    const pt = (along: number, across: number): string =>
      `${n(startX + downX * along + perpX * across)},${n(startY + downY * along + perpY * across)}`;

    const points = [
      pt(0, -wTop),
      pt(0, wTop),
      pt(knotY, wTop * 0.72),
      pt(midDist, wMid),
      pt(tipDist, 0),
      pt(midDist, -wMid),
      pt(knotY, -wTop * 0.72)
    ].join(" ");
    return `<g data-accessory="tie"><polygon points="${points}" fill="${accent}" stroke="${stroke}" stroke-width="${n(Math.max(0.9, sw * 0.32))}" stroke-linejoin="round"/></g>`;
  }

  if (accessory === "hat") {
    const hPt = (u: number, t: number): { x: number; y: number } => ({
      x: hx + upX * u + tanX * t,
      y: hy + upY * u + tanY * t
    });
    const baseLeft = hPt(hr * 0.72, -hr * 0.84);
    const baseRight = hPt(hr * 0.72, hr * 0.84);
    const crownLeft = hPt(hr * 1.32, -hr * 0.56);
    const crownRight = hPt(hr * 1.32, hr * 0.56);
    const brimBack = hPt(hr * 0.7, -dirSign * hr * 0.92);
    const brimFront = hPt(hr * 0.66, dirSign * hr * 1.28);
    const crownPath = `M${n(baseLeft.x)} ${n(baseLeft.y)}L${n(crownLeft.x)} ${n(crownLeft.y)}L${n(crownRight.x)} ${n(crownRight.y)}L${n(baseRight.x)} ${n(baseRight.y)}Z`;
    const brimPath = `M${n(brimBack.x)} ${n(brimBack.y)}L${n(brimFront.x)} ${n(brimFront.y)}`;
    return (
      `<g data-accessory="hat">` +
      `<path d="${crownPath}" fill="${accent}" stroke="${stroke}" stroke-width="${n(Math.max(1.1, sw * 0.45))}" stroke-linejoin="round"/>` +
      `<path d="${brimPath}" fill="none" stroke="${accent}" stroke-width="${n(Math.max(1.8, sw * 0.82))}" stroke-linecap="round"/>` +
      `</g>`
    );
  }

  if (accessory === "glasses") {
    const eyeBaseX = hx + upX * (hr * 0.06);
    const eyeBaseY = hy + upY * (hr * 0.06);
    const frameSw = n(Math.max(1.3, sw * 0.52));
    const halfH = hr * 0.19;
    const lensQuad = (centerT: number, halfW: number): string => {
      const p1 = { x: eyeBaseX + upX * halfH + tanX * (centerT - halfW), y: eyeBaseY + upY * halfH + tanY * (centerT - halfW) };
      const p2 = { x: eyeBaseX + upX * halfH + tanX * (centerT + halfW), y: eyeBaseY + upY * halfH + tanY * (centerT + halfW) };
      const p3 = { x: eyeBaseX - upX * halfH + tanX * (centerT + halfW), y: eyeBaseY - upY * halfH + tanY * (centerT + halfW) };
      const p4 = { x: eyeBaseX - upX * halfH + tanX * (centerT - halfW), y: eyeBaseY - upY * halfH + tanY * (centerT - halfW) };
      return `M${n(p1.x)} ${n(p1.y)}L${n(p2.x)} ${n(p2.y)}L${n(p3.x)} ${n(p3.y)}L${n(p4.x)} ${n(p4.y)}Z`;
    };
    const segLine = (t1: number, t2: number): string => {
      const a = { x: eyeBaseX + tanX * t1, y: eyeBaseY + tanY * t1 };
      const b = { x: eyeBaseX + tanX * t2, y: eyeBaseY + tanY * t2 };
      return `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`;
    };

    if (Math.abs(facingVal) < 0.35) {
      const leftLens = lensQuad(-hr * 0.36, hr * 0.22);
      const rightLens = lensQuad(hr * 0.36, hr * 0.22);
      const bridge = segLine(-hr * 0.14, hr * 0.14);
      return `<g data-accessory="glasses" fill="#ffffff" fill-opacity="0.7" stroke="${accent}" stroke-width="${frameSw}" stroke-linejoin="round"><path d="${leftLens}"/><path d="${rightLens}"/><path d="${bridge}" fill="none"/></g>`;
    }

    const nearT = dirSign * hr * 0.16;
    const farT = dirSign * hr * 0.64;
    const nearW = hr * 0.21;
    const farW = hr * 0.17;
    const nearLens = lensQuad(nearT, nearW);
    const farLens = lensQuad(farT, farW);
    const bridge = segLine(nearT + dirSign * nearW, farT - dirSign * farW);
    const temple = segLine(-dirSign * hr * 0.62, nearT - dirSign * nearW);
    return `<g data-accessory="glasses" fill="#ffffff" fill-opacity="0.7" stroke="${accent}" stroke-width="${frameSw}" stroke-linejoin="round"><path d="${temple}" fill="none"/><path d="${nearLens}"/><path d="${farLens}"/><path d="${bridge}" fill="none"/></g>`;
  }

  if (accessory === "badge") {
    const perpX = -downY;
    const perpY = downX;
    const cx = torso.x2 + downX * (torsoLen * 0.22) + perpX * (dirSign * hr * 0.24);
    const cy = torso.y2 + downY * (torsoLen * 0.22) + perpY * (dirSign * hr * 0.24);
    const r = Math.max(1.8, hr * 0.2);
    return `<g data-accessory="badge"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${accent}" stroke="#ffffff" stroke-width="${n(Math.max(0.9, sw * 0.32))}"/></g>`;
  }

  return "";
}

export function renderActorFigureSvg(
  actor: SampledActorFrame,
  timeMs = 0,
  options: SceneRenderOptions = {}
): string {
  const decimals = options.decimals ?? 3;
  const compact = options.compact === true;
  const isBlueprint = options.blueprint === true;
  const effectiveActor: SampledActorFrame = isBlueprint
    ? {
        ...actor,
        color: "#0f172a",
        accentColor: "#1e3a5f"
      }
    : actor;
  const n = (value: number): string => number(value, decimals);
  const sample = actorToSampledFrame(effectiveActor, timeMs);
  const geometry = frameGeometry(sample);
  const strokeWidth = Math.max(geometry.strokeWidth, options.minStrokeWidth ?? 0);
  const limbById = new Map(geometry.limbs.map((item) => [item.id, item]));
  const detailById = new Map(geometry.paths.map((item) => [item.id, item]));
  const dFmt = (d: string): string => compactPathNumbers(d, decimals);
  const segAttr = (id: string): string => (compact ? "" : ` data-segment="${id}"`);

  const footForSide = (side: "left" | "right"): string => {
    const foot = detailById.get(`${side}-foot`);
    return foot ? `<path${segAttr(foot.id)} d="${dFmt(foot.d)}"/>` : "";
  };
  const limb = (id: string): string => {
    const item = limbById.get(id);
    if (!item) throw new Error(`Missing limb ${id}.`);
    const foot = item.kind === "leg" ? footForSide(id.startsWith("left") ? "left" : "right") : "";
    return `<path${segAttr(item.id)} d="${dFmt(item.d)}"/>${foot}`;
  };

  const torsoD = dFmt(
    detailById.get("torso")?.d ??
      `M${n(effectiveActor.segments[0]!.x1)} ${n(effectiveActor.segments[0]!.y1)}L${n(effectiveActor.segments[0]!.x2)} ${n(effectiveActor.segments[0]!.y2)}`
  );
  const rawAccessorySvg = renderActorAccessorySvg(
    effectiveActor,
    geometry,
    isBlueprint ? "#1e3a5f" : options.themeAccentColor,
    decimals
  );
  const accessorySvg = compact ? compactAddonSvgNumbers(rawAccessorySvg, decimals, true) : rawAccessorySvg;
  const finger =
    effectiveActor.action === "point" && detailById.get("point-finger")
      ? `<path${segAttr("point-finger")} d="${dFmt(detailById.get("point-finger")!.d)}"/>`
      : "";
  const accessoryAttr =
    !compact && effectiveActor.accessory && effectiveActor.accessory !== "none"
      ? ` data-accessory-type="${xml(effectiveActor.accessory)}"`
      : "";
  const joinAttrs = compact ? "" : ` stroke-linecap="round" stroke-linejoin="round"`;
  const headFill = isBlueprint ? "#f8fafc" : "#fff";
  const headStrokeAttrs = compact ? "" : ` stroke="${xml(effectiveActor.color)}" stroke-width="${n(strokeWidth)}"`;

  return (
    `<g data-actor="${xml(effectiveActor.id)}" data-action="${xml(effectiveActor.action)}"${accessoryAttr} fill="none" stroke="${xml(effectiveActor.color)}" stroke-width="${n(strokeWidth)}"${joinAttrs}>` +
    `${limb(geometry.segmentOrder[0]!)}${limb(geometry.segmentOrder[1]!)}` +
    `<path${segAttr("torso")} d="${torsoD}"/>` +
    `<circle${segAttr("head")} cx="${n(geometry.head.x)}" cy="${n(geometry.head.y)}" r="${n(geometry.headRadius)}" fill="${headFill}"${headStrokeAttrs}/>` +
    `${accessorySvg}` +
    `${limb(geometry.segmentOrder[3]!)}${limb(geometry.segmentOrder[4]!)}` +
    `${finger}</g>`
  );
}

export function renderSceneInnerSvg(frame: SampledFrame, options: SceneRenderOptions = {}): string {
  const decimals = options.decimals ?? 3;
  const isBlueprint = options.blueprint === true;
  const hatchPatternId = options.hatchPatternId ?? "sm-bp-hatch";
  const n = (value: number): string => number(value, decimals);
  const defaultColor = isBlueprint ? "#0f172a" : (options.defaultColor ?? "#202124");
  const hasActors = Boolean(frame.actors && frame.actors.length > 0);
  const actorMap = new Map<string, SampledActorFrame>(
    hasActors ? frame.actors!.map((actor) => [actor.id, actor]) : []
  );

  const renderLayerAddons = (layer: "back" | "front"): string => {
    if (!frame.addons || frame.addons.length === 0) return "";
    return frame.addons
      .filter((addon) => addon.layer === layer)
      .map((addon) => {
        const owner = addon.actorId !== undefined ? actorMap.get(addon.actorId) : undefined;
        const baseSw = owner ? Math.max(2.5, 11 * (owner.scale * 1.5) * 2 * 0.09) : 2.5;
        const sw = Math.max(baseSw, options.minStrokeWidth ?? 0);
        const svg = renderAddonSvg(addon, {
          strokeWidth: sw,
          themeColor: isBlueprint ? "#1e3a5f" : (owner?.color ?? defaultColor),
          ...(isBlueprint ? { blueprint: true, hatchPatternId } : {})
        });
        return decimals < 3 || options.compact === true
          ? compactAddonSvgNumbers(svg, decimals, options.compact === true)
          : svg;
      })
      .join("");
  };

  const backAddons = renderLayerAddons("back");

  let actorsMarkup: string;
  if (hasActors) {
    actorsMarkup = frame.actors!
      .map((actor) => renderActorFigureSvg(actor, frame.timeMs, options))
      .join("");
  } else {
    const fallbackActor: SampledActorFrame = {
      id: "actor",
      action: frame.action,
      x: frame.x,
      groundY: frame.groundY,
      head: frame.head,
      segments: frame.segments,
      ...(frame.facing !== undefined ? { facing: frame.facing } : {}),
      ...(frame.articulated ? { articulated: true } : {}),
      color: defaultColor,
      scale: 1,
      zIndex: 0
    };
    actorsMarkup = renderActorFigureSvg(fallbackActor, frame.timeMs, options);
  }

  let propMarkup = "";
  if (frame.prop) {
    const geometry = frameGeometry(frame);
    const sw = Math.max(geometry.strokeWidth, options.minStrokeWidth ?? 0);
    const propFill = isBlueprint ? `url(#${xml(hatchPatternId)})` : "#fff";
    const propStroke = isBlueprint ? "#1e3a5f" : xml(defaultColor);
    const handleStroke = isBlueprint ? "#0f172a" : xml(defaultColor);
    const propStyleAttr = isBlueprint ? ' data-style="blueprint"' : "";
    propMarkup =
      `<g data-prop="${xml(frame.prop.id)}"${propStyleAttr}>` +
      `<rect x="${n(frame.prop.x)}" y="${n(frame.prop.y)}" width="${n(frame.prop.width)}" height="${n(frame.prop.height)}" rx="3" fill="${propFill}" stroke="${propStroke}" stroke-width="${n(sw)}"/>` +
      (geometry.handlePath
        ? `<path data-part="handle" d="${compactPathNumbers(geometry.handlePath, decimals)}" fill="none" stroke="${handleStroke}" stroke-width="${n(1.4 * geometry.scale)}" stroke-linecap="round"/>`
        : "") +
      `</g>`;
  }

  const frontAddons = renderLayerAddons("front");
  return `${backAddons}${actorsMarkup}${propMarkup}${frontAddons}`;
}

function isMultiSceneFrame(frame: SampledFrame, program?: CompiledAnimation): boolean {
  return (
    program?.contractVersion === CONTRACT_VERSION_V2 ||
    Boolean(frame.actors && frame.actors.length > 0) ||
    Boolean(frame.addons && frame.addons.length > 0)
  );
}

function v1FrameMarkup(frame: SampledFrame, color: string, width: number, height: number): string {
  const geometry = frameGeometry(frame);
  const limbById = new Map(geometry.limbs.map(limb => [limb.id, limb]));
  const detailById = new Map(geometry.paths.map(item => [item.id, item]));
  const footForSide = (side: "left" | "right"): string => {
    const foot = detailById.get(`${side}-foot`);
    return foot ? `<path id="${foot.id}" d="${foot.d}"/>` : "";
  };
  const limb = (id: string): string => {
    const item = limbById.get(id);
    if (!item) throw new Error(`Missing limb ${id}.`);
    const foot = item.kind === "leg" ? footForSide(id.startsWith("left") ? "left" : "right") : "";
    return `<path id="${item.id}" d="${item.d}"/>${foot}`;
  };
  const figure = `${limb(geometry.segmentOrder[0]!)}${limb(geometry.segmentOrder[1]!)}<path id="torso" d="${geometry.paths.find(item => item.id === "torso")?.d ?? `M${number(frame.segments[0]!.x1)} ${number(frame.segments[0]!.y1)}L${number(frame.segments[0]!.x2)} ${number(frame.segments[0]!.y2)}`}"/>` +
    `<circle id="head" cx="${number(geometry.head.x)}" cy="${number(geometry.head.y)}" r="${number(geometry.headRadius)}" fill="#ffffff" stroke="${xml(color)}" stroke-width="${number(geometry.strokeWidth)}"/>` +
    `${limb(geometry.segmentOrder[3]!)}${limb(geometry.segmentOrder[4]!)}` +
    `${detailById.get("point-finger") ? `<path id="point-finger" d="${detailById.get("point-finger")!.d}"/>` : ""}`;
  const prop = frame.prop
    ? `<g id="prop"><rect x="${number(frame.prop.x)}" y="${number(frame.prop.y)}" width="${number(frame.prop.width)}" height="${number(frame.prop.height)}" rx="3" fill="#fff" stroke="${xml(color)}" stroke-width="${number(geometry.strokeWidth)}"/><path id="handle" d="${geometry.handlePath}" fill="none" stroke="${xml(color)}" stroke-width="${number(1.4 * geometry.scale)}" stroke-linecap="round"/></g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Stick figure ${xml(frame.action)} at ${number(frame.timeMs)} milliseconds" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#ffffff"/><path id="ground" d="M0 ${number(frame.groundY)}H${width}" stroke="#d8dbe0" stroke-width="1"/>
<g fill="none" stroke="${xml(color)}" stroke-width="${number(geometry.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${figure}</g>${prop}
</svg>`;
}

function multiSceneFrameMarkup(
  frame: SampledFrame,
  width: number,
  height: number,
  options: { defaultColor?: string; themeAccentColor?: string; background?: string } = {}
): string {
  const background = options.background ?? "#ffffff";
  const inner = renderSceneInnerSvg(frame, {
    ...(options.defaultColor !== undefined ? { defaultColor: options.defaultColor } : {}),
    ...(options.themeAccentColor !== undefined ? { themeAccentColor: options.themeAccentColor } : {})
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Stick figure ${xml(frame.action)} at ${number(frame.timeMs)} milliseconds" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="${xml(background)}"/><path id="ground" d="M0 ${number(frame.groundY)}H${width}" stroke="#d8dbe0" stroke-width="1"/>
<g id="scene">${inner}</g>
</svg>`;
}

export const BLUEPRINT_STAGE_STYLE =
  `.bp-d{font:10px Consolas,"Courier New",Courier,monospace;fill:#1e3a5f}` +
  `.bp-a{font:700 10px Consolas,"Courier New",Courier,monospace;fill:#0f172a;text-anchor:middle}` +
  `.bp-ax{font:8.5px Consolas,"Courier New",Courier,monospace;fill:#334155;text-anchor:middle}`;

function resolveRenderStyle(program: CompiledAnimation, options?: RenderStyleOptions): RenderStyle {
  if (options?.style !== undefined) {
    if (options.style !== "default" && options.style !== "blueprint") {
      throw new TypeError('Render style must be "default" or "blueprint".');
    }
    return options.style;
  }
  const v2Spec = program.contractVersion === CONTRACT_VERSION_V2 ? (program.spec as AnimationSpecV2) : undefined;
  return v2Spec?.theme?.style === "blueprint" ? "blueprint" : "default";
}

function renderBlueprintRegistrationMarkSvg(cx: number, cy: number, arm = 5, decimals = 1): string {
  const n = (v: number): string => number(v, decimals);
  return `<path data-part="registration-mark" d="M${n(cx - arm)} ${n(cy)}H${n(cx + arm)}M${n(cx)} ${n(cy - arm)}V${n(cy + arm)}" fill="none" stroke="#1e3a5f" stroke-width="1"/>`;
}

export function renderBlueprintStageBackdropSvg(
  width: number,
  height: number,
  groundY: number,
  customAnchors?: Record<string, Point2D>,
  decimals = 2
): string {
  const n = (v: number): string => number(v, decimals);
  const clampVal = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const margin = Math.min(12, Math.max(4, Math.floor(Math.min(width, height) * 0.08)));
  const regMarks = [
    renderBlueprintRegistrationMarkSvg(margin, margin, 5, 1),
    renderBlueprintRegistrationMarkSvg(width - margin, margin, 5, 1),
    renderBlueprintRegistrationMarkSvg(margin, height - margin, 5, 1),
    renderBlueprintRegistrationMarkSvg(width - margin, height - margin, 5, 1)
  ].join("");

  const anchors = resolveStageAnchors({ width, height }, groundY, customAnchors);
  const anchorEntries = [
    ["L", anchors.left?.x ?? Math.round(width * 0.18)],
    ["CL", anchors["center-left"]?.x ?? Math.round(width * 0.35)],
    ["C", anchors.center?.x ?? Math.round(width * 0.5)],
    ["CR", anchors["center-right"]?.x ?? Math.round(width * 0.65)],
    ["R", anchors.right?.x ?? Math.round(width * 0.82)]
  ] as const;

  const placeBelow = groundY <= height - 26;
  const codeY = placeBelow ? clampVal(groundY + 14, 12, height - 12) : clampVal(groundY - 16, 12, height - 4);
  const coordY = placeBelow ? clampVal(groundY + 24, 20, height - 3) : clampVal(groundY - 6, 20, height - 2);

  const anchorTicks = anchorEntries
    .map(([code, wx]) => {
      const ax = n(wx);
      const xInt = Math.round(wx) || 0;
      return (
        `<g data-anchor-tick="${code}">` +
        `<line x1="${ax}" y1="${n(groundY - 4)}" x2="${ax}" y2="${n(groundY + 4)}" stroke="#1e3a5f" stroke-width="1"/>` +
        `<text class="bp-a" x="${ax}" y="${n(codeY)}">${code}</text>` +
        `<text class="bp-ax" x="${ax}" y="${n(coordY)}">X=${xInt}</text>` +
        `</g>`
      );
    })
    .join("");

  const gyInt = Math.round(groundY) || 0;
  const datumLabelY = n(Math.max(16, groundY - 6));

  return (
    `<rect width="100%" height="100%" fill="#f8fafc"/>` +
    `<rect width="100%" height="100%" fill="url(#sm-bp-grid)"/>` +
    `<rect x="1.5" y="1.5" width="${n(Math.max(1, width - 3))}" height="${n(Math.max(1, height - 3))}" fill="none" stroke="#cbd5e1" stroke-width="1"/>` +
    `<g data-part="registration-marks">${regMarks}</g>` +
    `<path id="ground" data-part="ground-datum" d="M0 ${n(groundY)}H${width}" fill="none" stroke="#1e3a5f" stroke-width="1" stroke-dasharray="4 3"/>` +
    `<text class="bp-d" data-part="datum-label" x="${n(Math.max(8, width - 10))}" y="${datumLabelY}" text-anchor="end">Y=${gyInt}</text>` +
    `<g data-part="anchor-ticks">${anchorTicks}</g>`
  );
}

function renderBlueprintActorDimensionsSvg(frame: SampledFrame, width: number, decimals = 2): string {
  const n = (v: number): string => number(v, decimals);
  const clampVal = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const actors: ReadonlyArray<{ id: string; x: number; groundY: number; scale: number }> =
    frame.actors && frame.actors.length > 0
      ? frame.actors
      : [{ id: "actor", x: frame.x, groundY: frame.groundY, scale: 1 }];

  return actors
    .map((actor) => {
      const gy = actor.groundY;
      const actorScale = Number.isFinite(actor.scale) && actor.scale > 0 ? actor.scale : 1;
      const scaledHeightPx = 144 * actorScale;
      const leaderTopY = clampVal(gy - scaledHeightPx, 12, Math.max(14, gy - 16));
      const leaderX = clampVal(actor.x - 28 * actorScale - 10, 8, Math.max(8, width - 64));
      const rootTickX = clampVal(actor.x, 4, Math.max(4, width - 4));
      const rootLabelX = clampVal(rootTickX + 4, 8, Math.max(8, width - 56));
      const xInt = Math.round(actor.x) || 0;
      const heightCallout =
        Math.abs(actorScale - 1) < 0.005
          ? "144u"
          : `144u (${Math.round(scaledHeightPx) || 0}px)`;

      return (
        `<g data-part="dimension-leader" data-actor-dimension="${xml(actor.id)}">` +
        `<line data-part="rig-height-leader" x1="${n(leaderX)}" y1="${n(leaderTopY)}" x2="${n(leaderX)}" y2="${n(gy)}" stroke="#1e3a5f" stroke-width="1" stroke-dasharray="2 2"/>` +
        `<line x1="${n(leaderX - 4)}" y1="${n(leaderTopY)}" x2="${n(leaderX + 4)}" y2="${n(leaderTopY)}" stroke="#1e3a5f" stroke-width="1"/>` +
        `<line x1="${n(leaderX - 4)}" y1="${n(gy)}" x2="${n(leaderX + 4)}" y2="${n(gy)}" stroke="#1e3a5f" stroke-width="1"/>` +
        `<text class="bp-d" data-part="rig-height-label" x="${n(leaderX + 5)}" y="${n((leaderTopY + gy) / 2)}">${heightCallout}</text>` +
        `<line data-part="actor-root-tick" x1="${n(rootTickX)}" y1="${n(gy - 5)}" x2="${n(rootTickX)}" y2="${n(gy + 5)}" stroke="#0f172a" stroke-width="1.1"/>` +
        `<text class="bp-d" data-part="actor-root-label" x="${n(rootLabelX)}" y="${n(Math.max(16, gy - 6))}">x=${xInt}</text>` +
        `</g>`
      );
    })
    .join("");
}

export function renderBlueprintFrameSceneSvg(frame: SampledFrame, width: number, decimals = 3): string {
  const inner = renderSceneInnerSvg(frame, {
    defaultColor: "#0f172a",
    themeAccentColor: "#1e3a5f",
    blueprint: true,
    decimals
  });
  const dimensions = renderBlueprintActorDimensionsSvg(frame, width, decimals);
  return `${inner}${dimensions}`;
}

function blueprintFrameMarkup(
  frame: SampledFrame,
  width: number,
  height: number,
  customAnchors?: Record<string, Point2D>
): string {
  const backdrop = renderBlueprintStageBackdropSvg(width, height, frame.groundY, customAnchors, 3);
  const sceneInner = renderBlueprintFrameSceneSvg(frame, width, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" data-style="blueprint" role="img" aria-label="Stick figure ${xml(frame.action)} at ${number(frame.timeMs)} milliseconds" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
${renderBlueprintDefsSvg()}<style>${BLUEPRINT_STAGE_STYLE}</style>
${backdrop}
<g id="scene">${sceneInner}</g>
</svg>`;
}

export function renderSvgFrame(
  program: CompiledAnimation,
  timeMs = 0,
  mode: PlaybackMode = "normal",
  options?: RenderStyleOptions
): string {
  const style = resolveRenderStyle(program, options);
  const frame = sampleAnimation(program, timeMs, mode);
  const { width, height } = program.spec.canvas;
  const v2Spec = program.contractVersion === CONTRACT_VERSION_V2 ? (program.spec as AnimationSpecV2) : undefined;
  if (style === "blueprint") {
    return blueprintFrameMarkup(frame, width, height, v2Spec?.anchors);
  }
  const defaultColor = program.spec.actor?.color ?? "#202124";
  if (!isMultiSceneFrame(frame, program)) {
    return v1FrameMarkup(frame, defaultColor, width, height);
  }
  return multiSceneFrameMarkup(frame, width, height, {
    defaultColor,
    ...(v2Spec?.theme?.accentColor !== undefined ? { themeAccentColor: v2Spec.theme.accentColor } : {}),
    ...(v2Spec?.theme?.background !== undefined ? { background: v2Spec.theme.background } : {})
  });
}

function animateAttribute(attribute: string, values: number[], durationSeconds: number, keyTimes: string): string {
  return `<animate attributeName="${attribute}" dur="${number(durationSeconds)}s" values="${values.map((v) => number(v)).join(";")}" keyTimes="${keyTimes}" fill="freeze" calcMode="discrete"/>`;
}

function renderBlueprintAnimatedSvg(
  program: CompiledAnimation,
  samples: readonly SampledFrame[]
): string {
  const { durationMs, canvas } = program.spec;
  const v2Spec = program.contractVersion === CONTRACT_VERSION_V2 ? (program.spec as AnimationSpecV2) : undefined;
  const seconds = Math.max(0.1, durationMs / 1000);
  const intervals = Math.max(1, samples.length - 1);
  const slicePercent = number(100 / intervals, 4);
  const durStr = `${number(seconds, 4)}s`;
  const firstGroundY = samples[0]?.groundY ?? canvas.height * 0.82;
  const backdrop = renderBlueprintStageBackdropSvg(canvas.width, canvas.height, firstGroundY, v2Spec?.anchors, 2);

  const frameGroups = samples
    .map((sample, idx) => {
      const inner = renderBlueprintFrameSceneSvg(sample, canvas.width, 2);
      if (idx === samples.length - 1) {
        return `<g class="sm-f sm-last" data-frame="${idx}" data-time-ms="${number(sample.timeMs, 1)}">${inner}</g>`;
      }
      const delaySec = (seconds * idx) / intervals;
      return `<g class="sm-f" data-frame="${idx}" data-time-ms="${number(sample.timeMs, 1)}" style="animation-delay:${number(delaySec, 4)}s">${inner}</g>`;
    })
    .join("");

  const reducedSample = sampleAnimation(program, durationMs, "reduced");
  const reducedInner = renderBlueprintFrameSceneSvg(reducedSample, canvas.width, 2);

  const style =
    `${BLUEPRINT_STAGE_STYLE}` +
    `.sm-f{visibility:hidden;animation:sm-slice ${durStr} steps(1,end) 0s 1 normal forwards}` +
    `.sm-f.sm-last{animation-name:sm-final}` +
    `.sm-reduced{display:none}` +
    `@keyframes sm-slice{0%{visibility:visible}${slicePercent}%{visibility:hidden}100%{visibility:hidden}}` +
    `@keyframes sm-final{0%{visibility:hidden}100%{visibility:visible}}` +
    `@media (prefers-reduced-motion:reduce){.sm-f{animation:none!important;visibility:hidden!important}.sm-reduced{display:inline}}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" data-style="blueprint" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}" role="img" aria-label="Deterministic stick figure animation">
${renderBlueprintDefsSvg()}<style>${style}</style>
${backdrop}
${frameGroups}<g class="sm-reduced">${reducedInner}</g></svg>`;
}

function renderMultiSceneAnimatedSvg(
  program: CompiledAnimation,
  samples: readonly SampledFrame[]
): string {
  const { durationMs, canvas } = program.spec;
  const v2Spec = program.contractVersion === CONTRACT_VERSION_V2 ? (program.spec as AnimationSpecV2) : undefined;
  const defaultColor = program.spec.actor?.color ?? "#202124";
  const themeAccentColor = v2Spec?.theme?.accentColor;
  const background = v2Spec?.theme?.background ?? "#ffffff";
  const seconds = Math.max(0.1, durationMs / 1000);
  const intervals = Math.max(1, samples.length - 1);
  const slicePercent = number(100 / intervals, 4);
  const durStr = `${number(seconds, 4)}s`;

  const renderOpts: SceneRenderOptions = {
    defaultColor,
    ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
    decimals: 2
  };

  const frameGroups = samples
    .map((sample, idx) => {
      const inner = renderSceneInnerSvg(sample, renderOpts);
      if (idx === samples.length - 1) {
        return `<g class="sm-f sm-last" data-frame="${idx}" data-time-ms="${number(sample.timeMs, 1)}">${inner}</g>`;
      }
      const delaySec = (seconds * idx) / intervals;
      return `<g class="sm-f" data-frame="${idx}" data-time-ms="${number(sample.timeMs, 1)}" style="animation-delay:${number(delaySec, 4)}s">${inner}</g>`;
    })
    .join("");

  const reducedSample = sampleAnimation(program, durationMs, "reduced");
  const reducedInner = renderSceneInnerSvg(reducedSample, renderOpts);
  const firstGroundY = samples[0]?.groundY ?? canvas.height * 0.82;

  const style =
    `.sm-f{visibility:hidden;animation:sm-slice ${durStr} steps(1,end) 0s 1 normal forwards}` +
    `.sm-f.sm-last{animation-name:sm-final}` +
    `.sm-reduced{display:none}` +
    `@keyframes sm-slice{0%{visibility:visible}${slicePercent}%{visibility:hidden}100%{visibility:hidden}}` +
    `@keyframes sm-final{0%{visibility:hidden}100%{visibility:visible}}` +
    `@media (prefers-reduced-motion:reduce){.sm-f{animation:none!important;visibility:hidden!important}.sm-reduced{display:inline}}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}" role="img" aria-label="Deterministic stick figure animation">
<style>${style}</style>
<rect width="100%" height="100%" fill="${xml(background)}"/><path id="ground" d="M0 ${number(firstGroundY)}H${canvas.width}" stroke="#d8dbe0" stroke-width="1"/>
${frameGroups}<g class="sm-reduced">${reducedInner}</g></svg>`;
}

export function renderAnimatedSvg(program: CompiledAnimation, options?: RenderStyleOptions): string {
  const style = resolveRenderStyle(program, options);
  const { durationMs, canvas } = program.spec;
  // A cached vector frame must retain its solved bone lengths and contacts;
  // interpolating separate endpoints between poses breaks those constraints.
  const frames = Math.max(2, Math.ceil(durationMs * canvas.fps / 1000) + 1);
  const samples = Array.from({ length: frames }, (_, index) => sampleAnimation(program, durationMs * index / (frames - 1)));
  if (style === "blueprint") {
    return renderBlueprintAnimatedSvg(program, samples);
  }
  if (samples.some((sample) => isMultiSceneFrame(sample, program))) {
    return renderMultiSceneAnimatedSvg(program, samples);
  }
  const shapes = samples.map(frameGeometry);
  const keys = samples.map((_, index) => (index / (frames - 1)).toString()).join(";");
  const seconds = durationMs / 1000;
  const first = samples[0]!;
  const firstShape = shapes[0]!;
  const color = program.spec.actor?.color ?? "#202124";
  const limbFor = (shape: typeof firstShape, side: "left" | "right", kind: "arm" | "leg") =>
    shape.limbs.find(limb => limb.id === `${side}-${kind}`)!;
  const pathFor = (shape: typeof firstShape, id: string) => shape.paths.find(item => item.id === id)!;
  const animatedPath = (id: string, initialD: string, values: string[], visibility?: string[]): string =>
    `<path id="${id}" d="${initialD}"><animate attributeName="d" dur="${number(seconds)}s" values="${values.join(";")}" keyTimes="${keys}" fill="freeze" calcMode="discrete"/>${visibility ? `<animate attributeName="visibility" dur="${number(seconds)}s" values="${visibility.join(";")}" keyTimes="${keys}" fill="freeze" calcMode="discrete"/>` : ""}</path>`;
  const limbLayer = (near: boolean): string => {
    const name = near ? "near" : "far";
    const sides = (["left", "right"] as const).flatMap(side => (["arm", "leg"] as const).map(kind => {
      const limbs = shapes.map(shape => limbFor(shape, side, kind));
      const visibility = limbs.map(limb => limb.near === near ? "visible" : "hidden");
      const foot = kind === "leg"
        ? animatedPath(`${name}-${side}-foot`, pathFor(firstShape, `${side}-foot`).d, shapes.map(shape => pathFor(shape, `${side}-foot`).d), visibility)
        : "";
      return animatedPath(`${name}-${side}-${kind}`, limbs[0]!.d, limbs.map(limb => limb.d), visibility) + foot;
    })).join("");
    return `<g data-layer="${name}">${sides}</g>`;
  };
  const torso = animatedPath("torso", pathFor(firstShape, "torso").d, shapes.map(shape => pathFor(shape, "torso").d));
  const pointFinger = animatedPath("point-finger", pathFor(firstShape, "point-finger").d, shapes.map(shape => pathFor(shape, "point-finger").d));
  const head = `<circle id="head" cx="${number(firstShape.head.x)}" cy="${number(firstShape.head.y)}" r="${number(firstShape.headRadius)}" fill="#fff" stroke="${xml(color)}" stroke-width="${number(firstShape.strokeWidth)}">${animateAttribute("cx", shapes.map(shape => shape.head.x), seconds, keys)}${animateAttribute("cy", shapes.map(shape => shape.head.y), seconds, keys)}</circle>`;
  const prop = first.prop
    ? `<g id="prop"><rect y="${number(first.prop.y)}" width="${number(first.prop.width)}" height="${number(first.prop.height)}" rx="3" fill="#fff" stroke="${xml(color)}" stroke-width="${number(firstShape.strokeWidth)}">${animateAttribute("x", samples.map(s => s.prop!.x), seconds, keys)}</rect><path id="handle" d="${firstShape.handlePath}" fill="none" stroke="${xml(color)}" stroke-width="${number(1.4 * firstShape.scale)}" stroke-linecap="round"><animate attributeName="d" dur="${number(seconds)}s" values="${shapes.map(shape => shape.handlePath).join(";")}" keyTimes="${keys}" fill="freeze" calcMode="discrete"/></path></g>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}" role="img" aria-label="Deterministic stick figure animation">
<rect width="100%" height="100%" fill="#fff"/><path id="ground" d="M0 ${number(first.groundY)}H${canvas.width}" stroke="#d8dbe0"/>
<g fill="none" stroke="${xml(color)}" stroke-width="${number(firstShape.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${limbLayer(false)}${torso}${head}${limbLayer(true)}${pointFinger}</g>${prop}</svg>`;
}

const HTML_SHELL_STYLE = `
:root {
  color-scheme: light;
  --cp-bg: #f7f4ef;
  --cp-bg-elevated: #fcfbf8;
  --cp-surface: #ffffff;
  --cp-surface-soft: #f5f5f5;
  --cp-border: #dedede;
  --cp-border-strong: #919191;
  --cp-text: #242424;
  --cp-text-muted: #5c5c5c;
  --cp-text-soft: #6f6f6f;
  --cp-actor-ink: #202124;
  --cp-accent: #b11f4b;
  --cp-accent-hover: #9a1a41;
  --cp-accent-soft: rgba(177, 31, 75, 0.08);
  --cp-accent-fg: #ffffff;
  --cp-success: #16a34a;
  --cp-danger: #dc2626;
  --cp-warning: #f59e0b;
  --cp-link: #0078d4;
  --cp-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --cp-dur-fast: 140ms;
  --cp-dur-enter: 180ms;
  --cp-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06);
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  --cp-overlay: rgba(255, 255, 255, 0.8);
  --cp-panel: rgba(255, 255, 255, 0.86);
  --cp-panel-strong: rgba(255, 255, 255, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.55);
  --cp-highlight: rgba(177, 31, 75, 0.12);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --cp-bg: #3d3b3a;
  --cp-bg-elevated: #343231;
  --cp-surface: #292929;
  --cp-surface-soft: #2e2e2e;
  --cp-border: #474747;
  --cp-border-strong: #5f5f5f;
  --cp-text: #dedede;
  --cp-text-muted: #919191;
  --cp-text-soft: #b0b0b0;
  --cp-actor-ink: #dedede;
  --cp-accent: #fd8ea1;
  --cp-accent-hover: #fb7b91;
  --cp-accent-soft: rgba(253, 142, 161, 0.14);
  --cp-accent-fg: #1a1a1a;
  --cp-success: #4ade80;
  --cp-danger: #f87171;
  --cp-warning: #fbbf24;
  --cp-link: #4da6ff;
  --cp-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --cp-dur-fast: 140ms;
  --cp-dur-enter: 180ms;
  --cp-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.24), 0 8px 24px rgba(0, 0, 0, 0.32);
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  --cp-overlay: rgba(41, 41, 41, 0.88);
  --cp-panel: rgba(41, 41, 41, 0.72);
  --cp-panel-strong: rgba(41, 41, 41, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.04);
  --cp-highlight: rgba(253, 142, 161, 0.12);
}
body{margin:0;background:var(--cp-bg);color:var(--cp-text);font:16px "Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif}
main{max-width:1000px;margin:2rem auto;padding:1rem}svg{display:block;width:100%;height:auto;background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:0.625rem;box-shadow:var(--cp-card-shadow)}
nav{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;padding:.8rem 0}input[type="range"]{min-width:12rem;accent-color:var(--cp-accent)}
button,select{font:inherit;background:var(--cp-surface);color:var(--cp-text);border:1px solid var(--cp-border);border-radius:0.625rem;padding:.35rem .6rem;transition:border-color var(--cp-dur-fast) var(--cp-ease-out),background-color var(--cp-dur-fast) var(--cp-ease-out),transform var(--cp-dur-fast) var(--cp-ease-out),opacity var(--cp-dur-fast) var(--cp-ease-out)}
button{cursor:pointer}button:hover,select:hover{border-color:var(--cp-accent)}button:active{transform:scale(0.98)}:focus-visible{outline:3px solid var(--cp-accent);outline-offset:4px}
.cp-timecode,output,[data-timecode],[data-frame-counter]{font-variant-numeric:tabular-nums;font-family:Consolas,"Courier New",Courier,monospace;font-size:.875rem;color:var(--cp-text-muted);min-width:11ch;text-align:right}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
`;

function collectBakedTimestamps(program: CompiledAnimation): number[] {
  const { durationMs, canvas } = program.spec;
  const raw = new Set<number>([0, durationMs]);
  const steps = Math.max(1, Math.ceil((durationMs * canvas.fps) / 1000));
  for (let i = 0; i <= steps; i++) {
    raw.add(Math.min(durationMs, Number(((i * 1000) / canvas.fps).toFixed(3))));
  }
  for (const event of program.events ?? []) {
    if (Number.isFinite(event.timeMs)) {
      raw.add(Math.max(0, Math.min(durationMs, Number(event.timeMs.toFixed(3)))));
    }
  }
  if (program.contractVersion === CONTRACT_VERSION_V2) {
    const v2 = program.spec as AnimationSpecV2;
    for (const actor of v2.actors) {
      for (const act of actor.actions) {
        raw.add(Math.max(0, Math.min(durationMs, act.startMs)));
        raw.add(Math.max(0, Math.min(durationMs, act.startMs + act.durationMs)));
      }
    }
  } else {
    const v1 = program.spec as AnimationSpec;
    for (const act of v1.actions) {
      raw.add(Math.max(0, Math.min(durationMs, act.startMs)));
      raw.add(Math.max(0, Math.min(durationMs, act.startMs + act.durationMs)));
    }
  }
  const sorted = [...raw].sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const t of sorted) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1]! >= 0.5 || t === durationMs) {
      if (deduped.length > 0 && t === durationMs && durationMs - deduped[deduped.length - 1]! < 0.5) {
        deduped[deduped.length - 1] = durationMs;
      } else {
        deduped.push(t);
      }
    }
  }
  return deduped;
}

interface BakedHtmlFrame {
  timeMs: number;
  action: string;
  groundY: number;
  markup: string;
}

function renderBakedHtml(program: CompiledAnimation, style: RenderStyle): string {
  const { canvas, durationMs } = program.spec;
  const v2Spec = program.contractVersion === CONTRACT_VERSION_V2 ? (program.spec as AnimationSpecV2) : undefined;
  const defaultColor = program.spec.actor?.color ?? "#202124";
  const themeAccentColor = v2Spec?.theme?.accentColor;
  const renderOpts: SceneRenderOptions = {
    defaultColor,
    ...(themeAccentColor !== undefined ? { themeAccentColor } : {}),
    decimals: 2
  };
  const renderFrameMarkup = (frame: SampledFrame): string =>
    style === "blueprint"
      ? renderBlueprintFrameSceneSvg(frame, canvas.width, 2)
      : renderSceneInnerSvg(frame, renderOpts);

  const svg = renderSvgFrame(program, 0, "normal", { style });
  const controls = `<label>Motion mode <select id="mode"><option value="normal">Normal</option><option value="reduced">Reduced</option><option value="static">Static</option></select></label><label>Playhead <input id="seek" type="range" min="0" max="${durationMs}" step="1" value="0"></label><output id="timecode" class="cp-timecode" data-timecode="true" for="seek">0.00s / ${(durationMs / 1000).toFixed(2)}s</output><button id="toggle" type="button">Pause</button>`;

  const timestamps = collectBakedTimestamps(program);
  const bakedFrames: BakedHtmlFrame[] = timestamps.map((t) => {
    const frame = sampleAnimation(program, t, "normal");
    return {
      timeMs: Number(frame.timeMs.toFixed(3)),
      action: frame.action,
      groundY: Number(frame.groundY.toFixed(3)),
      markup: renderFrameMarkup(frame)
    };
  });

  const reducedSample = sampleAnimation(program, durationMs, "reduced");
  const bakedReduced: BakedHtmlFrame = {
    timeMs: Number(reducedSample.timeMs.toFixed(3)),
    action: reducedSample.action,
    groundY: Number(reducedSample.groundY.toFixed(3)),
    markup: renderFrameMarkup(reducedSample)
  };

  const script = `(()=>{"use strict";const program=${scriptJson(program)};const frames=${scriptJson(bakedFrames)};const reducedFrame=${scriptJson(bakedReduced)};const lookup=(timeMs,mode)=>{if(mode!=="normal")return reducedFrame;const clamped=Math.max(0,Math.min(program.spec.durationMs,timeMs));let lo=0,hi=frames.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(frames[mid].timeMs<=clamped+1e-6)lo=mid;else hi=mid-1;}return frames[lo];};const svg=document.querySelector("#stage svg");const sceneEl=document.getElementById("scene")||(document.querySelector?document.querySelector("#scene"):null);const groundEl=document.getElementById("ground")||(document.querySelector?document.querySelector("#ground"):null);
const modeSelect=document.querySelector("#mode"),seek=document.querySelector("#seek"),toggle=document.querySelector("#toggle"),timecode=document.getElementById?document.getElementById("timecode"):null;
const duration=program.spec.durationMs;
let mode=matchMedia("(prefers-reduced-motion: reduce)").matches?"reduced":"normal";
modeSelect.value=mode;let time=0;let playing=mode==="normal";let previous=0;let requestId=null;
toggle.textContent=playing?"Pause":"Play";
function draw(){
const frameDuration=1000/program.spec.canvas.fps;
const sampleTime=mode==="normal"?Math.min(duration,Math.floor(time/frameDuration+1e-9)*frameDuration):duration;
const frame=lookup(mode==="normal"?time:sampleTime,mode);
if(sceneEl){sceneEl.innerHTML=frame.markup;if(sceneEl.setAttribute){sceneEl.setAttribute("data-time-ms",String(frame.timeMs));sceneEl.setAttribute("data-action",frame.action);}}
if(groundEl)groundEl.setAttribute("d","M0 "+frame.groundY+"H"+program.spec.canvas.width);
if(svg)svg.setAttribute("aria-label","Stick figure "+frame.action+" at "+frame.timeMs+" milliseconds");
const shownMs=mode==="normal"?frame.timeMs:duration;
seek.value=String(Math.round(shownMs));
if(timecode)timecode.textContent=(shownMs/1000).toFixed(2)+"s / "+(duration/1000).toFixed(2)+"s";
}
function stop(){playing=false;previous=0;if(requestId!==null){cancelAnimationFrame(requestId);requestId=null;}toggle.textContent="Play";}
function schedule(){if(playing&&requestId===null)requestId=requestAnimationFrame(tick);}
const events=program.events||[];let emitted=-1;function emit(from,to){for(const e of events){if(e.timeMs>from&&e.timeMs<=to){const detail={...e};if(document.dispatchEvent)document.dispatchEvent(new CustomEvent("stickman:marker",{detail}));if(typeof window!=="undefined"&&window.parent&&window.parent!==window)window.parent.postMessage({type:"stickman:marker",...detail},"*");}}}
function tick(now){requestId=null;if(!playing)return;if(previous)time+=now-previous;previous=now;if(time>=duration){time=duration;stop();}const before=emitted;emitted=time;emit(before,time);draw();schedule();}
function start(){if(mode!=="normal"){mode="normal";modeSelect.value=mode;}if(time>=duration)time=0;emitted=time>0?time:-1;playing=true;previous=0;toggle.textContent="Pause";draw();schedule();}
modeSelect.addEventListener("change",()=>{stop();mode=modeSelect.value;if(mode==="normal"){time=0;start();}else{time=duration;draw();}});
seek.addEventListener("input",()=>{time=Number(seek.value);emitted=time;previous=0;draw();});
toggle.addEventListener("click",()=>{if(playing)stop();else start();});
draw();schedule();})();`;

  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stickman animation</title>
<script>(()=>{const param=new URLSearchParams(window.location.search).get("scoutTheme");const theme=param||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",theme);})();</script>
<style>${HTML_SHELL_STYLE}</style>
<main><nav>${controls}</nav><div id="stage">${svg}</div></main><script id="stickman-player">${script}</script></html>`;
}

export function renderHtml(program: CompiledAnimation, options?: RenderStyleOptions): string {
  const style = resolveRenderStyle(program, options);
  if (style === "blueprint" || program.contractVersion === CONTRACT_VERSION_V2) {
    return renderBakedHtml(program, style);
  }
  const { canvas } = program.spec;
  const svg = v1FrameMarkup(sampleAnimation(program, 0), program.spec.actor?.color ?? "#202124", canvas.width, canvas.height);
  const controls = `<label>Motion mode <select id="mode"><option value="normal">Normal</option><option value="reduced">Reduced</option><option value="static">Static</option></select></label><label>Playhead <input id="seek" type="range" min="0" max="${program.spec.durationMs}" step="1" value="0"></label><output id="timecode" class="cp-timecode" data-timecode="true" for="seek">0.00s / ${(program.spec.durationMs / 1000).toFixed(2)}s</output><button id="toggle" type="button">Pause</button>`;
  const script = `(()=>{"use strict";const program=${scriptJson(program)};const geometry=${frameGeometry.toString()};const sample=(program,timeMs,mode)=>{const RUNTIME_MOTION_LIBRARY=${scriptJson(RUNTIME_MOTION_LIBRARY)};globalThis.__stickmanMotionLibrary=RUNTIME_MOTION_LIBRARY;const sampleClipMotion=${sampleClipMotion.toString()};globalThis.__stickmanSampleClipMotion=sampleClipMotion;return (${sampleAnimation.toString()})(program,timeMs,mode);};const svg=document.querySelector("#stage svg");
const modeSelect=document.querySelector("#mode"),seek=document.querySelector("#seek"),toggle=document.querySelector("#toggle"),timecode=document.getElementById?document.getElementById("timecode"):null;
const duration=program.spec.durationMs;
let mode=matchMedia("(prefers-reduced-motion: reduce)").matches?"reduced":"normal";
modeSelect.value=mode;let time=0;let playing=mode==="normal";let previous=0;let requestId=null;
toggle.textContent=playing?"Pause":"Play";
function draw(){
const frameDuration=1000/program.spec.canvas.fps;
const sampleTime=mode==="normal"?Math.min(program.spec.durationMs,Math.floor(time/frameDuration+1e-9)*1000/program.spec.canvas.fps):time;
const frame=sample(program,sampleTime,mode),shape=geometry(frame);
for(const limb of shape.limbs){const el=document.getElementById(limb.id);if(!el)throw Error("Missing limb "+limb.id);el.setAttribute("d",limb.d);}
for(const detail of shape.paths){const el=document.getElementById(detail.id);if(el)el.setAttribute("d",detail.d);}
const head=document.getElementById("head");head.setAttribute("cx",shape.head.x);head.setAttribute("cy",shape.head.y);head.setAttribute("r",shape.headRadius);
function appendDrawn(id){const el=document.getElementById(id);if(el)el.parentNode.appendChild(el);if(id.endsWith("-leg")){const foot=document.getElementById(id.replace("-leg","-foot"));if(foot)foot.parentNode.appendChild(foot);}}
for(const id of shape.segmentOrder.slice(0,3)){appendDrawn(id);}
head.parentNode.appendChild(head);
for(const id of shape.segmentOrder.slice(3)){appendDrawn(id);}
const finger=document.getElementById("point-finger");if(finger)finger.parentNode.appendChild(finger);
document.getElementById("ground").setAttribute("d","M0 "+frame.groundY+"H"+program.spec.canvas.width);
svg.setAttribute("aria-label","Stick figure "+frame.action+" at "+frame.timeMs+" milliseconds");
const prop=document.querySelector("#prop");if(frame.prop&&prop){prop.querySelector("rect").setAttribute("x",frame.prop.x);document.getElementById("handle").setAttribute("d",shape.handlePath);}
seek.value=String(frame.timeMs);
if(timecode)timecode.textContent=(frame.timeMs/1000).toFixed(2)+"s / "+(duration/1000).toFixed(2)+"s";
}
function stop(){playing=false;previous=0;if(requestId!==null){cancelAnimationFrame(requestId);requestId=null;}toggle.textContent="Play";}
function schedule(){if(playing&&requestId===null)requestId=requestAnimationFrame(tick);}
const events=program.events||[];let emitted=-1;function emit(from,to){for(const e of events){if(e.timeMs>from&&e.timeMs<=to){const detail={...e};document.dispatchEvent(new CustomEvent("stickman:marker",{detail}));if(typeof window!=="undefined"&&window.parent&&window.parent!==window)window.parent.postMessage({type:"stickman:marker",...detail},"*");}}}
function tick(now){requestId=null;if(!playing)return;if(previous)time+=now-previous;previous=now;if(time>=duration){time=duration;stop();}const before=emitted;emitted=time;emit(before,time);draw();schedule();}
function start(){if(mode!=="normal"){mode="normal";modeSelect.value=mode;}if(time>=duration)time=0;emitted=time>0?time:-1;playing=true;previous=0;toggle.textContent="Pause";draw();schedule();}
modeSelect.addEventListener("change",()=>{stop();mode=modeSelect.value;if(mode==="normal"){time=0;start();}else{time=duration;draw();}});
seek.addEventListener("input",()=>{time=Number(seek.value);emitted=time;previous=0;draw();});
toggle.addEventListener("click",()=>{if(playing)stop();else start();});
draw();schedule();})();`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stickman animation</title>
<script>(()=>{const param=new URLSearchParams(window.location.search).get("scoutTheme");const theme=param||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",theme);})();</script>
<style>${HTML_SHELL_STYLE}</style>
<main><nav>${controls}</nav><div id="stage">${svg}</div></main><script id="stickman-player">${script}</script></html>`;
}

export const renderHtmlPreview = renderHtml;
