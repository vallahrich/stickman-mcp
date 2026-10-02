import type { ActionName } from "./contract.js";

export interface ActionDescription {
  id: `${ActionName}@1.0.0`;
  action: ActionName;
  summary: string;
  requiredBinding: "named target" | "bound visible prop handle" | "none";
  reducedMotion: string;
}

export const actionCatalog: ActionDescription[] = [
  { id: "walk@1.0.0", action: "walk", summary: "Travel to a named flat-ground position with supported alternating steps. For relaxed human pacing, prefer about 1.8-2.2 steps per second; short routes and stopping need preparation/settling time. Validation rejects infeasible cadence rather than sliding feet.", requiredBinding: "named target", reducedMotion: "Shows the actor at the destination." },
  { id: "run@1.0.0", action: "run", summary: "Run toward a named flat-ground position with reciprocal arms and genuine flight. Human-paced examples use about 2.5-3.2 steps per second; reserve time for acceleration/braking or connect adjacent routes deliberately.", requiredBinding: "named target", reducedMotion: "Shows the actor at the destination." },
  { id: "wave@1.0.0", action: "wave", summary: "Raise and oscillate the right arm, then settle to neutral.", requiredBinding: "none", reducedMotion: "Shows a stable standing actor." },
  { id: "point@1.0.0", action: "point", summary: "Orient an extended arm toward a named canvas target.", requiredBinding: "named target", reducedMotion: "Shows a stable standing actor." },
  { id: "jump@1.0.0", action: "jump", summary: "Crouch, take off, travel vertically, absorb landing and settle at the current location. Start near 1200 ms for a normal-speed hop; longer authored durations deliberately slow the movement.", requiredBinding: "none", reducedMotion: "Shows the landed actor." },
  { id: "push@1.0.0", action: "push", summary: "Approach and drive a grounded rightward prop with two assigned grips centered around its declared handle anchor, then release after stopping. Prefer about 1.5-2 drive steps per second for readable loaded effort; the grip region must fit the prop and both fixed arm reaches.", requiredBinding: "bound visible prop handle", reducedMotion: "Shows the prop at its destination with the actor settled beside it." }
];

export function describeAction(id: string): ActionDescription | undefined {
  return actionCatalog.find((entry) => entry.id === id);
}
