import {
  CONTRACT_VERSION,
  type AnimationAction,
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
      if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
        diagnostics.push({ path: `$.canvas.${field}`, code: "out_of_range", message: `${field} must be an integer from ${min} to ${max}.` });
      }
    }
  }
  if (!Number.isInteger(input.durationMs) || (input.durationMs as number) < 100 || (input.durationMs as number) > 120000) {
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
    let plannedActorX = isRecord(input.actor) && finiteNumber(input.actor.x) ? input.actor.x : width * 0.2;
    let plannedGroundY = isRecord(input.actor) && finiteNumber(input.actor.groundY) ? input.actor.groundY : height * 0.8;
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
      if (!Number.isInteger(action.startMs) || (action.startMs as number) < 0) diagnostics.push({ path: `${path}.startMs`, code: "invalid_time", message: "startMs must be a non-negative integer." });
      if (!Number.isInteger(action.durationMs) || (action.durationMs as number) < 300) diagnostics.push({ path: `${path}.durationMs`, code: "invalid_duration", message: "durationMs must be an integer of at least 300." });
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
        if ((action.action === "walk" || action.action === "run") && typeof action.target === "string") {
          const destination = targets[action.target];
          if (isRecord(destination) && finiteNumber(destination.x) && finiteNumber(destination.y)) {
            plannedActorX = destination.x;
            plannedGroundY = destination.y;
          }
        }
      } else if (action.action === "push") {
        pushCount++;
        if (typeof action.target !== "string" || !isRecord(prop) || action.target !== prop.id) {
          diagnostics.push({ path: `${path}.target`, code: "unbound_prop", message: "push must target the ID of the visible prop in $.prop." });
        } else if (finiteNumber(prop.x) && finiteNumber(prop.y) && finiteNumber(prop.toX) && isRecord(prop.handle) && finiteNumber(prop.handle.x) && finiteNumber(prop.handle.y)) {
          const handX = prop.x + prop.handle.x;
          const handY = prop.y + prop.handle.y;
          if (handX <= plannedActorX) diagnostics.push({ path: "$.prop.handle", code: "unsupported_push_facing", message: "Version 1 push is right-facing; the actor must approach from the left side of the prop handle." });
          const approachDistance = Math.hypot(handX - plannedActorX, handY - (plannedGroundY - 92));
          if (approachDistance > 52 || approachDistance < 4) diagnostics.push({ path: "$.prop.handle", code: "unreachable_contact", message: `Prop handle is ${approachDistance.toFixed(1)} units from the actor shoulder at push start; two-hand reach must be 4-52 units. Add or adjust a preceding walk target to establish contact.` });
        }
      } else if (action.target !== undefined) {
        diagnostics.push({ path: `${path}.target`, code: "unexpected_target", message: `${String(action.action)} does not accept a target.` });
      }
    }
    if (pushCount > 1) diagnostics.push({ path: "$.actions", code: "multiple_prop_pushes", message: "A v1 animation binds one push interaction to one prop." });
    if (pushCount === 0 && prop !== undefined) diagnostics.push({ path: "$.prop", code: "unused_prop", message: "A prop must be referenced by one push action or removed." });
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

export function compileAnimation(input: unknown): CompileResult {
  const validation = validateAnimation(input);
  if (!validation.valid) return validation;
  const spec = structuredClone(input) as AnimationSpec;
  spec.actions.sort((a, b) => a.startMs - b.startMs);
  const program: CompiledAnimation = { contractVersion: CONTRACT_VERSION, spec };
  return { valid: true, diagnostics: [], program };
}

export function sampleAnimation(program: CompiledAnimation, timeMs: number, mode: PlaybackMode = "normal"): SampledFrame {
  const spec = program.spec;
  const t = mode === "normal" ? Math.min(spec.durationMs, Math.max(0, timeMs)) : spec.durationMs;
  const width = spec.canvas.width;
  const height = spec.canvas.height;
  const actorX = spec.actor?.x ?? width * 0.2;
  const groundY = spec.actor?.groundY ?? height * 0.8;
  const smooth = (v: number): number => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c); };
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const active = mode === "normal" ? spec.actions.find((a) => t >= a.startMs && t < a.startMs + a.durationMs) : undefined;
  let action: AnimationAction | undefined = active;
  let rootX = actorX;
  let rootY = groundY;
  let facing = 1;
  let walkPhase = 0;
  let walkMix = 0;
  let bodyLean = 0;
  let armWave = 0;
  let waveMix = 0;
  let pointMix = 0;
  let pushMix = 0;
  let armPoint: { x: number; y: number } | undefined;
  let jumping = 0;
  let propX = spec.prop?.x ?? 0;

  for (const item of spec.actions) {
    const progress = clamp01((t - item.startMs) / item.durationMs);
    if (item.action === "walk" || item.action === "run") {
      const actionStartX = rootX;
      const target = spec.targets?.[item.target ?? ""];
      if (target) {
        if (t >= item.startMs) {
          const direction = target.x === actionStartX ? facing : Math.sign(target.x - actionStartX);
          facing += (direction - facing) * smooth(progress / 0.16);
        }
        rootX += (target.x - rootX) * smooth(progress);
        rootY += (target.y - rootY) * smooth(progress);
      }
      if (active === item) {
        walkPhase = progress * Math.PI * (item.action === "run" ? 8 : 6);
        walkMix = smooth(progress / 0.12) * (1 - smooth((progress - 0.88) / 0.12));
        bodyLean = (item.action === "run" ? 0.22 : 0.08) * walkMix;
      }
    } else if (item.action === "push" && spec.prop) {
      const delta = spec.prop.toX - spec.prop.x;
      if (t >= item.startMs) facing += (1 - facing) * smooth(progress / 0.18);
      const travel = smooth((progress - 0.15) / 0.7);
      propX = spec.prop.x + delta * travel;
      rootX += delta * travel;
      if (active === item) {
        pushMix = smooth(progress / 0.15) * (1 - smooth((progress - 0.85) / 0.15));
        bodyLean = 0.14 * pushMix;
      }
    } else if (item.action === "jump" && active === item) {
      jumping = Math.sin(Math.PI * progress) * 52;
    } else if (item.action === "wave" && active === item) {
      const local = clamp01((t - item.startMs) / item.durationMs);
      waveMix = smooth(local / 0.18) * (1 - smooth((local - 0.82) / 0.18));
      armWave = waveMix * Math.sin(local * Math.PI * 10);
    } else if (item.action === "point" && active === item) {
      armPoint = spec.targets?.[item.target ?? ""];
      pointMix = smooth(progress / 0.2) * (1 - smooth((progress - 0.8) / 0.2));
    }
    if (item.action === "point" && t >= item.startMs) {
      const target = spec.targets?.[item.target ?? ""];
      if (target) {
        const direction = target.x === rootX ? facing : Math.sign(target.x - rootX);
        facing += (direction - facing) * smooth(progress / 0.2);
      }
    }
  }
  rootY -= jumping;

  const poseX = (x: number): number => rootX + (x - rootX) * facing;
  const hip = { x: rootX, y: rootY - 48 };
  const localShoulderX = rootX + Math.sin(bodyLean) * 10;
  const shoulder = { x: poseX(localShoulderX), y: rootY - 92 };
  const head = { x: poseX(localShoulderX + Math.sin(bodyLean) * 5), y: shoulder.y - 19 };
  const legSwing = active && (active.action === "walk" || active.action === "run") ? Math.sin(walkPhase) * (active.action === "run" ? 0.75 : 0.48) * walkMix : 0;
  const leftKnee = { x: poseX(rootX - 12 + Math.sin(legSwing) * 16), y: rootY - 25 };
  const rightKnee = { x: poseX(rootX + 12 - Math.sin(legSwing) * 16), y: rootY - 25 };
  const leftFoot = { x: poseX(rootX - 12 + Math.sin(legSwing) * 29), y: rootY - Math.max(0, Math.cos(walkPhase)) * (active?.action === "run" ? 12 : 3) * walkMix };
  const rightFoot = { x: poseX(rootX + 12 - Math.sin(legSwing) * 29), y: rootY - Math.max(0, -Math.cos(walkPhase)) * (active?.action === "run" ? 12 : 3) * walkMix };
  let leftElbow = { x: poseX(localShoulderX - 22), y: shoulder.y + 25 + bodyLean * 12 };
  let rightElbow = { x: poseX(localShoulderX + 22), y: shoulder.y + 25 + bodyLean * 12 };
  let leftHand = { x: poseX(localShoulderX - 30), y: shoulder.y + 52 };
  let rightHand = { x: poseX(localShoulderX + 30), y: shoulder.y + 52 };

  if (active?.action === "wave") {
    const targetElbow = { x: poseX(localShoulderX + 22), y: shoulder.y - 4 };
    const targetHand = { x: poseX(localShoulderX + 32 + armWave * 8), y: shoulder.y - 28 + armWave * 5 };
    rightElbow = { x: rightElbow.x + (targetElbow.x - rightElbow.x) * waveMix, y: rightElbow.y + (targetElbow.y - rightElbow.y) * waveMix };
    rightHand = { x: rightHand.x + (targetHand.x - rightHand.x) * waveMix, y: rightHand.y + (targetHand.y - rightHand.y) * waveMix };
  } else if (active?.action === "point" && armPoint) {
    const dx = armPoint.x - shoulder.x;
    const dy = armPoint.y - shoulder.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const targetElbow = { x: shoulder.x + dx / length * 25 - dy / length * 4, y: shoulder.y + dy / length * 25 + dx / length * 4 };
    const targetHand = { x: shoulder.x + dx / length * 51, y: shoulder.y + dy / length * 51 };
    rightElbow = { x: rightElbow.x + (targetElbow.x - rightElbow.x) * pointMix, y: rightElbow.y + (targetElbow.y - rightElbow.y) * pointMix };
    rightHand = { x: rightHand.x + (targetHand.x - rightHand.x) * pointMix, y: rightHand.y + (targetHand.y - rightHand.y) * pointMix };
  } else if (active?.action === "push" && spec.prop) {
    const handle = { x: propX + spec.prop.handle.x, y: spec.prop.y + spec.prop.handle.y };
    const targetRightHand = { ...handle };
    const targetLeftHand = { x: handle.x, y: handle.y + 3 };
    const targetRightElbow = { x: (shoulder.x + targetRightHand.x) / 2 - 6, y: (shoulder.y + targetRightHand.y) / 2 - 2 };
    const targetLeftElbow = { x: (shoulder.x + targetLeftHand.x) / 2 - 6, y: (shoulder.y + targetLeftHand.y) / 2 + 6 };
    rightHand = { x: rightHand.x + (targetRightHand.x - rightHand.x) * pushMix, y: rightHand.y + (targetRightHand.y - rightHand.y) * pushMix };
    leftHand = { x: leftHand.x + (targetLeftHand.x - leftHand.x) * pushMix, y: leftHand.y + (targetLeftHand.y - leftHand.y) * pushMix };
    rightElbow = { x: rightElbow.x + (targetRightElbow.x - rightElbow.x) * pushMix, y: rightElbow.y + (targetRightElbow.y - rightElbow.y) * pushMix };
    leftElbow = { x: leftElbow.x + (targetLeftElbow.x - leftElbow.x) * pushMix, y: leftElbow.y + (targetLeftElbow.y - leftElbow.y) * pushMix };
  }

  const segments: Segment[] = [
    { id: "torso", x1: hip.x, y1: hip.y, x2: shoulder.x, y2: shoulder.y },
    { id: "left-upper-arm", x1: shoulder.x, y1: shoulder.y, x2: leftElbow.x, y2: leftElbow.y },
    { id: "left-forearm", x1: leftElbow.x, y1: leftElbow.y, x2: leftHand.x, y2: leftHand.y },
    { id: "right-upper-arm", x1: shoulder.x, y1: shoulder.y, x2: rightElbow.x, y2: rightElbow.y },
    { id: "right-forearm", x1: rightElbow.x, y1: rightElbow.y, x2: rightHand.x, y2: rightHand.y },
    { id: "left-thigh", x1: hip.x - 10, y1: hip.y, x2: leftKnee.x, y2: leftKnee.y },
    { id: "left-shin", x1: leftKnee.x, y1: leftKnee.y, x2: leftFoot.x, y2: leftFoot.y },
    { id: "right-thigh", x1: hip.x + 10, y1: hip.y, x2: rightKnee.x, y2: rightKnee.y },
    { id: "right-shin", x1: rightKnee.x, y1: rightKnee.y, x2: rightFoot.x, y2: rightFoot.y }
  ];
  const prop = spec.prop ? {
    id: spec.prop.id, x: propX, y: spec.prop.y, width: spec.prop.width, height: spec.prop.height,
    handleX: propX + spec.prop.handle.x, handleY: spec.prop.y + spec.prop.handle.y
  } : null;
  return { timeMs: t, action: active?.action ?? "idle", x: rootX, groundY: rootY, head, segments, prop };
}

export function getFinalFrame(program: CompiledAnimation, mode: "reduced" | "static" = "static"): SampledFrame {
  return sampleAnimation(program, program.spec.durationMs, mode);
}
