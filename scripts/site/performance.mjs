// One continuous performance per film: approved key-pose motions are concatenated into a single
// engine clip, joined by eased blends, and linked by generated walks. The camera never moves.
import { buildKeyPoseClip } from "../motions/keypose.mjs";
import { engineSampledFrame, figureMarkup, renderStaticSvg } from "../motions/review-renderer.mjs";

export const FILM_SCALE = 2.4;
export const FILM_GROUND = 540;
const UNIT = 0.75;
const ROOT_X = 160;
const GROUND_Y = 150;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const round = value => Number(value.toFixed(2));

const walkPose = (dx, r, l, anchor, rArm, extra = {}) => ({
  anchor, lean: 3, neck: -1, bob: 0, dx,
  rLeg: { hip: 8, knee: 16 }, lLeg: { hip: 8, knee: 16 },
  rArm: { shoulder: rArm, elbow: 30 }, lArm: { shoulder: -rArm, elbow: 30 },
  rFoot: { x: r[0], y: r[1] }, lFoot: { x: l[0], y: l[1] }, ...extra
});

/** A walk built from the approved walk-on gait: start step, scaled half-cycles and a settling stop. */
export function walkSpec(distance, facing = 1, pace = 18) {
  if (!Number.isFinite(distance) || distance < 48) throw new Error(`A walk needs at least 48 units of travel (got ${distance}).`);
  if (Math.abs(facing) !== 1) throw new Error("Walks face left or right.");
  const at = fraction => Math.round(pace * fraction / 21);
  const keys = [];
  const push = (frame, pose) => keys.push({ frame, ease: "linear", pose: { ...pose, facing } });
  const feet = (side, swing, planted) => side === "r" ? { r: swing, l: planted } : { r: planted, l: swing };
  push(0, walkPose(0, [5, 0], [-7, 0], "both", -8, { lean: 2 }));
  push(at(3), walkPose(3, [5, 0], [-7, 4], "r", -4));
  push(at(10), walkPose(12, [5, 0], [16, 6], "r", 6));
  push(at(17), walkPose(20, [5, 0], [38, 4], "r", 16));
  let t = pace;
  push(t, walkPose(25, [5, 0], [45, 0], "both", 22));
  let front = { side: "l", x: 45 }, rear = { side: "r", x: 5 };
  const adjust = side => side === "r" ? -5 : 7;
  let best = null;
  for (let n = 1; n <= 60; n++) {
    const frontSide = n % 2 ? "r" : "l";
    const step = (distance - 45 - adjust(frontSide)) / n;
    if (step >= 15 && step <= 58 && (!best || Math.abs(step - 40) < Math.abs(best.step - 40))) best = { n, step };
  }
  if (!best) throw new Error(`No natural stride covers ${distance} units.`);
  for (let i = 0; i < best.n; i++) {
    const d = (front.x + rear.x) / 2, next = front.x + best.step, d2 = (front.x + next) / 2;
    const sign = rear.side === "r" ? 1 : -1;
    const pose = (frame, dx, swing, anchor, arm) => {
      const f = feet(rear.side, swing, [front.x, 0]);
      push(frame, walkPose(dx, f.r, f.l, anchor, sign * arm));
    };
    pose(t + at(3), d + .1429 * (d2 - d), [rear.x, 4], front.side, 20);
    pose(t + at(10), d + .476 * (d2 - d), [rear.x + .425 * (next - rear.x), 6], front.side, 2);
    pose(t + at(17), d + .8095 * (d2 - d), [next, 4], front.side, -18);
    t += pace;
    pose(t, d2, [next, 0], "both", -22);
    rear = front; front = { side: rear.side === "r" ? "l" : "r", x: next };
  }
  const d = (front.x + rear.x) / 2;
  const end = front.x + adjust(front.side);
  const target = front.side === "r" ? end - 7 : end + 5;
  const arms = rear.side === "r" ? [14, 2, -6, -8] : [-16, -10, -8, -8];
  const stop = (frame, dx, swing, anchor, arm, extra) => {
    const f = feet(rear.side, swing, [front.x, 0]);
    push(frame, walkPose(dx, f.r, f.l, anchor, arm, extra));
  };
  stop(t + at(3), d + .15 * (end - d), [rear.x, 4], front.side, arms[0]);
  stop(t + at(10), d + .55 * (end - d), [rear.x + .45 * (target - rear.x), 6], front.side, arms[1]);
  stop(t + at(17), d + .9 * (end - d), [target, 3], front.side, arms[2], { lean: 2.5 });
  t += pace;
  stop(t, end, [target, 0], "both", arms[3], { lean: 2 });
  stop(t + 8, end, [target, 0], "both", -8, { lean: 2 });
  return { id: `walk-${facing > 0 ? "right" : "left"}`, frames: t + 9, loop: false, poseKeys: keys, prop: null, review: {} };
}

/** Pelvis x relative to the clip root, in review-stage pixels. */
function pelvisOffset(sampler, clip, frame) {
  const sample = engineSampledFrame(sampler, clip, frame);
  const a = sample.segments.find(item => item.id === "left-thigh"), b = sample.segments.find(item => item.id === "right-thigh");
  return (a.x1 + b.x1) / 2 - ROOT_X;
}

/**
 * Compose recipe items into one continuous performance.
 * Items: { motion, cycles?, hold?, until?, gap?, keep?, laurel?, fadeOut?, beat?, root? } | { walk: { to, pace? }, beat? } | { relocate: filmX }.
 * Positions are film pixels: `root` / `walk.to` place the next motion's root; `relocate` places the next pelvis off-screen.
 */
export function composePerformance(items, { motions, sampleClipMotion, neutral, scale = FILM_SCALE }) {
  const S = scale;
  const segments = [];
  const keys = [];
  let pin = null, cursor = -1, relocate = null, beat = null;
  const nextMotion = index => {
    const item = items.slice(index + 1).find(entry => entry.motion);
    if (!item) throw new Error("A walk must lead to a motion.");
    return motions.get(item.motion);
  };
  items.forEach((item, index) => {
    if (item.relocate !== undefined) { relocate = item.relocate; if (item.beat) beat = item.beat; return; }
    let clip, spec, id;
    if (item.walk) {
      if (pin === null && relocate === null) throw new Error("A walk needs a starting position.");
      const start = relocate ?? pin;
      const next = nextMotion(index);
      const goal = item.walk.to + pelvisOffset(sampleClipMotion, next.clip, 0) * S;
      const facing = goal >= start ? 1 : -1;
      let distance = Math.abs(goal - start) / (S * UNIT);
      for (let attempt = 0; attempt < 3; attempt++) {
        spec = walkSpec(distance, facing, item.walk.pace ?? 18);
        if (spec.frames > 1800) throw new Error(`Generated walk exceeds the 1800-frame limit (${spec.frames} frames).`);
        clip = buildKeyPoseClip(spec, neutral);
        const travelled = (pelvisOffset(sampleClipMotion, clip, clip.frames.length - 1) - pelvisOffset(sampleClipMotion, clip, 0)) * S;
        distance += facing * (goal - start - travelled) / (S * UNIT);
      }
      id = spec.id;
    } else {
      const motion = motions.get(item.motion);
      if (!motion) throw new Error(`Unqualified film motion: ${item.motion}`);
      ({ clip, spec } = motion);
      id = item.motion;
      const sourceSpec = spec;
      if (item.until !== undefined && (clip.loop || !sourceSpec.poseKeys.some(key => key.frame === item.until)))
        throw new Error(`${item.motion}: 'until' must name an authored key frame of a one-shot motion.`);
      const factor = item._timeScale ?? 1;
      if (factor > 1) {
        const frames = Math.round((spec.frames - 1) * factor) + 1;
        spec = { ...spec, frames, poseKeys: spec.poseKeys.map(key => ({ ...key, frame: Math.round(key.frame * factor) })) };
        clip = buildKeyPoseClip(spec, neutral);
      }
      const trimStart = Math.round((item._trimStart ?? 0) * factor);
      if (trimStart) {
        const first = spec.poseKeys.find(key => key.frame === trimStart);
        if (!first || clip.loop) throw new Error(`${item.motion}: generated bridge cannot trim this motion start.`);
        spec = { ...spec, frames: spec.frames - trimStart, poseKeys: [
          { ...first, frame: 0 },
          ...spec.poseKeys.filter(key => key.frame > trimStart).map(key => ({ ...key, frame: key.frame - trimStart }))
        ] };
        clip = buildKeyPoseClip(spec, neutral);
      }
      if (item.until !== undefined) {
        const untilFrame = Math.round(item.until * factor) - trimStart;
        if (!spec.poseKeys.some(key => key.frame === untilFrame)) throw new Error(`${item.motion}: 'until' must name an authored key frame of a one-shot motion.`);
        spec = { ...spec, frames: untilFrame + 1, poseKeys: spec.poseKeys.filter(key => key.frame <= untilFrame) };
        clip = buildKeyPoseClip(spec, neutral);
      }
    }
    const n = clip.frames.length;
    const cycles = clip.loop ? (item.cycles ?? 1) : 1;
    const length = clip.loop ? cycles * n + 1 : n;
    const startPelvis = pelvisOffset(sampleClipMotion, clip, 0) * S;
    let root;
    if (!segments.length && relocate === null) {
      if (!Number.isFinite(item.root)) throw new Error("The first performance motion needs a root position.");
      root = item.root;
    } else root = (relocate ?? pin) - startPelvis;
    const previous = segments.at(-1);
    const flip = previous && Math.sign(previous.endFacing) !== Math.sign(clip.poseKeys[0].pose.facing ?? 1);
    const gap = !previous ? 0 : relocate !== null ? 1 : item.gap ?? (flip ? 18 : 10);
    const start = previous ? cursor + gap : 0;
    // Rebase local x so dx is continuous across the join; the root track cancels the shift.
    const shift = previous ? (keys.at(-1).pose.dx ?? 0) - (clip.poseKeys[0].pose.dx ?? 0) : 0;
    const shifted = pose => {
      const out = { ...pose, dx: (pose.dx ?? 0) + shift, facing: pose.facing ?? 1 };
      for (const name of ["rFoot", "lFoot", "rHand", "lHand"]) if (pose[name]) out[name] = { ...pose[name], x: pose[name].x + shift };
      return out;
    };
    const offset = (frame, key) => ({ ...key, frame: start + frame, pose: shifted(key.pose) });
    const joinIndex = keys.length;
    for (let c = 0; c < cycles; c++) for (const key of clip.poseKeys) keys.push(offset(c * n + key.frame, key));
    // A spread arm uses a different FK branch; make spread explicit on both sides of the join so the blend cannot snap.
    if (joinIndex) for (const arm of ["rArm", "lArm"]) for (const field of ["spread", "elbowSpread"]) {
      const before = keys[joinIndex - 1].pose, after = keys[joinIndex].pose;
      if (before[arm][field] !== undefined && after[arm][field] === undefined) keys[joinIndex] = { ...keys[joinIndex], pose: { ...after, [arm]: { ...after[arm], [field]: 0 } } };
      if (after[arm][field] !== undefined && before[arm][field] === undefined) keys[joinIndex - 1] = { ...keys[joinIndex - 1], pose: { ...before, [arm]: { ...before[arm], [field]: 0 } } };
    }
    if (clip.loop) keys.push(offset(cycles * n, clip.poseKeys[0]));
    let end = start + length - 1;
    if (item.hold) { keys.push({ ...keys.at(-1), frame: end + item.hold }); end += item.hold; }
    if (end >= 1800) throw new Error(`Performance exceeds the 1800-frame limit (${end + 1} frames).`);
    keys[keys.length - 1] = { ...keys.at(-1), ease: "inOut" };
    const lastLocal = clip.loop ? 0 : n - 1;
    segments.push({ id, itemIndex: index, kind: item.walk ? "walk" : "motion", clip, spec, start, end, length, root, loop: clip.loop, n,
      keep: item.keep ?? [], laurel: item.laurel ?? false, fadeOut: item.fadeOut ?? 0, beat: item.beat ?? beat ?? null,
      gapStart: previous ? previous.end + 1 : 0, relocated: relocate !== null,
      endFacing: clip.poseKeys.at(lastLocal === 0 ? 0 : -1).pose.facing ?? 1, bridge: item._bridge ?? null });
    beat = null;
    pin = root + pelvisOffset(sampleClipMotion, clip, lastLocal) * S;
    relocate = null;
    cursor = end;
  });
  const frames = cursor + 1;
  const clip = buildKeyPoseClip({ id: "film-performance", frames, poseKeys: keys }, neutral);
  const rootTrack = new Float64Array(frames);
  let pinned = null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    for (let t = seg.gapStart; t < seg.start; t++) rootTrack[t] = seg.relocated ? seg.root : pinned - pelvisOffset(sampleClipMotion, clip, t) * S;
    for (let t = seg.start; t <= seg.end; t++) {
      const local = seg.loop ? (t - seg.start) % seg.n : Math.min(t - seg.start, seg.n - 1);
      rootTrack[t] = seg.root + (pelvisOffset(sampleClipMotion, seg.clip, local) - pelvisOffset(sampleClipMotion, clip, t)) * S;
    }
    pinned = seg.root + pelvisOffset(sampleClipMotion, seg.clip, seg.loop ? 0 : seg.n - 1) * S;
  }
  return { frames, clip, segments, rootTrack, scale: S };
}

/** Mechanical continuity of the whole film as rendered in world space. */
export function performanceContinuity(performance, sampleClipMotion) {
  const { clip, rootTrack, scale: S } = performance;
  let previous = null, maxJointStep = 0, worstFrame = 0;
  const slides = [];
  const cuts = new Set(performance.segments.filter(seg => seg.relocated).map(seg => seg.start));
  for (let t = 0; t < performance.frames; t++) {
    if (cuts.has(t)) previous = null;
    const sample = engineSampledFrame(sampleClipMotion, clip, t);
    const shift = (rootTrack[t] - 640) / S;
    const points = [sample.head, ...sample.segments.map(item => ({ x: item.x2, y: item.y2, id: item.id }))].map(p => ({ x: p.x + shift, y: p.y, id: p.id }));
    if (previous) {
      points.forEach((point, i) => {
        const step = Math.hypot(point.x - previous[i].x, point.y - previous[i].y) / UNIT;
        if (step > maxJointStep) { maxJointStep = step; worstFrame = t; }
      });
      for (const side of ["left", "right"]) {
        const a = points.find(p => p.id === `${side}-shin`), b = previous.find(p => p.id === `${side}-shin`);
        const planted = a.y >= GROUND_Y - .5 && b.y >= GROUND_Y - .5;
        const slide = Math.abs(a.x - b.x) / UNIT;
        if (planted && slide > 1.2) slides.push({ frame: t, side, slide: round(slide) });
      }
    }
    previous = points;
  }
  return { maxJointStep: round(maxJointStep), worstFrame, footSlides: slides };
}

/** Per-boundary maximum joint movement during a crossfade, in the same world-space metric. */
export function performanceJoinCosts(performance, sampleClipMotion) {
  const { clip, rootTrack, scale: S, segments } = performance;
  const pointsAt = frame => {
    const sample = engineSampledFrame(sampleClipMotion, clip, frame);
    const shift = (rootTrack[frame] - 640) / S;
    return [sample.head, ...sample.segments.map(item => ({ x: item.x2, y: item.y2, id: item.id }))]
      .map(point => ({ x: point.x + shift, y: point.y, id: point.id }));
  };
  return segments.slice(1).map((segment, index) => {
    const previous = segments[index];
    let cost = 0, worstFrame = segment.gapStart;
    if (!segment.relocated) for (let frame = Math.max(1, segment.gapStart); frame <= segment.start; frame++) {
      const before = pointsAt(frame - 1), after = pointsAt(frame);
      for (let i = 0; i < after.length; i++) {
        const step = Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y) / UNIT;
        if (step > cost) { cost = step; worstFrame = frame; }
      }
    }
    return { itemIndex: segment.itemIndex, from: previous.id, to: segment.id, cost: round(cost), worstFrame,
      startFrame: segment.gapStart, endFrame: segment.start - 1, relocated: segment.relocated };
  });
}

const contentTransform = (root, S) => `translate(${round(root - ROOT_X * S)} ${round(FILM_GROUND - GROUND_Y * S)}) scale(${S})`;

function stripSpec(spec, types) {
  if (!spec) return { prop: null, review: {} };
  const review = spec.review ?? {};
  const main = types.includes(spec.prop);
  return { ...spec, prop: main ? null : spec.prop, review: { ...review, ...(main ? { prop: undefined } : {}),
    extraProps: (review.extraProps ?? []).filter(item => !types.includes(item.type)) } };
}

/** Renders figure and props into back/actor/front SVG layers at fixed film coordinates. */
export function createPerformanceRenderer(performance, { sampleClipMotion, frameGeometry, propsCatalog, set = [], theme = svg => svg, laurel, adorn, strip = [], motions }) {
  const S = performance.scale;
  const setTypes = [...new Set([...set.flatMap(item => item.types), ...strip])];
  const cache = new Map();
  const propLayers = async (seg, local) => {
    const frame = seg.loop ? local % seg.n : Math.min(local, seg.n - 1);
    const key = `${seg.start}:${frame}`;
    if (!cache.has(key)) {
      let back = "", front = "";
      if (seg.kind === "motion") {
        const spec = stripSpec(seg.spec, setTypes.filter(type => !seg.keep.includes(type)));
        const svg = await renderStaticSvg({ clip: seg.clip, spec, propsCatalog, frameIndex: frame });
        const body = svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<rect x="-10000"[^>]*\/>/, "")
          .replace(/<path id="ground"[^>]*\/>/, "").replace(/<text [^>]*y="-42"[\s\S]*?<\/text>/, "");
        const split = body.match(/^([\s\S]*?)<g data-stickman="exact-pivot"[^>]*>[\s\S]*?<\/g>([\s\S]*)$/);
        [back, front] = split ? [split[1], split[2]] : [body, ""];
      }
      cache.set(key, { back: theme(back), front: theme(front) });
    }
    return cache.get(key);
  };
  const setCache = new Map();
  const setLayer = async item => {
    if (!setCache.has(item)) {
      const motion = motions.get(item.motion);
      const others = [motion.spec.prop, ...(motion.spec.review?.extraProps ?? []).map(entry => entry.type)].filter(type => type && !item.types.includes(type));
      const svg = await renderStaticSvg({ clip: motion.clip, spec: stripSpec(motion.spec, others), propsCatalog, frameIndex: 0 });
      const body = svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<rect x="-10000"[^>]*\/>/, "")
        .replace(/<path id="ground"[^>]*\/>/, "").replace(/<text [^>]*y="-42"[\s\S]*?<\/text>/, "").replace(/<g data-stickman="exact-pivot"[^>]*>[\s\S]*?<\/g>/, "");
      setCache.set(item, theme(body));
    }
    return setCache.get(item);
  };
  const place = (root, markup, opacity = 1) => markup ? `<g transform="${contentTransform(root, S)}"${opacity < .999 ? ` opacity="${round(opacity)}"` : ""}>${markup}</g>` : "";
  const segmentAt = frame => {
    const index = performance.segments.findIndex(seg => frame <= seg.end);
    return { index, seg: performance.segments[index], previous: performance.segments[index - 1] };
  };
  return async frame => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= performance.frames) throw new Error("Story frame is outside its timeline.");
    const { seg, previous } = segmentAt(frame);
    const inGap = frame < seg.start;
    const u = inGap ? smooth((frame - seg.gapStart + 1) / (seg.start - seg.gapStart + 1)) : 1;
    const layers = [];
    if (inGap && previous) layers.push({ seg: previous, local: previous.end - previous.start, opacity: 1 - u });
    layers.push({ seg, local: Math.max(0, frame - seg.start), opacity: u });
    const bridge = seg.bridge && inGap ? seg.bridge : null;
    const bridgeU = bridge ? (frame - seg.gapStart) / Math.max(1, seg.start - seg.gapStart) : 0;
    const propAlpha = !bridge ? 1 : bridgeU < 0.5 ? 1 - smooth(bridgeU * 2) : smooth((bridgeU - 0.5) * 2);
    const rendered = [];
    for (const layer of layers) rendered.push({ ...layer, propAlpha, ...(await propLayers(layer.seg, layer.local)) });
    if (rendered.length === 2 && rendered[0].seg.root === rendered[1].seg.root) {
      if (rendered[0].back === rendered[1].back) { rendered[0].back = ""; rendered[1].backOpacity = 1; }
      if (rendered[0].front === rendered[1].front) { rendered[0].front = ""; rendered[1].frontOpacity = 1; }
    }
    let setMarkup = "";
    for (const item of set) {
      const owners = rendered.filter(layer => item.hideDuring?.includes(layer.seg.id));
      const opacity = (1 - owners.reduce((sum, layer) => sum + layer.opacity, 0)) * propAlpha;
      if (opacity > .001) setMarkup += place(item.root, await setLayer(item), opacity);
    }
    const sample = engineSampledFrame(sampleClipMotion, performance.clip, frame);
    const geometry = frameGeometry(sample);
    let figure = figureMarkup(sample, geometry);
    const owner = inGap ? previous ?? seg : seg;
    if (laurel && owner.laurel) figure += laurel(geometry);
    if (adorn) figure += adorn(geometry, sample);
    let figureOpacity = 1;
    const fading = inGap ? previous : seg;
    if (fading?.fadeOut) {
      const since = frame - (fading.end - fading.fadeOut);
      figureOpacity = inGap ? 0 : since > 0 ? 1 - smooth(since / fading.fadeOut) : 1;
    }
    const root = performance.rootTrack[frame];
    return {
      back: setMarkup + rendered.map(layer => place(layer.seg.root, layer.back, (layer.backOpacity ?? layer.opacity) * layer.propAlpha)).join(""),
      actor: figureOpacity > .001 ? place(root, theme(figure), figureOpacity) : "",
      front: rendered.map(layer => place(layer.seg.root, layer.front, (layer.frontOpacity ?? layer.opacity) * layer.propAlpha)).join(""),
      segment: seg.id, root
    };
  };
}

/** Fixed-camera placement for an independent extra (crowd, army). */
export async function renderExtra({ motion, root, frame, scale = 1, propsCatalog, theme = svg => svg, S = FILM_SCALE }) {
  const sample = motion.clip.loop ? frame % motion.clip.frames.length : Math.max(0, Math.min(frame, motion.clip.frames.length - 1));
  const svg = await renderStaticSvg({ ...motion, propsCatalog, frameIndex: sample });
  const body = svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<rect x="-10000"[^>]*\/>/, "")
    .replace(/<path id="ground"[^>]*\/>/, "").replace(/<text [^>]*y="-42"[\s\S]*?<\/text>/, "");
  const k = S * scale;
  return `<g transform="translate(${round(root - ROOT_X * k)} ${round(FILM_GROUND - GROUND_Y * k)}) scale(${round(k)})">${theme(body)}</g>`;
}
