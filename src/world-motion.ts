import { compileAnimation, sampleMotionIntent, type MotionPoseIntent as PoseIntent } from "./compiler.js";
import { CONTRACT_VERSION, type CompiledAnimation, type Point2D, type SampledFrame } from "./contract.js";

export interface WorldPoint { x: number; z: number }
export interface WorldTarget extends WorldPoint { height: number }
export interface WorldRoom {
  width: number;
  depth: number;
  initial: WorldPoint;
  pointTarget: WorldTarget;
  /** Trusted local, fixed orthographic projection. Height projects vertically. */
  projectWorld(point: WorldPoint, height?: number): Point2D;
  /** True means a disc can occupy this point; must include all room obstacles. */
  canOccupy?: (point: WorldPoint, radius: number) => boolean;
  /** World-space collision disc, >=1 and large enough to cover the stance. */
  actorRadius?: number;
}
export interface WorldMotionScene extends WorldRoom {
  canvas: { width: number; height: number; fps?: number };
  /** Optional canonical authored baseline from MCP; never mutated. */
  program?: CompiledAnimation;
}
export interface MotionIntent {
  horizontal: -1 | 0 | 1;
  depth: -1 | 0 | 1;
  run: boolean;
  jumpRequest: number;
  pointRequest: number;
  stop: boolean;
}
export type MotionStatus = "idle" | "moving" | "jumping" | "pointing" | "blocked";
interface Foot { anchor: WorldPoint; pole: -1 | 1 }
interface Swing { side: "left" | "right"; from: WorldPoint; to: WorldPoint; start: number; duration: number }
interface Jump { stage: "load" | "flight" | "land"; start: number }

/**
 * Planner state is opaque to consumers. Contact trajectories and root integration
 * belong here; joint lengths, FK, IK, reach and floor gates belong ONLY to compiler.
 * Bounded prototype: fixed affine orthographic camera, flat X/Z room, full-size
 * camera-facing rig, 90/145 world units per second, no wall sliding/pathfinding,
 * no air steering, slopes, stairs, combat or front/back sprite artwork. Knee
 * branches are carried unchanged across reversal instead of flipping joints.
 * Room/depth occlusion belongs to the rendering host, not this planner.
 */
export interface MotionIntentState {
  readonly timeMs: number;
  readonly worldRoot: Readonly<WorldPoint>;
  readonly program: CompiledAnimation;
  readonly scene: WorldMotionScene;
  /** @internal */
  readonly runtime: Planner;
}
interface Planner {
  simulatedMs: number;
  originMs: number;
  velocity: WorldPoint;
  root: WorldPoint;
  left: Foot;
  right: Foot;
  stance: WorldPoint;
  swing: Swing | null;
  nextSide: "left" | "right";
  phase: number;
  facing: -1 | 1;
  gaitWeight: number;
  runProfile: boolean;
  hipHeight: number;
  jump: Jump | null;
  lastJump: number;
  lastPoint: number;
  pointing: number;
  blocked: boolean;
  intent: MotionIntent;
}
export interface MotionIntentSample {
  state: MotionIntentState;
  frame: SampledFrame;
  status: MotionStatus;
  worldRoot: WorldPoint;
  /** Actor flight lift in world units; stance/swing clearance is not actor lift. */
  worldHeight: number;
  diagnostic?: string;
  /** World-space diagnostic contacts, not a second pose or skeleton. */
  contacts: { left: { world: WorldPoint; contact: boolean }; right: { world: WorldPoint; contact: boolean } };
}

const TICK_MS = 5;
const none: MotionIntent = { horizontal: 0, depth: 0, run: false, jumpRequest: 0, pointRequest: 0, stop: false };
const length = (v: WorldPoint): number => Math.hypot(v.x, v.z);
const add = (a: WorldPoint, b: WorldPoint): WorldPoint => ({ x: a.x + b.x, z: a.z + b.z });
const times = (a: WorldPoint, b: number): WorldPoint => ({ x: a.x * b, z: a.z * b });
const mix = (a: WorldPoint, b: WorldPoint, t: number): WorldPoint => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => { const t = clamp(v); return t * t * (3 - 2 * t); };
function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}
function project(scene: WorldRoom, point: WorldPoint, height = 0): Point2D {
  const result = scene.projectWorld({ ...point }, height);
  finite(result.x, "Projected x"); finite(result.y, "Projected y");
  return { ...result };
}
function occupy(scene: WorldRoom, point: WorldPoint, radius: number): boolean {
  return point.x >= radius && point.x <= scene.width - radius
    && (scene.depth === 0 ? point.z === 0 : point.z >= radius && point.z <= scene.depth - radius)
    && (scene.canOccupy?.({ ...point }, radius) ?? true);
}
function pathFree(scene: WorldRoom, a: WorldPoint, b: WorldPoint, radius: number): boolean {
  // At most one world unit between tests, including the endpoint. No endpoint-
  // only collision test that can jump across a thin obstacle after a long RAF.
  const count = Math.max(1, Math.ceil(length({ x: b.x - a.x, z: b.z - a.z })));
  for (let i = 1; i <= count; i++) if (!occupy(scene, mix(a, b, i / count), radius)) return false;
  return true;
}
function stanceFor(scene: WorldRoom): WorldPoint {
  const o = project(scene, scene.initial);
  const x = project(scene, add(scene.initial, { x: 1, z: 0 }));
  const z = project(scene, add(scene.initial, { x: 0, z: 1 }));
  const ax = x.x - o.x, ay = x.y - o.y, bx = z.x - o.x, by = z.y - o.y;
  const determinant = ax * by - ay * bx;
  const high = project(scene, scene.initial, 10);
  if (Math.abs(high.x - o.x) > 1e-6 || high.y >= o.y) throw new RangeError("Billboard projection must map positive height vertically upward.");
  if (scene.depth === 0) {
    if (Math.abs(ax) < 1e-6 || Math.abs(ay) > 1e-6) throw new RangeError("Flat scene needs a horizontal projection.");
    return { x: 9 / ax, z: 0 };
  }
  if (Math.abs(determinant) < 1e-6) throw new RangeError("Room projection must have independent ground X/Z axes.");
  const probe = add(scene.initial, { x: 2, z: 3 });
  const mapped = project(scene, probe);
  if (Math.hypot(mapped.x - o.x - ax * 2 - bx * 3, mapped.y - o.y - ay * 2 - by * 3) > 1e-5) {
    throw new RangeError("This prototype requires a fixed affine orthographic camera.");
  }
  // Camera inverse, NOT a joint solver: put the initial billboard stance level
  // in screen space while retaining both feet as genuine world-space anchors.
  return { x: 9 * by / determinant, z: -9 * ay / determinant };
}

export function createMotionIntentState(sceneInput: WorldMotionScene, initialTimeMs = 0): MotionIntentState {
  finite(initialTimeMs, "initialTimeMs");
  const scene: WorldMotionScene = {
    ...sceneInput, canvas: { ...sceneInput.canvas },
    initial: { ...sceneInput.initial }, pointTarget: { ...sceneInput.pointTarget },
    projectWorld: (point, height = 0) => sceneInput.projectWorld(point, height),
    ...(sceneInput.canOccupy ? { canOccupy: (point: WorldPoint, radius: number) => sceneInput.canOccupy!(point, radius) } : {})
  };
  for (const [name, value] of Object.entries({
    width: scene.width, depth: scene.depth, initialX: scene.initial.x, initialZ: scene.initial.z,
    targetX: scene.pointTarget.x, targetZ: scene.pointTarget.z, targetHeight: scene.pointTarget.height
  })) finite(value, name);
  if (scene.width <= 0 || scene.depth < 0 || scene.pointTarget.height < 0) throw new RangeError("Invalid world dimensions or target height.");
  if (scene.pointTarget.x < 0 || scene.pointTarget.x > scene.width
    || scene.pointTarget.z < 0 || scene.pointTarget.z > scene.depth) {
    throw new RangeError("Pointing target must be inside the world room.");
  }
  const radius = scene.actorRadius ?? 14;
  finite(radius, "actorRadius");
  if (radius < 1 || !occupy(scene, scene.initial, radius)) throw new RangeError("Initial world root must be inside usable, unoccupied room bounds with radius >=1.");
  const root = project(scene, scene.initial);
  if (scene.canvas.width < 180 || root.y < 196 || root.x < 80 || root.x > scene.canvas.width - 80 || root.y > scene.canvas.height - 4) {
    throw new RangeError("Projected initial root needs full-size rig headroom and an 80-unit horizontal margin.");
  }
  const result = compileAnimation(scene.program?.spec ?? {
    version: CONTRACT_VERSION, canvas: { ...scene.canvas, fps: scene.canvas.fps ?? 30 },
    actor: { x: root.x, groundY: root.y }, durationMs: 100, actions: []
  });
  if (scene.program && scene.program.contractVersion !== CONTRACT_VERSION) throw new TypeError("Expected a canonical v1 baseline program.");
  if (!result.valid || !result.program) throw new TypeError(`Invalid motion baseline: ${JSON.stringify(result.diagnostics)}`);
  if (result.program.spec.canvas.width !== scene.canvas.width || result.program.spec.canvas.height !== scene.canvas.height) {
    throw new RangeError("Authored baseline and projected room must use the same virtual canvas.");
  }
  const stance = stanceFor(scene);
  if (radius < length(stance)) throw new RangeError("actorRadius must cover the billboard's world-space foot stance.");
  const runtime: Planner = {
    simulatedMs: initialTimeMs, originMs: initialTimeMs, velocity: { x: 0, z: 0 }, root: { ...scene.initial },
    left: { anchor: add(scene.initial, times(stance, -1)), pole: -1 },
    right: { anchor: add(scene.initial, stance), pole: -1 }, stance, swing: null, nextSide: "right",
    phase: 0, facing: 1, gaitWeight: 0, runProfile: false, hipHeight: 70, jump: null, lastJump: 0, lastPoint: 0,
    pointing: 0, blocked: false, intent: { ...none }
  };
  const state: MotionIntentState = { timeMs: initialTimeMs, worldRoot: { ...scene.initial }, program: result.program, scene, runtime };
  poseSample(state); // Exact canonical validation before returning a usable state.
  return state;
}

function consume(p: Planner, intent: MotionIntent, atMs: number): void {
  if (intent.stop) {
    p.lastJump = intent.jumpRequest;
    p.lastPoint = intent.pointRequest;
    p.pointing = 0;
    if (p.jump?.stage === "load") p.jump = { stage: "land", start: atMs };
  } else {
    if (intent.jumpRequest > p.lastJump && !p.jump) {
      p.lastJump = intent.jumpRequest;
      p.jump = { stage: "load", start: atMs };
      p.pointing = 0;
    }
    if (intent.pointRequest > p.lastPoint) {
      p.lastPoint = intent.pointRequest;
      p.pointing = 1;
    }
  }
  p.intent = { ...intent };
}

function isSettledIdle(p: Planner, scene: WorldMotionScene, intent: MotionIntent): boolean {
  const quiet = (value: MotionIntent): boolean => value.stop
    || (value.horizontal === 0 && (value.depth === 0 || scene.depth === 0)
      && value.jumpRequest <= p.lastJump && value.pointRequest <= p.lastPoint);
  return p.velocity.x === 0 && p.velocity.z === 0
    && p.swing === null && p.jump === null && p.pointing === 0
    && quiet(p.intent) && quiet(intent);
}
function advanceIdleClock(p: Planner, toTimeMs: number): void {
  p.simulatedMs = p.originMs + Math.floor((toTimeMs - p.originMs) / TICK_MS) * TICK_MS;
}

function step(scene: WorldMotionScene, p: Planner, atMs: number): void {
  const dt = (atMs - p.simulatedMs) / 1000;
  p.simulatedMs = atMs;
  const radius = scene.actorRadius ?? 14;
  const wantsMove = !p.intent.stop && !p.jump && (p.intent.horizontal !== 0 || p.intent.depth !== 0);
  const unit = wantsMove ? { x: p.intent.horizontal, z: scene.depth === 0 ? 0 : p.intent.depth } : { x: 0, z: 0 };
  const magnitude = length(unit);
  const target = magnitude ? times(unit, (p.intent.run ? 145 : 90) / magnitude) : unit;
  const difference = { x: target.x - p.velocity.x, z: target.z - p.velocity.z };
  const change = length(difference);
  const acceleration = magnitude ? 1100 : 1300;
  const oldVelocity = p.velocity;
  const previousRoot = p.root;
  p.velocity = change <= acceleration * dt ? target : add(p.velocity, times(difference, acceleration * dt / change));
  let candidate = add(p.root, times(add(oldVelocity, p.velocity), dt / 2));
  const projectedCandidate = project(scene, candidate);
  const fitsViewport = projectedCandidate.x >= 80 && projectedCandidate.x <= scene.canvas.width - 80
    && projectedCandidate.y >= 196 && projectedCandidate.y <= scene.canvas.height - 4;
  if (!pathFree(scene, p.root, candidate, radius) || !fitsViewport) {
    candidate = p.root;
    p.velocity = { x: 0, z: 0 };
    p.blocked = wantsMove;
  } else p.blocked = false;
  p.root = candidate;
  const speed = length(p.velocity);
  const projected = project(scene, p.root);
  const ahead = project(scene, add(p.root, target));
  const sign = Math.sign(ahead.x - projected.x);
  const changingFacing = sign !== 0 && p.facing !== sign;
  const changingProfile = p.intent.run !== p.runProfile;
  // Cross the neutral arm profile before changing discrete facing/run style.
  // Feet/phase/root never reset, and no canonical arm formula is duplicated.
  const weight = changingFacing || changingProfile ? 0 : Math.min(1, speed / 90);
  p.gaitWeight += (weight - p.gaitWeight) * Math.min(1, dt * 20);
  if (p.gaitWeight < 0.02) {
    if (sign) p.facing = sign < 0 ? -1 : 1;
    p.runProfile = p.intent.run;
  }
  if (!p.swing && !p.jump && wantsMove && speed > 1) {
    const side = p.nextSide;
    const duration = p.intent.run ? 200 : 250;
    const predictedRoot = add(p.root, times(p.velocity, duration / 1000));
    const offset = times(p.stance, side === "left" ? -1 : 1);
    let end = add(predictedRoot, offset);
    if (!pathFree(scene, p.root, predictedRoot, radius) || !occupy(scene, end, 0)) end = add(p.root, offset);
    if (!pathFree(scene, p[side].anchor, end, 1)) {
      // Reject the proposed tick before drawing it; never drag a support foot
      // across an obstacle to manufacture clearance.
      p.root = previousRoot;
      p.velocity = { x: 0, z: 0 };
      p.blocked = true;
    } else {
      p.swing = { side, from: { ...p[side].anchor }, to: end, start: atMs, duration };
      p.nextSide = side === "left" ? "right" : "left";
    }
  }
  if (p.swing && atMs >= p.swing.start + p.swing.duration) {
    p[p.swing.side].anchor = { ...p.swing.to };
    p.phase += 1;
    p.swing = null;
  }
  if (p.jump) {
    const elapsed = atMs - p.jump.start;
    if (p.jump.stage === "load" && elapsed >= 80 && !p.swing && speed < 0.1) p.jump = { stage: "flight", start: atMs };
    else if (p.jump.stage === "flight" && elapsed >= 380) p.jump = { stage: "land", start: atMs };
    else if (p.jump.stage === "land" && elapsed >= 100) p.jump = null;
  }
  // Body envelope is a requested pose intention; core caps its actual reachable
  // pelvis through the SAME fixed-bone support solver. No reach formula here.
  let desiredHip = 70 - 6 * p.gaitWeight;
  if (p.jump?.stage === "load") desiredHip = 70 - 19 * smooth((atMs - p.jump.start) / 80);
  if (p.jump?.stage === "flight") desiredHip = 70;
  if (p.jump?.stage === "land") desiredHip = 51 + 19 * smooth((atMs - p.jump.start) / 100);
  p.hipHeight += (desiredHip - p.hipHeight) * Math.min(1, dt * 30);
  if (p.pointing) p.pointing = Math.max(0, p.pointing - dt / 0.7);
}

function poseSample(state: MotionIntentState): MotionIntentSample {
  const { scene, runtime: p } = state;
  const root = project(scene, p.root);
  const airborne = p.jump?.stage === "flight";
  const lift = airborne ? 28 * 4 * clamp((p.simulatedMs - p.jump!.start) / 380) * (1 - clamp((p.simulatedMs - p.jump!.start) / 380)) : 0;
  const foot = (side: "left" | "right") => {
    const active = p.swing?.side === side ? p.swing : null;
    const u = active ? clamp((p.simulatedMs - active.start) / active.duration) : 0;
    const world = active ? mix(active.from, active.to, smooth(u)) : { ...p[side].anchor };
    const height = lift + (active ? 9 * Math.sin(Math.PI * u) ** 2 : 0);
    const floor = project(scene, world);
    const point = project(scene, world, height);
    return { world, contact: !active && !airborne, x: point.x, y: point.y, floorY: floor.y, pole: p[side].pole };
  };
  const left = foot("left"), right = foot("right");
  const worldHead = project(scene, p.root, lift);
  const status: MotionStatus = p.jump ? "jumping" : p.swing || length(p.velocity) > 0.1 ? "moving"
    : p.pointing > 0 ? "pointing" : p.blocked ? "blocked" : "idle";
  const target = project(scene, scene.pointTarget, scene.pointTarget.height);
  // Extra projected-floor fields are internal sampled pose data, NEVER authored
  // AnimationSpec fields. Core owner owns their floor/reach interpretation.
  const pose: PoseIntent & { groundY: number } = {
    rootX: root.x, groundY: root.y, facing: p.facing,
    phase: p.phase + (p.swing ? clamp((p.simulatedMs - p.swing.start) / p.swing.duration) : 0),
    hipHeight: p.hipHeight + root.y - worldHead.y,
    gaitWeight: p.gaitWeight, action: p.jump ? "jump" : status === "moving" ? p.runProfile ? "run" : "walk" : p.pointing > 0 ? "point" : "idle",
    leftFoot: left, rightFoot: right,
    ...(p.pointing > 0 ? { point: { ...target, weight: Math.sin(Math.PI * p.pointing) } } : {})
  };
  const frame = sampleMotionIntent(state.program, state.timeMs, pose);
  return {
    state, frame, status, worldRoot: { ...p.root }, worldHeight: lift,
    contacts: { left: { world: { ...left.world }, contact: left.contact }, right: { world: { ...right.world }, contact: right.contact } }
  };
}

/**
 * Fixed 5ms simulation grid anchored to initialization. Calls only accept
 * monotonic absolute timestamps and edge IDs. Sub-tick input changes latch at
 * their timestamp and take effect on the next grid tick (<=5ms). Splitting RAF
 * calls does not reset the grid. Settled idle gaps preserve pose/anchors and
 * advance only the clock on the original grid. Active gaps above 5s still fail
 * explicitly rather than discarding movement, flight or gesture elapsed time.
 */
export function advanceMotionIntent(state: MotionIntentState, intent: MotionIntent, toTimeMs: number): MotionIntentSample {
  finite(toTimeMs, "toTimeMs");
  if (toTimeMs < state.timeMs) throw new RangeError("Motion timestamps must be monotonic.");
  if (![intent.horizontal, intent.depth].every(v => v === -1 || v === 0 || v === 1)) throw new TypeError("Motion axes must be -1, 0 or 1.");
  if (typeof intent.run !== "boolean" || typeof intent.stop !== "boolean") throw new TypeError("Motion flags must be boolean.");
  if (![intent.jumpRequest, intent.pointRequest].every(v => Number.isSafeInteger(v) && v >= 0)) throw new RangeError("Motion edge IDs must be nonnegative safe integers.");
  const p: Planner = structuredClone(state.runtime);
  if (intent.jumpRequest < p.lastJump || intent.pointRequest < p.lastPoint) throw new RangeError("Motion edge IDs must be monotonic.");
  if (isSettledIdle(p, state.scene, intent)) {
    // No idle ticks/solver loop: keep the exact last pose, root, phase and world
    // anchors. Do not rebase originMs; the first subsequent input still uses the
    // original fixed grid. Pending/held motion cannot take this shortcut.
    consume(p, intent, state.timeMs);
    advanceIdleClock(p, toTimeMs);
    const updated: MotionIntentState = { ...state, timeMs: toTimeMs, worldRoot: { ...p.root }, runtime: p };
    return poseSample(updated);
  }
  if (toTimeMs - state.timeMs > 5000) {
    throw new RangeError("Motion gap exceeds 5 seconds; stop and remount after suspension.");
  }
  // Integrate the supplied intent over this interval; keyboard advances old
  // intent first, then applies the new one at exactly the same timestamp.
  consume(p, intent, state.timeMs);
  let next = p.originMs + (Math.floor((p.simulatedMs - p.originMs) / TICK_MS) + 1) * TICK_MS;
  while (next <= toTimeMs) {
    step(state.scene, p, next);
    // Every simulation tick passes the real canonical reach/floor/bone gates,
    // including ticks skipped by a slow renderer. A failure is explicit.
    poseSample({ ...state, timeMs: next, worldRoot: { ...p.root }, runtime: p });
    if (isSettledIdle(p, state.scene, intent)) {
      // Freeze at the first settled tick even within a larger RAF interval, so
      // later idle pose preservation is independent of renderer partitioning.
      advanceIdleClock(p, toTimeMs);
      break;
    }
    next += TICK_MS;
  }
  const updated: MotionIntentState = { ...state, timeMs: toTimeMs, worldRoot: { ...p.root }, runtime: p };
  return poseSample(updated);
}
