# Stickman MCP: local animation tools

Stick-figure/person animation for IT and digital-services presentations, websites,
explainers and video. The local stdio MCP server uses a deterministic rig,
compiler and renderer. It does not execute authored code or call a video AI service.

## Connection and documentation

- [Connection guide](connection-guide.md): Copilot CLI, VS Code, Claude Code and Codex.
- [Capabilities](capabilities.json): actual transport, tools and runtime IDs.
- [Motion catalogue](catalogue.json): categories, previews, specifications
  and explicit runtime-ID availability.
- [Combined stories](stories.json): executable IT narrative recipes and
  synchronized content cues, not a playlist of independent motion previews.
- Tool input contracts come from `stickman_schema` and the connected server's
  advertised JSON schemas; do not infer arguments from catalogue previews.

## Normal workflow

Discover available runtime motions, describe the chosen action, retrieve the
schema, validate an animation, compile it, then preview SVG or self-contained HTML.
Export writes under the root selected at launch and requires an explicitly
reviewed destination. Preview/discovery do not write output files.

For a complete scene, call `stickman_story` with `{}` to list recipes, then
with `{"id":"cloud-journey"}` (or `incident-resolution`, `deployment-rollout`).
Pass the returned `animation` to validate/compile/preview/export and use its
separate `cues` in the presentation host on the same playhead. Keep cues out of
the strict animation document. The library's `composeStory` supports custom
ordered steps; `storyState` recomputes visible cues during forward or backward
seeking. Story animations have one persistent actor, world and timeline.

The actor belongs inside the deck's content, not in a separate presenter panel.
Useful requests include walking to a named slide target and pointing, explaining
an infrastructure diagram, and showing a digital-service workflow. Only actions
returned by the running server are valid animation-contract verbs. Reviewed
catalogue specs are authoring inputs, not animation-contract documents.

## Limits

The private package is not published. Connection requires a trusted checkout,
Node.js 20+ and a build. A catalogue approval does not promote a motion or its
props into MCP. A matching runtime ID does not guarantee the same reviewed
revision. The runtime does not train model weights.
General contact-safe novel combinations and cross-slide continuity remain
qualification work.

This documentation map is ordinary readable metadata, not a guarantee of
search visibility, a public-registry listing or automatic client installation.
The local site is private and marked noindex. No client configuration or
repository visibility is changed by its build.
