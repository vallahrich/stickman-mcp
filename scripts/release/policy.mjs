// Full connected product. Exact names, not recursive copy of a checkout or dist.
export const sourceFiles = Object.freeze([
  "src/index.ts", "src/catalog.ts", "src/compiler.ts", "src/contract.ts",
  "src/contract-schema.ts", "src/events.ts", "src/export.ts",
  "src/motion-clips.ts", "src/motion-library.ts", "src/generated/motion-library.ts",
  "src/playback.ts", "src/render.ts", "src/stories.ts", "src/cli.ts",
  "src/browser.ts", "src/room.ts", "src/keyboard.ts", "src/world-motion.ts",
  "src/mcp.ts", "src/film.ts", "src/film-schema.ts", "src/motion-authoring.ts"
]);
export const runtimeScripts = Object.freeze([
  "scripts/film/api.mjs", "scripts/film/runtime.mjs", "scripts/film/joins.mjs", "scripts/film/overlays.mjs",
  "scripts/motions/authoring.mjs", "scripts/motions/keypose.mjs", "scripts/motions/review-renderer.mjs",
  "scripts/site/catalogue.mjs", "scripts/site/performance.mjs", "scripts/site/story-films.mjs"
]);
export const siteInputs = Object.freeze([
  "scripts/site/build.mjs", "scripts/site/stories.mjs", "scripts/site/showcase-section.mjs",
  "scripts/site/retired-presentations.mjs", "scripts/release/native-showcase.mjs",
  "site/index.html", "site/styles.css", "site/catalogue.js", "site/scene-player.html",
  "docs/mcp-setup.md", "docs/agent-integration.md", "docs/showcase-sources.md"
]);
const motionIds = `arms-crossed balance basketball-shot beckon bow catch check-watch cheer clap climb-down
climb-ladder climb-ledge crawl crouch dance deep-library-bow dodge drag-object drag-window enter-door
exit-door facepalm fall-get-up fist-pump frustrated-pc get-up hand-over hang-swing head-shake hold-sign hop
hurdle idea idle inspect-magnifier jog jump kick kick-ball kneel-down kneel-library-transition kneel-up
lie-down lift-carry long-jump look-around nod open-door open-laptop phone-call pick-up plug-cable point
present present-card pull pull-banner pull-banner-bottom pull-banner-left pull-banner-right pull-banner-top
punch push push-walk put-down rack-server reveal roll run run-start sad-slump scratch-head seated-idle
shrug sidestep sit-down sit-floor skip sneak stairs-down stairs-up stand-up static-pose step-up stop
stop-hand surprised swipe-next tablet-tap tap-element think throw throw-ball thumbs-up trip turn-90
turn-around type-at-desk vault video-call walk walk-backwards walk-off walk-on walk-start walk-stop
walk-turn wave write-board write-notes`.split(/\s+/);
export const motionFiles = Object.freeze(motionIds.map(id => `motions/specs/${id}.json`));
// These older original key-pose records predate the dataset field. Exact names,
// not a blanket assumption that any source-less file is original.
export const authoredLegacyIds = Object.freeze(`climb-down dance drag-object drag-window frustrated-pc
hand-over hold-sign idea present-card pull-banner-bottom pull-banner-left pull-banner-right pull-banner-top
pull-banner push-walk rack-server reveal roll seated-idle surprised swipe-next tap-element type-at-desk
walk-stop write-board write-notes`.split(/\s+/));
export const licenseFiles = Object.freeze(["LICENSE", "NOTICE", "docs/rights.md"]);
export const supportFiles = Object.freeze([
  "motions/poses/poses.json", "motions/review-props.json", "motions/join-matrix.json",
  "docs/motion-catalog-plan.md", "examples/wave.json", "examples/films/team-handoff.json",
  "examples/films/bridge-demo.json", "scripts/release/README.md", "tsconfig.json", "package.json"
]);
export const buildToolFiles = Object.freeze([
  "scripts/release/policy.mjs", "scripts/release/prepare.mjs",
  "scripts/release/zip.mjs", "scripts/release/pack-guard.mjs"
]);
export const inputFiles = Object.freeze([...sourceFiles, ...runtimeScripts, ...siteInputs,
  ...motionFiles, ...licenseFiles, ...supportFiles, ...buildToolFiles]);
export const scope = "connected-mcp-library-cli-and-offline-demos";
export const inventory = Object.freeze([
  { component: "Engine, authored poses/specs and vector props", license: "MIT", evidence: "LICENSE" },
  { component: "CMU-derived compact motion data", license: "CMU permission with dataset-resale restriction (not MIT)",
    evidence: "docs/rights.md; NOTICE; https://mocap.cs.cmu.edu/; https://mocap.cs.cmu.edu/faqs.php", accessed: "2026-10-09" },
  { component: "Bruce Hahne BVH conversion, via una-dinosauria mirror", license: "No additional conversion restrictions; current CMU dataset-resale restriction retained",
    evidence: "docs/rights.md; https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/READMEFIRST.txt", accessed: "2026-10-09" }
]);
// Preparation and publication are different states. These do NOT prevent private inspection.
export const blockers = Object.freeze([
  "Owner final-file content/ownership review and artifact-hash sign-off remain required.",
  "Owner must approve publication destination and the actual public upload; no publication is authorized."
]);
