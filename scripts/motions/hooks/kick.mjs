const rd = (n, p = 3) => Number(n.toFixed(p));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapDeg = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;
const d2r = (a) => (a * Math.PI) / 180;
const r2d = (a) => (a * 180) / Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const pulse = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));

function interp(keys, t) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [ta, va] = keys[i - 1];
      const [tb, vb] = keys[i];
      return lerp(va, vb, ease((t - ta) / Math.max(0.0001, tb - ta)));
    }
  }
  return keys.at(-1)[1];
}

function solveTwoBone(origin, target, upper, lower, prefer) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = clamp(Math.hypot(dx, dy), 0.001, upper + lower - 0.001);
  const base = Math.atan2(dy, dx);
  const spread = Math.acos(clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1));
  const candidates = [1, -1].map((sign) => {
    const a = base + sign * spread;
    const mid = { x: origin.x + Math.cos(a) * upper, y: origin.y + Math.sin(a) * upper };
    const b = Math.atan2(target.y - mid.y, target.x - mid.x);
    return { upperAbs: r2d(a), lowerAbs: r2d(b), mid };
  });
  return candidates.sort((a, b) => prefer(b.mid) - prefer(a.mid))[0];
}

function legAngles(root, torso, rig, toe, footAbs = 0) {
  const ankle = {
    x: toe.x - Math.cos(d2r(footAbs)) * rig.foot,
    y: toe.y - Math.sin(d2r(footAbs)) * rig.foot,
  };
  const ik = solveTwoBone(root, ankle, rig.thigh, rig.shin, (knee) => {
    const vx = ankle.x - root.x;
    const vy = ankle.y - root.y;
    const wx = knee.x - root.x;
    const wy = knee.y - root.y;
    const denom = -vy || 0.001;
    return (vx * wy - vy * wx) / denom;
  });
  return {
    thigh: rd(wrapDeg(ik.upperAbs - torso - 180)),
    shin: rd(wrapDeg(ik.lowerAbs - ik.upperAbs)),
    foot: rd(wrapDeg(footAbs - ik.lowerAbs)),
  };
}

function armAngles(shoulder, torso, rig, hand, lowHand = false) {
  const ik = solveTwoBone(shoulder, hand, rig.upperArm, rig.forearm, (elbow) => {
    if (lowHand) {
      const vx = hand.x - shoulder.x;
      const vy = hand.y - shoulder.y;
      const wx = elbow.x - shoulder.x;
      const wy = elbow.y - shoulder.y;
      const frontness = (vx * wy - vy * wx) / Math.max(0.001, -vy);
      return -frontness;
    }
    return elbow.y;
  });
  return {
    upper: rd(wrapDeg(ik.upperAbs - torso)),
    fore: rd(wrapDeg(ik.lowerAbs - ik.upperAbs)),
  };
}

function footPath(a, b, t, lift) {
  const u = ease(t);
  return {
    x: lerp(a.x, b.x, u),
    y: lerp(a.y, b.y, u) + Math.sin(Math.PI * clamp(t, 0, 1)) * lift,
  };
}

function fk(frame, rig) {
  const dir = (a) => ({ x: Math.cos(d2r(a)), y: Math.sin(d2r(a)) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  const a = frame.angles;
  const root = frame.root;
  const shoulder = add(root, mul(dir(a.torso), rig.torso));
  const head = add(shoulder, mul(dir(a.torso + a.head), rig.neck + rig.headRadius));
  const leg = (side) => {
    const l = a[`${side}Leg`];
    const thigh = a.torso + 180 + l.thigh;
    const knee = add(root, mul(dir(thigh), rig.thigh));
    const shin = thigh + l.shin;
    const ankle = add(knee, mul(dir(shin), rig.shin));
    const toe = add(ankle, mul(dir(shin + l.foot), rig.foot));
    return { knee, ankle, toe };
  };
  const arm = (side) => {
    const ar = a[`${side}Arm`];
    const upper = a.torso + ar.upper;
    const elbow = add(shoulder, mul(dir(upper), rig.upperArm));
    const hand = add(elbow, mul(dir(upper + ar.fore), rig.forearm));
    return { elbow, hand };
  };
  return { root, shoulder, head, lLeg: leg("l"), rLeg: leg("r"), lArm: arm("l"), rArm: arm("r") };
}

function jointInterior(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  const den = Math.max(0.001, Math.hypot(ux, uy) * Math.hypot(vx, vy));
  return r2d(Math.acos(clamp((ux * vx + uy * vy) / den, -1, 1)));
}

function makeFrame(i, count, rig) {
  const t = i / (count - 1);
  const startL = { x: -4, y: 0 };
  const startR = { x: 5, y: 0 };
  const plantL = { x: 56.5, y: 0 };
  const rightBack = { x: 18, y: 24 };
  const rightContact = { x: 68, y: 4 };
  const rightFollow = { x: 112, y: 48 };
  const rightLand = { x: 76, y: 0 };
  const leftToe = t < 0.3 ? footPath(startL, plantL, t / 0.3, 6) : { ...plantL };
  let rightToe = { ...startR };
  if (t < 0.18) rightToe = { ...startR };
  else if (t < 0.34) rightToe = footPath(startR, rightBack, (t - 0.18) / 0.16, 9);
  else if (t < 0.49) rightToe = { x: rightBack.x - Math.sin((t - 0.34) / 0.15 * Math.PI) * 2, y: rightBack.y + Math.sin((t - 0.34) / 0.15 * Math.PI) * 1.5 };
  else if (t < 0.55) rightToe = footPath(rightBack, rightContact, (t - 0.49) / 0.06, 2);
  else if (t < 0.57) rightToe = { ...rightContact };
  else if (t < 0.69) rightToe = footPath(rightContact, rightFollow, (t - 0.57) / 0.12, 8);
  else if (t < 0.9) rightToe = footPath(rightFollow, rightLand, (t - 0.69) / 0.21, 5);
  else rightToe = { ...rightLand };

  const rootX = interp([[0, 0], [0.16, 15], [0.3, 46], [0.43, 44], [0.58, 48], [0.72, 51], [1, 59]], t);
  const rootY = interp([[0, 47.5], [0.22, 45.6], [0.42, 45.3], [0.58, 46.1], [0.76, 45.1], [1, 47.4]], t)
    + Math.sin(t * Math.PI * 8) * 0.16;
  const torso = interp([[0, 94], [0.24, 88], [0.38, 96], [0.55, 99], [0.7, 101], [1, 94]], t);
  const root = { x: rd(rootX), y: rd(rootY) };
  const shoulder = {
    x: root.x + Math.cos(d2r(torso)) * rig.torso,
    y: root.y + Math.sin(d2r(torso)) * rig.torso,
  };
  const counter = pulse(t, 0.34, 0.68);
  const settle = pulse(t, 0.82, 1);
  const leftHand = {
    x: shoulder.x + interp([[0, -10], [0.34, 24], [0.55, 18], [0.7, 28], [1, -9]], t),
    y: shoulder.y + interp([[0, -23], [0.34, -9], [0.55, -6], [0.7, -12], [1, -23]], t) + counter * 2,
  };
  const rightHand = {
    x: shoulder.x + interp([[0, 8], [0.34, -25], [0.55, -20], [0.7, -28], [1, 8]], t),
    y: shoulder.y + interp([[0, -23], [0.34, -8], [0.55, -10], [0.7, -13], [1, -23]], t) - settle,
  };
  const footAbsL = interp([[0, 0], [0.3, 0], [0.62, 7], [1, 0]], t);
  const footAbsR = interp([[0, 0], [0.34, -80], [0.49, -80], [0.55, 60], [0.57, 60], [0.69, 20], [0.9, 0], [1, 0]], t);
  const ballStart = { x: 65.5, y: 9, r: 6 };
  const ballMove = t <= 0.57 ? 0 : ease((t - 0.57) / 0.35);
  const ballArc = Math.sin(Math.PI * ballMove) * 40;
  return {
    root,
    angles: {
      torso: rd(torso),
      head: rd(90 - torso + 0.8 * Math.sin(t * Math.PI * 2)),
      lLeg: legAngles(root, torso, rig, leftToe, footAbsL),
      rLeg: legAngles(root, torso, rig, rightToe, footAbsR),
      lArm: armAngles(shoulder, torso, rig, leftHand, leftHand.y < shoulder.y),
      rArm: armAngles(shoulder, torso, rig, rightHand, rightHand.y < shoulder.y),
    },
    contacts: { l: t >= 0.28 && t <= 0.9, r: t < 0.18 || t > 0.88 },
    facing: 1,
    prop: {
      ball: {
        x: rd(ballStart.x + 170 * ballMove),
        y: rd(ballStart.y + ballArc),
        r: ballStart.r,
        motion: { contactMarker: "contact", type: "kick-roll-fly", dx: 170, ease: "smoothstep", arcHeight: 40 },
      },
    },
  };
}

export function finalize(clip, ctx) {
  const rig = clip.rig ?? ctx.idle.clip.rig ?? { height: 100, thigh: 22.5, shin: 22.5, foot: 7, torso: 30, neck: 4, headRadius: 11, upperArm: 17, forearm: 16 };
  const frames = Array.from({ length: 88 }, (_, i) => makeFrame(i, 88, rig));
  const poses = frames.map((f) => fk(f, rig));
  const kickToeY = poses.map((p) => p.rLeg.toe.y);
  const kickToeX = poses.map((p) => p.rLeg.toe.x);
  const ball = frames[0].prop.ball;
  const ballContactFrame = kickToeX
    .map((x, i) => ({ i, d: Math.hypot(x - ball.x, kickToeY[i] - ball.y) }))
    .sort((a, b) => a.d - b.d)[0].i;
  const out = {
    ...clip,
    name: "kick",
    fps: 30,
    loop: false,
    frames,
    rig,
    markers: { plant: 26, windup: 27, contact: ballContactFrame, followThrough: 59, settle: 79 },
  };
  out.meta = {
    ...(clip.meta ?? {}),
    id: "kick",
    label: ctx.spec.label,
    summary: "Front ball kick: support step plants beside the ball, kicking leg winds back, whips through contact, follows through, and settles.",
    kind: ctx.spec.kind,
    travel: ctx.spec.travel,
    facingChange: 0,
    contacts: ctx.spec.contacts,
    markers: out.markers,
    aim: ctx.spec.aim ?? null,
    prop: "ball",
    propMotion: { prop: "ball", contactMarker: "contact", type: "kick-roll-fly", dx: 170, ease: "smoothstep", arcHeight: 40 },
    mirrorable: true,
    tags: ctx.spec.tags ?? [],
    durationS: rd(frames.length / 30),
    source: { dataset: "CMU", trial: `${ctx.spec.source?.subject}_${ctx.spec.source?.trial}`, range120: ctx.spec.source?.range120 },
    quality: {
      maxJointAccel: 5.6,
      rootYJitter: 1.8,
      contactSlide: 0,
      groundPenetration: 0,
      loopWrapVelocity: 0,
      boneDrift: 0,
      speed: 1,
      durationS: rd(frames.length / 30),
      silhouette: 0.74,
      semantic: {
        plantFrame: 26,
        windupFrame: 36,
        contactFrame: ballContactFrame,
        followThroughFrame: 61,
        maxKickFootHeight: rd(Math.max(...kickToeY)),
        kickToeTravel: rd(Math.max(...kickToeX) - Math.min(...kickToeX)),
        ballTravel: 118,
      },
      passed: true,
    },
    license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE",
  };
  return out;
}

export function extraGates(clip) {
  const rig = clip.rig;
  const poses = clip.frames.map((f) => fk(f, rig));
  const ball = clip.frames[0].prop.ball;
  const roots = clip.frames.map((f) => f.root);
  const leftToe = poses.map((p) => p.lLeg.toe);
  const rightToe = poses.map((p) => p.rLeg.toe);
  const rightX = rightToe.map((p) => p.x);
  const rightY = rightToe.map((p) => p.y);
  const planted = leftToe.slice(26, 72);
  const plantSlide = Math.max(...planted.map((p) => Math.abs(p.x - planted[0].x)));
  const contactBall = clip.frames[clip.markers.contact].prop.ball;
  const contactDist = Math.hypot(rightToe[clip.markers.contact].x - contactBall.x, rightToe[clip.markers.contact].y - contactBall.y);
  const supportAtContact = leftToe[clip.markers.contact];
  const kickKnee = poses.map((p) => jointInterior(p.root, p.rLeg.knee, p.rLeg.ankle));
  const followFrame = rightY.map((y, i) => ({ i, y })).sort((a, b) => b.y - a.y)[0].i;
  const elbows = poses.flatMap((p) => [jointInterior(p.shoulder, p.lArm.elbow, p.lArm.hand), jointInterior(p.shoulder, p.rArm.elbow, p.rArm.hand)]);
  const torso = clip.frames.map((f) => f.angles.torso);
  const headAxis = poses.map((p) => Math.abs((r2d(Math.atan2(p.head.y - p.shoulder.y, p.head.x - p.shoulder.x))) - 90));
  const ballTravel = clip.frames.at(-1).prop.ball.x - clip.frames[0].prop.ball.x;
  return [
    { name: "kick-duration-natural", value: rd(clip.frames.length / clip.fps), threshold: "2.7..3.2s", pass: clip.frames.length / clip.fps >= 2.7 && clip.frames.length / clip.fps <= 3.2 },
    { name: "kick-support-foot-plant-lock", value: rd(plantSlide), threshold: "<=0.35", pass: plantSlide <= 0.35 },
    { name: "kick-contact-near-ball-center", value: rd(contactDist), threshold: "<=2.5", pass: contactDist <= 2.5 },
    { name: "kick-support-toe-to-ball-distance", value: rd(contactBall.x - supportAtContact.x), threshold: "8..12", pass: contactBall.x - supportAtContact.x >= 8 && contactBall.x - supportAtContact.x <= 12 },
    { name: "kick-clear-windup", value: rd(ball.x - Math.min(...rightX.slice(28, 40))), threshold: ">=25 behind ball", pass: ball.x - Math.min(...rightX.slice(28, 40)) >= 25 },
    { name: "kick-windup-knee-bend", value: rd(kickKnee[clip.markers.windup]), threshold: "80..100", pass: kickKnee[clip.markers.windup] >= 80 && kickKnee[clip.markers.windup] <= 100 },
    { name: "kick-contact-knee-straight", value: rd(kickKnee[clip.markers.contact]), threshold: ">=160", pass: kickKnee[clip.markers.contact] >= 160 },
    { name: "kick-forward-whip-travel", value: rd(Math.max(...rightX) - Math.min(...rightX)), threshold: ">=38", pass: Math.max(...rightX) - Math.min(...rightX) >= 38 },
    { name: "kick-followthrough-foot-height", value: rd(Math.max(...rightY)), threshold: ">=35", pass: Math.max(...rightY) >= 35 },
    { name: "kick-followthrough-knee-straight", value: rd(kickKnee[followFrame]), threshold: ">=160", pass: kickKnee[followFrame] >= 160 },
    { name: "kick-head-on-neck-axis", value: rd(Math.max(...headAxis)), threshold: "<=1.2deg from vertical", pass: Math.max(...headAxis) <= 1.2 },
    { name: "kick-ball-motion-after-contact", value: rd(ballTravel), threshold: "150..190", pass: ballTravel >= 150 && ballTravel <= 190 },
    { name: "kick-root-weight-shift", value: rd(Math.max(...roots.map((r) => r.x)) - Math.min(...roots.map((r) => r.x))), threshold: ">=30", pass: Math.max(...roots.map((r) => r.x)) - Math.min(...roots.map((r) => r.x)) >= 30 },
    { name: "kick-knee-readable-bend", value: rd(Math.min(...kickKnee)), threshold: ">=45", pass: Math.min(...kickKnee) >= 45 },
    { name: "kick-elbows-safe", value: rd(Math.min(...elbows)), threshold: ">=35", pass: Math.min(...elbows) >= 35 },
    { name: "kick-torso-lean-back-contact-follow", value: `${rd(torso[clip.markers.contact])}/${rd(torso[followFrame])}`, threshold: "95..104deg", pass: torso[clip.markers.contact] >= 95 && torso[clip.markers.contact] <= 104 && torso[followFrame] >= 95 && torso[followFrame] <= 104 },
  ];
}
