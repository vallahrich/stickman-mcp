# Stickman MCP roadmap

The current `0.1.0` MVP is the baseline: one original geometric actor, six
versioned actions, a deterministic shared playhead, SVG/self-contained HTML,
local CLI and stdio MCP adapters, strict validation, and an explicitly bound
rightward two-hand prop push. The roadmap is intent, not a promise or a claim
of visual qualification.

## Repository synchronization

Development is canonical in the private
[`t-vwallerich_microsoft/stickman-mcp`](https://github.com/t-vwallerich_microsoft/stickman-mcp)
repository. The private
[`vallahrich/stickman-mcp`](https://github.com/vallahrich/stickman-mcp)
repository is mirrored manually with `git push vallahrich` (non-forcing),
because Enterprise policy disables GitHub-hosted Actions runners for the
corporate repository; the former mirror workflow was removed. See the mirror
instructions in the README.
## Next stages

**Motion catalog: 100 most-used motions.** The
[motion catalog plan](motion-catalog-plan.md) lists the 100 target motions by
family, their status and the wave each one is built in. Motions ship only at a
user rating of 8/10 or higher; chaining across slides comes after the catalog.

### AI motion authoring: current limits and intended direction

The runtime is a deterministic rig, sampler and renderer, not a trained
text-to-motion or video-generation model. AI currently assists offline
authoring: an agent writes timed pose keys, contact targets and prop events,
then builds and inspects the rendered result. FK/IK, interpolation and quality
gates enforce mechanical constraints; they do not establish natural human
movement. User scores are catalog decisions, not model-weight updates.

Catalog approval is also distinct from runtime integration. Reviewed clips
must be explicitly promoted and assembled into the runtime library; a rating
in the catalog plan alone does not make a new verb available through MCP.
Cross-slide chaining, add-on integration and general novel-motion generation
still need their own end-to-end qualification.

Authored traveling loops declare `strideLength` in engine local units per
complete cycle. The sampler carries this translation across repeats for the
body and contact targets, including interpolation through the wrap. Build
gates inspect the last-to-first boundary as well as the interior frames.
Review playback preserves accumulated travel; `motions:shots` accepts frame
numbers beyond one cycle for loop-seam inspection. This does not promote an
unapproved motion or replace a legacy baseline automatically.
Review props honor authored `review.prop.color`: boxes use the color as their
fill and ladders as their rail/rung stroke, keeping the figure visually distinct.
Door entrance previews may bound aperture occlusion with
`review.prop.clipFigureFrom` (inclusive) and `clipFigureUntil` (exclusive).
Omitting the latter preserves permanent exit clipping; releasing entrance
clipping does not remove or fade the door.

A complete forward roll is currently withheld for a rig limitation, not
approved merely because joint gates pass. The rendered head center is
normalized to one head radius from the shoulder, so the current straight
torso/head geometry cannot express a supported inverted shoulder roll with
both head-floor clearance and no head/torso intersection. Qualifying this
motion requires an explicit head/neck and support-model extension that
preserves approved silhouettes, rather than floating the actor or accepting
head contact. `gates.headFloor: true` adds a rendered-head-outline floor gate.
It is opt-in so existing approval builds retain their established checks;
strict head-floor auditing exposed penetration in the approved fall-get-up
clip, which needs separate visual requalification before altering that motion.

The intended authoring architecture combines learned motion proposals with
deterministic playback, rather than replacing the renderer with generated
video:

1. Retrieve suitable approved motion examples and support/contact patterns
   from a structured, versioned library before proposing a novel sequence.
2. Use a learned motion generator or pose tracks extracted from explicitly
   authorized reference footage to propose timing and joint trajectories.
   Retarget these proposals onto the fixed stickman rig; reference acquisition
   and any external upload require an explicit data/provider decision.
3. Repair contacts and interactions in world space. Evaluate complete stance
   drift, support transfer, collision, grip, continuity and prop-release timing
   on the actual rendered output, not just authored angles.
4. Render and visually critique at normal speed as well as inspect key frames.
   Compare candidate alternatives; reject mechanically valid but unnatural
   movement rather than relaxing constraints.
5. Preserve approved examples, rejected versions, scores and specific
   corrections as an evaluation corpus. Retrieval can reuse this evidence
   without training. A later learned ranker or fine-tuning experiment requires
   sufficient licensed data, a held-out evaluation set and a demonstrated
   improvement before adoption.

These are planned capabilities, not implemented learning or a guarantee of
perfect motions. Success means a new request produces a readable, controllable
motion with fewer manual reworks, while preserving actor identity, exact
contacts, editable props and repeatable presentation playback.

**Add-ons: props that appear, get used and disappear.** Many motions only read
clearly with an object, for example the light bulb for `idea`, the desk and
monitor for `type-at-desk`, the door, a watch, glasses or boxing gloves. Sport
and action motions especially need them. Add-ons follow one lifecycle, so the
stickman can stand alone on a slide, act, and be alone again:

1. **Appear:** the add-on pops in from nothing (scale 0 → 110% → 100% over
   about 8 frames, with a small puff), fades in, or slides in. The stickman is
   already there.
2. **Use:** the motion interacts with it. A held add-on is attached to a hand
   or foot until a release frame. A thrown or kicked add-on then follows a
   ballistic arc to a target add-on (goal, hoop or target), which reacts (net
   bulge, swish).
3. **Celebrate (optional):** chain an approved reaction such as `cheer` or
   `fist-pump`.
4. **Disappear:** add-ons fade and shrink, or move away (a door tips forward
   slightly and fades), leaving the stickman alone.

The stickman stays black. Add-ons get flat, readable colours (orange
basketball, black-and-white football, red-and-white hurdle, wooden door, yellow
bulb), with a theme override for corporate colours. First sport and action
set: `hurdle` (a hurdle appears; run, clear it, land), `kick-ball` (football
and goal; kick into the net, then celebrate), `throw-ball`, `throw-spear`,
`basketball-shot` (ball into a hoop) and `throw-card` (a presentation card
thrown onto the slide). In the MCP, an action names its add-ons, for example
`{do:"kick", prop:"football", target:"goal"}`, and the runtime handles the
appear, use and disappear steps.

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
