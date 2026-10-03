import type { ActionName } from "./contract.js";
import { RUNTIME_ACTION_NAMES, getMotionMeta } from "./motion-library.js";

export interface ActionDescription {
  id: `${string}@${string}`;
  action: ActionName;
  label: string;
  summary: string;
  kind: "loop" | "oneshot" | "hold";
  travel: "travel" | "in-place";
  prop: string | null;
  requiredBinding: "named target" | "bound visible prop handle" | "none";
  reducedMotion: string;
}

const legacyVersionedIds = new Set(["walk", "run", "wave", "point", "jump", "push"]);

function binding(action: string, travel: "travel" | "in-place", aim: "hand" | "head" | null, prop: string | null): ActionDescription["requiredBinding"] {
  if (action === "push" && prop) return "bound visible prop handle";
  if (travel === "travel" || aim) return "named target";
  return "none";
}

export const actionCatalog: ActionDescription[] = RUNTIME_ACTION_NAMES.map((action) => {
  const meta = getMotionMeta(action);
  const kind = meta?.kind ?? "oneshot";
  const travel = meta?.travel ?? "in-place";
  const prop = meta?.prop ?? null;
  return {
    id: `${action}@${legacyVersionedIds.has(action) ? "1.0.0" : "1.1.0"}`,
    action,
    label: meta?.label ?? action,
    summary: meta?.summary ?? `${action} motion clip.`,
    kind,
    travel,
    prop,
    requiredBinding: binding(action, travel, meta?.aim ?? null, prop),
    reducedMotion: travel === "travel" ? "Shows the actor at the destination." : "Shows the final readable pose."
  };
});

export function describeAction(id: string): ActionDescription | undefined {
  return actionCatalog.find((entry) => entry.id === id);
}
