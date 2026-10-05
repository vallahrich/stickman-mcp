# Motion-quality rebuild and development cycle

## Status and honest baseline

The user rejected the visual result at `5ced65d`. That rejection supersedes the
earlier "build complete" statement as a visual-quality claim. The MCP connection,
argument contracts, determinism checks, and working encoders are useful
infrastructure, not evidence that the character or movement is publishable.

The baseline is a provisional **3/10 for the intended clean 2D stick-figure
style**, not a movie-industry certification. Evidence:

- During a wave, the upper-arm length ranges from 22.00 to 33.30 units: about
  one-third shortening. Connected endpoints do not mean a valid skeleton.
- At a left-run turn midpoint, root, shoulder and elbow all have the same x
  coordinate. Interpolating a facing multiplier through zero flattens the rig.
- A genuinely grounded walk foot stays at y=290 but moves from x=325.64 to
  x=324.24 over 20 ms. It slides rather than remaining planted.
- The jump sampler changes `groundY` from 290 to 238. Standalone frame rendering
  uses that value as the floor, whereas other outputs hold the floor still.
- Push poses use averaged elbow locations, an almost imperceptible torso lean,
  nearly coincident hands, and a stance that can be hidden by the prop.
- Existing tests largely prove output consistency, not weight, believable
  support, proportions, silhouette, or the distinction between walking/running.

No further transport work, extra verbs, or decorative fixes substitutes for
correcting those causes.

## Visual target and scope

The user was unavailable for the style question. Use the recommended assumption:
an original, clean presentation-style figure with natural, grounded motion,
readable poses, moderate expressiveness, a consistent circle head, round strokes,
and an adult-like balance of head/torso/leg proportions. This remains subject to
visual review; do not claim the user approved a particular character drawing.

Keep one actor and the existing six actions: walk, run, wave, point, jump and
rightward push. Preserve `stickman.animation/v1` authoring fields, safe outputs,
local stdio MCP, and the corporate-to-private-mirror publication setup.
No public release, copied character assets, general physics simulation, new
authoring fields, HTTP/OAuth migration, or multi-actor scope.

### Explicit product acceptance: natural human-like movement in a deck

The user clarified that natural human-like movement is the priority, and the
intended workflow is: tell the MCP agent to create a small stickman in a website
or animation deck, run from a start location to a destination, jump at that
destination, then point at a particular element. This is not satisfied merely
by an attractive standalone animation preview.

For the motion cycle, include `run -> jump at arrival -> point at highlight`
as a representative acceptance sequence, reviewed both at full size and at
approximately 48-80 CSS pixels of character height. Human-like means readable
weight transfer, coordinated reciprocal limbs, plausible arrival braking,
anticipation, flight, landing absorption, gaze/body intention and pointing.
A mathematically correct robotic pose must still score below the bar.

For actual website/deck wiring, keep a separate explicit integration gate:
resolve approved DOM/slide anchors into one local animation coordinate system,
mount a transparent overlay without blocking slide interaction, map CSS resize
and device scale correctly, respect reduced motion, and expose deterministic
play/pause/seek/cancel/cleanup hooks driven by the deck timeline. A client agent
can translate a natural-language request into validated v1 data; the server must
not execute arbitrary authored JavaScript or silently edit an unrelated website.
The current v1 contract can express running to a target, an in-place jump
there, and pointing to another target without adding new action fields.

Do not claim DOM target resolution, transparent deck mounting or deck-clock
integration are already delivered by the current self-contained preview.
Validate them against the actual intended website/deck before declaring that
end-to-end product workflow complete. The current repository remains an
animation engine/MCP server; no TemplatePresentation edits are authorized.

## Definition of publishable for this milestone

The latest user instruction sets the **version's weighted score over 8/10**,
at normal and intended miniature size. Retain the original **minimum 8/10 per
reviewed action/chain**, so weak cases cannot be hidden by an average. An exactly
8.0 overall version does not pass. A separate all-rows-strictly-over-8 stretch
target was used during review but was not the user's stated completion rule;
do not inflate unchanged 8.0 rows or claim that stretch result was achieved.

Each action and representative transition must score at least **8/10** in the
style above. A score is a documented expert judgment supported by clips,
frame inspection and numerical evidence; it is not an automatic certification.
Passing unit tests alone contributes no visual-quality points.

The user additionally requires an **architecture checkpoint below 5/10**.
Re-evaluate the motion engine, rendering framework, and technology stack rather
than tuning the same failed model indefinitely. Compare a corrected original
FK/IK/contact-aware core with an authored-rig alternative using the same walk
and push scene. A pivot may be a replacement of the motion authority within
TypeScript/SVG, or an external runtime if the evidence justifies its asset,
determinism, export, licensing and operational tradeoffs. The baseline already
triggers this checkpoint.

The initial independent checkpoint recommends a **representation pivot**:
replace the coordinate-wiggle sampler with a skeletal/contact-aware core while
retaining TypeScript/SVG provisionally. Renderer changes alone cannot fix
stretching or foot skating. This does not prove the new motion is good by
construction; original pose authoring and visual grading remain mandatory.
If the corrected candidate still scores below 5, compare the same action/grip
scene against an authored-rig alternative before committing to another rewrite.

The relevant mechanisms are documented in the official
[Rive IK constraint guide](https://rive.app/docs/editor/constraints/ik-constraint)
and [Unity two-bone IK guide](https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.2/manual/constraints/TwoBoneIKConstraint.html).
They support bone-chain targets and explicit bend hints; they do not establish
that changing to those runtimes automatically provides natural motion.
Rive's arbitrary-order seeking, runtime property access, editor/export terms
and compatibility with the required SVG/offline pipeline remain verification
gates for any actual adoption.

| Dimension | Weight | What reviewers must actually inspect |
|---|---|---|
| Character design and silhouette | 15% | Proportions, limb separation, readable hands/feet, consistent line weight and framing |
| Skeleton and pose integrity | 20% | Fixed bones, plausible hinges, no torso/head disconnection, stretching or turn collapse |
| Grounding and weight | 20% | Planted-foot stability, weight shift, foot clearance, walking support and running flight |
| Timing and choreography | 15% | Anticipation, acceleration, readable holds, follow-through, settling and transitions |
| Gesture/prop mechanics | 15% | Clear wave/point, reachable grips, leg/prop clearance, force/posture and release |
| Presentation/export consistency | 10% | Same actor and poses across SVG/HTML/video, clean composition and usable playback |
| Determinism/accessibility | 5% | Replay/seek parity, stable reduced/static states and clear controls |

The overall score is the weighted result, but an average cannot hide a poor
action: the minimum action score must also be at least 8. Any hard failure below
blocks approval regardless of average.

### Hard gates

- Fixed bone lengths: relative numerical error at most 0.1%; no coordinate
  interpolation that changes limb length.
- Grounded stance: cumulative foot drift at most 0.25 px at the reference size;
  no foot below the floor except numerical rounding.
- Stable world ground during jump; the body moves, not the floor.
- Real running flight: documented windows with neither foot in ground contact.
- Hand contact during prop drive within 0.25 px; no prop motion before contact
  or after release, and no silent clamping of unreachable contact.
- No flattened turns, reversed knee/elbow pops, unwanted body/prop intersection,
  clipped head/limbs, or accidental disappearance behind drawing layers.
- Same time/document gives the same pose regardless of prior sampling order.
- Runtime/type/build/protocol regressions remain green.

These thresholds are proposed acceptance criteria, not statements about the
rejected version.

## Architecture: fix the motion authority, not the MCP wrapper

Use a real constant-length 2D skeleton with local joint rotations and explicit
world-space contact targets. Forward kinematics positions the skeleton.
Analytic two-bone inverse kinematics solves feet and hands during contact.
Author original poses/curves for actions rather than independently wiggling
joint coordinates.

The authoritative flow is:

`v1 data -> validated motion plan -> root path + pose curves + contacts ->
fixed-length FK/IK pose -> shared SVG/HTML/video rendering -> CLI/MCP`

Keep the existing SVG renderer as an output backend. GSAP would provide tweening,
not a rig or planted feet; a renderer replacement would not solve these defects.
Rive or another authored-rig backend is a separate decision only if the
original procedural rig cannot meet the visual target. Do not adopt a new
runtime, asset pipeline, or vendor license merely to make the diagram more
impressive.

### Rig design

- Specify pelvis, hip attachments, torso, shoulders, neck/head, upper/lower arms,
  thigh/shin, ankles and readable feet.
- Use fixed lengths, joint limits and explicit bend directions.
- Design a neutral pose and original key poses before adding more motion.
- Make near/far limbs distinguishable through restrained styling and draw order,
  not invisible limbs or an opaque prop covering incorrect geometry.
- Use actual torso rotation for lean, not a tiny arbitrary shoulder translation.
- Turn through authored body/limb poses; never multiply all x offsets by a
  continuous sign that passes through zero.
- Keep a world ground plane separate from pelvis/body height.

### Motion planning

- Compute action-start/end state from the timeline once, not from previous
  rendered frames.
- Tie gait cadence/stride to actual root travel and requested duration.
- Plan foot placements and stance/swing intervals explicitly. A planted foot
  has a fixed world anchor; a swinging foot follows a lift/forward/place arc.
- Blend joint rotations and root curves, then enforce active contact constraints.
  Do not blend bone endpoints independently.
- Define starts, stops and direction changes as part of the clip, avoiding a
  rigid reset to a generic standing pose between touching actions.
- Reject infeasible speed/reach/clearance with actionable diagnostics; do not
  stretch limbs, teleport, change timing silently, or discard target coordinates.

## Detailed action work

| Action | Correct structure | Required visual evidence |
|---|---|---|
| Walk | Weight shift, heel/contact, support, passing, toe-off, swing and placement; distance-based steps; controlled start/stop | Both directions, short/long routes, slow/normal pace, close-up planted feet and full-body loop |
| Run | Faster root travel, forward torso lean, reciprocal arms, compression, push-off, genuine flight, landing and recovery | Clearly different from walk, both-feet-airborne frames, stable landing and deceleration |
| Wave | Shoulder raises, elbow bends, forearm/wrist gesture, readable pause, restrained repetition and return | Fixed arm lengths, no head collision or windscreen-wiper whole-arm oscillation |
| Point | Preparation, arm extension toward the target, readable hold, small follow-through and retract | Plausible elbow, visible direction, target above/below/either side, no arm through torso |
| Jump | Anticipation/crouch, extension/takeoff, flight, landing compression and settle | Stationary floor, believable arc, planted takeoff/landing feet, no sliding/floating endpoint |
| Push | Feasible approach/stance, grip, body hinge and weight shift, stepping drive, brake, release and recovery | Hands stay on grip, actor stays outside prop, both legs are readable, force is apparent |

The current fixed 15/70/15 push phases are not a substitute for these mechanics.
Preserve the contact-before-travel guarantee, but permit phase timing to be
derived internally from feasible poses instead of preserving a bad pose
because a test expects a particular percentage.

## Ordered implementation and review gates

### Keyboard/gameplay testbed

The user proposed learning from video-game locomotion and steering the actor
with the keyboard. Add a focused controller testbed: arrows/A/D for travel,
Shift for running, Space for jump, and a pointing trigger. Listen only while
the explicitly focused playground owns input; do not capture keys globally
from the deck or browser UI. Release keys on blur, and respect reduced motion.

Separate input intent from animation pose generation. Both keyboard and
MCP-authored choreography must use the same skeleton, contact mechanics,
transition planning and renderer. Do not build a second physics/pose system
whose good-looking demo hides a bad MCP result.

Evaluate start latency, stop/braking response, repeated taps, held input,
opposite-direction changes, moving-to-jump, landing-to-move, bounds, and cleanup.
Record any prototype limitations such as jumping only from a stopped stance.
A keyboard playground is a diagnostic/interactive integration surface, not
permission to replace the data-only v1 contract with arbitrary game scripts.

### Clarified target: 2D character in a room with depth

The user clarified "2D in 3D": a flat character walking around a room, rather
than a side-on actor confined to one horizontal screen-space floor. This is a
**2.5D world/character separation**, not permission to copy game sprites or
replace the character with a fully modeled 3D mesh.

The camera preference question was unanswered. Use an **orthographic angled/
isometric room** as the explicit working assumption; a perspective camera can
be substituted behind the same world/projection boundary if later requested.
Do not describe this camera choice as user-confirmed.

The world owns horizontal room coordinates **X/Z**, vertical height **Y**,
floor support, room bounds, obstacles, and named world anchors. Projection
maps those coordinates to the browser. The original 2D rig remains upright
and readable as a billboard/paper character. Rendering must depth-sort it
with furniture/walls, so it can go behind or in front of objects rather than
floating above every layer. Diagonal movement must be normalized; walking
toward/away from the camera must change its screen position consistently.

This clarification supersedes the horizontal-only controller API as the final
gameplay target. Preserve reusable focus/lifecycle and shared rig work, but
freeze the controller/world API before extending one-axis motion further.
The old flat-floor v1 animation contract remains supported; room authoring
must be a distinct explicit contract/integration surface if exposed through
MCP, not secretly reinterpret existing `targets.x/y` as 3D coordinates.

Room acceptance adds:

- Arrow/WASD movement across both world axes, normalized diagonals, collision/
  bounds and responsive intention changes.
- Stable floor contacts in world coordinates, not feet dragged by separately
  moving a sprite over the room.
- Jump height along world Y, landing at a feasible support position, and
  pointing toward a projected room/deck anchor.
- Occlusion at furniture/walls and consistent billboard scale/projection.
- The same small-scale human-natural motion score, >=8 per representative
  action/chain; keyboard/controller scores below 5 still trigger architecture
  review.

First implement a bounded original room and one controllable original figure;
not camera navigation, combat, a game asset pipeline or arbitrary physics.
Three.js is an option if real perspective meshes/lights/camera controls become
requirements. Isometric SVG/canvas can represent actual world depth, collision
and sorting without adopting a separate animation authority. Choose on required
behavior and measured prototype evidence, not the "3D" label alone.

### Gate A: character and skeleton

Deliver the neutral original character, connected skeleton, readable feet,
constant bone lengths, two-bone solver tests, and a pose sheet. Review at normal
presentation size, not only a large debug viewport. Correct proportions and
layering before judging motion. A collapsed, stretched, disconnected or
unreadable rig does not proceed.

### Gate B: walking is the first visible quality proof

Deliver right/left walking, start/stop and a turn on the new rig. Compare the
rejected and corrected clips at normal speed, slow playback and phase frames.
Check foot plants, weight transfer, pelvis/shoulder motion, cadence and silhouette.
Do not broaden to the other actions until walking reaches 8/10.

### Gate C: running and jumping

Build on the accepted rig/contact planner. Confirm run flight and landing,
and jump anticipation/landing with a fixed floor. Reject "walk with faster
wiggles" and "translate the entire actor on a sine wave" as acceptable results.

### Gate D: gestures and interaction

Author wave/point poses and constrained push mechanics. Re-author demonstration
placements if the old example is physically infeasible; do not silently relocate
the user's authored actor. Expose infeasibility with diagnostics and updated
examples. Review grips, body/prop clearance, feet and torso weight.

### Gate E: transitions and output parity

Review idle-to-walk, walk-to-run, walk-to-point, walk-to-wave, walk-to-push,
jump-to-idle and both direction changes. Verify one deterministic pose authority
for library, preview, animated SVG and encoded frames.

### Gate F: final publishability matrix

Recheck every action, representative sequence, both directions where supported,
canvas bounds, replay/seek, reduced/static modes and optional encoders.
Record the scorecard, evidence and remaining limits. Only claim the milestone
complete if all action scores and the overall score are at least 8 and the hard
gates pass.

## Concrete file boundaries

| Area | Files/surfaces | Responsibility |
|---|---|---|
| Input/compiler integration | `src\compiler.ts`, `src\contract.ts` only if an approved typed internal representation requires it | Validation, start/end states, diagnostics, stable public v1 input |
| Rig/kinematics | Planned `src\rig.ts`, `src\kinematics.ts` or initial self-contained equivalents | Fixed lengths, FK, two-bone IK, joint/contact invariants |
| Motion/contacts | Planned `src\motion.ts`, `src\contacts.ts` or initial self-contained equivalents | Root curves, stride planning, clip poses, ground and grip targets |
| Renderer/runtime | `src\render.ts`, browser runtime/build surface if modules are extracted | Neck/pelvis/feet readability, near/far styling, deterministic embedded runtime |
| Examples/catalog | `examples\*.json`, `src\catalog.ts` | Feasible original scenes and honest capability descriptions |
| Tests | New kinematics/locomotion/contact tests; existing core/render/MCP/export tests | Numerical correctness, meaningful regressions, real browser/export review |
| Evidence/scorecards | This document and session artifacts | Version scores, clips/screenshots, defects and next iteration |

Do not introduce external runtime helpers into the current
`sampleAnimation.toString()` HTML path. Either keep the first corrective sampler
self-contained or implement a trusted build-time browser bundle from the shared
core when extracting modules. Never maintain a separate browser approximation.

Preserve public output shapes and required segment IDs where practical, adding
renderer-only neck/pelvis/foot details from the authoritative pose. If an actual
contract change is necessary, make it explicit rather than silently expanding
the compiled-program or MCP output schema. Previously accepted but impossible
motion may require a documented validation behavior change.

## Bounded agent ownership

Use a small team, not a large factory:

1. Rig/motion developer owns the skeleton, sampler/contact mechanics and
   numerical tests.
2. Coordinator owns renderer readability, example scenes, integration and
   compatibility; writable ownership must not overlap.
3. Independent visual QA reviews actual clips/screenshots and returns honest
   scores/defects. It must not inflate a score to meet the requested threshold.

Freeze shared pose semantics before parallel work. Reuse contributors for
follow-up fixes rather than spawning duplicate teams. No simultaneous writes
to the same compiler or browser page. All coding stays in the corporate
worktree; every coherent private version is mirrored non-forcing.

## Plan -> act -> evaluate loop

For every version:

1. **Plan:** identify the weakest two/three score dimensions and concrete defects,
   choose the smallest coherent correction, and state what should visibly change.
2. **Act:** implement that correction with directly related regression coverage.
   Do not improve the score by removing a bad example or weakening the checks.
3. **Evaluate:** perform numerical tests and inspect real playback, slow motion,
   contact/transition frames and an encoded output as appropriate. Rotate the
   primary focus between rig, gait, timing, interaction and output consistency.
4. **Score:** record per-action and weighted scores with evidence, failures and
   uncertainty. Technical passes are a separate checklist.
5. **Continue:** if any action or the overall score is below 8, fix the largest
   remaining visual/mechanical defects and repeat. No completion declaration
   while a hard gate fails.
   If the score is below 5, perform the architecture checkpoint before another
   implementation cycle; record the keep/pivot decision and evidence.

An isolated child development session was attempted but project-origin
verification rejected creation. Do not modify the established dual-push Git
configuration to work around this. Use bounded subagents in this worktree with
disjoint file ownership; the motion developer owns the compiler/numerical tests,
the coordinator owns renderer/examples/integration, and a separate reviewer
owns visual grading. No implementation agent may change the scorecard to approve
its own candidate.

If a genuine environment/permission blocker prevents inspection, report it
instead of inventing a score. Mirroring is a manual non-forcing
`git push vallahrich` (Enterprise policy blocks hosted runners).

## Version scorecard

| Version | Main focus | Overall | Lowest action | Disposition |
|---|---|---:|---:|---|
| `5ced65d` | Existing coordinate-wiggle baseline | 3/10 provisional | Push/walk below 8 | Rejected; rebuild the rig/motion authority |
| Skeletal candidate V1 | Fixed bones, FK/IK, foot anchors, first authored poses | 7.4/10, approximately +/-0.5 | Push 6.2; sequence 6.4 | Independent QA rejected; improve force silhouette, turns, jump and handoff |
| Human-motion candidate V2 | Distinct grips, taller push posture/longer steps, preload, coordinated turns, jump follow-through | 7.6 normal / 7.3 miniature | Chain 6.7 | Rejected; improve trajectory/intent continuity and miniature mechanics |
| Human-motion candidate V3 | Shared waypoint velocity/contact scheduling, run-to-jump and landing-to-point intention, longer run strides, alternating push loading | 7.76 normal / 7.55 miniature | Shipped push 6.9 miniature | Rejected despite 200 technical checks passing |
| Controller diagnostic V1 | Canonical finite-clip keyboard testbed | 4.6/10 | Response latency | Architecture pivot required |
| Scripted V4 | Centered grips, directed arrival and turn/load refinements | 7.945 normal / 7.735 at 48px | 7.4 | Rejected |
| Scripted V5 | Human pacing and correct near/far readability | 8.035 normal / 7.920 at 48px | 7.7 | Rejected |
| Corrected scripted V6 | Supported load impulses, bounded turn timing, static-reference vector repair | 8.180 normal / 8.065 at 48px | 7.9 | Rejected: pointing/reversal below minimum |
| Scripted V7 | Loaded stepping pivot, dominant pointing/index cue and clear attention | **8.270 normal / 8.155 at 48px** | **8.0** | **Provisional approval for the scripted presentation/video scope** |

Subsequent rows must contain observed results, not anticipated scores.

### Accepted scripted V7 scope and evidence limits

The independent reviewer assessed all 19 frozen scripted scenes at normal
and native 48-pixel size. Every reviewed action/chain met the original 8/10
minimum, and both weighted totals exceeded 8. The requested run-to-arrival,
jump, then point sequence scored **8.4 normal / 8.3 miniature**.

The stronger pivot keeps one supporting foot grounded while the other steps
and changes branch at extension; compression is retained into departure.
Pointing gives the active arm foreground contrast and a restrained index cue.
HTML and representative baked SVG exports agree after replacing animated
references with static references and visibility-based layering.

This is a provisional pose/choreography judgment, approximately +/-0.3-0.4,
not industry certification. The review environment delivered roughly 1-second
RAF intervals even for a focused standalone page; no smooth realtime playback
claim is inferred from that environment. Encoded MP4/GIF files are independently
checked for dimensions, frame count, duration and complete decoding.

**Not approved by this score:** the separate 2.5D room/controller diagnostic,
a new room-scene MCP authoring/export contract, cross-browser certification,
or every possible authored input. Several unchanged miniature rows are exactly
8.0, so "all rows strictly above 8" remains false and is not claimed.

V2's independent final result was **7.6/10 normal and 7.3/10 miniature**.
Its lowest representative chain was 6.7; the miniature run-jump-point fixture
was 7.0. It was rejected, not an accepted release. V3 is addressing those
defects; no score is inferred from its technical checks.

V3's independent final result was **7.76/10 normal and 7.55/10 miniature**.
The miniature acceptance sequence scored 7.3, and the shipped low-crate push
scored 6.9. V3 remains rejected. V4 must make the grip readable, preserve
counterbalance through arrival/jump loading, make reversal support explicit,
and improve left-run silhouette. The technically verified vector export did
not increase the human-motion score.

The keyboard diagnostic scored **4.6/10**. This triggers the agreed
architecture checkpoint: whole finite-clip queuing is unsuitable for responsive
steering. Pivot to explicit input intent, root/contact state and shared rig
evaluation rather than duplicate poses or blame SVG. The motion developer and
controller developer must freeze a shared typed API before concurrent edits.

The generic browser overlay and local actual-MCP compile bridge now exist, with
scoped SVG painting, external clock, anchor mapping, click-through, resize
invalidation and disposal. Real Chromium checks found and corrected legacy
SVGMatrix `is2D` and prototype DOMRect handling issues.

The keyboard controller is a **diagnostic prototype**: canonical finite clips
share the motion core, but stop/reverse/jump may wait for a grounded segment
endpoint and new clips do not guarantee gait-state handoff. It must not be
described as seamless game control. Its wiring tests are separate from the
human-naturalness score; a poor controller score requires reviewing the
intent/contact-state API rather than assuming the renderer is at fault.

Publish coherent candidates to the private corporate/mirror worktree branches,
explicitly labeled under review. Do not merge them into the default branch or
declare visual completion until the agreed >=8 per-action/chain gate passes.

The earlier first-version/one-week target remains a user delivery constraint,
not a time estimate or a reason to publish bad animation. The first meaningful
visual deliverable is an improved actor and accepted walking clip, followed by
the remaining actions under the same quality gates.
