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

export const fk = { note: "Use clip-space frame angles with the shared engine rig; full BVH FK is provided by the legacy builder." };
