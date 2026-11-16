import { CONTRACT_VERSION_V2, type AnimationAction, type AnimationSpec, type AnimationSpecV2, type MarkerEvent, type ResolvedActorAction } from "./contract.js";
import type { MotionClipLibrary } from "./motion-clips.js";

function collectActionMarkers(
  actions: readonly (AnimationAction | ResolvedActorAction)[],
  durationMs: number,
  library: MotionClipLibrary,
  actorId?: string
): MarkerEvent[] {
  const events: MarkerEvent[] = [];
  const sorted = [...actions].sort((a, b) => a.startMs - b.startMs);
  sorted.forEach((item, actionIndex) => {
    const clip = library.clips[item.action];
    if (item.durationMs <= 0) return;
    const speed = Math.max(0.5, Math.min(2, item.speed ?? 1));
    const end = item.startMs + item.durationMs;
    const n = clip?.frames.length ?? 0;
    const markers = clip?.markers ?? clip?.meta?.markers;
    const travels = clip ? (!clip.poseKeys?.length && (clip.meta?.travel === "travel" || item.action === "walk" || item.action === "run")) : false;

    const push = (marker: string, frame: number, progress: number): void => {
      if (progress < 0 || progress > 1 + 1e-9) return;
      const timeMs = Math.round(item.startMs + progress * item.durationMs);
      if (timeMs <= Math.min(end, durationMs)) {
        events.push({
          timeMs,
          actionIndex,
          action: item.action,
          marker,
          frame,
          ...(actorId !== undefined ? { actorId } : {})
        });
      }
    };

    if (clip && markers && n >= 2 && !travels) {
      for (const [marker, frame] of Object.entries(markers)) {
        if (!Number.isFinite(frame) || frame < 0 || frame >= n) continue;
        if (clip.loop && clip.meta?.kind !== "hold") {
          const cycles = clip.poseKeys?.length
            ? Math.max(1, Math.round(item.durationMs * speed / (n / clip.fps * 1000)))
            : speed;
          for (let k = 0; (k * n + frame) / (cycles * n) <= 1 + 1e-9; k++) push(marker, frame, (k * n + frame) / (cycles * n));
        } else {
          push(marker, frame, frame / ((n - 1) * speed));
        }
      }
    }

    if (actorId !== undefined && "emitCue" in item && typeof item.emitCue === "string" && item.emitCue.length > 0) {
      const cueAt = item.emitCueAt ?? "end";
      let cueProgress = 1;
      let cueFrame = Math.max(0, n - 1);
      if (cueAt === "start") {
        cueProgress = 0;
        cueFrame = 0;
      } else if (cueAt !== "end" && markers && Number.isFinite(markers[cueAt])) {
        cueFrame = markers[cueAt]!;
        if (clip && clip.loop && clip.meta?.kind !== "hold" && n >= 2) {
          const cycles = clip.poseKeys?.length
            ? Math.max(1, Math.round(item.durationMs * speed / (n / clip.fps * 1000)))
            : speed;
          cueProgress = cueFrame / (cycles * n);
        } else if (n >= 2) {
          cueProgress = Math.min(1, cueFrame / ((n - 1) * speed));
        }
      }
      const cueTimeMs = Math.round(item.startMs + cueProgress * item.durationMs);
      if (cueTimeMs <= durationMs && !events.some((e) => e.actorId === actorId && e.marker === item.emitCue && e.timeMs === cueTimeMs)) {
        events.push({
          timeMs: cueTimeMs,
          actionIndex,
          action: item.action,
          marker: item.emitCue,
          frame: cueFrame,
          actorId
        });
      }
    }
  });
  return events;
}

/**
 * Timed motion markers (e.g. a keystroke, a reveal, a card placement) so a host page
 * can sync slide content to the stickman. Mirrors the clip timing used by sampleClipMotion.
 */
export function markerEvents(spec: AnimationSpec | AnimationSpecV2, library: MotionClipLibrary): MarkerEvent[] {
  if (spec.version === CONTRACT_VERSION_V2) {
    const events: MarkerEvent[] = [];
    for (const actor of spec.actors) {
      events.push(...collectActionMarkers(actor.actions, spec.durationMs, library, actor.id));
    }
    return events.sort((a, b) =>
      a.timeMs - b.timeMs
      || (a.actorId ?? "").localeCompare(b.actorId ?? "")
      || a.actionIndex - b.actionIndex
      || a.frame - b.frame
    );
  }
  const events = collectActionMarkers(spec.actions, spec.durationMs, library);
  return events.sort((a, b) => a.timeMs - b.timeMs || a.actionIndex - b.actionIndex || a.frame - b.frame);
}
