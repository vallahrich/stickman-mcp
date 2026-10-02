# Website/deck integration and keyboard diagnostics

The browser adapter mounts a small original stickman as a **transparent SVG
overlay** in an explicitly approved host. It consumes the same compiled v1
program and canonical sampler as MCP, SVG/HTML preview and video export.
It is not a second animation engine or a browser-accessible stdio transport.

The intended request is: "Run from here to there, jump at the arrival point,
then point at that card." The client agent resolves that intent to the supported
actions and named scene targets, calls `stickman_compile`, and passes the
returned program to the website/deck adapter.

## Run the integration example

```powershell
npm run preview:deck
```

Open the localhost URL printed by the command. Choose **Compile with MCP and
mount**, then play or scrub the deck clock. The example:

- Measures real DOM arrival/target anchors and uses a roughly 64 CSS-pixel actor.
- Compiles through an actual SDK client connected to the built stdio MCP server.
- Mounts without covering the deck with an opaque animation background.
- Leaves the target card button clickable.
- Uses an external deck clock, with no hidden animation timer in the adapter.
- Invalidates stale anchors on layout change; remap and compile again.

This localhost preview accepts only the known example/module paths and
same-origin JSON compile requests. It binds to `127.0.0.1` on an ephemeral port.
It is a development preview, **not** a production HTTP MCP endpoint, public
deployment or replacement for client trust/authorization. It does not edit
Copilot settings or unrelated website files.

## Browser-only entry

Use `@vallahrich/stickman-mcp/browser` in a browser bundler, or serve the built
`dist` browser modules. Do not bundle the root library entry to obtain browser
integration: its export helpers also use Node filesystem/encoder APIs.

```typescript
import {
  createBrowserScene, measureHostViewport, mapElementAnchor,
  viewportToScene, projectTravelAnchor, mountBrowserAnimation
} from "@vallahrich/stickman-mcp/browser";

const projection = createBrowserScene(measureHostViewport(host), 64);
const target = mapElementAnchor(projection, targetElement);
const arrival = projectTravelAnchor(
  mapElementAnchor(projection, arrivalElement),
  groundY,
  projection.canvas
);

// Author validated v1 data in this virtual scene, then obtain a compiled
// program from the local MCP host/bridge. No authored JavaScript is accepted.
const player = mountBrowserAnimation(host, compiledProgram, {
  approved: true,
  clock: "external",
  onInvalidate: reason => notifyAndRemap(reason)
});

deck.onTime(timeMs => player.seek(timeMs));
deck.onPause(() => player.pause());
deck.onDispose(() => player.dispose());
```

The consumer owns `host`, `groundY`, `compiledProgram`, the deck event API, and
the notification/remapping callback. These placeholders are not automatic
integration with any particular deck framework.

## Coordinates and size

Use one isotropic scene projection for the actor, ground, travel and pointing
targets. Scaling only the actor around its root breaks target direction and
contact geometry. `createBrowserScene(rect, standingHeightCss)` chooses a virtual
canvas for the entire host; ceiling/letterboxing means the actual height is
approximate rather than an exact CSS guarantee.

`measureHostViewport` accounts for borders, scroll offsets and positive
axis-aligned slide zoom. Coordinates are viewport **CSS pixels**, not physical
device pixels. `mapElementAnchor` uses the element's border-box center.
`projectTravelAnchor` intentionally uses only the anchor's X coordinate and
the selected flat floor; pointing retains the actual anchor's X/Y.

For a rotated/skewed planar host, mount the SVG first and use its actual
`mapViewportPoint`/`mapElement` screen-transform mapping. A missing, non-planar
or invalid transform is an error, not a silent approximate target.

The v1 canvas remains limited to 64..4096 units per axis. An extremely large
slide with a very small character can exceed this limit: use a bounded overlay
region or a larger actor. Do not stretch different axes or clamp anchors.

The host must already be positioned. Explicitly choosing
`positionHost: "relative"` permits a reversible position change on a static
host. Disposal removes the adapter's SVG and restores only its own untouched
position change; it does not restore unrelated edits made by the consumer.

## Playback and cleanup

- Mount starts paused; `play` is explicit.
- `clock: "external"` means `seek(t)` is the sole clock. The adapter never
  starts its own RAF in that mode.
- Internal mode uses one request, supports pause/resume, and stops at the end
  without automatically looping. Explicitly seek to zero to replay.
- Reduced-motion preferences override requested normal motion and show the
  stable canonical final state. Preference changes stop active motion.
- `cancel` is terminal and hides the overlay; `dispose` removes owned nodes,
  subscriptions/observers and scheduled requests. Both are idempotent.
- Resize, captured scroll, host disconnection or transform changes invalidate
  the original mapping, stop playback and hide stale pointing. They do not
  silently change authored targets, restart or move the playhead.
- An anchor that moves without a host resize/scroll requires the consumer to
  call `invalidateLayout()` explicitly. Remap, compile and remount, then seek
  to the saved deck time if appropriate.

The overlay uses DOM-created nodes, scoped references and `pointer-events:
none`; it does not execute HTML/JavaScript from an animation document.

## Keyboard testbed

Keyboard steering is a diagnostic for responsiveness, natural locomotion and
state hand-offs—not a different pose generator. The approved controls are
arrows/A/D for movement, Shift for run, Space for jump, and a pointing trigger.
They must be captured only by the explicitly focused playground, released on
blur, and disposed without global key interception. The `@vallahrich/stickman-mcp/keyboard` entry supplies
`createKeyboardController(options, port, clock)` and
`bindFocusedKeyboard(host, controller, { approved: true })`. The local deck
example's **Enable keyboard diagnostic** button mounts this controller with
the shared `createSvgPainter`; its poses still come from canonical compiled
clips. The controller owns the supplied rendering port, so do not reuse a port
after disposal.

The original finite-clip diagnostic scored 4.6/10 and was rejected: waiting
up to 700/500 ms for clip endpoints is not responsive steering. The current
iteration replaces that architecture with timestamped intent and explicit
world-root/contact planning evaluated by the shared skeletal kernel. Its score
remains open until actual browser review; recognize-the-key tests are not
human-motion approval.

## 2.5D room preview

**2.5D room preview** mounts an original isometric stage with world X/Z floor
coordinates, Y height, collision footprints and depth-ordered furniture/actor
layers. The character remains a flat billboard-style drawing. WASD/arrows
steer the room preview; the small figure-size selector defaults to 48px.

The renderer's shadow stays on the floor. This is a bounded orthographic,
box-and-paper-actor stage, not a general mesh engine or arbitrary transparent
occlusion solution. The world planner uses the same FK/IK solver; moving a
sprite independently of its ground contacts is not an acceptable implementation.

Each grounded foot has its own projected floor Y, because world-depth movement
is not a horizontal screen-space floor. Room support must be verified against
those world anchors. The legacy authored v1 flat-floor contract is not silently
reinterpreted as a 3D scene schema.

This preview is an authoring/validation aid for presentation/video scenes;
it does not claim that 2.5D room scenes already have a new MCP authoring/export
contract or that the current room/controller candidate passed visual review.
See [verified 2.5D research](2.5d-research.md) for precedents, evidence limits and
the renderer-pivot criteria.

The room/controller diagnostic is not included in the scripted animation score.
Its faster-locomotion mode still needs separate flight/cadence and directional
pose refinement before being described as human-natural running. Realtime
response must also be viewed in an unthrottled environment. Those limits do not
apply to the independently reviewed authored v1 run clips, which have genuine
flight and are part of the scored movie/deck candidate.

Actual Chromium checks covered focused movement/release, stable in-place jump
and surface disposal. Unit checks cover held-key repeat, blur/visibility,
bounds, terminal errors and listener cleanup. These checks establish wiring,
not the requested human-naturalness score.

The scored quality cycle covers human-naturalness at normal and miniature
sizes as well as keyboard start/stop, reversals, jumping and landing. The
integration checks do not themselves grant an 8/10 motion score.
