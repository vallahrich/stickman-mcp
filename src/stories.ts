import { compileAnimation } from "./compiler.js";
import type { AnimationAction, AnimationSpec } from "./contract.js";

export interface StoryCue {
  id: string;
  timeMs: number;
  title: string;
  text: string;
}

export interface StoryRecipe {
  id: string;
  title: string;
  summary: string;
  animation: AnimationSpec;
  cues: StoryCue[];
}

export interface StoryStep {
  action: string;
  durationMs: number;
  target?: string;
  speed?: number;
  cue?: { id: string; title: string; text: string; offsetMs?: number };
}

export interface StoryInput {
  id: string;
  title: string;
  summary: string;
  canvas: AnimationSpec["canvas"];
  actor?: AnimationSpec["actor"];
  targets?: AnimationSpec["targets"];
  prop?: AnimationSpec["prop"];
  steps: StoryStep[];
}

/** Build an ordered, single-actor scene with cues on the same absolute timeline. */
export function composeStory(input: StoryInput): StoryRecipe {
  if (!input.id.trim() || !input.title.trim() || !input.steps.length) throw new Error("A story needs an ID, title and at least one step.");
  const actions: AnimationAction[] = [];
  const cues: StoryCue[] = [];
  let timeMs = 0;
  for (const step of input.steps) {
    actions.push({
      action: step.action, startMs: timeMs, durationMs: step.durationMs,
      ...(step.target === undefined ? {} : { target: step.target }),
      ...(step.speed === undefined ? {} : { speed: step.speed })
    });
    if (step.cue) {
      const offset = step.cue.offsetMs ?? 0;
      if (!step.cue.id.trim() || !step.cue.title.trim() || cues.some(cue => cue.id === step.cue!.id)) throw new Error("Story cues need unique IDs and nonempty titles.");
      if (!Number.isFinite(offset) || offset < 0 || offset >= step.durationMs) throw new Error(`Cue "${step.cue.id}" must fall inside its action.`);
      cues.push({ id: step.cue.id, timeMs: timeMs + offset, title: step.cue.title, text: step.cue.text });
    }
    timeMs += step.durationMs;
  }
  const animation: AnimationSpec = {
    version: "stickman.animation/v1", canvas: structuredClone(input.canvas), durationMs: timeMs,
    ...(input.actor === undefined ? {} : { actor: structuredClone(input.actor) }),
    ...(input.targets === undefined ? {} : { targets: structuredClone(input.targets) }),
    ...(input.prop === undefined ? {} : { prop: structuredClone(input.prop) }),
    actions
  };
  const compiled = compileAnimation(animation);
  if (!compiled.valid) throw new Error(`Story "${input.id}" is not feasible: ${compiled.diagnostics.map(d => `${d.path}: ${d.message}`).join("; ")}`);
  return { id: input.id, title: input.title, summary: input.summary, animation, cues };
}

// Keep these recipes on the fixed-length procedural rig path; wide-canvas
// clip endpoint blending still needs separate contact/anatomy qualification.
const canvas = { width: 1000, height: 720, fps: 30 };
const inputs: StoryInput[] = [
  {
    id: "cloud-journey", title: "From application to cloud service",
    summary: "One actor follows the request from application to cloud, highlights each step and acknowledges the delivered service.",
    canvas, actor: { x: 120, groundY: 560 },
    targets: { app: { x: 310, y: 560 }, appLabel: { x: 380, y: 435 }, cloud: { x: 720, y: 560 }, cloudLabel: { x: 790, y: 435 } },
    steps: [
      { action: "walk", durationMs: 4000, target: "app", cue: { id: "request", title: "A request starts here", text: "An application needs a reliable digital service." } },
      { action: "point", durationMs: 2500, target: "appLabel", cue: { id: "application", title: "Application", text: "Make the starting point explicit.", offsetMs: 400 } },
      { action: "walk", durationMs: 6500, target: "cloud", cue: { id: "connect", title: "Follow the connection", text: "The same actor moves along the service path." } },
      { action: "point", durationMs: 2500, target: "cloudLabel", cue: { id: "cloud", title: "Cloud service", text: "Reveal where the request is handled.", offsetMs: 400 } },
      { action: "wave", durationMs: 2000, cue: { id: "delivered", title: "Service delivered", text: "End the story with a visible acknowledgment." } }
    ]
  },
  {
    id: "incident-resolution", title: "Detect, investigate, restore",
    summary: "A service incident motivates urgent travel, a targeted investigation and a calmer recovery. This is an illustrative workflow, not security advice.",
    canvas, actor: { x: 160, groundY: 560 },
    targets: { alert: { x: 420, y: 560 }, evidence: { x: 490, y: 435 }, service: { x: 800, y: 560 }, status: { x: 870, y: 435 } },
    steps: [
      { action: "run", durationMs: 3500, target: "alert", cue: { id: "detect", title: "An incident is detected", text: "Attention moves to the affected service." } },
      { action: "point", durationMs: 2500, target: "evidence", cue: { id: "investigate", title: "Investigate the signal", text: "Highlight the evidence before explaining the response.", offsetMs: 400 } },
      { action: "walk", durationMs: 6000, target: "service", cue: { id: "respond", title: "Work through the response", text: "Continue the same actor's journey rather than cutting to another clip." } },
      { action: "point", durationMs: 2500, target: "status", cue: { id: "verify", title: "Verify the service", text: "Show the outcome at its actual place in the diagram.", offsetMs: 400 } },
      { action: "wave", durationMs: 2000, cue: { id: "restored", title: "Service restored", text: "A clear closing beat completes the sequence." } }
    ]
  },
  {
    id: "deployment-rollout", title: "Move a release into place",
    summary: "A visible release package is moved with two-hand prop contact, then verified and handed over.",
    canvas, actor: { x: 240, groundY: 560 },
    prop: { id: "release-package", x: 285, y: 510, width: 54, height: 50, toX: 450, handle: { x: 5, y: 8 } },
    targets: { destination: { x: 490, y: 435 } },
    steps: [
      { action: "push", durationMs: 6500, target: "release-package", cue: { id: "deploy", title: "Deploy the release", text: "The actor and the release package move together through real handle contact." } },
      { action: "point", durationMs: 2500, target: "destination", cue: { id: "verify", title: "Verify the destination", text: "Point to the destination after the package reaches it.", offsetMs: 400 } },
      { action: "wave", durationMs: 2000, cue: { id: "handover", title: "Ready for handover", text: "Release, verify and acknowledge on one shared timeline." } }
    ]
  }
];

export function storyCatalog(): Omit<StoryRecipe, "animation" | "cues">[] {
  return inputs.map(({ id, title, summary }) => ({ id, title, summary }));
}

export function getStory(id: string): StoryRecipe {
  const input = inputs.find(story => story.id === id);
  if (!input) throw new Error(`Unknown story "${id}". Supported stories: ${inputs.map(story => story.id).join(", ")}.`);
  return composeStory(input);
}

/** Derive cue state, including backward seeks, without retaining playback history. */
export function storyState(story: StoryRecipe, timeMs: number) {
  if (!Number.isFinite(timeMs)) throw new Error("Story timeMs must be finite.");
  const time = Math.max(0, Math.min(story.animation.durationMs, timeMs));
  const revealed = story.cues.filter(cue => cue.timeMs <= time);
  return { timeMs: time, revealed, active: revealed.at(-1) ?? null, complete: time === story.animation.durationMs };
}
