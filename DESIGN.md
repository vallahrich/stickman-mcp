# Stickman MCP — Design System & Motion Specification (`DESIGN.md`)

A deterministic visual, spatial, and motion specification for Stickman MCP surfaces: the 2D vector animation renderer, `<stickman-player>` browser embeds, orthographic storyboard contact sheets, native technical presentations, and the offline motion gallery.

```yaml
schema: stickman.design-system/v1
aesthetic: editorial-technical-diagram
color_schemes: [light, dark]

tokens:
  color:
    light:
      bg: "#f7f4ef"              # Warm architectural paper
      bg_elevated: "#fcfbf8"
      surface: "#ffffff"         # Crisp stage & card surface
      surface_soft: "#f5f5f5"    # Code & secondary wells
      border: "#dedede"          # 1px structural hairline
      border_strong: "#919191"   # Diagram box & control stroke
      text: "#242424"            # Primary editorial ink
      text_muted: "#5c5c5c"
      text_soft: "#6f6f6f"
      actor_ink: "#202124"       # Default skeletal stroke
      accent: "#b11f4b"          # Crimson signal accent
      accent_hover: "#9a1a41"
      accent_soft: "rgba(177, 31, 75, 0.08)"
      accent_fg: "#ffffff"
      link: "#0078d4"
      success: "#16a34a"
      warning: "#f59e0b"
      danger: "#dc2626"
    dark:
      bg: "#3d3b3a"
      bg_elevated: "#343231"
      surface: "#292929"
      surface_soft: "#2e2e2e"
      border: "#474747"
      border_strong: "#5f5f5f"
      text: "#dedede"
      text_muted: "#919191"
      text_soft: "#b0b0b0"
      actor_ink: "#dedede"
      accent: "#fd8ea1"
      accent_hover: "#fb7b91"
      accent_soft: "rgba(253, 142, 161, 0.14)"
      accent_fg: "#1a1a1a"
      link: "#4da6ff"
      success: "#4ade80"
      warning: "#fbbf24"
      danger: "#f87171"
    blueprint_sheet:
      sheet_bg: "#f1f5f9"
      panel_bg: "#f8fafc"
      panel_border: "#cbd5e1"
      divider: "#e2e8f0"
      ground_datum: "#d8dbe0"
      badge_bg: "rgba(15, 23, 42, 0.78)"
      badge_fg: "#ffffff"
      caption_fg: "#334155"

  typography:
    sans: '"Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif'
    mono: 'Consolas, "Courier New", Courier, monospace'
    scale:
      hero_h1: "clamp(40px, 5vw, 72px)"
      section_h2: "clamp(28px, 3vw, 40px)"
      card_h3: "20px"
      lede: "20px"
      body: "14px"
      eyebrow: "12px"            # Uppercase, +0.13em tracking, weight 700
      svg_diagram_heading: "28px"
      svg_diagram_min: "24px"    # Hard legibility floor on 1000x420 stages
      blueprint_badge: "9.5px"   # Monospace timecode callout

  geometry:
    radius:
      card: "16px"
      diagram_node: "12px"
      control: "10px"
      badge: "4px"
    stage:
      choreography_v2: { width: 800, height: 450, fps: 30 }
      native_slide: { width: 1000, height: 420, fps: 30 }
      canvas_bounds: { min: 64, max: 4096 }
      projection: "xMidYMid meet"
    rig:
      standing_reference_units: 144
      torso_reference_units: 30
      head_radius_units: 11
      min_stroke_width: 2.5
      joint_fillet_ratio: 0.22

  motion:
    ui_chrome:
      press_hover_ms: 140
      popover_dialog_enter_ms: 180
      popover_dialog_exit_ms: 130
      ease_out: "cubic-bezier(0.22, 1, 0.36, 1)"
    stage_continuity:
      sample_rate_fps: 30
      transition_blend: "c1-hermite"
      film_max_joint_step_px: 14.0
      film_max_foot_slide_px: 1.2
      presenter_max_visible_step_px: 4.0
      presenter_max_visible_accel_px: 2.0
```

---

## 1. Visual Direction & Token Discipline

Stickman MCP pairs **warm editorial paper surfaces** (`#f7f4ef` background, `#ffffff` stage cards, `#dedede` 1px borders) with **drafting-table vector clarity**. The stick figure and technical diagram are the primary visual signal; surrounding chrome stays quiet, flat, and high-contrast.

- **Semantic CSS custom properties (`--cp-*`):** Every HTML shell, gallery view, and embedded SVG diagram binds exclusively to `--cp-*` tokens so `[data-theme="dark"]` flips backgrounds, diagram strokes, and actor ink cleanly without re-rendering geometry.
- **Single restrained accent:** Use `--cp-accent` (`#b11f4b` light / `#fd8ea1` dark) only for active playback states, primary actions, focus rings (`3px solid var(--cp-accent)` at `4px` offset), and focal diagram callouts. Multi-actor differentiation uses sparse vector accessories (`tie`, `hat`, `glasses`, `badge`) and distinct dark-safe hex inks rather than rainbow fills.
- **Zero external runtime dependencies:** Offline HTML exports, native showcases, and gallery builds never fetch remote web fonts, icon packs, CDN scripts, or analytics beacons.

---

## 2. Motion Architecture & Timing Rules

Interface transitions and stage choreography serve different cognitive roles and follow separate timing budgets:

### UI Chrome (Fast, Interruptible, Zero Bounce)
- **Controls and filters (`120ms–160ms`):** Hover borders, toggle states (`aria-pressed`), and scrubber thumbs respond immediately with `cubic-bezier(0.22, 1, 0.36, 1)` or instant state changes.
- **Dialogs and drawers (`<= 180ms` enter / `<= 130ms` exit):** Modal previews open cleanly and dismiss faster than they enter. Never apply spring overshoot or elastic bounce to utilitarian playback controls.
- **Tabular timecodes:** Scrubbers, frame counters, and `0.00s` badges render in monospace or `font-variant-numeric: tabular-nums` to prevent horizontal layout jitter while scrubbing.

### Stage Choreography (Grounded, Continuous, Deterministic)
- **Pure playhead function:** Every frame at `t` ms is a deterministic sample of compiled `stickman.animation/v1` or `stickman.animation/v2` data at `30 fps`. Seeking never depends on prior frame mutation.
- **Fixed-length kinematics & C1 joins:** Limb segments preserve anatomical proportions (`30`-unit torso, `11`-unit head radius, `0.22` joint corner rounding for deep knee/elbow readability). Consecutive clips blend via C1 Hermite interpolation; continuous films enforce `maxJointStep <= 14` and grounded support checks (`footSlides: []`, `maxFootSlide <= 1.2`).
- **Calm co-presenter pacing:** When accompanying technical diagrams, presenter gestures run at calm cadence (`maxVisibleStep <= 4`, `maxVisibleAcceleration <= 2`) inside a dedicated spatial zone so the actor reinforces diagram beats instead of competing with reading flow.
- **Strict reduced-motion respect:** Under `prefers-reduced-motion: reduce`, UI transitions disable (`transition: none`) and stage players open paused on a meaningful completed pose. Standard `Play` controls respect system reduced-motion rules unless the user explicitly selects a playback mode override (`normal`, `reduced`, `static`, `auto`).

---

## 3. Blueprint, Datum & Contact-Sheet Conventions

Spatial layout and `stickman_storyboard` inspection sheets borrow from orthographic CAD and dimensional drafting sheets:

- **Isotropic stage projection:** Scenes map onto host containers via `xMidYMid meet` (`createSceneProjection`). Travel anchors project onto an explicit horizontal ground datum (`groundY`), keeping feet planted on a shared floor line across viewport scales.
- **Semantic stage datums (`800x450` default stage):** Multi-actor `v2` scenes address named datum anchors (`offstage-left`, `left`, `center-left`, `center`, `center-right`, `right`, `offstage-right`, `board`, `door-left`, `door-right`, `hoop`, `goal`) rather than magic pixel coordinates.
- **Orthographic storyboard contact sheets (`storyboard-svg`):**
  - **Sheet grid:** Neutral drafting-paper sheet (`#f1f5f9`) framing crisp `#f8fafc` viewport cells (`#cbd5e1` `1px` border, `rx="6"`).
  - **Non-scaling ground hairline:** Every cell draws the continuous ground datum (`stroke="#d8dbe0"`, `stroke-width="1 / scale"`) so airborne clearance, kneeling contact, and offstage clipping are immediately visible at thumbnail scale.
  - **Timecode & beat strip:** Top-left `#0f172a` monospace timecode pill (`0.00s`) paired with a bottom specification strip (`#e2e8f0` rule, `9.5px` label) listing active actor actions and cue markers.
  - **Automated spatial lint:** Every storyboard pass evaluates `outOfBoundsCount`, `actorOverlapWarnings`, and `maxSeamStepPx` alongside visual inspection before final export.

---

## 4. Quality Bar: Floor / Reflex / Finish Gates

All UI, diagram, and choreography changes must pass three progressive anti-slop gates:

### Floor (Non-Negotiable Baseline)
- **Zero clipping or collision:** Every sampled frame keeps actors, props, and labels inside the stage viewBox with zero text-on-text or actor-on-text overlap.
- **Diagram legibility & mobile fallback:** SVG diagram copy never drops below `24px` on `1000x420` stages. Below `600px` viewport width, dense wide-aspect SVG diagrams switch to structured HTML semantic summaries (`18px`, `1.5` line-height) rather than shrinking diagram text into illegibility.
- **Keyboard & screen-reader completeness:** Interactive players expose `role="img"` + descriptive `aria-label`, `aria-live="polite"` beat captions, keyboard-operable range scrubbers, visible `:focus-visible` outlines, and paused initial load.

### Reflex (Immediate Rejections / Anti-Slop Rules)
- **No generic AI-SaaS decoration:** Reject purple/indigo neon gradients, glowing background blobs, glassmorphic blur soup, decorative animated flow-dots, and gratuitous icon badges.
- **No cramped miniature bento grids on slides:** Never squeeze four tiny multi-sentence cards onto a single stage frame; sequence complex comparisons across timed beats on one aligned coordinate grid.
- **No ungrounded motion:** Reject foot-sliding locomotion, unbridged pose teleports between clips, idle fidget loops during video playback, and moving subject glyphs that break spatial continuity.
- **No synthetic claims:** Technical showcase diagrams use clearly labeled illustrative baselines—never invented benchmarks, fake telemetry, or unsubstantiated cost promises.

### Finish (Craft & Polish Verification)
- **Fixed subject identity:** Across multi-scene architectural stories, keep recurring entities anchored at stable grid coordinates so viewers track state changes rather than hunting moved boxes.
- **Mutual-exclusion media hygiene:** Starting any showcase presentation or video automatically pauses sibling players on the page.
- **Contact-sheet self-critique:** Author scenes with `stickman_choreograph`, inspect the multi-panel `stickman_storyboard` contact sheet and spatial lint (`outOfBoundsCount === 0`), and verify both light and dark token contrast before shipping.
