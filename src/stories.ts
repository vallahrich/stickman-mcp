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
    id: "cloud-journey", title: "Keep the app simple. Scale the service.",
    summary: "A customer request leaves the application, reaches a managed service and returns a result. The architecture changes; the customer experience stays familiar.",
    canvas, actor: { x: 120, groundY: 560 },
    targets: { app: { x: 310, y: 560 }, appLabel: { x: 380, y: 435 }, cloud: { x: 720, y: 560 }, cloudLabel: { x: 790, y: 435 } },
    steps: [
      { action: "walk", durationMs: 4000, target: "app", cue: { id: "request", title: "A customer places an order", text: "The application owns the experience, not every backend capability." } },
      { action: "point", durationMs: 2500, target: "appLabel", cue: { id: "application", title: "One API boundary", text: "Send the request through a stable contract.", offsetMs: 400 } },
      { action: "walk", durationMs: 6500, target: "cloud", cue: { id: "connect", title: "Move the work, not the customer", text: "A managed service handles the backend request." } },
      { action: "point", durationMs: 2500, target: "cloudLabel", cue: { id: "cloud", title: "Scale behind the same interface", text: "Backend capacity can evolve without changing the application contract.", offsetMs: 400 } },
      { action: "wave", durationMs: 2000, cue: { id: "delivered", title: "Order confirmed", text: "Same customer experience. Independently scalable backend." } }
    ]
  },
  {
    id: "incident-resolution", title: "A failed instance need not stop the service.",
    summary: "A failed primary is identified, traffic shifts to a healthy replica, and the customer route recovers. An illustrative failover pattern, not a live operational runbook.",
    canvas, actor: { x: 160, groundY: 560 },
    targets: { alert: { x: 420, y: 560 }, evidence: { x: 490, y: 435 }, service: { x: 800, y: 560 }, status: { x: 870, y: 435 } },
    steps: [
      { action: "run", durationMs: 3500, target: "alert", cue: { id: "detect", title: "The primary stops responding", text: "Customer requests cannot rely on this instance." } },
      { action: "point", durationMs: 2500, target: "evidence", cue: { id: "investigate", title: "Isolate the failed instance", text: "The unhealthy primary stays out of the serving route.", offsetMs: 400 } },
      { action: "walk", durationMs: 6000, target: "service", cue: { id: "respond", title: "Redirect to the healthy replica", text: "The route changes while the application endpoint stays the same." } },
      { action: "point", durationMs: 2500, target: "status", cue: { id: "verify", title: "Check the new serving route", text: "Verify the replica before declaring recovery.", offsetMs: 400 } },
      { action: "wave", durationMs: 2000, cue: { id: "restored", title: "Requests flow again", text: "Resilience comes from an alternate path, not a healthier-looking status label." } }
    ]
  },
  {
    id: "deployment-rollout", title: "Deploy is a step. Verification is the gate.",
    summary: "A release moves from staging into a deployment slot. Traffic remains closed until verification; only then does the new version become live.",
    canvas, actor: { x: 240, groundY: 560 },
    prop: { id: "release-package", x: 285, y: 510, width: 54, height: 50, toX: 450, handle: { x: 5, y: 8 } },
    targets: { destination: { x: 490, y: 435 } },
    steps: [
      { action: "push", durationMs: 6500, target: "release-package", cue: { id: "deploy", title: "Load the new release", text: "The deployment slot receives the package; customer traffic is still closed." } },
      { action: "point", durationMs: 2500, target: "destination", cue: { id: "verify", title: "Verify before opening traffic", text: "Check the deployed version before routing customer requests to it.", offsetMs: 400 } },
      { action: "wave", durationMs: 2000, cue: { id: "handover", title: "Open the serving route", text: "Deployment complete. Verification complete. Now the release is live." } }
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
