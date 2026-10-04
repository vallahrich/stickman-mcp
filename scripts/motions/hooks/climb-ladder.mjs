const rd = (n) => Number(n.toFixed(3));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapDeg = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;
const TAU = Math.PI * 2;

function ease(t) {
  return t * t * (3 - 2 * t);
}

function smoothPulse(t, start, end) {
  if (start < end) {
    if (t <= start || t >= end) return 0;
    const u = (t - start) / (end - start);
    return Math.sin(Math.PI * u);
  }
  return smoothPulse(t, start, 1) || smoothPulse(t, 0, end);
}

function ik(start, target, upper, lower, bendSign = 1) {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const d = clamp(Math.hypot(dx, dy), 0.001, upper + lower - 0.001);
  const base = Math.atan2(dy, dx);
  const a = Math.acos(clamp((upper * upper + d * d - lower * lower) / (2 * upper * d), -1, 1)) * bendSign;
  const upperA = base + a;
  const elbow = { x: start.x + Math.cos(upperA) * upper, y: start.y + Math.sin(upperA) * upper };
  const foreA = Math.atan2(target.y - elbow.y, target.x - elbow.x);
  return { upper: upperA * 180 / Math.PI, fore: wrapDeg(foreA * 180 / Math.PI - upperA * 180 / Math.PI) };
}

function buildFrame(base, rig, i, count) {
  const t = i / Math.max(1, count - 1);
  const p = t % 1;
  const phaseA = ease(clamp((p - 0.05) / 0.2, 0, 1));
  const phaseB = ease(clamp((p - 0.55) / 0.2, 0, 1));
  const aUp = p < 0.5 ? phaseA : 1 - phaseB;
  const bUp = 1 - aUp;
  const root = {
    x: rd(2.3 + 0.65 * Math.sin(TAU * p + Math.PI / 8)),
    y: rd(48 + 24 * t + 0.35 * Math.sin(TAU * p - Math.PI / 4)),
  };
  const torso = 78 + 1.6 * Math.sin(TAU * p - 0.4);
  const chest = {
    x: root.x + Math.cos(torso * Math.PI / 180) * rig.torso,
    y: root.y + Math.sin(torso * Math.PI / 180) * rig.torso,
  };

  const leftReach = p < 0.5 ? smoothPulse(p, 0.05, 0.25) : 0;
  const rightReach = p >= 0.5 ? smoothPulse(p, 0.55, 0.75) : 0;
  const handHigh = 54;
  const handLow = 38;
  const footHigh = -10;
  const footLow = -34;
  const lHand = {
    x: 32 - 2 * aUp,
    y: root.y + handLow + (handHigh - handLow) * aUp + 1.8 * leftReach,
  };
  const rHand = {
    x: 32 - 2 * bUp,
    y: root.y + handLow + (handHigh - handLow) * bUp + 1.8 * rightReach,
  };
  const lFoot = {
    x: 22 + 3 * bUp,
    y: root.y + footLow + (footHigh - footLow) * bUp,
  };
  const rFoot = {
    x: 22 + 3 * aUp,
    y: root.y + footLow + (footHigh - footLow) * aUp,
  };

  const la = ik(chest, lHand, rig.upperArm, rig.forearm, aUp > 0.7 ? 1 : -1);
  const ra = ik(chest, rHand, rig.upperArm, rig.forearm, bUp > 0.7 ? 1 : -1);
  const ll = ik(root, lFoot, rig.thigh, rig.shin, 1);
  const rl = ik(root, rFoot, rig.thigh, rig.shin, 1);

  const footAngle = -6 + 3 * Math.sin(TAU * p);
  return {
    ...base,
    root,
    angles: {
      torso: rd(torso),
      head: rd(45 + 1.5 * Math.sin(TAU * p + 0.9)),
      lLeg: {
        thigh: rd(wrapDeg(ll.upper - torso - 180)),
        shin: rd(ll.fore),
        foot: rd(wrapDeg(footAngle - (ll.upper + ll.fore))),
      },
      rLeg: {
        thigh: rd(wrapDeg(rl.upper - torso - 180)),
        shin: rd(rl.fore),
        foot: rd(wrapDeg(footAngle - (rl.upper + rl.fore))),
      },
      lArm: {
        upper: rd(wrapDeg(la.upper - torso)),
        fore: rd(la.fore),
      },
      rArm: {
        upper: rd(wrapDeg(ra.upper - torso)),
        fore: rd(ra.fore),
      },
    },
    contacts: {
      l: rightReach < 0.45,
      r: leftReach < 0.45,
    },
    hands: {
      l: leftReach < 0.52,
      r: rightReach < 0.52,
    },
    prop: {
      ladder: {
        lHand: { x: rd(lHand.x), y: rd(lHand.y) },
        rHand: { x: rd(rHand.x), y: rd(rHand.y) },
        lFoot: { x: rd(lFoot.x), y: rd(lFoot.y) },
        rFoot: { x: rd(rFoot.x), y: rd(rFoot.y) },
      },
    },
  };
}

function fk(frame, rig) {
  const deg = (a) => a * Math.PI / 180;
  const dir = (a) => ({ x: Math.cos(deg(a)), y: Math.sin(deg(a)) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  const a = frame.angles;
  const root = frame.root;
  const chest = add(root, mul(dir(a.torso), rig.torso));
  const head = add(chest, mul(dir(a.torso + a.head), rig.neck + rig.headRadius));
  const hand = (side) => {
    const arm = a[`${side}Arm`];
    const upperA = a.torso + arm.upper;
    const elbow = add(chest, mul(dir(upperA), rig.upperArm));
    return { elbow, hand: add(elbow, mul(dir(upperA + arm.fore), rig.forearm)) };
  };
  const foot = (side) => {
    const leg = a[`${side}Leg`];
    const thighA = a.torso + 180 + leg.thigh;
    const knee = add(root, mul(dir(thighA), rig.thigh));
    const ankle = add(knee, mul(dir(thighA + leg.shin), rig.shin));
    return { knee, foot: add(ankle, mul(dir(thighA + leg.shin + leg.foot), rig.foot)) };
  };
  const la = hand("l"), ra = hand("r"), ll = foot("l"), rl = foot("r");
  return { root, chest, head, lElbow: la.elbow, rElbow: ra.elbow, lHand: la.hand, rHand: ra.hand, lKnee: ll.knee, rKnee: rl.knee, lFoot: ll.foot, rFoot: rl.foot };
}

function distPointSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function xOnLineAtY(a, b, y) {
  if (Math.abs(b.y - a.y) < 0.001) return Math.min(a.x, b.x);
  const t = clamp((y - a.y) / (b.y - a.y), 0, 1);
  return a.x + (b.x - a.x) * t;
}

function jointInterior(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  const den = Math.max(0.001, Math.hypot(ux, uy) * Math.hypot(vx, vy));
  return Math.acos(clamp((ux * vx + uy * vy) / den, -1, 1)) * 180 / Math.PI;
}

export function finalize(clip) {
  const rig = clip.rig ?? { height: 100, thigh: 22.5, shin: 22.5, foot: 7, torso: 30, neck: 4, headRadius: 11, upperArm: 17, forearm: 16 };
  const count = 73;
  const base = clip.frames?.[0] ?? { root: { x: 0, y: 48 }, angles: {}, contacts: { l: true, r: true } };
  const frames = Array.from({ length: count }, (_, i) => buildFrame(base, rig, i, count));
  return {
    ...clip,
    fps: 30,
    loop: true,
    frames,
    rig,
    markers: {
      ...(clip.markers ?? {}),
      cycle: { frames: [0, count - 1], verticalRise: 24, rungSpacing: 24 },
      prop: { type: "ladder", bodyPlane: "front rail at x=22; hips stay 16-24 units behind", rungSpacing: 12 },
    },
  };
}

export function extraGates(clip) {
  const frames = clip.frames ?? [];
  const rig = clip.rig;
  const rootRise = frames.at(-1).root.y - frames[0].root.y;
  const handTargets = frames.map((f) => {
    const p = fk(f, rig);
    return Math.min(p.lHand.y - p.chest.y, p.rHand.y - p.chest.y);
  });
  const footContacts = frames.filter((f) => f.contacts?.l || f.contacts?.r).length / frames.length;
  const handContacts = frames.filter((f) => f.hands?.l || f.hands?.r).length / frames.length;
  const phases = frames.map((f) => (f.prop?.ladder?.lHand?.y ?? 0) - (f.prop?.ladder?.rHand?.y ?? 0));
  const alternation = Math.max(...phases) - Math.min(...phases);
  const torsoLean = frames.map((f) => f.angles.torso);
  const hipClearance = frames.map((f) => 22 - f.root.x);
  const kneeFlex = frames.flatMap((f) => [Math.abs(f.angles.lLeg.shin), Math.abs(f.angles.rLeg.shin)]);
  const armLevels = frames.map((f) => Math.abs((f.prop?.ladder?.lHand?.y ?? 0) - (f.prop?.ladder?.rHand?.y ?? 0)));
  let minKneePole = Infinity, minElbowPole = Infinity, minHeadClearance = Infinity, minInterior = Infinity;
  for (const frame of frames) {
    const p = fk(frame, rig);
    for (const side of ["l", "r"]) {
      const knee = p[`${side}Knee`], foot = p[`${side}Foot`];
      minKneePole = Math.min(minKneePole, knee.x - xOnLineAtY(p.root, foot, knee.y));
      minInterior = Math.min(minInterior, jointInterior(p.root, knee, foot));
      const elbow = p[`${side}Elbow`], hand = p[`${side}Hand`];
      minElbowPole = Math.min(minElbowPole, hand.x - elbow.x, hand.y - elbow.y);
      minInterior = Math.min(minInterior, jointInterior(p.chest, elbow, hand));
      minHeadClearance = Math.min(
        minHeadClearance,
        distPointSegment(p.head, elbow, hand) - rig.headRadius,
        Math.hypot(p.head.x - elbow.x, p.head.y - elbow.y) - rig.headRadius,
      );
    }
  }
  const first = frames[0].angles;
  const last = frames.at(-1).angles;
  const close = Math.max(
    Math.abs(wrapDeg(last.torso - first.torso)),
    Math.abs(wrapDeg(last.lArm.upper - first.lArm.upper)),
    Math.abs(wrapDeg(last.rArm.upper - first.rArm.upper)),
    Math.abs(wrapDeg(last.lLeg.thigh - first.lLeg.thigh)),
    Math.abs(wrapDeg(last.rLeg.thigh - first.rLeg.thigh)),
  );
  const gates = [
    { name: "vertical-root-rise", value: rd(rootRise), threshold: ">= 22", pass: rootRise >= 22 },
    { name: "hands-at-or-above-shoulder", value: rd(Math.min(...handTargets)), threshold: ">= 8", pass: Math.min(...handTargets) >= 8 },
    { name: "alternating-hand-rungs", value: rd(alternation), threshold: ">= 16", pass: alternation >= 16 },
    { name: "hand-height-separation", value: rd(Math.max(...armLevels)), threshold: ">= 16", pass: Math.max(...armLevels) >= 16 },
    { name: "torso-10-15deg-from-vertical", value: `${rd(Math.min(...torsoLean))}-${rd(Math.max(...torsoLean))}`, threshold: "75..80deg", pass: Math.min(...torsoLean) >= 75 && Math.max(...torsoLean) <= 80 },
    { name: "hip-ladder-clearance", value: `${rd(Math.min(...hipClearance))}-${rd(Math.max(...hipClearance))}`, threshold: "16..24", pass: Math.min(...hipClearance) >= 16 && Math.max(...hipClearance) <= 24 },
    { name: "knee-flexion-limit", value: rd(Math.max(...kneeFlex)), threshold: "<= 135deg", pass: Math.max(...kneeFlex) <= 135 },
    { name: "knee-pole-ladder-side", value: rd(minKneePole), threshold: ">= 1", pass: minKneePole >= 1 },
    { name: "elbow-pole-back-and-down", value: rd(minElbowPole), threshold: ">= 1", pass: minElbowPole >= 1 },
    { name: "limb-interior-angle", value: rd(minInterior), threshold: ">= 45deg", pass: minInterior >= 45 },
    { name: "head-limb-clearance", value: rd(minHeadClearance), threshold: ">= 4", pass: minHeadClearance >= 4 },
    { name: "foot-contact-coverage", value: rd(footContacts), threshold: ">= 0.85", pass: footContacts >= 0.85 },
    { name: "hand-contact-coverage", value: rd(handContacts), threshold: ">= 0.85", pass: handContacts >= 0.85 },
    { name: "loop-pose-closure", value: rd(close), threshold: "<= 0.25deg", pass: close <= 0.25 },
  ];
  return gates;
}
