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
before treating the mirror as current. GitHub-hosted Actions runners are
currently disabled for the corporate repository by Enterprise policy, so the
workflow cannot run there yet. Until an administrator enables runners, each
version must be pushed to both remotes explicitly; see the mirror instructions
in the README.

## Next stages

**Scripted motion milestone: provisionally accepted V7.**
The [scored development cycle](motion-quality-plan.md) replaced the rejected
approximately 3/10 coordinate-motion baseline with fixed-length FK/IK,
world-space foot plants, run flight, supported turns and loaded push mechanics.
Independent review scored V7 **8.27/10 normal and 8.155/10 at native 48px**;
every reviewed action/chain reached at least 8.0, and run -> jump -> point
scored 8.4/8.3. These are bounded judgments, not industry certification.

The final local suite has 259 passing tests across 14 files, plus build and
type checks. Representative MP4/GIF outputs were fully decoded. The tool-driven
browser was RAF-throttled, so unthrottled realtime playback still needs viewing
in the intended presentation environment. The original 2.5D room/controller is
an **experimental preview**, outside the scripted score, without a new room-scene
MCP authoring/export contract. Retain the quality gate for further milestones:
weighted version scores above 8, no reviewed action/chain below 8, and an
architecture checkpoint below 5 rather than cosmetic tuning.

Completed groundwork includes target-inferred v1 facing, staged rightward push,
and push reach after preceding locomotion. The local stdio MCP adapter also
enforces advertised argument schemas, supplies structured result/output schemas,
distinguishes protocol and execution errors, and has actual client/transport
regression coverage. See [MCP setup and verification](mcp-setup.md) for connection
instructions and explicit limits; this is not certification of every MCP client.

1. **Choreography and motion:** current v1 infers facing for walk, run, and
   point from existing target coordinates and stages rightward push as approach,
   contacted travel, and release. Broaden tested transitions, pacing, and
   locomotion; specify phase and contact semantics before adding verbs. Keep
   normal, reduced, and static outcomes deterministic and meaningful.
2. **Props and interactions:** add explicitly modeled grip points, prop
   geometry, routes, and release/contact validation. Add carry, pull, or other
   interactions only when their constraints and failure diagnostics are real.
3. **Actors and presentation:** define a versioned rig/profile extension
   boundary, then support additional independently constructed geometric
   actors without coupling animation documents to renderer internals.
4. **Library and integrations:** stabilize the public contract and SDK
   ergonomics and verify documented connections in the intended Copilot clients.
   Evaluate long-export cancellation/progress and any SDK/protocol migration
   separately against actual client support. Keep CLI and MCP as thin adapters
   over the same compiler and runtime; HTTP/OAuth and resources/prompts require
   an identified use case rather than being mandatory local-server features.
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
