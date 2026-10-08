# Stickman MCP roadmap

The current `0.1.0` MVP is the baseline: one original geometric actor, six
versioned actions, a deterministic shared playhead, SVG/self-contained HTML,
local CLI and stdio MCP adapters, strict validation, and an explicitly bound
rightward two-hand prop push. The roadmap is intent, not a promise or a claim
of visual qualification.

## Repository synchronization

Development is canonical in the private
[`vallahrich/stickman-mcp`](https://github.com/vallahrich/stickman-mcp)
repository. The former corporate copy `t-vwallerich_microsoft/stickman-mcp` is
retired: no mirroring in either direction.
## Continuous film composition phases

1. **Phase 1 — Composer in the MCP: done.** Strict JSON recipes, approved film
   asset discovery, shared showcase/MCP continuous composition, actor and lead
   continuity reports, confined MP4/poster/VTT/QA export and fast previews.
   See [film recipes](film-recipes.md). Mechanical gates do not constitute new
   visual approval or universal text-to-motion generation.
2. **Phase 2 - Automatic transitions / join matrix: done.** Approved motion pairs
   have a deterministic, film-scale join-cost matrix (`motions:joins`). MCP recipes
   default to bounded generated pose-space bridges; results identify each bridge
   and its before/after cost. `stickman_check_join` reports pair cost and a suggested
   bridge length. See [film recipes](film-recipes.md) and `bridge-demo.json`.
3. **Phase 3 — Faster pose authoring.** Reusable pose library with an explicit
   human approval gate before any authored motion becomes a film asset.
4. **Phase 4 — Groups & contact.** Formation/crowd/follow, hand contact and
   controlled variation without breaking per-actor continuity.
5. **Phase 5 — Speed & QA loop.** Faster previews, sampled visual checks and
   an iterative report/fix/review cycle for complete films.

## Next stages

**Presentation-first audience:** prioritize IT and digital servicesâ€”cloud
architecture, infrastructure, cybersecurity, operations and service workflows.
The local designer gallery shows approved review versions, searchable categories,
lazy accessible previews and client setup, separately from the runtime library.
The active showcase is limited to the on-premises-to-cloud slide and two
stickman story videos, each at most one minute. The videos explain an open-source
contribution journey and Julius Caesar's life/legacy in under a minute each,
replacing the workplace/personality compilations. NIST and NASA presentation
experiments and their generated downloads have been removed. The slide keeps
substantive comparison and decision evidence readable while a smaller actor
supports the story. Each video is a silent full-frame short staged as one
continuous performance under a locked camera: newer approved key-pose motions
joined by eased blends and generated walks, a per-frame continuity gate, short
burned-in text cues and overlays that appear only while used, not slide
layouts, camera push-ins or legacy fixtures.
Source-spec and encoded-media fingerprints prevent ambiguous motion versions
and stale cached videos. These authored films do not establish
universal story generation or arbitrary seamless choreography.
Three reusable runtime recipes connect travel, gestures, prop movement and
host content cues through `stickman_story` and the library's `composeStory`.
The first combined-story visual treatment received a user **2/10** rejection.
It is not a presentation-quality milestone. The revised visual candidate
prioritizes a slide takeaway and visible changes to request flow, failover
routing and the release gate, with presenter-controlled explanation beats.
New visual approval is still required; passing runtime checks is insufficient.
The next presentation-quality gate uses actual source slides rather than generic
story examples. A [local PPTX-to-HTML path](offline-presentations.md) preserves
source notes/media and uses explicit presenter-controlled beats, with no actor
over a running demo. Representative pilot review normally precedes full-deck
expansion; the user's subsequent explicit instruction to complete autonomously
authorized expansion of the revised object-interaction candidate, not a new
quality score or template approval. Private source material and derived HTML are not repository
examples, gallery assets or mirror content. This is not universal conversion or
an automatic animation-authoring capability.
Development feedback rejected the retired IT comparison (**1/10**) and the
actual three-slide source-deck HTML pilot (**2/10**). Neither treatment is an
approved template. The rejected treatment was reworked with real push,
laptop-opening and carry props, delayed released-data handoff, explicit diagram
reveals and uninterrupted source recordings. The full local conversion adds
source-image focus/enlargement, exact original resource links, complete
slide/media fidelity checks and a genuinely blank ending. It remains an
unqualified development candidate, not a published gallery template.
The default release-style catalogue is rating-free across UI, JSON and preview
downloads; scores and review history belong only in development. The separate
development build retains 98 historical approvals; the release-style build has
97 entries because `sneak` needs mechanical requalification.
Public deployment remains a separate readiness decision: qualify the remaining
motions, runtime promotion, complete-scene composition, client compatibility,
source notices and dependency remediation before publishing. Current dependency
audit findings must not be waved away by the new gallery.

**Motion catalog: 100 most-used motions.** The
[motion catalog plan](motion-catalog-plan.md) lists the 100 target motions by
family, their status and the wave each one is built in. Motions ship only at a
user rating of 8/10 or higher during development. Building a catalogue and
qualifying complete story sequences proceed together; arbitrary cross-slide
continuity remains further work.

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
The compiler already supports ordered actions and transition blending in some
playback paths. Blending individual joint endpoints is not a general guarantee
of fixed limb lengths, planted feet or persistent prop grips across a new
combination. A contact-aware composition pass and complete-chain review remain
necessary before claiming arbitrary seamless choreography.

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

Review previews now include distinct laptop, tablet, magnifier, notebook and
pen shapes, with a hinged laptop lid, animated notebook writing and hand-grip
anchors. Placement, color, rotation, scale and lifecycle work in static shots,
live reviews and the standalone stage kit. See the
[motion factory](../motions/README.md#review-props) for authoring details.
This is review infrastructure; the corresponding IT motions still require
individual authoring, user approval and separate runtime integration.
Opted-in video-call desks now show an arm-free participant bust with a gentle
nod, while sampled headphones track the caller's rendered head. Frustration
previews can use an original anger-vein ideogram with jagged agitation lines
instead of a thought bubble; these are editable vector props, not generated
video or copied reference artwork.

Hardware previews likewise include a flexible cable with independently
animated plug, a socket, a multi-unit server rack with a separate module, and
a titlebar/content window with a cursor. These enable real contact-based
plugging, module extraction and UI dragging rather than generic rectangles.
Their individual motion candidates and runtime integration remain separate.

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
   corrections as an evaluation corpus, tied to immutable motion versions.
   Distinguish semantic readability (for example, frustration versus thinking)
   from timing, contact quality and prop clarity; retain qualitative feedback
   without inventing a numeric score. Retrieval can reuse this evidence
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

1. **Appear:** the add-on pops in from nothing (scale 0 â†’ 110% â†’ 100% over
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
