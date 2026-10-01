import type { ActionName } from "./contract.js";

export interface ActionDescription {
  id: `${ActionName}@1.0.0`;
  action: ActionName;
  summary: string;
  requiredBinding: "named target" | "bound visible prop handle" | "none";
  reducedMotion: string;
}

export const actionCatalog: ActionDescription[] = [
  { id: "walk@1.0.0", action: "walk", summary: "Travel smoothly to a named ground position with alternating connected limbs.", requiredBinding: "named target", reducedMotion: "Shows the actor at the destination." },
  { id: "run@1.0.0", action: "run", summary: "Travel at a running cadence with a brief airborne foot phase.", requiredBinding: "named target", reducedMotion: "Shows the actor at the destination." },
  { id: "wave@1.0.0", action: "wave", summary: "Raise and oscillate the right arm, then settle to neutral.", requiredBinding: "none", reducedMotion: "Shows a stable standing actor." },
  { id: "point@1.0.0", action: "point", summary: "Orient an extended arm toward a named canvas target.", requiredBinding: "named target", reducedMotion: "Shows a stable standing actor." },
  { id: "jump@1.0.0", action: "jump", summary: "Anticipate, arc upward, and land on the shared playhead.", requiredBinding: "none", reducedMotion: "Shows the landed actor." },
  { id: "push@1.0.0", action: "push", summary: "Move the actor and a visible bound prop together while both hands stay at its declared handle.", requiredBinding: "bound visible prop handle", reducedMotion: "Shows the prop at its destination with the actor settled beside it." }
];

export function describeAction(id: string): ActionDescription | undefined {
  return actionCatalog.find((entry) => entry.id === id);
}
