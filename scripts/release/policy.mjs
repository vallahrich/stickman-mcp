// Reviewed scope, not a glob. Changes require a new content/provenance review.
export const sourceFiles = Object.freeze([
  "src/index.ts", "src/catalog.ts", "src/compiler.ts", "src/contract.ts",
  "src/contract-schema.ts", "src/events.ts", "src/export.ts",
  "src/motion-clips.ts", "src/motion-library.ts", "src/generated/motion-library.ts",
  "src/playback.ts", "src/render.ts", "src/stories.ts", "src/cli.ts",
  "src/browser.ts", "src/room.ts", "src/keyboard.ts", "src/world-motion.ts"
]);
export const licenseFiles = Object.freeze(["LICENSE", "NOTICE"]);
// Populate only after documented owner/content/provenance review. A changed
// input must be re-reviewed, even after the general blockers are resolved.
export const approvedInputs = Object.freeze({});
export const inventory = Object.freeze([
  { component: "Engine source and geometric rig", license: "MIT", evidence: "LICENSE" },
  {
    component: "Embedded motion clips and generated library",
    license: "Unresolved redistribution permission",
    evidence: "src/motion-clips.ts; src/motion-library.ts; motions/specs/*.json"
  },
  {
    component: "Optional GIF/MP4 rendering",
    license: "External dependencies; not bundled",
    evidence: "@resvg/resvg-js: MPL-2.0; separately installed FFmpeg: build-dependent license"
  }
]);
export const blockers = Object.freeze([
  "Public scope and publication destination have not been approved by the owner.",
  "CMU-derived embedded clips require documented redistribution review or replacement; runtime metadata explicitly says keep private until legal review.",
  "Every allowlisted source file and LICENSE/NOTICE require a content, ownership, attribution and secret review; an allowlist or hash is not that review."
]);
