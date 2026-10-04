import type { AnimationSpec, MarkerEvent } from "./contract.js";
import type { MotionClipLibrary } from "./motion-clips.js";

/**
 * Timed motion markers (e.g. a keystroke, a reveal, a card placement) so a host page
 * can sync slide content to the stickman. Mirrors the clip timing used by sampleClipMotion.
 */
export function markerEvents(spec: AnimationSpec, library: MotionClipLibrary): MarkerEvent[] {
  const events: MarkerEvent[] = [];
  const actions = [...spec.actions].sort((a, b) => a.startMs - b.startMs);
  actions.forEach((item, actionIndex) => {
    const clip = library.clips[item.action];
    const markers = clip?.markers ?? clip?.meta?.markers;
    if (!clip || !markers || item.durationMs <= 0) return;
    const n = clip.frames.length;
    const travels = !clip.poseKeys?.length && (clip.meta?.travel === "travel" || item.action === "walk" || item.action === "run");
    if (n < 2 || travels) return;
    const speed = Math.max(0.5, Math.min(2, item.speed ?? 1));
    const end = item.startMs + item.durationMs;
    const push = (marker: string, frame: number, progress: number): void => {
      if (progress < 0 || progress > 1 + 1e-9) return;
      const timeMs = Math.round(item.startMs + progress * item.durationMs);
      if (timeMs <= Math.min(end, spec.durationMs)) events.push({ timeMs, actionIndex, action: item.action, marker, frame });
    };
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
  });
  return events.sort((a, b) => a.timeMs - b.timeMs || a.actionIndex - b.actionIndex || a.frame - b.frame);
}
