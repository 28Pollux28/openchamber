# Agent Canvas

The agent builds standalone HTML views (dashboards, comparisons, audits, timelines) and shows them in a dedicated panel next to the chat, with versions, a project canvas list, and reopening. Modeled on Canvas in Cursor. Today the closest thing is the agent writing an `.html` file and opening it in a browser tab, which reads as a demo, not a result.

## Settled decisions

- Storage lives in the instance data dir, not the repository. The workspace stays clean and canvases survive branch switches. A "save copy to project" action comes later.
- A separate managed tool `openchamber_canvas` with its own `agentCanvasToolEnabled` setting, following the pattern of `agentControlToolEnabled` and `agentWebToolEnabled` in the settings registry.
- The source view is read-only in v1, with copy. Manual editing arrives in a later phase.
- The first step is the full MVP: tool, panel, chat card, versions, canvas list, on web and desktop.

## Naming

"Canvas" already means something in this repo: file editors with their own document model (`FileCanvasHandle`, the Excalidraw editor). That meaning stays with the editors. This feature is "Agent Canvas" in docs and settings copy; the panel tab label is "Canvas". The two never share a page, but every doc that mentions both should keep the distinction.

## How it works

1. The model decides a result reads better as a view, or the user asks for one, and calls `canvas.update { title, html }`.
2. The server stores the canvas as a new version, broadcasts `openchamber:canvas-updated`, and answers `{ id, title, version }`.
3. Chat renders a card for the tool call: title, version, an Open button.
4. Open shows a Canvas tab in the context panel: toolbar (version picker, canvas list, rendered/source), sandboxed iframe with the document.
5. Iteration rewrites the whole document through `canvas.update`, which records a new version. "Rerun with fresh data" is `canvas.read`, then a new `canvas.update`.

## Why not an extension

Extensions cannot give the model a new tool: `contributes.tools` only restyles calls of tools that already exist. A service extension runs only for a fixed host role (today, `browser`), and an extension panel is an iframe with no path into the chat, so the card would still be core code. The tool, storage, and card belong to the app. Extensions may later contribute renderers; that is a P4 idea.

## Server: `packages/web/server/lib/canvas/`

- `store.js` owns identity and layout. One canvas is `<dataDir>/canvas/<projectId>/<canvasId>/` holding `meta.json` plus `v<n>.html`. Writes use temp file plus rename. Limits: 2 MB of HTML per version, 20 versions retained, 100 canvases per project. Delete removes the directory.
- `service.js` creates or updates, lists, and reads. List returns metadata only. Read returns the requested or the latest version. Concurrent updates serialize per canvas; the last write lands as a new version, nothing merges.
- `routes.js` exposes authenticated routes like the rest of `/api`: list (`GET /api/canvas`), meta (`GET /api/canvas/:id`), content (`GET /api/canvas/:id/v/:n`), write (`POST /api/canvas`), delete (`DELETE /api/canvas/:id`). Content responses carry the same CSP as the frame.
- The SSE event goes out through the existing control stream, named `openchamber:canvas-updated` after `openchamber:file-open-request`.

Project scoping resolves the way `file.open` does: the session's directory, then the owning project. A request with no directory is an error, never a write to a guessed project.

## Control service and agent tool

- `openchamber-control/actions.js` adds `canvas.update`, `canvas.list`, and `canvas.read`, all agent-exposed. `service.js` executes them; `canvas.update` returns `{ id, title, version }`, echoing the shape `file.open` already returns.
- `agent-tool/runtime.js` registers a fourth managed tool, `openchamber_canvas`, next to `openchamber`, `openchamber_web`, `openchamber_memory`, and `openchamber_notify`, behind `agentCanvasToolEnabled` (default on). The managed config file rewrite applies within seconds, so no restart.
- The tool description carries the policy: prefer canvas for dashboards, comparisons, audits, timelines, and reports the user will look at rather than quote; keep markdown for short answers; keep `browser.*` for running apps and live pages. A file the user asked to edit is still written with `write` and shown with `file.open`.

## UI: `packages/ui`

- `lib/openchamberEvents.ts` parses `openchamber:canvas-updated`.
- `stores/useCanvasStore.ts` keeps canvases per runtime and project, mirrors authoritative snapshots, keeps load errors distinct from empty lists, and clears on runtime reset. Versions stay server-side; the store holds metadata.
- The managed tool family currently renders through the neutral JSON views. `canvas.update` gets the first tool-specific card: title, version count, an Open button, and the error inline on failure. The branch lives in `lib/opencode/tools.ts` and `ToolPart.tsx`, lazy like other heavy bodies.
- `ContextPanel` gains a `canvas` tab mode with its own toolbar: title, version picker, canvas list, rendered/source toggle. The frame is `sandbox="allow-scripts"` with no same-origin, delivered as srcDoc after `runtimeFetch`, so direct and relay both work.
- Command palette: "Open Canvas".
- Settings: General → OpenChamber Tools gains the new toggle, declared once in the settings registry, translated in all 12 locales.

## Security

- Agent HTML is untrusted input. The iframe has an opaque origin, no popups, no top navigation, no same-origin API access. The host prepends a CSP meta: `default-src 'none'`, inline style and script allowed, images and fonts from `data:` and `blob:`, `connect-src 'none'`. An author's own CSP can narrow it and never widen it.
- Saved-version responses carry the same CSP as headers, so opening a canvas file directly cannot script against the app origin.
- Limits keep a runaway tool visible: per-version and per-project caps, atomic writes, and a failed write that leaves the previous version intact while the tool reports the error.
- A canvas deleted while its tab is open shows a gone state, not a silent empty success.
- Tokens, paths, and credentials never enter canvas content; the frame never receives them.

## Phases

- P1 (MVP): everything above, web and desktop, read-only source.
- P2: manual source editing (write route, dirty state, conflict handling), restore a version as current, save copy to project, fullscreen, and an explicit mobile decision (viewer-only at minimum).
- P3: a built-in canvas skill for consistent layouts, plus export. Cursor-style share links are a separate conversation, because a share link is a way into this machine and needs the enterprise-boundary review first.
- P4 (optional): a service provider role for extension renderers, after the `browser` provider precedent.

## Validation

- Focused server tests for store, service, and routes: round-trip, limits, malformed input, failed-write rollback, concurrent updates, delete while open.
- UI package type-check and lint, component tests for the card and panel states, `bun run dead-code` for the new files and exports, `bunx oxlint` on files I author.
- Manual: desktop web and Electron, direct and relay, the tool toggled off and on mid-session, a canvas tab open across a runtime switch.
