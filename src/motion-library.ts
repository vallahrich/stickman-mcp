import { MOTION_CLIP_LIBRARY, type MotionClip, type MotionClipLibrary, type MotionClipMeta } from "./motion-clips.js";
import { GENERATED_MOTION_LIBRARY } from "./generated/motion-library.js";

type MetaSeed = Pick<MotionClipMeta, "id" | "label" | "summary" | "kind" | "travel" | "facingChange" | "contacts" | "aim" | "prop" | "mirrorable" | "tags">;

const license = "CMU-derived/generated local motion clip; keep private until legal review.";
const source = "runtime fixture library";

function meta(seed: MetaSeed, clip: MotionClip): MotionClipMeta {
  return {
    ...seed,
    markers: clip.markers,
    durationS: clip.frames.length / clip.fps,
    quality: "approved-fixture",
    source,
    license
  };
}

function withMeta(base: MotionClip, seed: MetaSeed): MotionClip {
  return { ...base, name: seed.id, meta: meta(seed, base) };
}

function turnAroundClip(): MotionClip {
  const base = MOTION_CLIP_LIBRARY.clips.idle!;
  const frameCount = 31;
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const sourceFrame = base.frames[Math.min(base.frames.length - 1, Math.round(index / (frameCount - 1) * (base.frames.length - 1)))]!;
    const u = index / (frameCount - 1);
    const facing = Math.cos(Math.PI * u);
    return {
      root: { ...sourceFrame.root },
      angles: {
        torso: sourceFrame.angles.torso + 4 * Math.sin(Math.PI * u),
        head: sourceFrame.angles.head - 12 * Math.sin(Math.PI * u),
        lLeg: { ...sourceFrame.angles.lLeg },
        rLeg: { ...sourceFrame.angles.rLeg },
        lArm: { ...sourceFrame.angles.lArm, upper: sourceFrame.angles.lArm.upper + 15 * Math.sin(Math.PI * u) },
        rArm: { ...sourceFrame.angles.rArm, upper: sourceFrame.angles.rArm.upper - 15 * Math.sin(Math.PI * u) }
      },
      contacts: { ...sourceFrame.contacts, lFoot: true, rFoot: true },
      facing
    };
  });
  const clip: MotionClip = {
    ...base,
    name: "turn-around",
    loop: false,
    frames,
    strideLength: 0,
    markers: { start: 0, half: 15, end: 30 }
  };
  return withMeta(clip, {
    id: "turn-around",
    label: "Turn around",
    summary: "Supported in-place 180° turn with per-frame facing for readable side-to-front-to-side rotation.",
    kind: "oneshot",
    travel: "in-place",
    facingChange: 180,
    contacts: ["lFoot", "rFoot"],
    aim: null,
    prop: null,
    mirrorable: true,
    tags: ["turn", "facing"]
  });
}

const legacyMeta: Record<string, MetaSeed> = {
  walk: { id: "walk", label: "Walk", summary: "Travel to a named flat-ground position with supported alternating steps.", kind: "loop", travel: "travel", facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: ["locomotion"] },
  run: { id: "run", label: "Run", summary: "Run toward a named flat-ground position with reciprocal arms and flight.", kind: "loop", travel: "travel", facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: ["locomotion"] },
  jump: { id: "jump", label: "Jump", summary: "Crouch, take off, travel vertically, absorb landing, and settle.", kind: "oneshot", travel: "in-place", facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: ["locomotion", "airborne"] },
  point: { id: "point", label: "Point", summary: "Orient an extended hand toward a named canvas target.", kind: "oneshot", travel: "in-place", facingChange: 0, contacts: ["lFoot", "rFoot"], aim: "hand", prop: null, mirrorable: true, tags: ["gesture", "aim"] },
  idle: { id: "idle", label: "Idle", summary: "Subtle standing hold for pauses and final poses.", kind: "loop", travel: "in-place", facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: ["hold"] },
  stop: { id: "stop", label: "Stop", summary: "Brake from a run and settle into a supported stance.", kind: "oneshot", travel: "in-place", facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: ["locomotion", "transition"] },
  "static-pose": { id: "static-pose", label: "Static pose", summary: "Stable reference standing pose.", kind: "hold", travel: "in-place", facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: ["hold"] }
};

const GENERATED_LIBRARY = GENERATED_MOTION_LIBRARY as MotionClipLibrary;

function normalizeClip(id: string, clip: MotionClip): MotionClip {
  return {
    ...clip,
    name: clip.meta?.id ?? clip.name ?? id,
    frames: clip.frames.map((frame) => ({
      ...frame,
      contacts: {
        ...frame.contacts,
        l: Boolean(frame.contacts.l ?? frame.contacts.lFoot),
        r: Boolean(frame.contacts.r ?? frame.contacts.rFoot)
      }
    }))
  };
}

const clips: Record<string, MotionClip> = Object.fromEntries(
  Object.entries(MOTION_CLIP_LIBRARY.clips).map(([id, clip]) => [id, withMeta(clip, legacyMeta[id] ?? {
    id, label: id, summary: `${id} motion clip.`, kind: clip.loop ? "loop" : "oneshot", travel: clip.strideLength > 10 ? "travel" : "in-place",
    facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: []
  })])
);

for (const [id, clip] of Object.entries(GENERATED_LIBRARY.clips ?? {})) {
  if (legacyMeta[id]) continue;
  clips[id] = normalizeClip(id, clip);
}

clips.wave ??= withMeta({ ...MOTION_CLIP_LIBRARY.clips.point!, name: "wave", loop: false }, {
  id: "wave", label: "Wave", summary: "Raise and wave the right hand, then settle.", kind: "oneshot", travel: "in-place",
  facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: ["gesture"]
});
clips.push ??= withMeta({ ...MOTION_CLIP_LIBRARY.clips.stop!, name: "push", loop: false }, {
  id: "push", label: "Push", summary: "Loaded two-hand push posture for a box or wall.", kind: "loop", travel: "travel",
  facingChange: 0, contacts: ["lFoot", "rFoot", "lHand", "rHand"], aim: null, prop: "box", mirrorable: true, tags: ["prop", "hands"]
});
clips["turn-around"] ??= turnAroundClip();
clips["hold-pose"] ??= withMeta({ ...MOTION_CLIP_LIBRARY.clips["static-pose"]!, name: "hold-pose", loop: false }, {
  id: "hold-pose", label: "Hold pose", summary: "Hold a readable standing pose on the final frame.", kind: "hold", travel: "in-place",
  facingChange: 0, contacts: ["lFoot", "rFoot"], aim: null, prop: null, mirrorable: true, tags: ["hold"]
});

export const RUNTIME_MOTION_LIBRARY: MotionClipLibrary = {
  version: 1,
  fps: 30,
  rig: MOTION_CLIP_LIBRARY.clips.idle!.rig,
  clips
};

export const RUNTIME_ACTION_NAMES = Object.freeze(Object.keys(RUNTIME_MOTION_LIBRARY.clips).sort());

export function getMotionClip(id: string): MotionClip | undefined {
  return RUNTIME_MOTION_LIBRARY.clips[id];
}

export function getMotionMeta(id: string): MotionClipMeta | undefined {
  return getMotionClip(id)?.meta;
}
