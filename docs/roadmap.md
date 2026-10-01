# Stickman MCP roadmap

The current `0.1.0` MVP is the baseline: one original geometric actor, six
versioned actions, a deterministic shared playhead, SVG/self-contained HTML,
local CLI and stdio MCP adapters, strict validation, and an explicitly bound
rightward two-hand prop push. The roadmap is intent, not a promise or a claim
of visual qualification.

## Repository synchronization

Development is canonical in the private
[`t-vwallerich_microsoft/stickman-mcp`](https://github.com/t-vwallerich_microsoft/stickman-mcp)
repository. A push workflow mirrors matching branches and tags to the private
[`vallahrich/stickman-mcp`](https://github.com/vallahrich/stickman-mcp)
repository. Sync uses a mirror-scoped deploy key, pins GitHub's Ed25519 host
key, and refuses non-fast-forward rewrites; failed syncs must be resolved
before treating the mirror as current.

## Next stages

1. **Choreography and motion:** broaden tested transitions, pacing, locomotion,
   and facing; specify phase and contact semantics before adding verbs. Keep
   normal, reduced, and static outcomes deterministic and meaningful.
2. **Props and interactions:** add explicitly modeled grip points, prop
   geometry, routes, and release/contact validation. Add carry, pull, or other
   interactions only when their constraints and failure diagnostics are real.
3. **Actors and presentation:** define a versioned rig/profile extension
   boundary, then support additional independently constructed geometric
   actors without coupling animation documents to renderer internals.
4. **Library and integrations:** stabilize the public contract and SDK
   ergonomics, document compatibility, and add client examples. Keep CLI and
   MCP as thin adapters over the same compiler and runtime.
5. **Quality promotion:** add visual regression fixtures and browser/playback
   review across actions, boundaries, replay, accessibility modes, and export
   targets. Publish explicit support/qualification evidence; compilation and
   unit tests alone are not visual or production approval.
6. **Export:** keep SVG/HTML self-contained and reliable; exercise GIF/MP4
   rasterization and FFmpeg encoding on supported platforms, including codec,
   dimension, frame-rate, cancellation, and cleanup cases. Report missing
   optional tools clearly rather than silently changing output.

## Public references

These are research pointers for capabilities and design trade-offs, not
implementation or asset sources:

- [Rive bones](https://rive.app/docs/editor/manipulating-shapes/bones),
  [IK constraints](https://rive.app/docs/editor/constraints/ik-constraint),
  and [state machines](https://rive.app/docs/editor/state-machine/state-machine)
  illustrate rigging and state-machine concepts.
- [SVG animation](https://developer.mozilla.org/en-US/docs/Web/SVG/SVG_animation_with_SMIL)
  and [reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
  document browser-facing output and accessibility considerations.
- [FFmpeg documentation](https://ffmpeg.org/documentation.html) describes
  the external encoder used for optional video formats.

No third-party character art, reference artwork, traced derivatives, or
external project source is included or authorized by these links. Any future
asset must have independently documented provenance and distribution rights.
