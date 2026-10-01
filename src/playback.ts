import type { CompiledAnimation, PlaybackMode, SampledFrame } from "./contract.js";
import { sampleAnimation } from "./compiler.js";

export interface PlaybackSnapshot {
  frame: SampledFrame;
  playing: boolean;
  cancelled: boolean;
  generation: number;
}

export class PlaybackSession {
  private position = 0;
  private playing = false;
  private cancelled = false;
  private generation = 0;

  constructor(private readonly program: CompiledAnimation, private mode: PlaybackMode = "normal") {}

  snapshot(): PlaybackSnapshot {
    return {
      frame: sampleAnimation(this.program, this.position, this.mode),
      playing: this.playing,
      cancelled: this.cancelled,
      generation: this.generation
    };
  }

  play(): PlaybackSnapshot {
    if (this.cancelled) return this.snapshot();
    if (this.position >= this.program.spec.durationMs) this.position = 0;
    this.playing = true;
    return this.snapshot();
  }

  pause(): PlaybackSnapshot {
    this.playing = false;
    return this.snapshot();
  }

  seek(timeMs: number): PlaybackSnapshot {
    if (!Number.isFinite(timeMs)) throw new TypeError("Playback seek must be a finite number.");
    this.position = Math.max(0, Math.min(this.program.spec.durationMs, timeMs));
    this.generation++;
    return this.snapshot();
  }

  advance(deltaMs: number): PlaybackSnapshot {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError("Playback advance must be a finite non-negative duration.");
    if (this.playing && !this.cancelled) {
      this.position = Math.min(this.program.spec.durationMs, this.position + deltaMs);
      if (this.position === this.program.spec.durationMs) this.playing = false;
    }
    return this.snapshot();
  }

  setMode(mode: PlaybackMode): PlaybackSnapshot {
    this.mode = mode;
    this.generation++;
    return this.snapshot();
  }

  cancel(): PlaybackSnapshot {
    this.cancelled = true;
    this.playing = false;
    this.generation++;
    return this.snapshot();
  }
}
