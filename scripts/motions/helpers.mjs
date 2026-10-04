export const deepClone = (value) => JSON.parse(JSON.stringify(value));

export function wrapDeg(angle) {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

export function angleLerp(a, b, t) {
  return a + wrapDeg(b - a) * t;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function resampleFrames(frames, fromFps, toFps) {
  if (!frames.length || fromFps === toFps) return deepClone(frames);
  const duration = (frames.length - 1) / fromFps;
  const count = Math.max(2, Math.round(duration * toFps) + 1);
  return Array.from({ length: count }, (_, i) => sampleFrame(frames, (i / toFps) * fromFps));
}

export function sampleFrame(frames, index) {
  const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(index)));
  const i1 = Math.max(0, Math.min(frames.length - 1, i0 + 1));
  const t = index - i0;
  const a = frames[i0], b = frames[i1];
  const out = deepClone(a);
  out.root.x = lerp(a.root.x, b.root.x, t);
  out.root.y = lerp(a.root.y, b.root.y, t);
  for (const key of Object.keys(out.angles ?? {})) {
    if (typeof out.angles[key] === "number") out.angles[key] = angleLerp(a.angles[key], b.angles[key], t);
    else for (const sub of Object.keys(out.angles[key] ?? {})) out.angles[key][sub] = angleLerp(a.angles[key][sub], b.angles[key][sub], t);
  }
  out.contacts = t < 0.5 ? deepClone(a.contacts) : deepClone(b.contacts);
  if (a.hands || b.hands) out.hands = t < 0.5 ? deepClone(a.hands ?? {}) : deepClone(b.hands ?? {});
  if (a.facing != null || b.facing != null) out.facing = lerp(a.facing ?? 1, b.facing ?? 1, t);
  return out;
}

export function smoothFrames(frames, passes = 1) {
  let out = deepClone(frames);
  for (let pass = 0; pass < passes; pass++) {
    out = out.map((frame, i) => {
      if (i === 0 || i === out.length - 1) return deepClone(frame);
      const prev = out[i - 1], next = out[i + 1], mid = deepClone(frame);
      mid.root.x = (prev.root.x + frame.root.x * 2 + next.root.x) / 4;
      mid.root.y = (prev.root.y + frame.root.y * 2 + next.root.y) / 4;
      for (const key of Object.keys(mid.angles ?? {})) {
        if (typeof mid.angles[key] === "number") mid.angles[key] = angleLerp(angleLerp(prev.angles[key], frame.angles[key], 0.5), angleLerp(frame.angles[key], next.angles[key], 0.5), 0.5);
        else for (const sub of Object.keys(mid.angles[key] ?? {})) mid.angles[key][sub] = angleLerp(angleLerp(prev.angles[key][sub], frame.angles[key][sub], 0.5), angleLerp(frame.angles[key][sub], next.angles[key][sub], 0.5), 0.5);
      }
      return mid;
    });
  }
  return out;
}

export function easeFramesToIdle(frames, idleFrame, easeIn = 0, easeOut = 0) {
  const out = deepClone(frames);
  const blend = (frame, t) => {
    const f = deepClone(frame);
    f.root.y = lerp(idleFrame.root.y, frame.root.y, t);
    for (const key of Object.keys(f.angles ?? {})) {
      if (typeof f.angles[key] === "number") f.angles[key] = angleLerp(idleFrame.angles[key], frame.angles[key], t);
      else for (const sub of Object.keys(f.angles[key] ?? {})) f.angles[key][sub] = angleLerp(idleFrame.angles[key][sub], frame.angles[key][sub], t);
    }
    return f;
  };
  for (let i = 0; i < Math.min(easeIn, out.length); i++) out[i] = blend(out[i], i / Math.max(1, easeIn));
  for (let i = 0; i < Math.min(easeOut, out.length); i++) {
    const ix = out.length - 1 - i;
    out[ix] = blend(out[ix], i / Math.max(1, easeOut));
  }
  return out;
}

export function twoBoneIK(root, target, upper, lower, bendSign = 1) {
  const dx = target.x - root.x, dy = target.y - root.y;
  const dist = Math.max(0.001, Math.min(upper + lower - 0.001, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const cosA = (upper * upper + dist * dist - lower * lower) / (2 * upper * dist);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA))) * bendSign;
  const mid = { x: root.x + Math.cos(base + a) * upper, y: root.y + Math.sin(base + a) * upper };
  return { mid, end: target };
}

export function lockContactRoots(frames, _options = {}) {
  return deepClone(frames);
}

export function computeStickPose(frame, rig) {
  const dir = (angle) => ({ x: Math.cos(angle * Math.PI / 180), y: Math.sin(angle * Math.PI / 180) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, scalar) => ({ x: a.x * scalar, y: a.y * scalar });
  const angles = frame.angles;
  const hip = { x: frame.root.x, y: frame.root.y };
  const shoulder = add(hip, mul(dir(angles.torso), rig.torso));
  const leg = (side) => {
    const value = angles[`${side}Leg`];
    const thighAngle = angles.torso + 180 + value.thigh;
    const knee = add(hip, mul(dir(thighAngle), rig.thigh));
    const shinAngle = thighAngle + value.shin;
    const ankle = add(knee, mul(dir(shinAngle), rig.shin));
    const toe = add(ankle, mul(dir(shinAngle + value.foot), rig.foot));
    return { hip, knee, ankle, toe, thighAngle, shinAngle };
  };
  const arm = (side) => {
    const value = angles[`${side}Arm`];
    const upperAngle = angles.torso + value.upper;
    const elbow = add(shoulder, mul(dir(upperAngle), rig.upperArm));
    const foreAngle = upperAngle + value.fore;
    const hand = add(elbow, mul(dir(foreAngle), rig.forearm));
    return { shoulder, elbow, hand, upperAngle, foreAngle };
  };
  return { hip, shoulder, lLeg: leg("l"), rLeg: leg("r"), lArm: arm("l"), rArm: arm("r") };
}

function interiorAngle(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  const denom = Math.max(0.0001, Math.hypot(ux, uy) * Math.hypot(vx, vy));
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denom));
  return Math.acos(cos) * 180 / Math.PI;
}

function signedDistanceFromLine(a, b, p) {
  const vx = b.x - a.x, vy = b.y - a.y;
  return (vx * (p.y - a.y) - vy * (p.x - a.x)) / Math.max(0.0001, Math.hypot(vx, vy));
}

function signedDistanceInFacingDirection(a, b, p, facing) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const cross = vx * wy - vy * wx;
  const denom = -vy * Math.sign(facing);
  if (Math.abs(denom) < 0.001) return Math.sign(facing) * signedDistanceFromLine(a, b, p);
  return cross / denom;
}

export function anatomicalGates(clip, spec = {}, options = {}) {
  const overrides = spec.gates?.overrides ?? {};
  const thresholds = {
    kneeBackDistance: overrides.kneeBackDistance ?? options.kneeBackDistance ?? 1.5,
    straightKneeAngle: overrides.straightKneeAngle ?? options.straightKneeAngle ?? 172,
    minKneeInteriorAngle: overrides.minKneeInteriorAngle ?? options.minKneeInteriorAngle ?? 40,
    minElbowInteriorAngle: overrides.minElbowInteriorAngle ?? options.minElbowInteriorAngle ?? 30,
    elbowFrontDistance: overrides.elbowFrontDistance ?? options.elbowFrontDistance ?? 4,
  };
  const rig = clip.rig ?? { thigh: 22.5, shin: 22.5, foot: 7, torso: 30, upperArm: 17, forearm: 16 };
  const worst = {
    kneeDirection: { name: "knee-direction", pass: true, value: 0, threshold: `>= -${thresholds.kneeBackDistance} unless straight`, frame: null, side: null },
    kneeInterior: { name: "knee-interior-angle", pass: true, value: 180, threshold: `>= ${thresholds.minKneeInteriorAngle}`, frame: null, side: null },
    elbowInterior: { name: "elbow-interior-angle", pass: true, value: 180, threshold: `>= ${thresholds.minElbowInteriorAngle}`, frame: null, side: null },
    elbowDirection: { name: "elbow-direction", pass: true, value: 0, threshold: `<= ${thresholds.elbowFrontDistance} when hand below shoulder`, frame: null, side: null },
  };
  for (const [frameIndex, frame] of (clip.frames ?? []).entries()) {
    const facing = frame.facing ?? (clip.meta?.facingChange === 180 ? 1 : 1);
    const pose = computeStickPose(frame, rig);
    for (const side of ["l", "r"]) {
      const leg = pose[`${side}Leg`];
      const kneeAngle = interiorAngle(leg.hip, leg.knee, leg.ankle);
      if (kneeAngle < worst.kneeInterior.value) Object.assign(worst.kneeInterior, { value: Number(kneeAngle.toFixed(3)), frame: frameIndex, side });
      if (kneeAngle < thresholds.minKneeInteriorAngle) worst.kneeInterior.pass = false;
      if (Math.abs(facing) >= 0.3) {
        const frontness = signedDistanceInFacingDirection(leg.hip, leg.ankle, leg.knee, facing);
        if (frontness < worst.kneeDirection.value) Object.assign(worst.kneeDirection, { value: Number(frontness.toFixed(3)), frame: frameIndex, side, kneeAngle: Number(kneeAngle.toFixed(3)) });
        if (frontness < -thresholds.kneeBackDistance && kneeAngle < thresholds.straightKneeAngle) worst.kneeDirection.pass = false;
      }
      const arm = pose[`${side}Arm`];
      const elbowAngle = interiorAngle(arm.shoulder, arm.elbow, arm.hand);
      if (elbowAngle < worst.elbowInterior.value) Object.assign(worst.elbowInterior, { value: Number(elbowAngle.toFixed(3)), frame: frameIndex, side });
      if (elbowAngle < thresholds.minElbowInteriorAngle) worst.elbowInterior.pass = false;
      if (Math.abs(facing) >= 0.3 && arm.hand.y < arm.shoulder.y) {
        const frontness = signedDistanceInFacingDirection(arm.shoulder, arm.hand, arm.elbow, facing);
        if (frontness > worst.elbowDirection.value) Object.assign(worst.elbowDirection, { value: Number(frontness.toFixed(3)), frame: frameIndex, side });
        if (frontness > thresholds.elbowFrontDistance) worst.elbowDirection.pass = false;
      }
    }
  }
  return Object.values(worst);
}

export const fk = { note: "Use clip-space frame angles with the shared engine rig; full BVH FK is provided by the legacy builder." };
