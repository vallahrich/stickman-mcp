import {
  CONTRACT_VERSION,
  type AnimationSpec,
  type CompileResult,
  type CompiledAnimation,
  type Diagnostic,
  type PlaybackMode,
  type SampledFrame,
  type Segment,
  type ValidationResult
} from "./contract.js";

const actionNames = new Set(["walk", "run", "wave", "point", "jump", "push"]);
const hexColor = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[], path: string, errors: Diagnostic[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push({ path: `${path}.${key}`, code: "unknown_field", message: `Unknown field "${key}". Remove it or use a supported contract field.` });
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// A real structural narrowing, independent of the path-specific diagnostics
// below. It only claims the contract's types, not motion feasibility.
function hasAnimationSpecStructure(value: unknown): value is AnimationSpec {
  const point = (candidate: unknown): boolean =>
    isRecord(candidate) && finiteNumber(candidate.x) && finiteNumber(candidate.y);
  if (!isRecord(value) || value.version !== CONTRACT_VERSION || !finiteNumber(value.durationMs)) return false;
  if (!isRecord(value.canvas) || !finiteNumber(value.canvas.width) || !finiteNumber(value.canvas.height) || !finiteNumber(value.canvas.fps)) return false;
  if (value.actor !== undefined) {
    if (!isRecord(value.actor)) return false;
    if (value.actor.x !== undefined && !finiteNumber(value.actor.x)) return false;
    if (value.actor.groundY !== undefined && !finiteNumber(value.actor.groundY)) return false;
    if (value.actor.color !== undefined && typeof value.actor.color !== "string") return false;
  }
  if (value.targets !== undefined && (!isRecord(value.targets) || !Object.values(value.targets).every(point))) return false;
  if (value.prop !== undefined) {
    const prop = value.prop;
    if (!isRecord(prop) || typeof prop.id !== "string" || !point(prop.handle)) return false;
    for (const key of ["x", "y", "width", "height", "toX"]) if (!finiteNumber(prop[key])) return false;
  }
  if (!Array.isArray(value.actions)) return false;
  const actions: unknown[] = value.actions;
  return actions.every((action) => isRecord(action)
    && typeof action.action === "string" && actionNames.has(action.action)
    && finiteNumber(action.startMs) && finiteNumber(action.durationMs)
    && (action.target === undefined || typeof action.target === "string"));
}

export function validateAnimation(input: unknown): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(input)) return { valid: false, diagnostics: [{ path: "$", code: "invalid_type", message: "Animation must be a JSON object." }] };
  hasOnlyKeys(input, ["version", "canvas", "durationMs", "actor", "targets", "prop", "actions"], "$", diagnostics);
  if (input.version !== CONTRACT_VERSION) diagnostics.push({ path: "$.version", code: "unsupported_version", message: `Expected "${CONTRACT_VERSION}".` });

  const canvas = input.canvas;
  if (!isRecord(canvas)) {
    diagnostics.push({ path: "$.canvas", code: "required_object", message: "Provide a canvas with width, height, and fps." });
  } else {
    hasOnlyKeys(canvas, ["width", "height", "fps"], "$.canvas", diagnostics);
    for (const [field, min, max] of [["width", 64, 4096], ["height", 64, 4096], ["fps", 1, 60]] as const) {
      const v = canvas[field];
      if (!finiteNumber(v) || !Number.isInteger(v) || v < min || v > max) {
        diagnostics.push({ path: `$.canvas.${field}`, code: "out_of_range", message: `${field} must be an integer from ${min} to ${max}.` });
      }
    }
  }
  if (!finiteNumber(input.durationMs) || !Number.isInteger(input.durationMs) || input.durationMs < 100 || input.durationMs > 120000) {
    diagnostics.push({ path: "$.durationMs", code: "out_of_range", message: "durationMs must be an integer from 100 to 120000." });
  }

  const width = isRecord(canvas) && finiteNumber(canvas.width) ? canvas.width : 0;
  const height = isRecord(canvas) && finiteNumber(canvas.height) ? canvas.height : 0;
  if (input.actor !== undefined) {
    if (!isRecord(input.actor)) diagnostics.push({ path: "$.actor", code: "invalid_type", message: "actor must be an object." });
    else {
      hasOnlyKeys(input.actor, ["x", "groundY", "color"], "$.actor", diagnostics);
      for (const key of ["x", "groundY"] as const) {
        if (input.actor[key] !== undefined && !finiteNumber(input.actor[key])) diagnostics.push({ path: `$.actor.${key}`, code: "invalid_number", message: `${key} must be a finite number.` });
        else if (finiteNumber(input.actor[key]) && ((key === "x" && (input.actor[key] < 0 || input.actor[key] > width)) || (key === "groundY" && (input.actor[key] < 0 || input.actor[key] > height)))) {
          diagnostics.push({ path: `$.actor.${key}`, code: "outside_canvas", message: `${key} must be inside the canvas.` });
        }
      }
      if (input.actor.color !== undefined && (typeof input.actor.color !== "string" || !hexColor.test(input.actor.color))) {
        diagnostics.push({ path: "$.actor.color", code: "invalid_color", message: "Use a six-digit hex color such as #202124." });
      }
    }
  }

  let targets: Record<string, unknown> = {};
  if (input.targets !== undefined) {
    if (!isRecord(input.targets)) diagnostics.push({ path: "$.targets", code: "invalid_type", message: "targets must map names to x/y positions." });
    else {
      targets = input.targets;
      for (const [name, value] of Object.entries(targets)) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) diagnostics.push({ path: `$.targets.${name}`, code: "invalid_name", message: "Target names must start with a letter and contain only letters, digits, hyphens, or underscores." });
        if (!isRecord(value) || !finiteNumber(value.x) || !finiteNumber(value.y)) {
          diagnostics.push({ path: `$.targets.${name}`, code: "invalid_target", message: "A target needs finite numeric x and y coordinates." });
        } else if (value.x < 0 || value.x > width || value.y < 0 || value.y > height) {
          diagnostics.push({ path: `$.targets.${name}`, code: "target_outside_canvas", message: "Target coordinates must be inside the canvas." });
        } else hasOnlyKeys(value, ["x", "y"], `$.targets.${name}`, diagnostics);
      }
    }
  }

  const prop = input.prop;
  if (prop !== undefined) {
    if (!isRecord(prop)) diagnostics.push({ path: "$.prop", code: "invalid_type", message: "prop must describe a visible bound rectangle and handle." });
    else {
      hasOnlyKeys(prop, ["id", "x", "y", "width", "height", "toX", "handle"], "$.prop", diagnostics);
      for (const key of ["id", "x", "y", "width", "height", "toX", "handle"]) {
        if (prop[key] === undefined) diagnostics.push({ path: `$.prop.${key}`, code: "required_field", message: `${key} is required for a bound prop.` });
      }
      if (typeof prop.id !== "string" || !prop.id.trim()) diagnostics.push({ path: "$.prop.id", code: "invalid_id", message: "Prop id must be a non-empty string." });
      for (const key of ["x", "y", "width", "height", "toX"] as const) {
        if (!finiteNumber(prop[key])) diagnostics.push({ path: `$.prop.${key}`, code: "invalid_number", message: `${key} must be a finite number.` });
        else if ((key === "width" || key === "height") && prop[key] <= 0) diagnostics.push({ path: `$.prop.${key}`, code: "out_of_range", message: `${key} must be greater than zero.` });
      }
      if (finiteNumber(prop.x) && finiteNumber(prop.y) && finiteNumber(prop.width) && finiteNumber(prop.height) && finiteNumber(prop.toX)) {
        if (prop.x < 0 || prop.y < 0 || prop.x + prop.width > width || prop.y + prop.height > height || prop.toX < prop.x || prop.toX + prop.width > width) {
          diagnostics.push({ path: "$.prop", code: "prop_path_outside_canvas", message: "Keep the complete prop and its rightward push path inside the canvas." });
        }
      }
      if (!isRecord(prop.handle) || !finiteNumber(prop.handle.x) || !finiteNumber(prop.handle.y)) {
        diagnostics.push({ path: "$.prop.handle", code: "invalid_handle", message: "handle must provide finite x and y coordinates in prop-local space." });
      } else {
        hasOnlyKeys(prop.handle, ["x", "y"], "$.prop.handle", diagnostics);
        if (finiteNumber(prop.width) && finiteNumber(prop.height) && (prop.handle.x < 0 || prop.handle.x > prop.width || prop.handle.y < 0 || prop.handle.y > prop.height)) {
          diagnostics.push({ path: "$.prop.handle", code: "handle_outside_prop", message: "The handle must lie inside the visible prop." });
        }
      }
    }
  }

  if (!Array.isArray(input.actions)) diagnostics.push({ path: "$.actions", code: "required_array", message: "Provide an actions array (it may be empty)." });
  else {
    let lastEnd = 0;
    let pushCount = 0;
    const actions: unknown[] = input.actions;
    for (let i = 0; i < actions.length; i++) {
      const path = `$.actions[${i}]`;
      const action = actions[i];
      if (!isRecord(action)) {
        diagnostics.push({ path, code: "invalid_type", message: "Each action must be an object." });
        continue;
      }
      hasOnlyKeys(action, ["action", "startMs", "durationMs", "target"], path, diagnostics);
      if (typeof action.action !== "string" || !actionNames.has(action.action)) {
        diagnostics.push({ path: `${path}.action`, code: "unsupported_action", message: `Unsupported action. Supported actions: ${[...actionNames].join(", ")}.` });
      }
      if (!finiteNumber(action.startMs) || !Number.isInteger(action.startMs) || action.startMs < 0) diagnostics.push({ path: `${path}.startMs`, code: "invalid_time", message: "startMs must be a non-negative integer." });
      if (!finiteNumber(action.durationMs) || !Number.isInteger(action.durationMs) || action.durationMs < 300) diagnostics.push({ path: `${path}.durationMs`, code: "invalid_duration", message: "durationMs must be an integer of at least 300." });
      if (typeof action.startMs === "number" && typeof action.durationMs === "number" && Number.isFinite(action.startMs) && Number.isFinite(action.durationMs)) {
        const end = action.startMs + action.durationMs;
        if (action.startMs < lastEnd) diagnostics.push({ path: `${path}.startMs`, code: "overlapping_actions", message: "Actions must be sorted and non-overlapping so one playhead can preserve continuous boundaries." });
        if (typeof input.durationMs === "number" && end > input.durationMs) diagnostics.push({ path, code: "action_exceeds_duration", message: "The action ends after the animation duration." });
        lastEnd = Math.max(lastEnd, end);
      }
      if (["walk", "run", "point"].includes(String(action.action))) {
        if (typeof action.target !== "string" || !Object.hasOwn(targets, action.target)) {
          diagnostics.push({ path: `${path}.target`, code: "unbound_target", message: `${String(action.action)} requires a target ID declared under targets.` });
        }
      } else if (action.action === "push") {
        pushCount++;
        if (typeof action.target !== "string" || !isRecord(prop) || action.target !== prop.id) {
          diagnostics.push({ path: `${path}.target`, code: "unbound_prop", message: "push must target the ID of the visible prop in $.prop." });
        }
      } else if (action.target !== undefined) {
        diagnostics.push({ path: `${path}.target`, code: "unexpected_target", message: `${String(action.action)} does not accept a target.` });
      }
    }
    if (pushCount > 1) diagnostics.push({ path: "$.actions", code: "multiple_prop_pushes", message: "A v1 animation binds one push interaction to one prop." });
    if (pushCount === 0 && prop !== undefined) diagnostics.push({ path: "$.prop", code: "unused_prop", message: "A prop must be referenced by one push action or removed." });
  }
  // Only inspect motion after structural validation: the sampler is also the
  // authority for reach/clearance, not a second approximation of the skeleton.
  if (diagnostics.length === 0) {
    if (hasAnimationSpecStructure(input)) validateMotion(input, diagnostics);
    else diagnostics.push({ path: "$", code: "invalid_structure", message: "Animation fields must match the v1 object, point, prop and action structures." });
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

function validateMotion(spec: AnimationSpec, diagnostics: Diagnostic[]): void {
  const program: CompiledAnimation = { contractVersion: CONTRACT_VERSION, spec };
  const ground = spec.actor?.groundY ?? spec.canvas.height * 0.8;
  // Cheap preflight uses the sampler's sizing policy, before any pose search
  // or coverage allocation. Small canvases remain supported; a subpixel rig
  // caused by a floor at the top of a canvas is an error, not a valid miniature.
  const headroom = spec.actions.some((item) => item.action === "jump") ? 192
    : spec.actions.some((item) => item.action === "wave" || item.action === "point") ? 170 : 145;
  const requestedScale = Math.min(1, spec.canvas.width / 180, (ground - 4) / headroom);
  const scale = Math.max(0.001, requestedScale);
  if (requestedScale < 0.2) diagnostics.push({
    path: "$.actor.groundY", code: "rig_too_small",
    message: `This floor leaves too little headroom for a readable rig (minimum scale 0.2). Increase groundY to at least ${(4 + headroom * 0.2).toFixed(1)} or enlarge the canvas; the engine will not hide the actor as a subpixel miniature.`
  });
  if (spec.prop && Math.abs(spec.prop.y + spec.prop.height - ground) > 0.001) {
    diagnostics.push({ path: "$.prop", code: "ungrounded_prop", message: `The pushed crate must rest on the same world floor as the actor (y + height = ${ground}). Adjust the crate geometry; the engine does not move the floor or levitate the prop.` });
  }
  if (spec.prop && spec.prop.handle.y + 3 * scale > spec.prop.height + 1e-6) diagnostics.push({
    path: "$.prop.handle", code: "grip_region_outside_prop",
    message: "The far/left grip is 3 scaled units below the declared near/right handle. Move the handle upward so both assigned grips remain inside the prop."
  });
  let root = spec.actor?.x ?? spec.canvas.width * 0.2;
  const routes: { item: AnimationSpec["actions"][number]; index: number; distance: number; count: number }[] = [];
  for (const [index, item] of spec.actions.entries()) {
    const path = `$.actions[${index}]`;
    let distance = 0;
    if (item.action === "walk" || item.action === "run") {
      const target = spec.targets![item.target!]!;
      if (Math.abs(target.y - ground) > 0.001) {
        diagnostics.push({ path: `${path}.target`, code: "non_flat_ground", message: `v1 locomotion uses one world floor at y=${ground}. Set target "${item.target}" y to ${ground}; a different y would require a terrain/path contract, not a moving floor.` });
      }
      distance = Math.abs(target.x - root);
      root = target.x;
    } else if (item.action === "push") {
      const prop = spec.prop!;
      if (prop.x + prop.handle.x <= root) diagnostics.push({ path: "$.prop.handle", code: "unsupported_push_facing", message: "v1 push is rightward. Establish a root position to the left of the handle before pushing." });
      distance = prop.toX - prop.x;
      root += distance;
    }
    if (distance > 0) {
      const stride = (item.action === "run" ? 90 : item.action === "push" ? 28 : 40) * scale;
      const baseSteps = Math.max(item.action === "run" && distance > 120 * scale ? 4 : 2, Math.ceil(distance / stride));
      const steps = item.action === "run" ? baseSteps + baseSteps % 2 : baseSteps;
      // Reserve time for anticipation/turning and landing/release. These are
      // diagnostic limits, not permission to retime an authored action.
      const driveSeconds = item.durationMs / 1000 * (item.action === "push" ? 0.5 : 0.76);
      const maxCadence = item.action === "run" ? 5.5 : item.action === "push" ? 5 : 4;
      if (steps / driveSeconds > maxCadence) diagnostics.push({
        path: `${path}.durationMs`, code: "infeasible_cadence",
        message: `${distance.toFixed(1)} units require ${steps} supported steps at this rig scale. Increase durationMs to at least ${Math.ceil(1000 * steps / (maxCadence * (item.action === "push" ? 0.5 : 0.76)))} or shorten the route; the engine will not slide feet or change the requested duration.`
      });
    }
    routes.push({ item, index, distance, count: 0 });
  }
  // Preserve all cheap semantic diagnostics, but do not pay for geometry that
  // is already known to be impossible (especially at the 0.001 fallback size).
  if (diagnostics.length > 0) return;
  const maxSamplesPerAction = 4096;
  const maxSamplesTotal = 32768;
  let requiredSamples = 2;
  for (const route of routes) {
    // Never silently lower coverage and accept unchecked motion. If the
    // requested scale/route needs more work, reject with a concrete remedy.
    route.count = Math.max(64, Math.ceil(route.distance / (4 * scale)));
    requiredSamples += route.count + 1;
    if (route.count > maxSamplesPerAction) diagnostics.push({
      path: `$.actions[${route.index}]`, code: "validation_capacity_exceeded",
      message: `This route requires ${route.count} fit intervals at this rig scale; the limit is ${maxSamplesPerAction} per action. Increase headroom for a larger rig, shorten the route, or split it into shorter actions.`
    });
  }
  if (requiredSamples > maxSamplesTotal) diagnostics.push({
    path: "$.actions", code: "validation_capacity_exceeded",
    message: `This timeline requires ${requiredSamples} fit samples; the limit is ${maxSamplesTotal}. Split the animation into smaller documents or reduce its routes/actions.`
  });
  if (diagnostics.length > 0) return;
  let fit = false;
  let overlap = false;
  let belowFloor = false;
  // Segment/rectangle test (slab intersection). Arms are intentionally allowed
  // to reach a prop-local handle; torso, head and legs are not.
  const intersects = (line: Segment, prop: NonNullable<SampledFrame["prop"]>): boolean => {
    let lo = 0;
    let hi = 1;
    const inset = 0.5 * scale;
    for (const [a, b, min, max] of [
      [line.x1, line.x2, prop.x - inset, prop.x + prop.width + inset],
      [line.y1, line.y2, prop.y - inset, prop.y + prop.height + inset]
    ]) {
      const delta = b! - a!;
      if (Math.abs(delta) < 1e-9) { if (a! < min! || a! > max!) return false; }
      else {
        const entry = (min! - a!) / delta;
        const exit = (max! - a!) / delta;
        lo = Math.max(lo, Math.min(entry, exit));
        hi = Math.min(hi, Math.max(entry, exit));
        if (lo > hi) return false;
      }
    }
    return true;
  };
  const inspect = (frame: SampledFrame): void => {
    const margin = 2.5 * scale;
    for (const line of frame.segments) {
      for (const point of [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }]) {
        if (point.x < margin || point.x > spec.canvas.width - margin || point.y < margin || point.y > spec.canvas.height - margin) fit = true;
        if (point.y > ground + 1e-6) belowFloor = true;
      }
      if (frame.prop && (line.id === "torso" || line.id.includes("thigh") || line.id.includes("shin")) && intersects(line, frame.prop)) overlap = true;
    }
    const radius = 13 * scale; // 10.5-unit head plus its stroke.
    if (frame.head.x < radius || frame.head.x > spec.canvas.width - radius || frame.head.y < radius || frame.head.y > spec.canvas.height - radius) fit = true;
    if (frame.prop) {
      const closestX = Math.max(frame.prop.x, Math.min(frame.prop.x + frame.prop.width, frame.head.x));
      const closestY = Math.max(frame.prop.y, Math.min(frame.prop.y + frame.prop.height, frame.head.y));
      if (Math.hypot(closestX - frame.head.x, closestY - frame.head.y) < radius) overlap = true;
    }
  };
  const reportGeometry = (): void => {
    if (fit) diagnostics.push({ path: "$.actor", code: "rig_outside_canvas", message: "The complete fixed-length rig does not fit this actor/target placement. Move the actor or target inward, leave headroom, or enlarge the canvas; authored root positions are never silently relocated." });
    if (belowFloor) diagnostics.push({ path: "$.actions", code: "floor_penetration", message: "This placement requires a joint below the world floor. Increase stand-off/support clearance or adjust the grip; the rig cannot stretch or pass through the floor." });
    if (overlap) diagnostics.push({ path: "$.prop", code: "actor_prop_overlap", message: "The torso, head or a leg intersects the visible crate along this timeline. Leave a genuine stand-off before the push and keep the approach path outside the crate; an inside-body grip is not a feasible interaction." });
  };
  // A few mandatory endpoint/grip poses catch cheap fit/contact failures and
  // retain useful overlap diagnostics without doing dense path coverage.
  inspect(sampleAnimation(program, 0));
  inspect(sampleAnimation(program, spec.durationMs));
  for (const { item } of routes) {
    if (item.action !== "push") continue;
    let gripError = 0;
    for (const fraction of [0.32, 0.4, 0.5, 0.6, 0.7, 0.8, 0.82]) {
      const frame = sampleAnimation(program, item.startMs + item.durationMs * fraction);
      inspect(frame);
      for (const id of ["left-forearm", "right-forearm"]) {
        const hand = frame.segments.find((segment) => segment.id === id)!;
        const assignedY = frame.prop!.handleY + (id === "left-forearm" ? 3 * scale : 0);
        gripError = Math.max(gripError, Math.hypot(hand.x2 - frame.prop!.handleX, hand.y2 - assignedY));
      }
    }
    if (gripError > 0.01) diagnostics.push({
      path: "$.prop.handle", code: "unreachable_contact",
      message: `The handle cannot be held by both fixed ${28 * scale}-unit arm bones from the actual preceding root while maintaining a supported crouch/hinge and crate clearance (grip error ${gripError.toFixed(1)}). Re-author the stand-off/handle height or preceding walk target. For a 640×360 scene, try groundY=290, actor.x=105, crate x=150/y=240/height=50 and a left-face handle {x:0,y:18}.`
    });
  }
  if (diagnostics.length > 0 || fit || overlap || belowFloor) { reportGeometry(); return; }
  const times = new Set<number>([0, spec.durationMs]);
  for (const { item, count } of routes) {
    for (let i = 0; i <= count; i++) times.add(item.startMs + item.durationMs * i / count);
  }
  for (const time of times) inspect(sampleAnimation(program, time));
  reportGeometry();
}

export function compileAnimation(input: unknown): CompileResult {
  const validation = validateAnimation(input);
  if (!validation.valid) return validation;
  if (!hasAnimationSpecStructure(input)) return {
    valid: false, diagnostics: [{ path: "$", code: "invalid_structure", message: "Animation fields must match the v1 object, point, prop and action structures." }]
  };
  const spec = structuredClone(input);
  spec.actions.sort((a, b) => a.startMs - b.startMs);
  const program: CompiledAnimation = { contractVersion: CONTRACT_VERSION, spec };
  return { valid: true, diagnostics: [], program };
}

export function sampleAnimation(program: CompiledAnimation, timeMs: number, mode: PlaybackMode = "normal"): SampledFrame {
  // IMPORTANT: every runtime helper stays inside this function. The HTML
  // renderer embeds sampleAnimation.toString(), without a module loader.
  type Point = { x: number; y: number };
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) throw new TypeError("timeMs must be a finite number.");
  if (mode !== "normal" && mode !== "reduced" && mode !== "static") throw new TypeError('mode must be "normal", "reduced", or "static".');
  const spec = program.spec;
  const t = mode === "normal" ? Math.min(spec.durationMs, Math.max(0, timeMs)) : spec.durationMs;
  const groundY = spec.actor?.groundY ?? spec.canvas.height * 0.8;
  const headroom = spec.actions.some((item) => item.action === "jump") ? 192
    : spec.actions.some((item) => item.action === "wave" || item.action === "point") ? 170 : 145;
  const scale = Math.max(0.001, Math.min(1, spec.canvas.width / 180, (groundY - 4) / headroom));
  const torsoLength = 45 * scale;
  const armLength = 28 * scale;
  const legLength = 36 * scale;
  const stance = 9 * scale;
  const restHeight = 70 * scale;
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const smooth = (v: number): number => { const c = clamp01(v); return c * c * c * (10 + c * (-15 + 6 * c)); };
  const mix = (a: number, b: number, v: number): number => a + (b - a) * v;
  const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
  const angleMix = (a: number, b: number, v: number): number => a + wrap(b - a) * v;
  // Angles are measured from the downward axis; joints, not endpoints, blend.
  const bone = (start: Point, length: number, angle: number): Point => ({
    x: start.x + Math.sin(angle) * length, y: start.y + Math.cos(angle) * length
  });
  const armFK = (shoulder: Point, lean: number, upper: number, bend: number): { joint: Point; end: Point } => {
    const constrainedUpper = Math.max(-Math.PI, Math.min(Math.PI, upper));
    const constrainedBend = Math.max(-2.6, Math.min(2.6, bend));
    const joint = bone(shoulder, armLength, constrainedUpper - lean);
    return { joint, end: bone(joint, armLength, constrainedUpper - lean + constrainedBend) };
  };
  const ik = (start: Point, target: Point, length: number, pole: number, maxBend: number): { joint: Point; end: Point; upper: number; bend: number } => {
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const rawDistance = Math.hypot(dx, dy);
    const distance = Math.max(2 * length * Math.cos(maxBend / 2), Math.min(2 * length - 1e-8 * scale, rawDistance));
    const ux = rawDistance > 1e-9 ? dx / rawDistance : 0;
    const uy = rawDistance > 1e-9 ? dy / rawDistance : 1;
    const half = distance / 2;
    const offset = Math.sqrt(Math.max(0, length * length - half * half));
    const joint = { x: start.x + ux * half - uy * offset * pole, y: start.y + uy * half + ux * offset * pole };
    const end = { x: start.x + ux * distance, y: start.y + uy * distance };
    const upper = Math.atan2(joint.x - start.x, joint.y - start.y);
    const lower = Math.atan2(end.x - joint.x, end.y - joint.y);
    return { joint, end, upper, bend: wrap(lower - upper) };
  };
  // Integrated velocity with independently authored boundary speeds. Values
  // are normalized to this interval's distance/duration; the cruise speed is
  // solved from its integral, so waypoints and clip times remain exact.
  const travel = (value: number, entry = 0, exit = 0): number => {
    const u = clamp01(value);
    const ramp = 0.15;
    const cruise = (1 - ramp * (entry + exit) / 2) / (1 - ramp);
    if (u < ramp) {
      const w = u / ramp;
      return entry * u + (cruise - entry) * ramp * (w ** 3 - 0.5 * w ** 4);
    }
    if (u > 1 - ramp) return 1 - travel(1 - u, exit, entry);
    return ramp * (entry + cruise) / 2 + cruise * (u - ramp);
  };
  // Reconstruct routes from v1 data on every seek. No cached frame, compiler
  // metadata or imported helper is needed by the serialized browser sampler.
  type Route = { index: number; startX: number; endX: number; direction: number; facing: number; steps: number };
  const routes: Route[] = [];
  let routeX = spec.actor?.x ?? spec.canvas.width * 0.2;
  let routeFacing = 1;
  for (const [index, item] of spec.actions.entries()) {
    if (item.action === "walk" || item.action === "run") {
      const endX = spec.targets?.[item.target ?? ""]?.x ?? routeX;
      const direction = Math.sign(endX - routeX) || routeFacing;
      const distance = Math.abs(endX - routeX);
      const baseSteps = Math.max(item.action === "run" && distance > 120 * scale ? 4 : 2,
        Math.ceil(distance / ((item.action === "run" ? 90 : 40) * scale)));
      routes.push({ index, startX: routeX, endX, direction, facing: routeFacing,
        steps: item.action === "run" ? baseSteps + baseSteps % 2 : baseSteps });
      routeX = endX;
      routeFacing = direction;
    } else if (item.action === "push" && spec.prop) {
      routeX += spec.prop.toX - spec.prop.x;
      routeFacing = 1;
    } else if (item.action === "point") {
      routeFacing = Math.sign((spec.targets?.[item.target ?? ""]?.x ?? routeX) - routeX) || routeFacing;
    }
  }
  let rootX = spec.actor?.x ?? spec.canvas.width * 0.2;
  let propX = spec.prop?.x ?? 0;
  let facing = 1;
  let active: AnimationSpec["actions"][number] | undefined;
  let activeIndex = -1;
  let previous: AnimationSpec["actions"][number] | undefined;
  let previousDirection = facing;
  // Absolute timeline scan, never previous-frame integration. Completed clips
  // carry their exact root/prop endpoint and knee orientation to the next clip.
  for (const [index, item] of spec.actions.entries()) {
    if (t < item.startMs) break;
    if (mode === "normal" && t < item.startMs + item.durationMs) { active = item; activeIndex = index; break; }
    if (item.action === "walk" || item.action === "run") {
      const target = spec.targets?.[item.target ?? ""];
      if (target) {
        facing = Math.sign(target.x - rootX) || facing;
        previousDirection = facing;
        rootX = target.x;
      }
    } else if (item.action === "push" && spec.prop) {
      rootX += spec.prop.toX - spec.prop.x;
      propX = spec.prop.toX;
      facing = 1;
    }
    if (item.action === "point") {
      const target = spec.targets?.[item.target ?? ""];
      if (target) facing = Math.sign(target.x - rootX) || facing;
    }
    previous = item;
  }
  let hipHeight = restHeight;
  let hipOffset = 0;
  let lean = 0;
  let turning = false;
  let kneePole = -facing;
  let leftKneePole = kneePole;
  let rightKneePole = kneePole;
  let leftFoot: Point = { x: rootX - stance, y: groundY };
  let rightFoot: Point = { x: rootX + stance, y: groundY };
  let leftUpper = -0.32;
  let leftBend = -0.20;
  let rightUpper = 0.32;
  let rightBend = 0.20;
  let gesture = 0;
  let pointTarget: Point | undefined;
  let grip = 0;

  const gait = (startX: number, endX: number, value: number, kind: "walk" | "run" | "push",
    route?: { count: number; at: (u: number) => number; runAt: (phase: number) => number }
  ): { x: number; left: Point; right: Point; phase: number; envelope: number } => {
    const q = clamp01(value);
    const distance = Math.abs(endX - startX);
    const direction = Math.sign(endX - startX) || facing;
    // Original gait profiles: walking places a longer, relaxed step; running
    // covers distance with a true long stride, not faster short-step shuffling.
    const stride = (kind === "run" ? 90 : kind === "push" ? 28 : 40) * scale;
    const baseSteps = Math.max(kind === "run" && distance > 120 * scale ? 4 : 2, Math.ceil(distance / stride));
    // Complete alternating run pairs keep terminal feet reachable on short
    // routes; an odd final half-pair could throw one foot past full leg reach.
    const count = route?.count ?? (kind === "run" ? baseSteps + baseSteps % 2 : baseSteps);
    const at = route?.at ?? ((u: number): number => mix(startX, endX, travel(u)));
    const footAt = (isLeft: boolean): Point => {
      const offset = isLeft ? -stance : stance;
      let anchor = startX + offset;
      const finalAnchor = endX + offset;
      for (let step = 0; step < count; step++) {
        const steppingLeft = step % 2 === 0 ? direction > 0 : direction < 0;
        if (isLeft !== steppingLeft) continue;
        const run = route?.runAt(step + 0.5) ?? (kind === "run" ? 1 : 0);
        const lift = Math.max(0, (step + mix(0.12, -0.30, run)) / count);
        // The penultimate stopping foot lands only after the pelvis catches
        // up. A long stride must not demand an unreachable final stance.
        const stoppingPlace = step === count - 2 ? 1.35 : 1;
        const place = (step + mix(0.90, stoppingPlace, run)) / count;
        const lead = (kind === "push" ? 12 : mix(26, 36, run)) * scale;
        let next = step >= count - 2 ? finalAnchor : at(place) + direction * lead;
        next = direction > 0 ? Math.min(finalAnchor, Math.max(anchor, next)) : Math.max(finalAnchor, Math.min(anchor, next));
        if (q <= lift) return { x: anchor, y: groundY };
        if (q < place) {
          const u = (q - lift) / (place - lift);
          const clearance = (kind === "push" ? 7 : mix(11, 28, run)) * scale * Math.min(1, distance / (24 * scale));
          const swing = mix(anchor, next, smooth(u));
          // A free ankle passes under the moving pelvis, not along a huge
          // world-space chord to its next anchor. Correction vanishes with
          // zero slope at lift/place; planted anchors never move.
          const passing = kind === "push" ? 0 : Math.sin(Math.PI * u) ** 2;
          return { x: mix(swing, at(q), passing), y: groundY - clearance * Math.sin(Math.PI * u) ** 2 };
        }
        anchor = next;
      }
      return { x: anchor, y: groundY };
    };
    return {
      x: at(q), left: footAt(true), right: footAt(false), phase: q * count,
      envelope: smooth(q / 0.12) * smooth((1 - q) / 0.12)
    };
  };
  const connectedGait = (index: number): ReturnType<typeof gait> & { run: number } => {
    const current = routes.findIndex((route) => route.index === index);
    if (current < 0) throw new Error("A locomotion action requires a derived route.");
    const connects = (a: Route, b: Route): boolean => {
      const item = spec.actions[a.index]!;
      return b.index === a.index + 1 && item.startMs + item.durationMs === spec.actions[b.index]!.startMs
        && a.direction === b.direction && a.startX !== a.endX && b.startX !== b.endX;
    };
    let first = current;
    let last = current;
    while (first > 0 && connects(routes[first - 1]!, routes[first]!)) first--;
    while (last + 1 < routes.length && connects(routes[last]!, routes[last + 1]!)) last++;
    const group = routes.slice(first, last + 1);
    let total = 0;
    const spans = group.map((route, i) => {
      const item = spec.actions[route.index]!;
      const next = spec.actions[route.index + 1];
      const reverse = next && next.startMs === item.startMs + item.durationMs
        && (next.action === "walk" || next.action === "run");
      const start = item.startMs + (i === 0 ? item.durationMs * (route.facing !== route.direction ? 0.16 : 0.08) : 0);
      const end = item.startMs + item.durationMs * (i === group.length - 1 && !reverse ? 0.92 : 1);
      const span = { route, start, end, phase: total, distance: Math.abs(route.endX - route.startX) };
      total += route.steps;
      return span;
    });
    const speed = (i: number, phase: boolean): number => {
      if (i < 0 || i >= spans.length) return 0;
      const span = spans[i]!;
      return (phase ? span.route.steps : span.distance) / (span.end - span.start);
    };
    const progress = (i: number, q: number, phase: boolean): number => {
      if (phase && spans.length === 1) return q;
      const nominal = speed(i, phase);
      const entry = i === 0 ? 0 : Math.min(nominal, speed(i - 1, phase));
      const exit = i === spans.length - 1 ? 0 : Math.min(nominal, speed(i + 1, phase));
      return travel(q, nominal > 0 ? entry / nominal : 0, nominal > 0 ? exit / nominal : 0);
    };
    const phaseTime = (phase: number): { i: number; q: number; time: number } => {
      const target = Math.max(0, Math.min(total, phase));
      const i = Math.max(0, spans.findIndex((span) => target <= span.phase + span.route.steps));
      const span = spans[i]!;
      const fraction = (target - span.phase) / span.route.steps;
      if (spans.length === 1) return { i, q: fraction, time: mix(span.start, span.end, fraction) };
      if (fraction === 0 || fraction === 1) {
        return { i, q: fraction, time: mix(span.start, span.end, fraction) };
      }
      let lo = 0;
      let hi = 1;
      // Inverting a monotone phase integral schedules contacts analytically
      // from data, including steps which straddle an authored waypoint.
      for (let iteration = 0; iteration < 28; iteration++) {
        const mid = (lo + hi) / 2;
        if (progress(i, mid, true) < fraction) lo = mid; else hi = mid;
      }
      const q = target === 0 ? 0 : target === total ? 1 : (lo + hi) / 2;
      return { i, q, time: mix(span.start, span.end, q) };
    };
    const at = (u: number): number => {
      const { i, q } = phaseTime(u * total);
      const span = spans[i]!;
      return mix(span.route.startX, span.route.endX, progress(i, q, false));
    };
    const runAt = (phase: number): number => {
      const { i, time } = phaseTime(phase);
      const kind = (j: number): number => spec.actions[spans[j]!.route.index]!.action === "run" ? 1 : 0;
      let amount = kind(i);
      for (const boundary of [i, i + 1]) {
        if (boundary <= 0 || boundary >= spans.length) continue;
        const center = spans[boundary]!.start;
        const blendMs = Math.min(120, (spans[boundary - 1]!.end - spans[boundary - 1]!.start) / 4,
          (spans[boundary]!.end - spans[boundary]!.start) / 4);
        if (Math.abs(time - center) <= blendMs) amount = mix(kind(boundary - 1), kind(boundary), smooth((time - center + blendMs) / (2 * blendMs)));
      }
      return amount;
    };
    const i = current - first;
    const span = spans[i]!;
    const q = clamp01((t - span.start) / (span.end - span.start));
    const phase = span.phase + span.route.steps * progress(i, q, true);
    const pose = gait(group[0]!.startX, group.at(-1)!.endX, phase / total, "walk", { count: total, at, runAt });
    return { ...pose, x: mix(span.route.startX, span.route.endX, progress(i, q, false)), run: runAt(phase) };
  };
  const turn = (progress: number, direction: number, end: number, startHeight = restHeight): void => {
    if (facing !== direction && end > 0 && progress < end) {
      turning = true;
      const u = clamp01(progress / end);
      // Transfer support across the planted stance. Each leg changes branch
      // only at its own extension, at different times; no simultaneous pogo.
      const shift = 6 * scale;
      const extension = Math.sqrt((2 * legLength) ** 2 - (stance + shift) ** 2);
      if (u < 0.35) {
        const amount = smooth(u / 0.35);
        hipOffset = shift * amount;
        const reach = Math.sqrt((2 * legLength) ** 2 - (stance + hipOffset) ** 2);
        hipHeight = mix(startHeight, reach, amount) - (u < 0.28 ? 4 * scale * Math.sin(Math.PI * u / 0.28) ** 2 : 0);
      } else if (u < 0.65) {
        hipOffset = mix(shift, -shift, smooth((u - 0.35) / 0.30));
        hipHeight = extension;
      } else {
        const amount = smooth((u - 0.65) / 0.35);
        hipOffset = -shift * (1 - amount);
        const reach = Math.sqrt((2 * legLength) ** 2 - (stance - hipOffset) ** 2);
        hipHeight = mix(reach, restHeight, amount);
      }
      leftKneePole = -(u < 0.35 ? facing : direction);
      rightKneePole = -(u < 0.65 ? facing : direction);
    } else { kneePole = -direction; leftKneePole = kneePole; rightKneePole = kneePole; }
  };
  const pushPosture = (startX: number): { height: number; lean: number; load: number } => {
    const prop = spec.prop!;
    const handle = { x: prop.x + prop.handle.x, y: prop.y + prop.handle.y };
    let result = { height: restHeight, lean: 0.35, load: 0 };
    let best = Infinity;
    for (const load of [1, 0.6, 0.3]) {
      // Use the strongest feasible transfer. Very low handles may need a
      // smaller stroke, but never a static brace or relaxed grip tolerance.
      let backSupport = -stance;
      let frontSupport = stance;
      for (let i = 0; i <= 32; i++) {
        const pose = gait(startX, startX + prop.toX - prop.x, i / 32, "push");
        const pelvisX = pose.x + (3 + 2.5 * load * Math.sin(Math.PI * pose.phase)) * scale * pose.envelope;
        for (const foot of [pose.left, pose.right]) {
          backSupport = Math.min(backSupport, foot.x - pelvisX - 0.5 * scale);
          frontSupport = Math.max(frontSupport, foot.x - pelvisX + 0.5 * scale);
        }
      }
      for (let h = 70; h >= 34; h -= 2) {
        for (let angle = 0.18; angle <= 0.900001; angle += 0.04) {
          const hip = { x: startX, y: groundY - h * scale };
          const shoulder = bone(hip, torsoLength, Math.PI - angle);
          const head = bone(shoulder, 16.5 * scale, Math.PI - angle);
          const reach = Math.hypot(handle.x - shoulder.x, handle.y - shoulder.y);
          const farReach = Math.hypot(handle.x - shoulder.x, handle.y + 3 * scale - shoulder.y);
          // Both assigned grips must be physically reachable, with reserve for
          // the drive rhythm. Never move a grip to rescue a posture.
          if (Math.max(reach, farReach) > 55.5 * scale || Math.min(reach, farReach) < 20 * scale) continue;
          const safePoint = (point: Point, radius = 3 * scale): boolean =>
            point.y + radius + 2 * scale < prop.y || point.x + radius + 3 * scale < prop.x;
          if (!safePoint(hip) || !safePoint(shoulder) || !safePoint(head, 13 * scale)) continue;
          let loadClear = true;
          // Reserve the whole supported load-transfer envelope, rather than
          // discovering an unreachable wrist after the prop starts moving.
          for (const offset of [0, 3 + 2.5 * load]) {
            for (const compression of [0, 2.5 * load]) {
              for (const rotation of [-0.055 * load, 0.055 * load]) {
                const loadedHip = { x: startX + offset * scale, y: hip.y + compression * scale };
                const loadedShoulder = bone(loadedHip, torsoLength, Math.PI - angle - rotation);
                const loadedHead = bone(loadedShoulder, 16.5 * scale, Math.PI - angle - rotation);
                for (const y of [handle.y, handle.y + 3 * scale]) {
                  const distance = Math.hypot(handle.x - loadedShoulder.x, y - loadedShoulder.y);
                  if (distance > 55.5 * scale || distance < 20 * scale) loadClear = false;
                }
                if (!safePoint(loadedHip) || !safePoint(loadedShoulder) || !safePoint(loadedHead, 13 * scale)) loadClear = false;
              }
            }
          }
          if (!loadClear) continue;
          let legsClear = true;
          const supportedHip = { x: hip.x, y: hip.y + 2.5 * load * scale };
          for (const x of [startX + backSupport, startX - stance, startX + stance, startX + frontSupport]) {
            const foot = { x, y: groundY };
            const leg = ik(supportedHip, foot, legLength, -1, 2.65);
            if (!safePoint(foot) || !safePoint(leg.joint) || leg.joint.y > groundY
              || Math.hypot(x - startX, h * scale) > 2 * legLength * Math.cos(0.18)) legsClear = false;
          }
          if (!legsClear) continue;
          const cost = ((70 - h) / 10) ** 2 + (angle - 0.72) ** 2 * 2;
          if (cost < best) { best = cost; result = { height: h * scale, lean: angle, load }; }
        }
      }
      if (Number.isFinite(best)) break;
    }
    return result;
  };

  if (active) {
    const p = clamp01((t - active.startMs) / active.durationMs);
    const startX = rootX;
    if (active.action === "walk" || active.action === "run") {
      const destination = spec.targets?.[active.target ?? ""] ?? { x: rootX, y: groundY };
      const direction = Math.sign(destination.x - startX) || facing;
      const next = spec.actions[activeIndex + 1];
      const touchingNext = next && next.startMs === active.startMs + active.durationMs;
      const nextDestination = touchingNext && (next.action === "walk" || next.action === "run") ? spec.targets?.[next.target ?? ""] : undefined;
      const nextDirection = nextDestination ? Math.sign(nextDestination.x - destination.x) || direction : direction;
      const carryOut = nextDestination !== undefined && nextDirection !== direction;
      const priorRoute = routes.find((route) => route.index === activeIndex - 1);
      const carryIn = previous && (previous.action === "walk" || previous.action === "run")
        && previous.startMs + previous.durationMs === active.startMs && priorRoute !== undefined && priorRoute.startX !== priorRoute.endX;
      const reverseIn = carryIn && previousDirection !== direction;
      const moveStart = carryIn && previousDirection === direction ? 0 : facing !== direction ? 0.16 : 0.08;
      const moving = Math.abs(destination.x - startX) > 1e-9;
      const preparationDepth = (active.action === "run" ? 5 : 2) * scale;
      const peakLean = active.action === "run" ? 0.27 : 0.085;
      turn(p, direction, moveStart);
      if (moving && p < moveStart) {
        // Shift weight while both anchors remain planted. A reversing turn
        // passes through knee extension first, then prepares the new stance.
        const preparation = facing === direction ? smooth(p / moveStart) : smooth((p / moveStart - 0.65) / 0.35);
        const intention = smooth(p / (0.55 * moveStart));
        hipHeight -= preparationDepth * preparation;
        lean = direction * peakLean * 0.5 * intention;
        leftBend = mix(leftBend, direction * (active.action === "run" ? 0.90 : 0.32), intention);
        rightBend = mix(rightBend, direction * (active.action === "run" ? 0.90 : 0.32), intention);
      }
      if (p >= moveStart && moving) {
        const pose = connectedGait(activeIndex);
        rootX = pose.x;
        leftFoot = pose.left;
        rightFoot = pose.right;
        const phase = pose.phase - Math.floor(pose.phase);
        const preparationCarry = 1 - smooth(pose.phase / 0.5);
        const run = pose.run;
        // Authored support poses: the walk rises over its single supporting
        // leg at passing and lowers at double support. A run compresses on
        // contact, extends through toe-off, then follows a compact flight arc.
        const walkBob = phase < 0.5
          ? mix(-6, -2, smooth(phase / 0.5))
          : phase < 0.9 ? mix(-2, -6, smooth((phase - 0.5) / 0.4)) : -6;
        const runBob = phase < 0.7
          ? mix(-7, 1, smooth(phase / 0.7))
          : 1 - 8 * smooth((phase - 0.7) / 0.3) + 6 * Math.sin(Math.PI * (phase - 0.7) / 0.3) ** 2;
        const bob = mix(walkBob, runBob, run);
        hipHeight = restHeight + bob * scale * pose.envelope - mix(2, 5, run) * scale * preparationCarry;
        hipOffset = direction * 1.5 * scale * Math.sin(2 * Math.PI * pose.phase) * pose.envelope;
        lean = direction * mix(0.085, 0.27, run) * (pose.envelope + 0.5 * preparationCarry);
        // Peak counter-arm drive coincides with the opposite foot contact,
        // rather than reversing both arms at that contact.
        const drive = Math.cos(Math.PI * pose.phase) * pose.envelope;
        const bias = mix(0.10, 0.08, run);
        leftUpper = mix(leftUpper, -bias, pose.envelope) + direction * mix(0.38, 0.85, run) * drive;
        rightUpper = mix(rightUpper, bias, pose.envelope) - direction * mix(0.38, 0.85, run) * drive;
        leftBend = mix(mix(leftBend, direction * mix(0.32, 0.90, run), preparationCarry), direction * mix(0.30, 1.40 + 0.08 * drive, run), pose.envelope);
        rightBend = mix(mix(rightBend, direction * mix(0.32, 0.90, run), preparationCarry), direction * mix(0.30, 1.40 - 0.08 * drive, run), pose.envelope);
      }
      const carry = carryOut && p > 0.85 ? smooth((p - 0.85) / 0.15)
        : reverseIn ? 1 - smooth(p / 0.04) : 0;
      const carryDirection = carryOut && p > 0.85 ? nextDirection : direction;
      if (carry > 0) {
        hipHeight = mix(hipHeight, 68 * scale, carry);
        hipOffset *= 1 - carry;
        lean = mix(lean, carryDirection * 0.08, carry);
        leftUpper = angleMix(leftUpper, -0.10, carry);
        rightUpper = angleMix(rightUpper, 0.10, carry);
        leftBend = mix(leftBend, carryDirection * 0.50, carry);
        rightBend = mix(rightBend, carryDirection * 0.50, carry);
      }
      if (active.action === "walk" && touchingNext && next.action === "push" && direction === 1 && spec.prop) {
        const preload = 0.55 * smooth((p - 0.85) / 0.15);
        const posture = pushPosture(destination.x);
        hipHeight = mix(hipHeight, posture.height, preload);
        lean = mix(lean, posture.lean, preload);
        grip = preload;
      }
      if (moving && touchingNext && next.action === "jump") {
        const preload = smooth((p - 0.82) / 0.18);
        hipHeight = mix(hipHeight, 62 * scale, preload);
        hipOffset *= 1 - preload;
        lean = mix(lean, direction * 0.10, preload);
        leftUpper = angleMix(leftUpper, -0.55, preload);
        rightUpper = angleMix(rightUpper, 0.55, preload);
        leftBend = mix(leftBend, -0.35, preload);
        rightBend = mix(rightBend, 0.35, preload);
      }
    } else if (active.action === "wave") {
      gesture = smooth(p / 0.22) * smooth((1 - p) / 0.22);
      const repetitions = Math.max(1, Math.min(3, Math.round(active.durationMs / 1200)));
      const waveTime = clamp01((p - 0.22) / 0.56);
      leftUpper = angleMix(leftUpper, -facing * 0.32, gesture);
      leftBend = mix(leftBend, -facing * 0.20, gesture);
      rightUpper = angleMix(rightUpper, facing * 2.03, gesture);
      rightBend = mix(rightBend, facing * (0.80 + 0.23 * Math.sin(2 * Math.PI * repetitions * waveTime)), gesture);
      lean = facing * 0.015 * gesture;
    } else if (active.action === "point") {
      pointTarget = spec.targets?.[active.target ?? ""];
      const direction = pointTarget ? Math.sign(pointTarget.x - rootX) || facing : facing;
      const turnEnd = facing !== direction ? 0.16 : 0;
      const landingIn = previous?.action === "jump" && previous.startMs + previous.durationMs === active.startMs;
      turn(p, direction, turnEnd, landingIn ? 66 * scale : restHeight);
      gesture = mix(landingIn ? 0.55 : 0, 1, smooth(p / 0.28)) * smooth((1 - p) / 0.22);
      if (landingIn && turnEnd === 0) hipHeight = mix(66 * scale, restHeight, smooth(p / 0.18));
      // Keep the inactive arm behind/opposite the pointing gesture so both
      // sides remain readable; rotate joints rather than mirroring the rig.
      leftUpper = angleMix(leftUpper, -direction * 0.32, gesture);
      leftBend = mix(leftBend, -direction * 0.20, gesture);
      // Remain upright so an overhead point can route around the head.
      facing = direction;
    } else if (active.action === "jump") {
      const crouch = 51 * scale;
      const extension = 70 * scale;
      const absorb = 46 * scale;
      const apex = 48 * scale;
      let lift = 0;
      let armRaise = 0;
      let airborneFlex = 0.55;
      const previousRoute = routes.find((route) => route.index === activeIndex - 1);
      const travelIn = previousRoute && previousRoute.startX !== previousRoute.endX
        && previous && previous.startMs + previous.durationMs === active.startMs;
      const load = travelIn ? 1 - smooth(p / 0.20) : 0;
      leftUpper = mix(leftUpper, -0.55, load);
      rightUpper = mix(rightUpper, 0.55, load);
      leftBend = mix(leftBend, -0.35, load);
      rightBend = mix(rightBend, 0.35, load);
      if (p < 0.20) {
        hipHeight = mix(travelIn ? 62 * scale : restHeight, crouch, smooth(p / 0.20));
        armRaise = -0.18 * smooth(p / 0.20);
      } else if (p < 0.30) {
        const u = (p - 0.20) / 0.10;
        const launchVelocity = 4 * apex / 0.42;
        hipHeight = crouch + (extension - crouch) * (3 * u * u - 2 * u * u * u) + launchVelocity * 0.10 * (u * u * u - u * u);
        armRaise = mix(-0.18, 0.9, smooth(u));
      } else if (p < 0.72) {
        const u = (p - 0.30) / 0.42;
        lift = 4 * apex * u * (1 - u);
        hipHeight = extension + lift;
        const tuck = Math.sin(Math.PI * u) ** 2;
        leftFoot.x -= facing * 7 * scale * tuck;
        rightFoot.x += facing * 9 * scale * tuck;
        leftFoot.y -= lift + 17 * scale * tuck;
        rightFoot.y -= lift + 7 * scale * tuck;
        armRaise = u < 0.25 ? mix(0.9, 0.70, smooth(u / 0.25))
          : u < 0.60 ? mix(0.70, 0.38, smooth((u - 0.25) / 0.35))
          : mix(0.38, 0.24, smooth((u - 0.60) / 0.40));
        airborneFlex = 0.55 + 0.40 * tuck;
      } else if (p < 0.86) {
        const u = (p - 0.72) / 0.14;
        hipHeight = extension + (absorb - extension) * (3 * u * u - 2 * u * u * u) - 4 * apex / 0.42 * 0.14 * (u * u * u - 2 * u * u + u);
        armRaise = 0.24 * (1 - smooth(u));
      } else hipHeight = mix(absorb, restHeight, smooth((p - 0.86) / 0.14));
      lean = mix(facing * 0.12 * clamp01((restHeight - hipHeight + lift) / (20 * scale)), facing * 0.10, load);
      leftUpper = angleMix(leftUpper, -1.90, armRaise);
      rightUpper = angleMix(rightUpper, 1.90, armRaise);
      leftBend = mix(leftBend, -airborneFlex, Math.max(0, armRaise));
      rightBend = mix(rightBend, airborneFlex, Math.max(0, armRaise));
      const next = spec.actions[activeIndex + 1];
      if (next?.action === "point" && next.startMs === active.startMs + active.durationMs && p >= 0.86) {
        const intention = smooth((p - 0.86) / 0.14);
        pointTarget = spec.targets?.[next.target ?? ""];
        gesture = 0.55 * intention;
        hipHeight = mix(absorb, 66 * scale, intention);
        const direction = pointTarget ? Math.sign(pointTarget.x - rootX) || facing : facing;
        leftUpper = angleMix(leftUpper, -direction * 0.32, gesture);
        leftBend = mix(leftBend, -direction * 0.20, gesture);
      }
    } else if (active.action === "push" && spec.prop) {
      const turnEnd = facing !== 1 ? 0.14 : 0;
      const contact = turnEnd + 0.20 * (1 - turnEnd);
      const release = 0.82;
      turn(p, 1, turnEnd);
      if (p >= turnEnd) {
        const posture = pushPosture(startX);
        const preload = previous?.action === "walk" && previous.startMs + previous.durationMs === active.startMs && facing === 1 ? 0.55 : 0;
        grip = mix(preload, 1, smooth((p - turnEnd) / (contact - turnEnd))) * smooth((1 - p) / (1 - release));
        hipHeight = mix(restHeight, posture.height, grip);
        lean = posture.lean * grip;
        const q = clamp01((p - contact) / (release - contact));
        const pose = gait(startX, startX + spec.prop.toX - spec.prop.x, q, "push");
        rootX = pose.x;
        propX = spec.prop.x + rootX - startX;
        leftFoot = pose.left;
        rightFoot = pose.right;
        const force = Math.sin(Math.PI * pose.phase) ** 2;
        hipHeight -= 2.5 * posture.load * scale * (1 - force) * pose.envelope;
        hipOffset = (3 + 2.5 * posture.load * Math.sin(Math.PI * pose.phase)) * scale * pose.envelope;
        lean += 0.055 * posture.load * Math.cos(Math.PI * pose.phase) * pose.envelope;
      }
    }
  }

  const hip = { x: rootX + hipOffset, y: groundY - hipHeight };
  // Enforce leg reach at the pelvis, not by stretching bones or dragging an
  // anchor. This supplies real stance compression/weight transfer.
  const maxReach = turning ? 2 * legLength - 1e-8 * scale : 2 * legLength * Math.cos(0.18);
  for (const foot of [leftFoot, rightFoot]) {
    const dx = foot.x - hip.x;
    const cap = groundY - foot.y + Math.sqrt(Math.max(0, maxReach * maxReach - dx * dx));
    hipHeight = Math.min(hipHeight, cap);
  }
  hip.y = groundY - hipHeight;
  const shoulder = bone(hip, torsoLength, Math.PI - lean);
  const head = bone(shoulder, 16.5 * scale, Math.PI - lean);
  if (pointTarget && gesture > 0) {
    const dx = pointTarget.x - shoulder.x;
    const dy = pointTarget.y - shoulder.y;
    const distance = Math.hypot(dx, dy);
    const upwardAngle = distance > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, -dy / distance))) : Math.PI / 2;
    // Clearance from the head center to the upper-arm line is
    // neckLength * sin(targetAngle + elbowHalfAngle). Solve that constraint
    // before IK: an overhead point routes around the head, not through it.
    const clearanceAngle = Math.asin(13.2 / 16.5);
    const reach = Math.min(55, 56 * Math.cos(Math.max(0, clearanceAngle - upwardAngle))) * scale;
    const target = distance < 1e-9
      ? { x: shoulder.x + facing * 55 * scale, y: shoulder.y }
      : { x: shoulder.x + dx / distance * reach, y: shoulder.y + dy / distance * reach };
    const solved = ik(shoulder, target, armLength, Math.sign(dx) || facing, 2.6);
    rightUpper = angleMix(rightUpper, wrap(solved.upper + lean), gesture);
    rightBend = mix(rightBend, solved.bend, gesture);
  }
  if (grip > 0 && spec.prop) {
    const handle = { x: propX + spec.prop.handle.x, y: spec.prop.y + spec.prop.handle.y };
    const left = ik(shoulder, { x: handle.x, y: handle.y + 3 * scale }, armLength, -1, 2.6);
    const right = ik(shoulder, handle, armLength, 1, 2.6);
    leftUpper = angleMix(leftUpper, wrap(left.upper + lean), grip);
    rightUpper = angleMix(rightUpper, wrap(right.upper + lean), grip);
    leftBend = mix(leftBend, left.bend, grip);
    rightBend = mix(rightBend, right.bend, grip);
  }
  const leftArm = armFK(shoulder, lean, leftUpper, leftBend);
  const rightArm = armFK(shoulder, lean, rightUpper, rightBend);
  const leftLeg = ik(hip, leftFoot, legLength, leftKneePole, 2.65);
  const rightLeg = ik(hip, rightFoot, legLength, rightKneePole, 2.65);
  const segments: Segment[] = [
    { id: "torso", x1: hip.x, y1: hip.y, x2: shoulder.x, y2: shoulder.y },
    { id: "left-upper-arm", x1: shoulder.x, y1: shoulder.y, x2: leftArm.joint.x, y2: leftArm.joint.y },
    { id: "left-forearm", x1: leftArm.joint.x, y1: leftArm.joint.y, x2: leftArm.end.x, y2: leftArm.end.y },
    { id: "right-upper-arm", x1: shoulder.x, y1: shoulder.y, x2: rightArm.joint.x, y2: rightArm.joint.y },
    { id: "right-forearm", x1: rightArm.joint.x, y1: rightArm.joint.y, x2: rightArm.end.x, y2: rightArm.end.y },
    { id: "left-thigh", x1: hip.x, y1: hip.y, x2: leftLeg.joint.x, y2: leftLeg.joint.y },
    { id: "left-shin", x1: leftLeg.joint.x, y1: leftLeg.joint.y, x2: leftLeg.end.x, y2: leftLeg.end.y },
    { id: "right-thigh", x1: hip.x, y1: hip.y, x2: rightLeg.joint.x, y2: rightLeg.joint.y },
    { id: "right-shin", x1: rightLeg.joint.x, y1: rightLeg.joint.y, x2: rightLeg.end.x, y2: rightLeg.end.y }
  ];
  const prop = spec.prop ? {
    id: spec.prop.id, x: propX, y: spec.prop.y, width: spec.prop.width, height: spec.prop.height,
    handleX: propX + spec.prop.handle.x, handleY: spec.prop.y + spec.prop.handle.y
  } : null;
  return { timeMs: t, action: active?.action ?? "idle", x: rootX, groundY, head, segments, prop };
}

export function getFinalFrame(program: CompiledAnimation, mode: "reduced" | "static" = "static"): SampledFrame {
  return sampleAnimation(program, program.spec.durationMs, mode);
}
