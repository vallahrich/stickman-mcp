# Local, source-faithful HTML presentations

This is a **local presentation-building path**, not an automatic PowerPoint
redesign tool or a new MCP capability. It inventories a PPTX, then uses an
explicit, source-specific storyboard to build one offline HTML file. The
catalogue, runtime verbs and motion-review baselines are unchanged.

Keep private decks, extracted screenshots/videos, notes, storyboards, HTML and
QA screenshots **outside this repository and its mirror**. Both commands refuse
source-derived output under this worktree. Neither fetches external resources.
Only these reusable scripts and source-free tests belong in Git.

```powershell
npm run -s build
python .\scripts\presentations\extract-pptx.py --source "C:\private\source.pptx" --output "C:\private\inventory"
node .\scripts\presentations\build.mjs --source "C:\private\inventory\source.json" --design "C:\private\storyboard.json" --output "C:\private\presentation.html"
```

The inventory retains ordered source slides, original text, body speaker notes,
media relationships, hashes, crops, placeholder-inherited geometry and grouped
coordinates. It sanitizes SVG active/remote content and rejects macros,
unsupported media, external media and packages exceeding 1 GiB uncompressed.
Original screenshots and video bytes are not recolored or transcoded.

The storyboard has a `title` and ordered `slides`. Each slide specifies its
`source` number, `section`, `title`, `subtitle`, optional diagram `nodes`/`edges`,
optional source `video`, and `beats`. A beat contains a `caption`, `active`
diagram IDs, and optionally an `actor` cue with an approved catalogue `motion`,
world-space `x`/`groundY`/`scale`, clip-frame `from`/`to`, and `durationMs`.
Selected authored clips must pass their existing mechanical checks. Clip
geometry is sampled by the shipping renderer, not replaced by CSS figures or
hundreds of complete SVG frames.

Set `complete: true` on a full-deck storyboard: validation requires every
original slide, in order, and every recording on its own source slide. An
optional text `notice` appears outside the slide stage, for example to identify
historical preview terminology. A genuinely empty original slide can use
`blank: true`, empty heading fields and an empty-caption beat; it stays in the
sequence and renders an empty stage rather than an invented conclusion.

`slide.images` places actual source screenshots using unique `id`, `asset`,
`x`/`y`/`width`/`height` and accessible `alt`. Clicking enlarges the uncropped
original. A beat's `imageFocus[id]` can emphasize a normalized
`left`/`top`/`width`/`height` detail; Back reconstructs the full image or crop
without accumulating state. `slide.resources` places explicit source links
using `id`, `href`, `label` and the same rectangle fields; `large: true` provides
a larger call to action. Destinations must exactly match an original hyperlink
or URL token in that slide's text, not just a substring. They open in a separate
tab only when clicked and are never fetched by the presentation.

For an object interaction, set `actor.scene: true` to draw the approved clip's
actual props and `keepProps: true` to retain them after its review lifecycle.
Optional `payload: {type: "files" | "table", label: "..."}` replaces only the
box's glyph, not its authored dimensions or hand-contact trajectory. Clip
boundaries should share the same world transform and endpoint frame.
`figure: false`, `hideAtEnd` and `hideSceneAtEnd` allow a stable deposit or a
clean handover to a demo without keeping a character over application UI.
Prop fills use the presentation theme while keeping laptop screen, keyboard
and body details distinct; original source imagery remains untouched.

Diagram nodes can use `shape: "plain"` for typography or `"band"` for a shared
space. `beat.visible` declares the complete set of diagram, image and resource IDs shown at that
beat; omitting it shows all components. Visibility and emphasis are recomputed
on every seek, never accumulated. Independent `slide.objects` have unique IDs,
`type`/`label` and stage-space `x`/`y`/`w`/`h`; a beat's `objects` contains their
explicit states. Omission or `visible: false` hides an object. Positions
interpolate from the preceding beat, and `startAt` in `[0,1)` can delay motion
until hand release. Treat data movement and control-flow dependencies as
different explanations: an "on completion" branch must not imply success.

Optional `video.focus` defines a poster-detail beat and normalized `left`, `top`,
`width`, `height` crop. The detail uses the actual source image without inventing
code or UI; the full image remains available under Original slide, and playback
always switches back to the unaltered recording. Foreground diagram edges can
reach an inner layer without disappearing behind its enclosing foundation;
`activeOnly` routes and `label.onlyActive` expose the specific engine path.
`video.revealBeat` and `revealAtEnd` defer demo availability until the preceding
interaction recovers. Movie bytes are decoded to a Blob only on explicit Play.

Open the generated file directly in a current browser. There are no remote
fonts, scripts, images or runtime fetches. Videos are embedded and activated
only for their slide, played explicitly, and released on slide changes. Expect
roughly 33% base64 overhead for embedded media: a single file is convenient,
not necessarily small. Browser codec support still matters.

**Presenter controls:** Next/Space advances a beat and holds; pressing Next
during a beat finishes it. Back reconstructs a stable prior state. Replay is
explicit. Selecting a slide stops outgoing media. Next does not advance during
video playback, and the figure is suspended. Keyboard shortcuts ignore media
controls, inputs and dialogs. Reduced motion or Animation off preserves every
explanation without an actor. Notes separates original notes from added beats.
Play and Enlarge demo live in presenter controls, not over source application
UI. Enlarge demo makes the original poster or recording fullscreen without
starting playback; its Play and Exit controls sit below, not over, the source.
Original slide reconstructs source positions and also shows uncropped images;
this is not a pixel-perfect Office rendering.

Start with representative source slides and obtain visual feedback before
expanding a deck, unless the user explicitly directs autonomous completion.
That direction is permission to finish, not a quality rating.
Automated checks establish fidelity and behavior, **not**
presentation quality or user approval. Preserve historical terminology, repeated
headings, blank slides and explicit preview labels; do not silently update claims.

## Verification

```powershell
python -m unittest discover -s .\tests\presentations -p "test_*.py"
npx vitest run tests\presentation.test.ts --pool=vmThreads --maxWorkers=1
npx playwright test --config playwright.presentation.config.mjs
```

The browser suite normally builds a source-free temporary fixture. To verify
an actual private output, set **both** paths outside the repository:

```powershell
$env:STICKMAN_PRESENTATION_HTML = "C:\private\presentation.html"
$env:STICKMAN_PRESENTATION_QA = "C:\private\qa"
npx playwright test --config playwright.presentation.config.mjs
```

This opens `file://` with networking offline, checks presenter state, source
notes/images, video playback/disposal, deterministic back/replay and reduced
motion, payload-label clearance, exact rendered hand/prop contact, same-clip
boundary continuity and a single retained object across access beats. Complete
outputs are compared with their neighboring `source.json` for exact original
slide/notes coverage and embedded media hashes. Every recording is decoded,
played, seek-tested and disposed offline; source screenshot crops/enlargement, links
and the blank ending are exercised too. Large embedded inventories are inspected
directly rather than through a locator's expensive element preview. The suite
captures stable beats and decisive contact frames locally. Also inspect moving
frames, labels, crossings, actor contact/aim and source coverage visually. Keep private
QA outputs out of published sites, commits and CI artifacts.
