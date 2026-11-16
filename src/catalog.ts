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

export interface ActionCatalogFilter {
  category?: string;
  tag?: string;
  prop?: string;
  kind?: string;
  travel?: string;
  search?: string;
}

const legacyVersionedIds = new Set(["walk", "run", "wave", "point", "jump", "push"]);

function binding(action: string, travel: "travel" | "in-place", aim: "hand" | "head" | null, prop: string | null): ActionDescription["requiredBinding"] {
  if (action === "push" && prop) return "bound visible prop handle";
  if (travel === "travel" || aim) return "named target";
  return "none";
}

interface CatalogIndexedEntry {
  description: ActionDescription;
  category: string;
  group: string;
  tags: string[];
}

const catalogIndexed: CatalogIndexedEntry[] = RUNTIME_ACTION_NAMES.map((action) => {
  const meta = getMotionMeta(action);
  const kind = meta?.kind ?? "oneshot";
  const travel = meta?.travel ?? "in-place";
  const prop = meta?.prop ?? null;
  return {
    description: {
      id: `${action}@${legacyVersionedIds.has(action) ? "1.0.0" : "1.1.0"}`,
      action,
      label: meta?.label ?? action,
      summary: meta?.summary ?? `${action} motion clip.`,
      kind,
      travel,
      prop,
      requiredBinding: binding(action, travel, meta?.aim ?? null, prop),
      reducedMotion: travel === "travel" ? "Shows the actor at the destination." : "Shows the final readable pose."
    },
    category: meta?.category ?? "basic",
    group: meta?.group ?? "Basic (moving & postures)",
    tags: meta?.tags ?? []
  };
});

export const actionCatalog: ActionDescription[] = catalogIndexed.map((item) => item.description);

export function queryActionCatalog(filter?: ActionCatalogFilter): ActionDescription[] {
  if (!filter) return catalogIndexed.map((item) => item.description);
  const category = filter.category?.trim().toLowerCase();
  const tag = filter.tag?.trim().toLowerCase();
  const prop = filter.prop?.trim().toLowerCase();
  const kind = filter.kind?.trim().toLowerCase();
  const travel = filter.travel?.trim().toLowerCase();
  const search = filter.search?.trim().toLowerCase();
  const searchTokens = search ? search.split(/\s+/).filter(Boolean) : [];

  return catalogIndexed
    .filter((item) => {
      const { description } = item;
      if (category && item.category.toLowerCase() !== category && item.group.toLowerCase() !== category) return false;
      if (tag && !item.tags.some((t) => t.toLowerCase() === tag)) return false;
      if (prop && (description.prop ?? "").toLowerCase() !== prop) return false;
      if (kind && description.kind.toLowerCase() !== kind) return false;
      if (travel && description.travel.toLowerCase() !== travel) return false;
      if (searchTokens.length > 0) {
        const haystack = [
          description.id,
          description.action,
          description.label,
          description.summary,
          description.prop ?? "",
          item.category,
          item.group,
          ...item.tags
        ].join(" ").toLowerCase();
        if (!searchTokens.every((token) => haystack.includes(token))) return false;
      }
      return true;
    })
    .map((item) => item.description);
}

export function describeAction(idOrAction: string): ActionDescription | undefined {
  if (idOrAction.includes("@")) {
    return catalogIndexed.find((item) => item.description.id === idOrAction)?.description;
  }
  return catalogIndexed.find((item) => item.description.action === idOrAction)?.description;
}
