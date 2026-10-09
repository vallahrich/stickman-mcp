# Private designer showcase

The audience is IT and digital services: cloud/infrastructure explanation,
cybersecurity briefings, digital workflows, collaboration and service operations.
The original reviewed rig and renderer are reused; the gallery is not a parallel
CSS approximation of the character. Presentation demos put the actor inside
the slide content, travelling along timelines and revealing cards—not in a
sidebar or co-presenter panel.

### Current cloud review status

The user rejected the release candidate's native cloud replacement at **3/10**.
It is not the accepted presentation or a publication-ready demo. The richer
Dynamic Presentation + Stickman v10 remains the baseline, also requiring repair.
The next engineering preview keeps its motion library and five-scene argument,
parks W1 during reading, removes the travelling evidence dot, increases evidence
type sizes and replaces repeated fast console taps with one eased action.

`scripts\site\render-cloud-deck.mjs` now calls the installed Dynamic Presentation
MCP over stdio: `get_authoring_guide`, `validate_deck`, `motion_status`, and
`render_pilot`. MCP responses are saved with the private preview. The full
engineering preview still uses the pure renderer API; it is **not** an approved
`render_deck` result. No pilot approval is fabricated, no external renderer
source is modified, and these private integration outputs are not release assets.

## Gallery

```powershell
npm ci
npm run site:build
npm run site:serve
```

Open `http://127.0.0.1:4173/`. Output is ignored `dist/site`, a release-style
catalogue without ratings or review notes in cards, dialogs, catalogue JSON,
downloaded specs or embedded motion-preview metadata.
The builder parses the 100-entry approval ledger, includes only `user-approved`
records, joins aliased review IDs and writes SVG posters, standalone previews,
authored specs and `catalogue.json`. The five non-keyed baselines are the
existing runtime clips, not unreviewed replacement motions.
The logical `throw` and `pull-banner` entries retain the reviewed basketball
and four-direction banner variants in their controlled preview selector;
variants do not inflate the logical approval count.

Current regeneration detects a pre-existing `sneak` loop-wrap joint-pop failure.
The release-style build excludes it, leaving 97 logical entries. Its historical
approval and mechanical diagnostics remain in development. Unapproved dance
and withheld roll remain excluded; the gate is not weakened.

Development ratings and feedback remain in `docs/motion-catalog-plan.md` and
the separate development build:

```powershell
npm run site:dev
npm run site:serve -- --dev --port 4175
```

This serves `dist\site-dev`, with 98 historically approved entries, review
scores/notes, pending entries in JSON and a visible requalification flag on
`sneak`. Neither build deploys publicly or changes repository visibility.

## Runtime story recipes

The first combined-story layout was rejected by the user at **2/10**:
"no one would present it like that." Mechanical checks were not visual approval.
The revised candidate uses substantive architecture messages, visible request
flow, failover routing, and a deployment traffic gate instead of tall placeholder
cards, a runway, action-name captions or narration about the actor.
The preview's **Next beat** control lets a presenter stop at an explanation
point rather than race the autoplay. This revision is awaiting user review;
it has no invented replacement score or presentation-quality approval.

The library retains these recipes outside the active presentation showcase:
`cloud-journey`, `incident-resolution`, and `deployment-rollout`. Each recipe
uses supported runtime actions on a single continuous actor timeline. Travel,
gestures and a bound release package remain in the same world; timed cues
explain the story beats in the slide content rather than in a separate panel.

`stickman_story` lists recipes with `{}` and returns one with `{"id":"cloud-journey"}`.
The recipe has an `animation` compatible with normal validation, compilation,
preview and export, and `cues` for the host's content. Do not put cue fields in
the strict animation document. Downloads include both forms and standalone
motion HTML; the themed diagram preview is generated through the same sampler.
Seeking backward recomputes cue state, and Replay returns to the beginning.
Reduced-motion opens the scene paused.

For custom stories, the library's `composeStory` accepts ordered `steps`,
targets, optional actor/prop and per-step cues. It computes cumulative timing
and rejects infeasible animations through the existing compiler.
`storyState(recipe, playheadMs)` returns revealed/active cues without retaining
playback history. This is deterministic authoring, not new motion generation.
The three examples do not qualify arbitrary blends, simultaneous actors/actions,
all catalogue props or cross-slide continuity.
Their 1000-by-720 animation canvas deliberately uses the existing fixed-length
procedural rig path; the 1280-by-720 diagram preview adds host layout space,
not actor scaling. Wide-canvas clip endpoint blending remains unqualified for
limb-length preservation and is not used by these recipes.

Only one hover/focus preview is active at once; leaving removes its player.
Touch selects the controlled preview. Reduced-motion disables hover playback
and opens paused previews. Search includes accurate IT use cases as well as IDs,
categories and tags. Matching runtime IDs are explicitly distinguished from
promotion of the reviewed version/props.

The build embeds its UI code and styles in one HTML file. Assets remain relative,
so it can later be hosted under a repository subpath. It currently emits noindex
metadata and a disallow-all robots file; the loopback server also sends noindex.
There is no deployment or registry submission. Public release needs a separate
readiness review, including outstanding motions, dependencies and runtime assembly.

## Focused showcase: one slide and two videos

The active presentation example is the private on-premises-to-cloud engineering-preview
HTML deck. It is not the older `cloud-journey` procedural recipe. The current
version (v10) is a **58.6-second**, five-scene workload story using the dynamic-presentations
renderer and actual adapter-1.0 runtime, with one stickman IT admin inside the
scene slot the deck reserves (see [Deck stickman provider](#deck-stickman-provider)).
The v9 workload-led version was evaluated at approximately **8/10**. This polish is awaiting
user review; implementation and mechanical verification do not confer a new rating.

Two original, silent animated stories accompany it, each **56 seconds**:
**Open source: a small fix, shared** follows a developer from a missing feature
through license rights, a working copy, maintainer review, release and community
reuse. **Julius Caesar: ambition changes Rome** follows his origins, political
alliances, campaigns, Rubicon crossing, reforms and concentrated power,
assassination and the later rise of Augustus. Caesar's death is symbolic and
non-graphic; Caesar is explicitly not described as the first emperor.

The earlier slide-like story videos and the later multi-shot cut (camera
push-ins and per-shot clip restarts) were rejected as shaky and disconnected.
Each film is now **one continuous performance under a locked camera**
(`scripts\site\performance.mjs`): approved clips are joined by eased pose
blends, and generated walks (built from the approved walk-on gait and gated
like any authored motion) carry the actor between actions, e.g. stand up →
walk → inspect → walk back → sit down → type. A continuity gate rejects any
join where a joint jumps more than 14 units in a frame. Caesar's changes of
place (Senate, Gaul, Rubicon) are brief world dissolves, not camera moves.
Overlays and props appear only while their beat uses them and then fade out;
readable text cues explain the story without a voiceover. There is no slide
header, card grid, source footer or progress strip.

Only current, user-approved authored key-pose motions (and approved variants
such as `basketball-shot`) are allowed, including the reviewed `video-call`
and `type-at-desk` performances. The builder rejects unapproved motions and
all five legacy runtime fixtures. This is a curated composition, not
arbitrary simultaneous action blending.
All three items are individually under one minute;
the limit is per item, not the sum of all three.

Generate the local assets using the reviewed slide outside the repository:

```powershell
npm run site:showcase -- --slide "C:\private\on-prem-to-cloud-story.html"
npm run site:build
npm run site:serve
```

The source slide remains outside Git. The ignored `dist\site\showcase` folder
contains its local copy, two H.264 MP4 files, PNG posters, VTT captions and a
duration manifest. The manifest records each motion's source-spec SHA-256 and
each encoded video's SHA-256; media URLs use the latter to invalidate older
cached films. `site:showcase` checks the embedded slide timeline, current
keyed-motion approval/mechanical gates, generated-walk gates and the
performance continuity gate. `site:build` requires complete assets before
displaying the three-item showcase; without them it shows setup instructions,
not broken media. No remote generation or publication occurs.

Non-looping performances play in full; looping motions run whole cycles. The
builder rejects a film exceeding one minute (1800 frames at 30 fps). Each large, burned-in
text cue remains for at least 2.5 seconds and fits at most two lines. Optional VTT
captions follow those same cue timings and are not enabled by default, avoiding
duplicate text. Encoding explicitly excludes audio: no voice or music track.
Sources and factual limitations are in
[showcase sources](showcase-sources.md). The slide opens paused in the showcase. Starting a video pauses the slide and
the other video; starting the slide pauses both videos. A full-size slide link
retains its own controls. Motion ratings and review notes are not displayed.

The NIST/NASA presentations, old comparison UI, mixed showcase video and their
generation scripts are retired. Every release/development rebuild deletes
only their explicitly named generated files, preserving unrelated assets.
The motion engine, catalogue and library story recipes remain unchanged.

## Deck stickman provider

`scripts\site\deck-provider.mjs` post-processes a dynamic-presentations
deck; the installed renderer remains read-only. The cloud story lasts **58.6 seconds
(1758 frames at 30 fps)**. Its co-presenter measures **137–139 px tall**
standing at a 1440×900 viewport.
In Present view, scene backgrounds and borders are transparent so the character
and diagrams sit directly on the slide, rather than inside a second white panel.
The opening defines **W1 = one workload**. One W1 glyph traverses two possible homes, a demand baseline, a batch-driven
capacity pool, four evidence stations and a conditional decision gate.
`deck-diagrams.js` owns the connected illustrative objects; explanations sit
next to the change they describe, not in a duplicate right-column list.
The camera and baseline stay fixed. Projection reduces actor/props around the
actor's planted world position, preserving the evidence-station grid.
Reading/reduced-motion mobile view retains content-equivalent static descriptions
and the renderer's reading layer; it does not compress the desktop animation into
unreadable tiny text.

1. Inputs live in `examples\cloud-deck\`. The seven-slide source includes
   five composed story scenes plus two pilot-only framing/recommendation pages,
   preserving three representative compositions/layouts for renderer review.
   The generator removes those two pages from HTML, index and runtime metadata;
   it rejects undeclared extras rather than silently dropping content.
2. **No pilot-specific user approval was obtained or fabricated.**
   `approval.json` is a historical, stale autonomous-review record and must NOT
   be reused as user approval of this redesign. `render-cloud-deck.mjs` calls
   the installed `prepareDeck` and real `renderPilot`, then the exported pure
   `renderHtml` API for an explicitly unapproved engineering preview. It never
   invokes `recordApproval` or gated `renderDeck`. `render-status.json` records
   this limitation. The normal full-deck approval workflow still requires the
   user's explicit approval of the exact current pilot.
3. Reproduce with an installed renderer and a session-only work folder:

   ```powershell
   npm run build
   node scripts\site\render-cloud-deck.mjs --renderer C:\dynamic-presentations-mcp --work <work> --out <story.html>
   node scripts\site\verify-deck.mjs <story.html> final-v10 --output <work> --full
   node scripts\site\update-showcase-deck.mjs <story.html>
   npm run site:build
   ```

   The deck-only update stages HTML/manifest writes with unique temporary names,
   derives duration using the actual `inspectSlide` parser and checks both MP4
   hashes before/after. Do not re-encode the films for a deck-only change.

`composeFilm` loads and gates the actual qualified library sources, not their historically
inconsistent source-spec status fields. The deck reuses those motion resources and the
shared `composePerformance` helper. A **deck-local authored standing console transition**
supplies preparation, keyed taps/contact and recovery; it is mechanically gated but has
no invented user approval. It is not a seated typing motion, a generic pointing gesture,
or a change to the catalogue/approved/candidate specs. The shared renderer's defaults are unchanged.
A deck-local airborne replant avoids dragging feet during generated joins; the
rendered-world gate requires joint steps ≤14 and zero planted-foot slides. The
current gate reports **11.48**, zero foot slides and **14** replant records.
Authored motions/specs remain untouched. Still-pose holds budget silent reading
time instead of adding decorative cycles. Choreography and visible consequence:

| Scene / time | Action → visible result |
| --- | --- |
| Question / 0–6s | `present` marker at frame 32 introduces the defined W1 into a two-destination comparison; neither wins by default |
| Today / 6–18s | `rack-server/check` at frame 311 reveals demand against fixed capacity; the connector reaches the physical rack. Shrug/recovery and operational work follow |
| Option / 18–31s | standing console contact at frame 583 submits W1 jobs; batch transit takes 24 frames, arrival precedes expansion by 12 frames. `present/sweepStart` at 717 starts processing; `present/stand` at 770 completes draining and contraction, 2 → 5 → 2 **instances serving W1** |
| Evidence / 31–49.6s | standing station action → baseline (973), then three generated walks and station actions → requirements (1153), cost inputs (1299), pilot artifact (1445). Only contact reveals each output; W1 travels with the actual actor root |
| Decision / 49.6–58.6s | console contact (1531) supplies an evidence packet to the gate; after 24 frames, both conditional routes appear with the opening rack/cloud symbols. Persistent “Pilot one workload”; no exit |

Event frames are derived from the actual composed segment starts and reachable source/local
markers. Transit/arrival delays are explicit causal offsets from those markers, not global
wall-clock animation triggers. Seeking in either direction recomputes events and artifacts.
The four minimal station captions are **Baseline / Requirements / Total cost / Pilot**.
Active detail sits above the walking lane, while completed summaries stay visible.
The side-by-side comparison lists **inputs**, not monetary bars: local
hardware/licences/operations versus cloud migration/usage/operations/egress, over the
**same time period**. Dependency questions, pilot criteria and a planned rollback do not
claim validation passes, a completed pilot or readiness. Retention means
“Requirements cannot be met” or local fits better.

There is no basketball, door, celebration, claimed success or automatic savings.
CPU is explicitly not proof of waste. The final actor/diagram remain identical
through the last **90 frames (3 seconds)** and persist after playback ends.
The generator retains SVG precision and writes `#data` timing for `inspectSlide` plus deduplicated
`#stickman-frames`. The adapter-1.0 provider supports absolute seek, static
state, cleanup and offline use; props and illustrative charts stay in the slot.

Autoplay starts with the MCP Replay control for entrances, then advances through
its Next control for animated build reveals (including Requirements). Since the MCP
suppresses its fallback flow when a provider mounts, the provider mounts a
sanitised copy of the renderer-authored native flow aligned to the same four
station centres. The existing CSS packet/trace
animations are clocked from the shared playhead, remain deterministic on seek,
and are removed on cleanup. Play/Pause/Replay and the frame slider honour
`?paused=1`, reduced motion, manual navigation and the showcase's
`stickman:play` / `stickman:pause` messages.

The browser verifier captures every beat and checks provider negotiation,
120–150 px standing height, bounds, slide/scene, actor/object and SVG text overlaps,
deterministic actor/native-flow seek, native entrance/build/packet animation,
required workload/evidence/decision shapes, marker-timed before/after reveals and batch-triggered 2→5→2 scaling,
the final 90-frame hold, console errors, full autoplay and 390 px mobile overflow.
For actual gallery iframe screenshots at 1440 and 390 px, add
`--site http://127.0.0.1:<your-preview-port>/` to verification.
The weakest first-pass scene was the evidence grid: active captions crossed the walking
lane and a dependency summary touched the caption. Moving the active detail above the
actor and tightening that summary resolved those overlaps. Intentional hand/control
interaction is the only actor/object bounding-box overlap exemption; the verifier separately
measures the **actual final SVG hand endpoint versus the console control**, at each of six
contact frames, with a ≤4 rendering-pixel gate at 1440×900. The engine-space distance is
0.488 stage units (0.568–0.577 rendering px); this is not a fabricated contact annotation or a diagram moved off its wire.
Renderer validation has one advisory `TOPIC_HEADLINE` warning for the requested
four-verb headline; costs/constraints address the `NO_RISKS` informational note.
Provider-unavailable info in the raw renderer is resolved by the injected provider;
the final browser reports no motion diagnostics.
`tests\deck-provider.test.ts` covers injection, theming, projection/clip
precision, pilot selection, client syntax, all five scenes' W1 continuity,
causal capacity states on every cloud frame, contact-marker artifact timing, same-period
cost inputs without bars, conditional routes, rejection of impossible budgets/extra beats,
and the timeline. Browser captures remain session artifacts outside Git. This is an
engineering preview and mechanical/visual self-check, not independent QA or a new user rating.

## Checks and client integration

```powershell
npm run site:test
node .\node_modules\vitest\vitest.mjs run tests\site-catalogue.test.ts tests\review-renderer-geometry.test.ts --pool=vmThreads --maxWorkers=1
```

Browser checks use locally installed Edge on Windows; otherwise Playwright's
Chromium is required. Set `STICKMAN_SITE_BROWSER` to choose a supported browser
channel. Checks cover catalogue/asset availability, hover lifecycle, actual
playhead progression, search/filtering, keyboard/reduced-motion behavior,
copyable configuration, three-item showcase playback/durations/seek,
rating-free release assets, retained development feedback and mobile overflow.
Build both `site:build` and `site:dev` before running `site:test`.

Client commands in [MCP setup](mcp-setup.md) are verified against official
documentation, not executed by the gallery. `llms.txt`, catalogue and capability
JSON are ordinary documentation maps; neither they nor a private repository
guarantee automatic agent discovery. The public MCP Registry requires a
publicly available installation method or accessible remote server, so this
private checkout is not submitted.
