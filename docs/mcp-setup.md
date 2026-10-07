# Local MCP setup and verification

Stickman MCP is a private, local stdio server. It uses the repository's locked
`@modelcontextprotocol/sdk` 1.x dependency and the same animation compiler as the
library and CLI. It is not an HTTP service and does not require a GitHub token,
OAuth, a cloud renderer, or publication to an npm registry.

The current official [server-building guide](https://modelcontextprotocol.io/docs/develop/build-server)
uses a newer SDK package, `@modelcontextprotocol/server`. This project deliberately
does not copy those imports into its existing SDK. A future protocol/SDK migration
must first verify support in the intended clients; the tests here exercise the
locked SDK's actual initialization, discovery, calls, and output validation.

## Build and launch

Use Node.js 20 or newer. From the corporate repository checkout:

```powershell
npm ci
npm run build
npm test -- mcp.test.ts
```

For a client, launch the built server directly rather than through `npm run`,
which can print a command banner to stdout:

```powershell
node C:\Projects\stickman-mcp\dist\mcp.js --root C:\Projects\MyPresentation\stickman-output
```

Replace both paths with existing checkout/output locations you have reviewed.
Use an absolute server path so launching from another working directory works.
If `node` is not on the client's inherited `PATH`, use the full path to the Node
executable. A server waiting silently for input is normal: stdout is reserved for
MCP JSON-RPC messages, not a human-readable startup banner. Startup errors go to
stderr and exit with a nonzero status.

The output directory is selected at launch. If `--root` is omitted, the current
working directory is retained as the backward-compatible default; prefer an
explicit root. Duplicate `--root` options and unknown startup options are errors.
No tool can change the root. Export rejects absolute output filenames, traversal,
symlink directories, mismatched extensions, and existing files.

## Connect Copilot CLI

Review the command before running it: it writes your user MCP configuration and
makes the local server available to Copilot. The repository does not execute this
command or modify your settings.

Start with the seven non-writing tools:

```powershell
copilot mcp add stickman --tools 'stickman_discover,stickman_describe,stickman_schema,stickman_validate,stickman_compile,stickman_preview,stickman_story' -- node 'C:\Projects\stickman-mcp\dist\mcp.js' --root 'C:\Projects\MyPresentation\stickman-output'
copilot mcp get stickman
```

The interactive alternative is `/mcp add`, selecting **STDIO**, the same command
and arguments, and the tool names above. Use `/mcp show stickman` to inspect the
server and its tools. Enable `stickman_export` only when you intend to write
artifacts in the approved root; enabling a tool is not authorization to overwrite
or write outside that root.

The CLI user configuration is `~/.copilot/mcp-config.json`. Project configuration
can use `.mcp.json` or `.github/mcp.json`, and is subject to folder trust and
organization allowlist policies. Do not bypass those controls if a server is
blocked. See the official [Copilot CLI connection instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

## Connect VS Code

Use **MCP: Add Server** and select a local stdio server, or review and create a
portable `.mcp.json` in the consuming project's root:

```json
{
  "mcpServers": {
    "stickman": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:\\Projects\\stickman-mcp\\dist\\mcp.js",
        "--root",
        "C:\\Projects\\MyPresentation\\stickman-output"
      ]
    }
  }
}
```

This example is not automatically installed. Merge it with any existing
configuration; do not replace other servers. Review the trust prompt, inspect
the tools, and keep export disabled unless you need it. VS Code also supports
its own `.vscode/mcp.json` format with a top-level `servers` object; Copilot CLI
does not read that format. Portable configuration avoids conflating the two.
See the official [VS Code MCP instructions](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## Connect Claude Code or Codex CLI

The same local stdio server works without a remote endpoint. Review these
PowerShell examples before running them; they change the named client's MCP
configuration, and do not install a published package:

```powershell
claude mcp add --transport stdio stickman -- node 'C:\Projects\stickman-mcp\dist\mcp.js' --root 'C:\Projects\MyPresentation\stickman-output'
codex mcp add stickman -- node 'C:\Projects\stickman-mcp\dist\mcp.js' --root 'C:\Projects\MyPresentation\stickman-output'
```

Use `claude mcp list` or `codex mcp list` to inspect configuration, then verify
the running server's tools in the client. Review client trust and tool-permission
settings; these commands do not limit tool availability to the seven non-writing
tools as the Copilot example does. Do not authorize export until its destination
is reviewed. Organization policy can block local servers; do not bypass it.

These command shapes are verified against the official
[Claude Code MCP reference](https://code.claude.com/docs/en/mcp) and
[Codex MCP reference](https://developers.openai.com/codex/mcp).
Client versions and policies still require a live compatibility check.
No invented `--type`/`--command` Codex flags or `/mcp/metadata` endpoint are used.

## Tool contracts and errors

All eight tools enforce their advertised JSON input schemas at runtime. Missing
required fields, unknown fields (including attempted root overrides), wrong
types, and invalid enums are rejected without coercion. For example, preview
`timeMs` must be a number, not `"500"` or `null`. Animation validation remains the
canonical strict `stickman.animation/v1` validation.

Successful results preserve the existing pretty-printed JSON text payload.
They additionally provide `structuredContent: { "result": <payload> }` and an
advertised output schema. The envelope is consistent even when the payload is
an array, such as the discovery catalog.

| Condition | Response |
|---|---|
| Unknown tool name | JSON-RPC `InvalidParams` protocol error (`-32602`) |
| Invalid tool arguments | `isError: true` with structured `error.code: "invalid_arguments"` and an actionable message |
| Unknown action ID or render/export failure | `isError: true` with structured `error.code: "execution_error"` and a message |
| Invalid animation sent to `stickman_validate` | Successful diagnostic result with `valid: false`; validation itself completed |
| Invalid animation sent to compile/preview/export | `isError: true` with the canonical validation diagnostics in the result envelope |

Read-only/idempotency annotations describe tool behavior; they are hints, not
access control. Export is annotated as writing and non-idempotent because it
creates a new artifact and rejects repeated writes to the same filename.
The filesystem root and safe-export checks enforce the actual boundary.

These contracts follow the [SDK-generation tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
Protocol-generation compatibility is separate from the animation document's v1
version.

## Smoke check

After reviewing and starting the server in your client:

1. Discover the supported runtime action IDs and retrieve the animation schema.
2. Validate and compile `examples\walk-and-wave.json` by supplying its JSON
   document as the `animation` argument, not just its filename.
3. Preview the document as SVG at a numeric `timeMs`, then as self-contained HTML.
   The preview response contains artifact text; the client decides how to view it.
4. Send a preview with `timeMs: "500"` and verify an actionable argument error.
   A subsequent valid call must still work.
5. If export is enabled, choose a new relative `.svg` filename in the approved
   root. Confirm the artifact, then verify a repeated export refuses to overwrite
   it. Never use real out-of-root paths as a destructive test target.

`npm test` builds first so protocol checks exercise the same `dist` server that
clients launch, rather than a development TypeScript loader whose function-name
helpers can change serialized browser code. The automated suite uses a real SDK
client and child-process stdio transport. It
checks all eight tools, output-schema validation, malformed arguments, unknown
tools, engine/render parity, export boundaries, startup stderr, and clean client
closure. These tests do not claim that a particular installed Copilot/VS Code
version, its enterprise policies, or its artifact viewer has been certified;
the client smoke check above is still required in that environment.

To start from a combined story, call `stickman_story` with `{}` for discovery
and `{"id":"cloud-journey"}` for an executable recipe. Send its `animation`
to the existing validation/compile/preview/export tools; its `cues` are
presentation-host metadata, not extra animation fields. Unknown story IDs
produce actionable execution errors. This read-only tool does not promote
unavailable catalogue motions or change the existing animation contract.

The [official MCP Inspector](https://github.com/modelcontextprotocol/inspector)
is an optional additional diagnostic client. Review its version, Node
requirements, and installation instructions before installing it; it is not a
runtime dependency and this repository does not launch or install it for you.

## Recorded end-to-end verification

In addition to 28 passing automated tests, local verification covered:

- Installed Copilot CLI `1.0.90-2` connected through an isolated ACP session and
  ephemeral MCP configuration. The actual client negotiated initialization
  with this server; no model prompt was sent and no persistent client settings
  were changed. Actual tool calls are covered separately by the SDK tests.
- Chromium loaded five self-contained scenes: wave, walk-and-wave, push,
  left-turn/run/point/wave, and walk-to-push. Sampled DOM coordinates matched
  canonical frames, seek and motion modes worked, and there were no script
  runtime errors. Reduced-motion startup/resume and visible prop styling were
  checked and corrected.
- GIF and H.264 MP4 export each produced 72 readable frames at 640x360 over
  2.4 seconds. Testing used a SHA-256-verified portable FFmpeg `9.0.2`
  essentials build from [Gyan](https://www.gyan.dev/ffmpeg/builds/), downloaded
  temporarily for session QA and removed afterward, not bundled or installed
  globally. That build is
  GPLv3-enabled; users must review their own encoder licensing and put their
  approved FFmpeg installation on `PATH`.
  The prop-push scene was also exported and fully decoded as GIF and MP4:
  54 frames at 640x360 over 1.8 seconds.

These are bounded smoke checks, not exhaustive motion/visual certification or
verification of every VS Code/Copilot client version.

### Scripted motion-quality cycle result

The later original-rig rebuild was independently reviewed across 19 scripted
scenes at normal and native 48-pixel character size. V7's weighted provisional
scores are **8.27 normal / 8.155 miniature**, with no reviewed action/chain below
8.0. The run-to-arrival, jump, then point sequence scored **8.4 / 8.3**.
This meets the requested version-above-8 target and the original minimum-8
per-action gate; it does not mean every individual row is strictly above 8.

Movie checks exported and fully decoded:

| Scene | Formats | Dimensions | Frames | Duration |
|---|---|---|---|---|
| Run -> jump -> point | H.264 MP4 and GIF | 640x400 | 162 | 5.4 s |
| Loaded push | H.264 MP4 | 640x400 | 183 | 6.1 s |
| Supported reversal | H.264 MP4 | 640x400 | 192 | 6.4 s |

Vector-only rasterization skips unnecessary per-frame system-font loading;
a representative frame was byte-identical with/without that optimization.
The temporary checksum-verified FFmpeg build remains a QA tool, not a bundled
or global installation.

The reviewer observed approximately 1-second RAF intervals in the tool-driven
browser, even on a visible focused standalone page. The score is a bounded
pose/choreography judgment (+/-0.3-0.4), not smooth-realtime or industry
certification. Normal-speed viewing in the user's actual presentation/video
environment remains recommended.

The separate 2.5D room/controller preview is **not included** in this movie-quality
score or a new room-scene MCP/video-authoring contract. See the
[motion cycle and scope](motion-quality-plan.md) and
[browser integration limits](browser-integration.md).

## Deliberate remaining limits

There are no HTTP/OAuth transports, exposed resources/prompts, SDK-major
migration, task/progress API, or coordinated cancellation of FFmpeg exports in
this milestone. GIF/MP4 still need the optional rasterizer and external encoder.
Client roots do not override the launch-time output root. Corporate Actions
runners remain Enterprise-disabled; publication continues to rely on verified
dual pushes to the two private repositories.
