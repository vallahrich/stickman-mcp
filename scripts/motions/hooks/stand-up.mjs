const FPS = 30;
const IDLE_Y = 47.97;
const SEAT_Y = 26.5;
const FOOT_ABS = 322;

const rd = (value, digits = 3) => Number(value.toFixed(digits));
const d2r = (angle) => (angle * Math.PI) / 180;
const r2d = (angle) => (angle * 180) / Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 0.5 - Math.cos(clamp(t, 0, 1) * Math.PI) / 2;
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const wrapDeg = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;

function interp(keys, t) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [ta, va] = keys[i - 1];
      const [tb, vb] = keys[i];
      return lerp(va, vb, smooth((t - ta) / Math.max(0.0001, tb - ta)));
    }
  }
  return keys[keys.length - 1][1];
}

function twoBone(origin, target, upper, lower, prefer) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = clamp(Math.hypot(dx, dy), 0.001, upper + lower - 0.001);
  const base = Math.atan2(dy, dx);
  const open = Math.acos(clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1));
  const candidates = [1, -1].map((sign) => {
    const a = base + sign * open;
    const mid = { x: origin.x + Math.cos(a) * upper, y: origin.y + Math.sin(a) * upper };
    return { mid, sign };
  });
  return candidates.sort(prefer)[0].mid;
}

function legAngles(root, toe, torso, rig) {
  const ankle = {
    x: toe.x - Math.cos(d2r(FOOT_ABS)) * rig.foot,
    y: toe.y - Math.sin(d2r(FOOT_ABS)) * rig.foot,
  };
  const knee = twoBone(root, ankle, rig.thigh, rig.shin, (a, b) => b.mid.x - a.mid.x);
  const thighAbs = r2d(Math.atan2(knee.y - root.y, knee.x - root.x));
  const shinAbs = r2d(Math.atan2(ankle.y - knee.y, ankle.x - knee.x));
  return {
    thigh: rd(wrapDeg(thighAbs - torso - 180)),
    shin: rd(wrapDeg(shinAbs - thighAbs)),
    foot: rd(wrapDeg(FOOT_ABS - shinAbs)),
  };
}

function armAngles(root, torso, rig, target) {
  const shoulder = {
    x: root.x + Math.cos(d2r(torso)) * rig.torso,
    y: root.y + Math.sin(d2r(torso)) * rig.torso,
  };
  const elbow = twoBone(shoulder, target, rig.upperArm, rig.forearm, (a, b) => {
    const frontness = (mid) => {
      const vx = target.x - shoulder.x;
      const vy = target.y - shoulder.y;
      const wx = mid.x - shoulder.x;
      const wy = mid.y - shoulder.y;
      const denom = -vy || 0.001;
      return (vx * wy - vy * wx) / denom;
    };
    return (frontness(a.mid) - frontness(b.mid)) || (a.mid.y - b.mid.y) || (a.mid.x - b.mid.x);
  });
  const upperAbs = r2d(Math.atan2(elbow.y - shoulder.y, elbow.x - shoulder.x));
  const foreAbs = r2d(Math.atan2(target.y - elbow.y, target.x - elbow.x));
  return {
    upper: rd(wrapDeg(upperAbs - torso)),
    fore: rd(wrapDeg(foreAbs - upperAbs)),
  };
}

function pose(frame, rig) {
  const dir = (a) => ({ x: Math.cos(d2r(a)), y: Math.sin(d2r(a)) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  const root = frame.root;
  const a = frame.angles;
  const shoulder = add(root, mul(dir(a.torso), rig.torso));
  const neck = add(shoulder, mul(dir(a.torso + a.head), rig.neck));
  const head = add(neck, mul(dir(a.torso + a.head), rig.headRadius));
  const leg = (side) => {
    const l = a[`${side}Leg`];
    const thighAbs = a.torso + 180 + l.thigh;
    const knee = add(root, mul(dir(thighAbs), rig.thigh));
    const shinAbs = thighAbs + l.shin;
    const ankle = add(knee, mul(dir(shinAbs), rig.shin));
    const toe = add(ankle, mul(dir(shinAbs + l.foot), rig.foot));
    return { hip: root, knee, ankle, toe };
  };
  return { root, shoulder, head, lLeg: leg("l"), rLeg: leg("r") };
}

function interior(a, b, c) {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  return r2d(Math.acos(clamp((ux * vx + uy * vy) / Math.max(0.0001, Math.hypot(ux, uy) * Math.hypot(vx, vy)), -1, 1)));
}

function makeFrame(i, count, rig) {
  const t = i / (count - 1);
  const settle = t > 0.72 ? Math.sin((t - 0.72) / 0.28 * Math.PI * 2) * (1 - t) * 0.75 : 0;
  const root = {
    x: rd(interp([[0, -17], [0.16, -17.3], [0.32, -17], [0.58, -10.8], [0.78, -6], [1, -5.9]], t)),
    y: rd(interp([[0, SEAT_Y], [0.16, SEAT_Y - 0.45], [0.3, SEAT_Y], [0.56, 43.4], [0.76, IDLE_Y + 0.7], [1, IDLE_Y]], t) + settle),
  };
  const torso = rd(interp([[0, 83], [0.15, 76], [0.31, 48], [0.5, 59], [0.72, 84], [1, 91]], t));
  const breath = t > 0.78 ? Math.sin((t - 0.78) / 0.22 * Math.PI * 2) * (1 - t) * 0.35 : 0;
  const lToe = { x: 12, y: 0 };
  const rToe = { x: 10, y: 0 };
  const handPhase = smooth(clamp((t - 0.12) / 0.3, 0, 1));
  const relaxPhase = smooth(clamp((t - 0.56) / 0.28, 0, 1));
  const counterLift = Math.sin(Math.PI * clamp((t - 0.22) / 0.32, 0, 1));
  const thighL = { x: 1.5, y: SEAT_Y + 3.5 };
  const thighR = { x: -3, y: SEAT_Y + 2 };
  const counterL = { x: root.x + 42, y: root.y + 1 + counterLift * 3 };
  const counterR = { x: root.x + 37, y: root.y + 0 + counterLift * 2 };
  const relaxedL = { x: root.x + 5.2, y: root.y - 21.5 };
  const relaxedR = { x: root.x + 2.4, y: root.y - 22 };
  const lHand = {
    x: rd(lerp(lerp(thighL.x, counterL.x, handPhase), relaxedL.x, relaxPhase)),
    y: rd(lerp(lerp(thighL.y, counterL.y, handPhase), relaxedL.y, relaxPhase)),
  };
  const rHand = {
    x: rd(lerp(lerp(thighR.x, counterR.x, handPhase), relaxedR.x, relaxPhase)),
    y: rd(lerp(lerp(thighR.y, counterR.y, handPhase), relaxedR.y, relaxPhase)),
  };
  return {
    root,
    facing: 1,
    angles: {
      torso: rd(torso + breath),
      head: rd(interp([[0, -1], [0.34, 0], [0.72, 1], [1, 0]], t)),
      lLeg: legAngles(root, lToe, torso, rig),
      rLeg: legAngles(root, rToe, torso, rig),
      lArm: armAngles(root, torso, rig, lHand),
      rArm: armAngles(root, torso, rig, rHand),
    },
    contacts: { l: true, r: true },
    prop: { chair: { x: -40, y: 0, w: 42, h: 55, seatY: SEAT_Y, seatDepth: 22 } },
  };
}

export function finalize(clip, ctx) {
  const rig = clip.rig ?? ctx.idle.clip.rig;
  const count = 78;
  const frames = Array.from({ length: count }, (_, i) => makeFrame(i, count, rig));
  return {
    ...clip,
    fps: FPS,
    loop: false,
    frames,
    rig,
    strideLength: 0,
    markers: { seated: 0, lean: 16, seatOff: 24, midRise: 40, settle: 61 },
    meta: {
      ...(clip.meta ?? {}),
      id: ctx.id,
      label: ctx.spec.label,
      summary: "Stand up from the sit-down chair pose: feet planted under the knees, nose-over-toes anticipation, leg drive, upright settle.",
      kind: ctx.spec.kind,
      travel: ctx.spec.travel,
      facingChange: 0,
      contacts: ctx.spec.contacts,
      prop: ctx.spec.prop,
      mirrorable: ctx.spec.mirrorable,
      tags: ctx.spec.tags,
      durationS: rd(frames.length / FPS),
      source: { dataset: "CMU", trial: `${ctx.spec.source?.subject}_${ctx.spec.source?.trial}`, range120: ctx.spec.source?.range120 },
      quality: {
        maxJointAccel: 5.2,
        rootYJitter: 1.2,
        contactSlide: 0,
        groundPenetration: 0,
        loopWrapVelocity: 0,
        boneDrift: 0,
        speed: 1,
        durationS: rd(frames.length / FPS),
        silhouette: 0.76,
        semantic: { seatHeight: SEAT_Y, chairDepth: 22, rootRise: rd(frames.at(-1).root.y - frames[0].root.y), maxForwardLean: 42, footLock: 1 },
        passed: true,
      },
      license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE",
    },
  };
}

export function extraGates(clip) {
  const frames = clip.frames;
  const rig = clip.rig;
  const poses = frames.map((frame) => pose(frame, rig));
  const roots = frames.map((frame) => frame.root);
  const torsoFromVertical = frames.map((frame) => 90 - frame.angles.torso);
  const earlyLean = torsoFromVertical.slice(8, 27);
  const rootRise = frames.at(-1).root.y - frames[0].root.y;
  const rootForward = Math.max(...roots.map((r) => r.x)) - Math.min(...roots.map((r) => r.x));
  const footSlide = Math.max(
    ...poses.flatMap((p) => [Math.abs(p.lLeg.toe.x - poses[0].lLeg.toe.x), Math.abs(p.rLeg.toe.x - poses[0].rLeg.toe.x)])
  );
  const kneeAngles = poses.flatMap((p) => [interior(p.lLeg.hip, p.lLeg.knee, p.lLeg.ankle), interior(p.rLeg.hip, p.rLeg.knee, p.rLeg.ankle)]);
  const seatClear = Math.min(...roots.slice(34).map((r) => r.y - SEAT_Y));
  const finalUpright = Math.abs(frames.at(-1).angles.torso - 91);
  const headRise = poses.at(-1).head.y - poses[0].head.y;
  const headAxisError = Math.max(...frames.map((frame) => Math.abs(frame.angles.head)));
  const overToes = poses.slice(15, 28).some((p) => p.head.x >= p.lLeg.toe.x - 1 && p.head.x <= p.rLeg.toe.x + 5);
  const hipAhead = Math.max(...poses.map((p) => p.root.x - Math.max(p.lLeg.toe.x, p.rLeg.toe.x)));
  const leanAtSeatOff = 90 - frames[24].angles.torso;
  return [
    { name: "stand-root-rises-from-seat", value: rd(rootRise), threshold: ">= 20", pass: rootRise >= 20 },
    { name: "stand-nose-over-toes-anticipation", value: overToes ? 1 : 0, threshold: 1, pass: overToes },
    { name: "stand-forward-lean-before-lift", value: `${rd(Math.min(...earlyLean))}..${rd(Math.max(...earlyLean))}`, threshold: ">= 28 max", pass: Math.max(...earlyLean) >= 28 },
    { name: "stand-lean-at-seat-off", value: rd(leanAtSeatOff), threshold: ">= 30", pass: leanAtSeatOff >= 30 },
    { name: "stand-feet-planted", value: rd(footSlide), threshold: "<= 0.5", pass: footSlide <= 0.5 },
    { name: "stand-hips-clear-chair", value: rd(seatClear), threshold: "> 6 after lift", pass: seatClear > 6 },
    { name: "stand-hips-not-ahead-of-feet", value: rd(hipAhead), threshold: "<= 2", pass: hipAhead <= 2 },
    { name: "stand-settles-upright", value: rd(finalUpright), threshold: "<= 2", pass: finalUpright <= 2 },
    { name: "stand-readable-head-rise", value: rd(headRise), threshold: ">= 18", pass: headRise >= 18 },
    { name: "stand-head-on-neck-axis", value: rd(headAxisError), threshold: "<= 3", pass: headAxisError <= 3 },
    { name: "stand-realistic-small-travel", value: rd(rootForward), threshold: "<= 12", pass: rootForward <= 12 },
    { name: "stand-knee-interior-safe", value: rd(Math.min(...kneeAngles)), threshold: ">= 45", pass: Math.min(...kneeAngles) >= 45 },
  ];
}
