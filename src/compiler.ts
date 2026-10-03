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
import { MOTION_CLIP_LIBRARY, sampleClipMotion } from "./motion-clips.js";

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
  if (spec.prop && (spec.prop.handle.y - 4 * scale < -1e-6 || spec.prop.handle.y + 4 * scale > spec.prop.height + 1e-6)) diagnostics.push({
    path: "$.prop.handle", code: "grip_region_outside_prop",
    message: "The handle is the center of two assigned grips: near/right at y−4 scaled units and far/left at y+4. Keep the entire grip region inside the prop."
  });
  let root = spec.actor?.x ?? spec.canvas.width * 0.2;
  let plannedFacing = 1;
  let priorTravel: { direction: number; endMs: number } | undefined;
  const routes: { item: AnimationSpec["actions"][number]; index: number; distance: number; count: number }[] = [];
  for (const [index, item] of spec.actions.entries()) {
    const path = `$.actions[${index}]`;
    let distance = 0;
    let availableWindow = (durationMs: number): number => durationMs;
    if (item.action === "walk" || item.action === "run") {
      const target = spec.targets![item.target!]!;
      if (Math.abs(target.y - ground) > 0.001) {
        diagnostics.push({ path: `${path}.target`, code: "non_flat_ground", message: `v1 locomotion uses one world floor at y=${ground}. Set target "${item.target}" y to ${ground}; a different y would require a terrain/path contract, not a moving floor.` });
      }
      distance = Math.abs(target.x - root);
      const direction = Math.sign(target.x - root);
      const touching = priorTravel?.endMs === item.startMs;
      const continuing = touching && priorTravel!.direction === direction;
      const reversing = touching && priorTravel!.direction !== direction;
      const changesFacing = direction !== 0 && direction !== plannedFacing;
      const next = spec.actions[index + 1];
      const continuation = next?.startMs === item.startMs + item.durationMs
        && (next.action === "walk" || next.action === "run" || next.action === "jump");
      availableWindow = durationMs => durationMs
        - (continuing ? 0 : reversing ? Math.min(durationMs * 0.35, 400)
          : changesFacing ? Math.min(durationMs * 0.16, 240) : Math.min(durationMs * 0.08, 120))
        - (continuation ? 0 : Math.min(durationMs * 0.08, 200));
      root = target.x;
      if (direction !== 0) plannedFacing = direction;
      priorTravel = direction !== 0 ? { direction, endMs: item.startMs + item.durationMs } : undefined;
    } else if (item.action === "push") {
      const prop = spec.prop!;
      if (prop.x + prop.handle.x <= root) diagnostics.push({ path: "$.prop.handle", code: "unsupported_push_facing", message: "v1 push is rightward. Establish a root position to the left of the handle before pushing." });
      distance = prop.toX - prop.x;
      const turnsToProp = plannedFacing !== 1;
      availableWindow = durationMs => durationMs * 0.62
        - (turnsToProp ? Math.min(durationMs * 0.14, 240) * 0.8 : 0);
      root += distance;
      plannedFacing = 1;
      priorTravel = undefined;
    } else {
      if (item.action === "point") plannedFacing = Math.sign(spec.targets![item.target!]!.x - root) || plannedFacing;
      priorTravel = undefined;
    }
    if (distance > 0) {
      const stride = (item.action === "run" ? 90 : item.action === "push" ? 28 : 40) * scale;
      const baseSteps = Math.max(item.action === "run" && distance > 120 * scale ? 4 : 2, Math.ceil(distance / stride));
      const steps = item.action === "run" ? baseSteps + baseSteps % 2 : baseSteps;
      // Reserve time for anticipation/turning and landing/release. These are
      // diagnostic limits, not permission to retime an authored action.
      const driveSeconds = availableWindow(item.durationMs) / 1000;
      const maxCadence = item.action === "run" ? 5.5 : item.action === "push" ? 5 : 4;
      if (steps / driveSeconds > maxCadence) {
        const requiredMs = steps / maxCadence * 1000;
        let minimum = 300, maximum = 120000;
        while (minimum < maximum) {
          const middle = Math.floor((minimum + maximum) / 2);
          if (availableWindow(middle) >= requiredMs) maximum = middle;
          else minimum = middle + 1;
        }
        const remedy = availableWindow(minimum) >= requiredMs
          ? `Increase durationMs to at least ${minimum} or shorten the route`
          : "Shorten or split this route; no supported duration up to 120000 ms fits";
        diagnostics.push({
          path: `${path}.durationMs`, code: "infeasible_cadence",
          message: `${distance.toFixed(1)} units require ${steps} supported steps at this rig scale. ${remedy}; the engine will not slide feet or change the requested duration.`
        });
      }
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
    if (frame.action === "point") {
      const wrist = frame.segments.find(line => line.id === "right-forearm")!;
      const fingerMargin = 8 * scale;
      if (wrist.x2 < fingerMargin || wrist.x2 > spec.canvas.width - fingerMargin
        || wrist.y2 < fingerMargin || wrist.y2 > spec.canvas.height - fingerMargin) fit = true;
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
    let nearError = 0;
    let farError = 0;
    for (const fraction of [0.32, 0.4, 0.5, 0.6, 0.7, 0.8, 0.82]) {
      const frame = sampleAnimation(program, item.startMs + item.durationMs * fraction);
      inspect(frame);
      for (const id of ["left-forearm", "right-forearm"]) {
        const hand = frame.segments.find((segment) => segment.id === id)!;
        const assignedY = frame.prop!.handleY + (id === "left-forearm" ? 4 : -4) * scale;
        const error = Math.hypot(hand.x2 - frame.prop!.handleX, hand.y2 - assignedY);
        if (id === "left-forearm") farError = Math.max(farError, error);
        else nearError = Math.max(nearError, error);
      }
    }
    const gripError = Math.max(nearError, farError);
    if (gripError > 0.01) diagnostics.push({
      path: "$.prop.handle", code: "unreachable_contact",
      message: `The centered grip region cannot be held by both fixed ${28 * scale}-unit arm bones from the actual preceding root while maintaining a supported crouch/hinge and crate clearance (near/right grip error ${nearError.toFixed(1)}, far/left grip error ${farError.toFixed(1)}). Re-author the stand-off/handle height or preceding walk target. For a 640×360 scene, try groundY=290, actor.x=105, crate x=150/y=240/height=50 and a left-face handle {x:0,y:18}.`
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

/** Projected/local rig target and explicit IK branch; planner retains world anchors. */
export interface MotionFootIntent {
  x: number;
  y: number;
  pole: -1 | 1;
  contact: boolean;
  /** Projected floor at this world anchor; omitted means the authored program floor. */
  floorY?: number;
}

/** Local arm rotations in radians, using the canonical downward-axis convention. */
export interface MotionArmIntent {
  upper: number;
  bend: number;
}

/** Immutable support commitments; future records do not retime earlier steps. */
export interface MotionSupportStep {
  side: "left" | "right";
  liftMs: number;
  placeMs: number;
  fromX: number;
  toX: number;
  clearance: number;
}

/** C1 airborne retarget. Endpoint is a new plant, never a moved stance anchor. */
export interface MotionFootTransition {
  side: "left" | "right";
  startMs: number;
  endMs: number;
  fromX: number;
  fromY: number;
  velocityX: number;
  velocityY: number;
  toX: number;
}

/**
 * Runtime controller state, not an authored v1 field or mutable animation.
 * The controller owns its timestamped input/plant history. The rig remains
 * the sole FK/IK authority and derives no state from earlier sampled frames.
 */
export interface MotionPoseIntent {
  rootX: number;
  /** Projected root floor, not an authored v1 field or an actor-size change. */
  groundY?: number;
  facing: -1 | 1;
  /** Continuous half-step count, shared by the canonical reciprocal arm profile. */
  phase: number;
  /** Optional absolute phase clock: supply both epoch and half-steps/second. */
  phaseTimeMs?: number;
  cadence?: number;
  /** Billboard units above the supplied root floor; includes flight lift. */
  hipHeight: number;
  hipOffset?: number;
  lean?: number;
  action?: Exclude<SampledFrame["action"], "push">;
  gaitWeight?: number;
  /** Reserve near-extension for a supported IK branch change, not a facing mirror. */
  pivot?: boolean;
  /** Smoothly leave full extension after a supported branch change (0..1). */
  extensionWeight?: number;
  leftFoot: MotionFootIntent;
  rightFoot: MotionFootIntent;
  /** Optional recorded steps; core evaluates swing/contact, not keyboard code. */
  steps?: readonly MotionSupportStep[];
  transitions?: readonly MotionFootTransition[];
  arms?: { left: MotionArmIntent; right: MotionArmIntent };
  point?: { x: number; y: number; weight: number };
  /** Reuses the canonical jump envelope, with a continuous controller handoff. */
  jump?: { progress: number; loaded: boolean; fromHipHeight: number; fromLean: number };
}

/** Evaluate externally planned intent through exactly the canonical rig solver. */
export function sampleMotionIntent(program: CompiledAnimation, timeMs: number, state: MotionPoseIntent): SampledFrame {
  if (state === undefined) throw new TypeError("Motion intent state is required.");
  return sampleAnimation(program, timeMs, "normal", state);
}

export interface MotionIntentSample {
  frame: SampledFrame;
  contacts: { left: MotionFootIntent; right: MotionFootIntent };
}

/** Same evaluator plus solved world contacts, suitable for a controller handoff. */
export function evaluateMotionIntent(program: CompiledAnimation, timeMs: number, state: MotionPoseIntent): MotionIntentSample {
  const frame = sampleMotionIntent(program, timeMs, state);
  const authoredFloor = program.spec.actor?.groundY ?? program.spec.canvas.height * 0.8;
  const foot = (side: "left" | "right"): MotionFootIntent => {
    const shin = frame.segments.find((segment) => segment.id === `${side}-shin`);
    if (!shin) throw new Error("The canonical rig did not return its foot segment.");
    const requested = side === "left" ? state.leftFoot : state.rightFoot;
    return {
      x: shin.x2, y: shin.y2, pole: requested.pole,
      contact: Math.abs(shin.y2 - (requested.floorY ?? authoredFloor)) <= 1e-7,
      ...(requested.floorY !== undefined ? { floorY: requested.floorY } : {})
    };
  };
  return { frame, contacts: { left: foot("left"), right: foot("right") } };
}

export function sampleAnimation(
  program: CompiledAnimation, timeMs: number, mode: PlaybackMode = "normal",
  /** @internal Use sampleMotionIntent; never put runtime state in v1 authoring data. */
  intent?: MotionPoseIntent
): SampledFrame {
  // IMPORTANT: every runtime helper stays inside this function. The HTML
  // renderer embeds sampleAnimation.toString(), without a module loader.
  type Point = { x: number; y: number };
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) throw new TypeError("timeMs must be a finite number.");
  if (mode !== "normal" && mode !== "reduced" && mode !== "static") throw new TypeError('mode must be "normal", "reduced", or "static".');
  if (intent !== undefined && mode !== "normal") throw new TypeError("Motion intent requires normal playback mode.");
  const spec = program.spec;
  const t = intent !== undefined ? Math.max(0, timeMs)
    : mode === "normal" ? Math.min(spec.durationMs, Math.max(0, timeMs)) : spec.durationMs;
  const authoredGroundY = spec.actor?.groundY ?? spec.canvas.height * 0.8;
  const groundY = intent?.groundY ?? authoredGroundY;
  const headroom = spec.actions.some((item) => item.action === "jump") ? 192
    : spec.actions.some((item) => item.action === "wave" || item.action === "point") ? 170 : 145;
  const scale = Math.max(0.001, Math.min(1, spec.canvas.width / 180, (authoredGroundY - 4) / headroom));
  const torsoLength = 45 * scale;
  const armLength = 28 * scale;
  const legLength = 36 * scale;
  const stance = 9 * scale;
  const restHeight = 70 * scale;
  const preparationFraction = (durationMs: number, reversing: boolean): number =>
    Math.min(reversing ? 0.16 : 0.08, (reversing ? 240 : 120) / durationMs);
  const settledFraction = (durationMs: number): number => 1 - Math.min(0.08, 200 / durationMs);
  const loadedPreparation = (durationMs: number): number => Math.min(0.35, 400 / durationMs);
  const pushCompression = 7;
  const pushRotation = 0.08;
  if (intent !== undefined) {
    if (intent === null || typeof intent !== "object") throw new TypeError("Motion intent must be an object.");
    const finite = (value: unknown, name: string): void => {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Motion intent ${name} must be a finite number.`);
    };
    for (const name of ["rootX", "phase", "hipHeight"] as const) finite(intent[name], name);
    for (const name of ["groundY", "hipOffset", "lean", "gaitWeight", "phaseTimeMs", "cadence", "extensionWeight"] as const) {
      if (intent[name] !== undefined) finite(intent[name], name);
    }
    if (intent.facing !== -1 && intent.facing !== 1) throw new TypeError("Motion intent facing must be -1 or 1.");
    if (intent.phase < 0 || intent.hipHeight <= 0) throw new RangeError("Motion intent phase must be nonnegative and hipHeight positive.");
    if ((intent.phaseTimeMs === undefined) !== (intent.cadence === undefined)) throw new TypeError("Motion intent phase clock requires both phaseTimeMs and cadence.");
    if (intent.cadence !== undefined && (intent.cadence < 0 || intent.cadence > (intent.action === "walk" ? 4 : 5.5))) {
      throw new RangeError("Motion intent cadence exceeds the canonical feasible cadence range.");
    }
    if (intent.pivot !== undefined && typeof intent.pivot !== "boolean") throw new TypeError("Motion intent pivot must be boolean.");
    if (intent.extensionWeight !== undefined && (intent.extensionWeight < 0 || intent.extensionWeight > 1)) throw new RangeError("Motion intent extensionWeight must be between 0 and 1.");
    if (intent.gaitWeight !== undefined && (intent.gaitWeight < 0 || intent.gaitWeight > 1)) throw new RangeError("Motion intent gaitWeight must be between 0 and 1.");
    if (intent.action !== undefined && !["idle", "walk", "run", "wave", "point", "jump"].includes(intent.action)) throw new TypeError("Motion intent action is unsupported; prop drive remains an authored push.");
    for (const side of ["leftFoot", "rightFoot"] as const) {
      const foot = intent[side];
      if (foot === null || typeof foot !== "object") throw new TypeError(`Motion intent ${side} must be a foot target.`);
      finite(foot.x, `${side}.x`);
      finite(foot.y, `${side}.y`);
      if (foot.floorY !== undefined) finite(foot.floorY, `${side}.floorY`);
      if (foot.pole !== -1 && foot.pole !== 1) throw new TypeError(`Motion intent ${side}.pole must be -1 or 1.`);
      if (typeof foot.contact !== "boolean") throw new TypeError(`Motion intent ${side}.contact must be boolean.`);
      const supportY = foot.floorY ?? authoredGroundY;
      if (foot.y > supportY + 1e-6 || (foot.contact && Math.abs(foot.y - supportY) > 1e-6)) {
        throw new RangeError(`Motion intent ${side} must not penetrate the floor; contact targets must lie on the world floor.`);
      }
    }
    if (((intent.steps?.length ?? 0) > 0 || (intent.transitions?.length ?? 0) > 0)
      && [intent.leftFoot, intent.rightFoot].some(foot => Math.abs((foot.floorY ?? authoredGroundY) - groundY) > 1e-6)) {
      throw new RangeError("Projected support floors require explicit world-foot targets; flat support-event records cannot describe depth travel.");
    }
    if (intent.pivot && !intent.leftFoot.contact && !intent.rightFoot.contact) throw new RangeError("Motion intent pivot requires a supported foot.");
    if (intent.steps !== undefined) {
      if (!Array.isArray(intent.steps)) throw new TypeError("Motion intent steps must be a support-event array.");
      const steps: readonly MotionSupportStep[] = intent.steps;
      const previousStep: Partial<Record<"left" | "right", MotionSupportStep>> = {};
      for (const step of steps) {
        if (step === null || typeof step !== "object" || (step.side !== "left" && step.side !== "right")) throw new TypeError("Motion intent step must name a left or right foot.");
        for (const name of ["liftMs", "placeMs", "fromX", "toX", "clearance"] as const) finite(step[name], `step.${name}`);
        if (step.liftMs < 0 || step.placeMs <= step.liftMs || step.clearance <= 0) throw new RangeError("Motion intent step requires ordered times and positive swing clearance.");
        const foot = step.side === "left" ? intent.leftFoot : intent.rightFoot;
        const previous = previousStep[step.side];
        const fromX = previous ? previous.toX : foot.x;
        if (!foot.contact || Math.abs(fromX - step.fromX) > 1e-6 || (previous && step.liftMs < previous.placeMs)) {
          throw new RangeError("Motion intent step must continue its preceding planted anchor without overlap or teleportation.");
        }
        previousStep[step.side] = step;
      }
    }
    if (intent.transitions !== undefined) {
      if (!Array.isArray(intent.transitions)) throw new TypeError("Motion intent transitions must be an array.");
      const transitions: readonly MotionFootTransition[] = intent.transitions;
      const sides = new Set<string>();
      for (const transition of transitions) {
        if (!transition || (transition.side !== "left" && transition.side !== "right")) throw new TypeError("Motion intent transition must name a foot.");
        for (const name of ["startMs", "endMs", "fromX", "fromY", "velocityX", "velocityY", "toX"] as const) finite(transition[name], `transition.${name}`);
        if (transition.endMs <= transition.startMs || transition.fromY > groundY + 1e-6 || sides.has(transition.side)) throw new RangeError("Motion intent transition needs an airborne start, positive duration and unique foot.");
        const controlY = transition.fromY + transition.velocityY * (transition.endMs - transition.startMs) / 3;
        if (controlY > groundY + 1e-6) throw new RangeError("Motion intent transition would cross the floor before planting.");
        sides.add(transition.side);
      }
    }
    if (intent.arms !== undefined) {
      if (intent.arms === null || typeof intent.arms !== "object") throw new TypeError("Motion intent arms must describe both arm joints.");
      for (const side of ["left", "right"] as const) {
        const arm = intent.arms[side];
        if (arm === null || typeof arm !== "object") throw new TypeError(`Motion intent ${side} arm must describe upper and bend angles.`);
        finite(arm.upper, `arms.${side}.upper`);
        finite(arm.bend, `arms.${side}.bend`);
        if (Math.abs(arm.upper) > Math.PI || Math.abs(arm.bend) > 2.6) throw new RangeError(`Motion intent ${side} arm exceeds the canonical joint limits.`);
      }
    }
    if (intent.point !== undefined) {
      if (intent.point === null || typeof intent.point !== "object") throw new TypeError("Motion intent point must describe a target and weight.");
      for (const name of ["x", "y", "weight"] as const) finite(intent.point[name], `point.${name}`);
      if (intent.point.weight < 0 || intent.point.weight > 1) throw new RangeError("Motion intent point weight must be between 0 and 1.");
    }
    if (intent.jump !== undefined) {
      if (!intent.jump || intent.action !== "jump" || typeof intent.jump.loaded !== "boolean") throw new TypeError("Motion intent jump requires a jump action and loaded flag.");
      for (const name of ["progress", "fromHipHeight", "fromLean"] as const) finite(intent.jump[name], `jump.${name}`);
      if (intent.jump.progress < 0 || intent.jump.progress > 1 || intent.jump.fromHipHeight <= 0) throw new RangeError("Motion intent jump progress or initial height is invalid.");
    }
  }
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
    const constrainedUpper = wrap(upper);
    const constrainedBend = Math.max(-2.6, Math.min(2.6, bend));
    const joint = bone(shoulder, armLength, constrainedUpper - lean);
    return { joint, end: bone(joint, armLength, constrainedUpper - lean + constrainedBend) };
  };
  const ik = (start: Point, target: Point, length: number, pole: number, maxBend: number, minBend = 0): { joint: Point; end: Point; upper: number; bend: number } => {
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const rawDistance = Math.hypot(dx, dy);
    const distance = Math.max(2 * length * Math.cos(maxBend / 2),
      Math.min(2 * length * Math.cos(minBend / 2) - 1e-8 * scale, rawDistance));
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
  for (const [index, item] of intent === undefined ? spec.actions.entries() : []) {
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
  for (const [index, item] of intent === undefined ? spec.actions.entries() : []) {
    if (t < item.startMs) break;
    if (mode === "normal" && (
      t < item.startMs + item.durationMs
      || (index === spec.actions.length - 1 && t <= spec.durationMs)
    )) { active = item; activeIndex = index; break; }
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
  const useClipEngine = spec.canvas.width > 1000;
  if (useClipEngine && intent === undefined && active && (active.action === "walk" || active.action === "run" || active.action === "jump" || active.action === "point")) {
    const p = clamp01((t - active.startMs) / active.durationMs);
    const startX = rootX;
    const target = active.target ? spec.targets?.[active.target] : undefined;
    const direction = active.action === "point" && target ? Math.sign(target.x - startX) || facing
      : active.action === "walk" || active.action === "run" ? Math.sign((target?.x ?? startX) - startX) || facing : facing;
    const clip = sampleClipMotion(MOTION_CLIP_LIBRARY, {
      action: active.action === "walk" || active.action === "run" || active.action === "jump" || active.action === "point" ? active.action : "idle",
      progress: p,
      startX,
      endX: active.action === "walk" || active.action === "run" ? target?.x ?? startX : startX,
      groundY,
      facing: direction as -1 | 1,
      scale,
      ...(active.action === "point" && target ? { pointTarget: target } : {})
    });
    if (clip.segments && clip.headPoint) {
      const prop = spec.prop ? {
        id: spec.prop.id, x: propX, y: spec.prop.y, width: spec.prop.width, height: spec.prop.height,
        handleX: propX + spec.prop.handle.x, handleY: spec.prop.y + spec.prop.handle.y
      } : null;
      return { timeMs: t, action: active.action, x: clip.rootX, groundY, head: clip.headPoint, segments: clip.segments, prop };
    }
  } else if (useClipEngine && intent === undefined && !active && mode === "normal") {
    const nearActionBoundary = spec.actions.some(item =>
      Math.abs(t - item.startMs) < 250 || Math.abs(t - (item.startMs + item.durationMs)) < 250
    );
    if (!nearActionBoundary) {
      const clip = sampleClipMotion(MOTION_CLIP_LIBRARY, {
        action: "idle", progress: ((t / 1000) % 2) / 2, startX: rootX, endX: rootX,
        groundY, facing: facing as -1 | 1, scale
      });
      if (clip.segments && clip.headPoint) return { timeMs: t, action: "idle", x: clip.rootX, groundY, head: clip.headPoint, segments: clip.segments, prop: null };
    }
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
  let gravityCompensation = 0;
  // Shared pose authoring as well as shared FK/IK: controller code need not
  // copy reciprocal arm profiles when it supplies a continuous gait phase.
  const locomotionArms = (phase: number, weight: number, run: number, direction: number, preparation = 0) => {
    const drive = Math.cos(Math.PI * phase) * weight;
    const bias = mix(0.10, 0.08, run);
    const relaxation = 0.05 * (1 - run) * Math.sin(Math.PI * phase);
    return {
      leftUpper: mix(-0.32, -bias, weight) + mix(0.38, 0.85, run) * drive,
      rightUpper: mix(0.32, bias, weight) - mix(0.38, 0.85, run) * drive,
      leftBend: mix(mix(-0.20, direction * mix(0.32, 0.90, run), preparation),
        direction * mix(0.30 + direction * relaxation, 1.40 + direction * 0.08 * drive, run), weight),
      rightBend: mix(mix(0.20, direction * mix(0.32, 0.90, run), preparation),
        direction * mix(0.30 - direction * relaxation, 1.40 - direction * 0.08 * drive, run), weight)
    };
  };
  const swingFoot = (anchor: number, next: number, u: number, root: number, clearance: number, passing = true): Point => {
    const amount = clamp01(u);
    const lift = Math.sin(Math.PI * amount) ** 2;
    return { x: mix(mix(anchor, next, smooth(amount)), root, passing ? lift : 0), y: groundY - clearance * lift };
  };

  const gait = (startX: number, endX: number, value: number, kind: "walk" | "run" | "push",
    route?: { count: number; at: (u: number) => number; runAt: (phase: number) => number; initialFeet?: { left: Point; right: Point } }
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
    const at = route?.at ?? ((u: number): number => {
      const q = clamp01(u);
      const envelope = smooth(q / 0.12) * smooth((1 - q) / 0.12);
      const timed = kind === "push"
        ? q - 0.055 / count * Math.sin(2 * Math.PI * q * count) * envelope
        : q;
      return mix(startX, endX, travel(timed));
    });
    const footAt = (isLeft: boolean): Point => {
      const offset = isLeft ? -stance : stance;
      let anchor = route?.initialFeet?.[isLeft ? "left" : "right"].x ?? startX + offset;
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
          // A free ankle passes under the moving pelvis, not along a huge
          // world-space chord to its next anchor. Correction vanishes with
          // zero slope at lift/place; planted anchors never move.
          return swingFoot(anchor, next, u, at(q), clearance, kind !== "push");
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
    const predecessor = routes.find(route => route.index === group[0]!.index - 1);
    const predecessorAction = predecessor ? spec.actions[predecessor.index]! : undefined;
    const loadedFirst = predecessor !== undefined && predecessor.startX !== predecessor.endX
      && predecessor.direction !== group[0]!.direction
      && predecessorAction!.startMs + predecessorAction!.durationMs === spec.actions[group[0]!.index]!.startMs;
    let total = 0;
    const spans = group.map((route, i) => {
      const item = spec.actions[route.index]!;
      const next = spec.actions[route.index + 1];
      const touchingContinuation = next && next.startMs === item.startMs + item.durationMs
        && (next.action === "walk" || next.action === "run" || next.action === "jump");
      const start = item.startMs + (i === 0 ? item.durationMs * (loadedFirst
        ? loadedPreparation(item.durationMs) : preparationFraction(item.durationMs, route.facing !== route.direction)) : 0);
      const end = item.startMs + item.durationMs * (i === group.length - 1 && !touchingContinuation ? settledFraction(item.durationMs) : 1);
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
    const startX = group[0]!.startX;
    const direction = group[0]!.direction;
    const initialFeet = loadedFirst ? {
      left: { x: startX + (direction < 0 ? -24 : -18) * scale, y: groundY },
      right: { x: startX + (direction > 0 ? 24 : 18) * scale, y: groundY }
    } : undefined;
    const pose = gait(startX, group.at(-1)!.endX, phase / total, "walk",
      { count: total, at, runAt, ...(initialFeet ? { initialFeet } : {}) });
    return { ...pose, x: mix(span.route.startX, span.route.endX, progress(i, q, false)), run: runAt(phase) };
  };
  const turn = (progress: number, direction: number, end: number, startHeight = restHeight, startOffset = 0, loaded = false): void => {
    if (loaded && facing !== direction && end > 0 && progress < end) {
      turning = true;
      const u = clamp01(progress / end);
      hipHeight = startHeight;
      hipOffset = mix(startOffset, direction * 5 * scale, smooth((u - 0.25) / 0.5));
      const lift = 4 * scale;
      const extension = Math.sqrt(Math.max(0, (2 * legLength) ** 2 - (startHeight - lift) ** 2));
      const frontLeft = direction < 0;
      const swing = (front: boolean): Point => {
        const begin = front ? 0 : 0.5;
        const phase = clamp01((u - begin) / 0.5);
        const side = front ? frontLeft ? "left" : "right" : frontLeft ? "right" : "left";
        const initial = rootX + (side === "left" ? -stance : stance);
        const anchor = rootX + (front ? direction * 24 : -direction * 18) * scale;
        const extended = rootX + (front ? startOffset + direction * extension : direction * 5 * scale - direction * extension);
        return {
          x: phase < 0.5 ? mix(initial, extended, smooth(phase * 2)) : mix(extended, anchor, smooth((phase - 0.5) * 2)),
          y: groundY - lift * Math.sin(Math.PI * phase) ** 2
        };
      };
      const front = swing(true), rear = swing(false);
      leftFoot = frontLeft ? front : rear;
      rightFoot = frontLeft ? rear : front;
      leftKneePole = -(u < (frontLeft ? 0.25 : 0.75) ? facing : direction);
      rightKneePole = -(u < (frontLeft ? 0.75 : 0.25) ? facing : direction);
      return;
    }
    if (facing !== direction && end > 0 && progress < end) {
      turning = true;
      const u = clamp01(progress / end);
      // Transfer support across the planted stance. Each leg changes branch
      // only at its own extension, at different times; no simultaneous pogo.
      const shift = 6 * scale;
      const extension = Math.sqrt((2 * legLength) ** 2 - (stance + shift) ** 2);
      if (u < 0.35) {
        const amount = smooth(u / 0.35);
        hipOffset = mix(startOffset, shift, amount);
        const reach = Math.sqrt((2 * legLength) ** 2 - (stance + hipOffset) ** 2);
        // Reversal compression is carried from braking in startHeight. Keep
        // this small support transfer, rather than adding a larger turn bob.
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
    type Posture = { height: number; lean: number; load: number };
    // Cache invariant posture search on this named sampler, not authored data.
    // The embedded HTML gets its own cache; geometry keys also cover mutations.
    const sampler: typeof sampleAnimation & {
      pushPostureCache?: WeakMap<CompiledAnimation, Map<string, Posture>>;
    } = sampleAnimation;
    const cache = sampler.pushPostureCache ??= new WeakMap();
    let postures = cache.get(program);
    if (!postures) { postures = new Map(); cache.set(program, postures); }
    const key = [startX, scale, groundY, facing, prop.x, prop.y, prop.width, prop.height, prop.toX,
      prop.handle.x, prop.handle.y, pushCompression, pushRotation].join(":");
    const cached = postures.get(key);
    if (cached) return cached;
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
        for (let angle = 0.18; angle <= 1.100001; angle += 0.04) {
          const hip = { x: startX, y: groundY - h * scale };
          const shoulder = bone(hip, torsoLength, Math.PI - angle);
          const head = bone(shoulder, 16.5 * scale, Math.PI - angle);
          const reach = Math.hypot(handle.x - shoulder.x, handle.y - 4 * scale - shoulder.y);
          const farReach = Math.hypot(handle.x - shoulder.x, handle.y + 4 * scale - shoulder.y);
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
            for (const compression of [0, pushCompression * load]) {
              for (const rotation of [-pushRotation * load, pushRotation * load]) {
                const loadedHip = { x: startX + offset * scale, y: hip.y + compression * scale };
                const loadedShoulder = bone(loadedHip, torsoLength, Math.PI - angle - rotation);
                const loadedHead = bone(loadedShoulder, 16.5 * scale, Math.PI - angle - rotation);
                for (const y of [handle.y - 4 * scale, handle.y + 4 * scale]) {
                  const distance = Math.hypot(handle.x - loadedShoulder.x, y - loadedShoulder.y);
                  if (distance > 55.5 * scale || distance < 20 * scale) loadClear = false;
                }
                if (!safePoint(loadedHip) || !safePoint(loadedShoulder) || !safePoint(loadedHead, 13 * scale)) loadClear = false;
              }
            }
          }
          if (!loadClear) continue;
          let legsClear = true;
          const supportedHip = { x: hip.x, y: hip.y + pushCompression * load * scale };
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
    if (postures.size >= 16) postures.clear();
    postures.set(key, result);
    return result;
  };

  const applyJump = (p: number, travelIn: boolean, nextPoint?: Point, fromHeight = travelIn ? 54 * scale : restHeight,
    preserveSeed = false, seedLean = 0): void => {
    const crouch = 51 * scale;
    const extension = 70 * scale;
    const absorb = 46 * scale;
    const apex = 48 * scale;
    let lift = 0;
    let armRaise = 0;
    let airborneFlex = 0.55;
    const loadEnd = travelIn ? 0.05 : 0.20;
    const launchEnd = travelIn ? 0.18 : 0.30;
    const landing = launchEnd + 0.42;
    const absorbEnd = travelIn ? 0.78 : 0.86;
    const load = travelIn && !preserveSeed ? 1 - smooth(p / launchEnd) : 0;
    leftUpper = mix(leftUpper, -0.85, load);
    rightUpper = mix(rightUpper, 0.85, load);
    leftBend = mix(leftBend, facing * (facing > 0 ? 0.60 : 1.10), load);
    rightBend = mix(rightBend, facing * (facing > 0 ? 1.10 : 0.60), load);
    if (p < loadEnd) {
      hipHeight = mix(fromHeight, crouch, smooth(p / loadEnd));
      armRaise = (travelIn ? 0.20 : -0.18) * smooth(p / loadEnd);
    } else if (p < launchEnd) {
      const duration = launchEnd - loadEnd;
      const u = (p - loadEnd) / duration;
      hipHeight = crouch + (extension - crouch) * (3 * u * u - 2 * u * u * u)
        + 4 * apex / 0.42 * duration * (u * u * u - u * u);
      armRaise = mix(travelIn ? 0.20 : -0.18, 0.9, smooth(u));
    } else if (p < landing) {
      const u = (p - launchEnd) / 0.42;
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
    } else if (p < absorbEnd) {
      const duration = absorbEnd - landing;
      const u = (p - landing) / duration;
      hipHeight = extension + (absorb - extension) * (3 * u * u - 2 * u * u * u)
        - 4 * apex / 0.42 * duration * (u * u * u - 2 * u * u + u);
      armRaise = 0.24 * (1 - smooth(u));
    } else hipHeight = mix(absorb, restHeight, smooth((p - absorbEnd) / (1 - absorbEnd)));
    lean = mix(facing * 0.12 * clamp01((restHeight - hipHeight + lift) / (20 * scale)), facing * 0.15, load);
    if (preserveSeed) lean = mix(seedLean, lean, smooth(p / launchEnd));
    leftUpper = angleMix(leftUpper, -1.90, armRaise);
    rightUpper = angleMix(rightUpper, 1.90, armRaise);
    leftBend = mix(leftBend, -airborneFlex, Math.max(0, armRaise));
    rightBend = mix(rightBend, airborneFlex, Math.max(0, armRaise));
    if (nextPoint && p >= absorbEnd) {
      const intention = smooth((p - absorbEnd) / (1 - absorbEnd));
      pointTarget = nextPoint;
      gesture = 0.55 * intention;
      hipHeight = mix(absorb, 66 * scale, intention);
      const direction = Math.sign(nextPoint.x - rootX) || facing;
      leftUpper = angleMix(leftUpper, -direction * 0.32, gesture);
      leftBend = mix(leftBend, -direction * 0.20, gesture);
    }
  };
  const applyClipDefault = (
    action: "idle" | "walk" | "run" | "jump" | "point",
    progress: number,
    startX: number,
    endX: number,
    direction: -1 | 1,
    target?: Point
  ): void => {
    if (!useClipEngine) return;
    const clip = sampleClipMotion(MOTION_CLIP_LIBRARY, {
      action, progress, startX, endX, groundY, facing: direction, scale,
      ...(target ? { pointTarget: target } : {})
    });
    const weight = clip.weight;
    if (weight <= 1e-6) return;
    const nextRootX = mix(rootX, clip.rootX, weight);
    const minimumClipHeight = (action === "jump" ? 46 : 66) * scale;
    const nextHipHeight = mix(hipHeight, Math.max(minimumClipHeight, clip.hipHeight), weight);
    const supportRadius = Math.max(stance, Math.sqrt(Math.max(0, (2 * legLength * 0.94) ** 2 - nextHipHeight ** 2)));
    const clampFoot = (current: Point, foot: { x: number; y: number }): Point => ({
      x: mix(current.x, Math.max(nextRootX - supportRadius, Math.min(nextRootX + supportRadius, foot.x)), weight),
      y: Math.min(groundY, mix(current.y, foot.y, weight))
    });
    rootX = nextRootX;
    hipHeight = nextHipHeight;
    const clipLean = action === "walk" || action === "run"
      ? direction * Math.max(Math.abs(clip.lean), (action === "run" ? 0.18 : 0.06) * weight)
      : clip.lean;
    lean = angleMix(lean, clipLean, weight);
    leftFoot = clampFoot(leftFoot, clip.leftFoot);
    rightFoot = clampFoot(rightFoot, clip.rightFoot);
    leftKneePole = -direction;
    rightKneePole = -direction;
    const armWeight = (nextRootX < 70 * scale || nextRootX > spec.canvas.width - 70 * scale) ? 0 : weight;
    leftUpper = angleMix(leftUpper, clip.arms.left.upper, armWeight);
    leftBend = angleMix(leftBend, clip.arms.left.bend, armWeight);
    rightUpper = angleMix(rightUpper, clip.arms.right.upper, armWeight);
    rightBend = angleMix(rightBend, clip.arms.right.bend, armWeight);
    if (action === "point" && target) {
      pointTarget = target;
      gesture = Math.max(gesture, weight);
    }
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
      const moveStart = carryIn && previousDirection === direction ? 0
        : reverseIn ? loadedPreparation(active.durationMs) : preparationFraction(active.durationMs, facing !== direction);
      const moving = Math.abs(destination.x - startX) > 1e-9;
      const preparationDepth = (active.action === "run" ? 5 : 2) * scale;
      const peakLean = active.action === "run" ? 0.27 : 0.085;
      turn(p, direction, moveStart, reverseIn ? 62 * scale : restHeight, reverseIn ? -direction * 5 * scale : 0, Boolean(reverseIn));
      if (moving && p < moveStart) {
        // Shift weight while both anchors remain planted. A reversing turn
        // passes through knee extension first, then prepares the new stance.
        const preparation = reverseIn ? smooth((p / moveStart - 0.8) / 0.2)
          : facing === direction ? smooth(p / moveStart) : smooth((p / moveStart - 0.65) / 0.35);
        const intention = smooth(p / (0.55 * moveStart));
        hipHeight -= preparationDepth * preparation;
        const brakingCarry = reverseIn ? 1 - smooth(p / moveStart) : 0;
        lean = mix(direction * peakLean * 0.5 * intention, direction * 0.12, brakingCarry);
        if (reverseIn) lean += direction * 0.10 * Math.sin(Math.PI * p / moveStart) ** 2;
        leftUpper = angleMix(leftUpper, -direction * 0.25, brakingCarry);
        rightUpper = angleMix(rightUpper, direction * 0.25, brakingCarry);
        leftBend = mix(leftBend, direction * (active.action === "run" ? 0.90 : 0.32), intention);
        rightBend = mix(rightBend, direction * (active.action === "run" ? 0.90 : 0.32), intention);
        leftBend = mix(leftBend, direction * 0.75, brakingCarry);
        rightBend = mix(rightBend, direction * 0.75, brakingCarry);
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
        hipHeight = restHeight + bob * scale * pose.envelope - (mix(2, 5, run) + (reverseIn ? 8 : 0)) * scale * preparationCarry;
        hipOffset = direction * 1.5 * scale * Math.sin(2 * Math.PI * pose.phase) * pose.envelope + (reverseIn ? direction * 5 * scale * preparationCarry : 0);
        lean = direction * mix(0.085, 0.27, run) * (pose.envelope + 0.5 * preparationCarry);
        // Peak counter-arm drive coincides with the opposite foot contact,
        // rather than reversing both arms at that contact.
        ({ leftUpper, rightUpper, leftBend, rightBend } = locomotionArms(pose.phase, pose.envelope, run, direction, preparationCarry));
      }
      const carry = carryOut && p > 0.85 ? smooth((p - 0.85) / 0.15) : 0;
      const carryDirection = carryOut && p > 0.85 ? nextDirection : direction;
      if (carry > 0) {
        hipHeight = mix(hipHeight, 62 * scale, carry);
        hipOffset = mix(hipOffset, -carryDirection * 5 * scale, carry);
        lean = mix(lean, carryDirection * 0.12, carry);
        leftUpper = angleMix(leftUpper, -carryDirection * 0.25, carry);
        rightUpper = angleMix(rightUpper, carryDirection * 0.25, carry);
        leftBend = mix(leftBend, carryDirection * 0.75, carry);
        rightBend = mix(rightBend, carryDirection * 0.75, carry);
      }
      if (active.action === "walk" && touchingNext && next.action === "push" && direction === 1 && spec.prop) {
        const preload = 0.55 * smooth((p - 0.85) / 0.15);
        const posture = pushPosture(destination.x);
        hipHeight = mix(hipHeight, posture.height, preload);
        lean = mix(lean, posture.lean, preload);
        gravityCompensation = posture.lean * preload;
        grip = preload;
      }
      if (moving && touchingNext && next.action === "jump") {
        const preload = smooth((p - 0.82) / 0.18);
        const armLoad = smooth((p - 0.82) / 0.12);
        hipHeight = mix(hipHeight, 54 * scale, preload);
        hipOffset *= 1 - preload;
        lean = mix(lean, direction * 0.15, preload);
        leftUpper = angleMix(leftUpper, -0.85, armLoad);
        rightUpper = angleMix(rightUpper, 0.85, armLoad);
        leftBend = mix(leftBend, direction * (direction > 0 ? 0.60 : 1.10), armLoad);
        rightBend = mix(rightBend, direction * (direction > 0 ? 1.10 : 0.60), armLoad);
      }
      applyClipDefault(active.action, p, startX, destination.x, direction as -1 | 1);
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
      const turnEnd = facing !== direction ? preparationFraction(active.durationMs, true) : 0;
      const landingIn = previous?.action === "jump" && previous.startMs + previous.durationMs === active.startMs;
      turn(p, direction, turnEnd, landingIn ? 66 * scale : restHeight);
      const finalPoint = activeIndex === spec.actions.length - 1;
      gesture = mix(landingIn ? 0.55 : 0, 1, smooth(p / 0.28)) * (finalPoint ? 1 : smooth((1 - p) / 0.22));
      if (landingIn && turnEnd === 0) hipHeight = mix(66 * scale, restHeight, smooth(p / 0.18));
      // Keep the inactive arm behind/opposite the pointing gesture so both
      // sides remain readable; rotate joints rather than mirroring the rig.
      leftUpper = angleMix(leftUpper, -direction * 0.32, gesture);
      leftBend = mix(leftBend, -direction * 0.20, gesture);
      // Remain upright so an overhead point can route around the head.
      facing = direction;
      applyClipDefault("point", finalPoint ? Math.min(p, 0.5) : p, startX, startX, direction as -1 | 1, pointTarget);
    } else if (active.action === "jump") {
      const previousRoute = routes.find((route) => route.index === activeIndex - 1);
      const travelIn = previousRoute && previousRoute.startX !== previousRoute.endX
        && previous && previous.startMs + previous.durationMs === active.startMs;
      const next = spec.actions[activeIndex + 1];
      const target = next?.action === "point" && next.startMs === active.startMs + active.durationMs ? spec.targets?.[next.target ?? ""] : undefined;
      applyJump(p, Boolean(travelIn), target);
      applyClipDefault("jump", p, startX, startX, facing as -1 | 1, target);
    } else if (active.action === "push" && spec.prop) {
      const turnEnd = facing !== 1 ? Math.min(0.14, 240 / active.durationMs) : 0;
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
        hipHeight -= pushCompression * posture.load * scale * (1 - force) * pose.envelope;
        hipOffset = (3 + 2.5 * posture.load * Math.sin(Math.PI * pose.phase)) * scale * pose.envelope;
        lean += pushRotation * posture.load * Math.cos(Math.PI * pose.phase) * pose.envelope;
        gravityCompensation = lean;
      }
    }
  } else if (mode === "normal" && intent === undefined) {
    const nearActionBoundary = spec.actions.some(item =>
      Math.abs(t - item.startMs) < 250 || Math.abs(t - (item.startMs + item.durationMs)) < 250
    );
    if (!nearActionBoundary) applyClipDefault("idle", ((t / 1000) % 2) / 2, rootX, rootX, facing as -1 | 1);
  }

  if (intent !== undefined) {
    rootX = intent.rootX;
    facing = intent.facing;
    hipHeight = intent.hipHeight;
    hipOffset = intent.hipOffset ?? 0;
    lean = intent.lean ?? 0;
    leftFoot = { x: intent.leftFoot.x, y: intent.leftFoot.y };
    rightFoot = { x: intent.rightFoot.x, y: intent.rightFoot.y };
    leftKneePole = intent.leftFoot.pole;
    rightKneePole = intent.rightFoot.pole;
    turning = intent.pivot ?? false;
    if (intent.steps) {
      const recordedFoot = (side: "left" | "right", base: Point): Point => {
        let selected: MotionSupportStep | undefined;
        for (const step of intent.steps ?? []) {
          if (step.side === side && t >= step.liftMs) selected = step;
        }
        if (!selected) return base;
        if (t >= selected.placeMs) return { x: selected.toX, y: groundY };
        return swingFoot(selected.fromX, selected.toX, (t - selected.liftMs) / (selected.placeMs - selected.liftMs),
          rootX, selected.clearance);
      };
      leftFoot = recordedFoot("left", leftFoot);
      rightFoot = recordedFoot("right", rightFoot);
    }
    if (intent.transitions) {
      const transitionFoot = (side: "left" | "right", base: Point): Point => {
        const transition = intent.transitions?.find((item) => item.side === side && t >= item.startMs);
        if (!transition) return base;
        const duration = transition.endMs - transition.startMs;
        const u = clamp01((t - transition.startMs) / duration);
        const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
        return {
          x: a * transition.fromX + b * (transition.fromX + transition.velocityX * duration / 3) + (c + d) * transition.toX,
          y: a * transition.fromY + b * (transition.fromY + transition.velocityY * duration / 3) + (c + d) * groundY
        };
      };
      leftFoot = transitionFoot("left", leftFoot);
      rightFoot = transitionFoot("right", rightFoot);
    }
    if (turning && Math.abs(leftFoot.y - (intent.leftFoot.floorY ?? authoredGroundY)) > 1e-6
      && Math.abs(rightFoot.y - (intent.rightFoot.floorY ?? authoredGroundY)) > 1e-6) {
      throw new RangeError("Motion intent pivot requires a currently supported foot, not just an initial anchor.");
    }
    const phase = intent.phase + (intent.cadence ?? 0) * (t - (intent.phaseTimeMs ?? t)) / 1000;
    if (phase < 0 || !Number.isFinite(phase)) throw new RangeError("Motion intent sample must be within its finite phase epoch.");
    if (intent.arms) {
      leftUpper = intent.arms.left.upper;
      leftBend = intent.arms.left.bend;
      rightUpper = intent.arms.right.upper;
      rightBend = intent.arms.right.bend;
    } else if (intent.action === "walk" || intent.action === "run") {
      ({ leftUpper, rightUpper, leftBend, rightBend } = locomotionArms(phase, intent.gaitWeight ?? 1, intent.action === "run" ? 1 : 0, facing));
    }
    if (intent.point) {
      pointTarget = intent.point;
      gesture = intent.point.weight;
      const pointDirection = Math.sign(intent.point.x - rootX) || facing;
      leftUpper = angleMix(leftUpper, -pointDirection * 0.32, gesture);
      leftBend = mix(leftBend, -pointDirection * 0.20, gesture);
    }
    if (intent.jump) applyJump(intent.jump.progress, intent.jump.loaded, undefined, intent.jump.fromHipHeight, true, intent.jump.fromLean);
  }
  const hip = { x: rootX + hipOffset, y: groundY - hipHeight };
  // Enforce leg reach at the pelvis, not by stretching bones or dragging an
  // anchor. This supplies real stance compression/weight transfer.
  const maxReach = turning
    ? 2 * legLength * Math.cos(0.18 * (1 - (intent?.extensionWeight ?? 1))) - 1e-8 * scale
    : 2 * legLength * Math.cos(0.18);
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
    const upwardAngle = distance > 1e-9
      ? Math.acos(Math.max(-1, Math.min(1, (dx * Math.sin(lean) - dy * Math.cos(lean)) / distance))) : Math.PI / 2;
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
    // Relaxed arms follow gravity while the torso hinges; anchoring their
    // neutral angles to the torso creates a backward reach and wrap-around.
    leftUpper += gravityCompensation;
    rightUpper += gravityCompensation;
    const handle = { x: propX + spec.prop.handle.x, y: spec.prop.y + spec.prop.handle.y };
    // Reserve a readable elbow during non-contact reach/release. The drive
    // posture reserves <=55.5 units, so both assigned full-contact targets
    // remain exact; only the free transition avoids the straight-arm singularity.
    const left = ik(shoulder, { x: handle.x, y: handle.y + 4 * scale }, armLength, -1, 2.6, 0.25);
    const right = ik(shoulder, { x: handle.x, y: handle.y - 4 * scale }, armLength, 1, 2.6, 0.25);
    leftUpper = angleMix(leftUpper, wrap(left.upper + lean), grip);
    rightUpper = angleMix(rightUpper, wrap(right.upper + lean), grip);
    leftBend = mix(leftBend, left.bend, grip);
    rightBend = mix(rightBend, right.bend, grip);
  }
  const leftArm = armFK(shoulder, lean, leftUpper, leftBend);
  const rightArm = armFK(shoulder, lean, rightUpper, rightBend);
  const leftLeg = ik(hip, leftFoot, legLength, leftKneePole, 2.65);
  const rightLeg = ik(hip, rightFoot, legLength, rightKneePole, 2.65);
  if (intent !== undefined) {
    for (const [side, target, solved] of [
      ["left", leftFoot, leftLeg], ["right", rightFoot, rightLeg]
    ] as const) {
      if (Math.hypot(target.x - solved.end.x, target.y - solved.end.y) > 1e-6 * scale) {
        throw new RangeError(`Motion intent ${side} foot is unreachable by the fixed-length rig; re-plan the support/root, not the anchor.`);
      }
    }
  }
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
  if (intent !== undefined && segments.some(line => {
    if (line.id.includes("thigh") || line.id.includes("shin")) {
      const floor = (line.id.startsWith("left-") ? intent.leftFoot : intent.rightFoot).floorY ?? authoredGroundY;
      // Equal-length billboard bones use the midpoint of supplied root/foot
      // support references at the knee. No authored terrain or camera is inferred.
      const kneeFloor = (groundY + floor) / 2;
      return line.id.includes("thigh")
        ? line.y1 > groundY + 1e-6 || line.y2 > kneeFloor + 1e-6
        : line.y1 > kneeFloor + 1e-6 || line.y2 > floor + 1e-6;
    }
    return Math.max(line.y1, line.y2) > groundY + 1e-6;
  })) {
    throw new RangeError("Motion intent causes a joint to penetrate its assigned support floor.");
  }
  if (intent !== undefined && (!Number.isFinite(head.x) || !Number.isFinite(head.y)
    || segments.some((line) => {
      const length = (line.id === "torso" ? 45 : line.id.includes("arm") ? 28 : 36) * scale;
      return [line.x1, line.y1, line.x2, line.y2].some((value) => !Number.isFinite(value))
        || Math.abs(Math.hypot(line.x2 - line.x1, line.y2 - line.y1) / length - 1) > 0.001;
    }))) {
    throw new RangeError("Motion intent exceeds the finite numerical range of the rig.");
  }
  return { timeMs: t, action: intent?.action ?? active?.action ?? "idle", x: rootX, groundY, head, segments, prop };
}

export function getFinalFrame(program: CompiledAnimation, mode: "reduced" | "static" = "static"): SampledFrame {
  return sampleAnimation(program, program.spec.durationMs, mode);
}
