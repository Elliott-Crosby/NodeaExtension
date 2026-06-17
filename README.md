# Nodea Tree — Branch Maps for Claude, ChatGPT & Gemini

A Chrome (Manifest V3) extension that surfaces an AI chat's **hidden branch tree** as a
Nodea-style conversation map docked on the right of the page — on `claude.ai`,
`chatgpt.com`, and `gemini.google.com`. This is the acquisition wedge described in the
vault note *Browser Extension — Tree for AI Chats*.

Every time you edit a prompt or retry a response, Claude and ChatGPT fork a branch in
their own backends — but they only show a tiny `‹ 2/3 ›` pager. This extension reads that
tree and draws it the way Nodea does, then offers **Open in Nodea →** to take the
conversation into the real app.

## Per-host support

| Host | Read (visualize) | Branch-write | How the tree is read |
|---|:--:|:--:|---|
| **Claude** (`claude.ai`) | ✅ | ✅ | Claude's conversation API (full tree, with your session) |
| **ChatGPT** (`chatgpt.com`, `chat.openai.com`) | ✅ | — | `/backend-api/conversation/<id>` mapping tree (bearer token from `/api/auth/session`) |
| **Gemini** (`gemini.google.com`) | ✅ | — | DOM of the rendered conversation (Gemini exposes no API); linear thread |

Each host is one **adapter** under `src/adapters/`; everything else is host-agnostic. The
adapter turns whatever the host exposes into the renderer's flat node shape
(`{ id, parent_id, role, content, created_at }`). Branch-**writing** (jump-to-node,
fork-from-node) needs a `*-write.js` driver — only Claude ships one today, so ChatGPT and
Gemini run **visualize-only** (the panel cleanly hides the branching controls when no write
driver is present).

## What it does (v1)

- Reads the full conversation tree from Claude's own API (read-only, with your cookies).
- Renders it with Nodea's exact geometry and theme: dotted-grid canvas, bezier edges,
  detailed / compact / mini node cards (zoom-driven), active-path highlighting.
- Tree / Outline / Full view toggle, node count, collapse, drag-to-resize — mirroring
  the live `TreePanel`.
- Per-node colors (saved per conversation via `chrome.storage`).
- **Open in Nodea** — hands the **whole branch tree** to Nodea, which rebuilds it as a
  real conversation (every branch, parent links + per-node Claude message ids preserved)
  so a later "Update Conversation" can diff & re-sync. Transport is the Nodea-side bridge
  (`src/bridge.js`); falls back to Markdown-on-clipboard if extension storage is unavailable.
- Light/dark theme auto-detected from Claude.

## How to test (no localhost — load unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Open a conversation on any supported host:
   - `claude.ai` or `chatgpt.com` — edit/retry a message first to create branches.
   - `gemini.google.com` — any chat (the thread renders as a linear tree).
5. The tree dock appears on the right. Sign in to Nodea in the panel, then the tree
   unlocks. The toolbar icon toggles the dock.

After editing any file: click **↻ reload** on the extension card in `chrome://extensions`,
then refresh the host tab.

**Debugging:** content-script logs (`[Nodea Tree] …`) show in the normal page DevTools
console (F12 on the host tab). Service-worker logs are behind the "service worker"
link on the extension card.

## ⚠️ The files that need live recon

Everything except the `src/adapters/*` files is host-agnostic. Each adapter targets a
**reverse-engineered, not official** shape — verify against the live site before trusting
it. If a shape drifted, only that one adapter changes; the renderer, panel, and bridge
don't. (`node test/adapters.test.mjs` proves the logic against fixtures, but can't catch a
live drift.)

**Claude** — `src/adapters/claude.js`:
```
GET /api/organizations/{org}/chat_conversations/{convId}?tree=True&rendering_mode=messages
→ { chat_messages: [ { uuid, parent_message_uuid, sender, text|content, created_at } ], current_leaf_message_uuid }
```
Adjust `normalize()` / `extractText()` / `senderToRole()` if `parent_message_uuid`,
`sender`, `text`/`content`, or `current_leaf_message_uuid` differ.

**ChatGPT** — `src/adapters/chatgpt.js`:
```
GET /api/auth/session            → { accessToken }
GET /backend-api/conversation/{id}  (Authorization: Bearer <accessToken>)
→ { title, current_node, mapping: { <id>: { message: { author:{role}, content:{parts|text}, create_time }, parent, children } } }
```
Adjust `normalize()` / `extractText()` / `roleOf()` if the `mapping` node shape differs.

**Gemini** — `src/adapters/gemini.js` (DOM, no API). Confirm `<conversation-container>`
holds `<user-query>` (`.query-text`) + `<model-response>` (`message-content .markdown`).
If tag/class names changed, update the selector lists in `pickText()` / `parse()`.

## File map

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest; one content-script block per host (`claude.ai`, `chatgpt.com`/`chat.openai.com`, `gemini.google.com`) + the nodea.ai bridge |
| `src/util.js` | Constants + pure functions ported verbatim from Nodea's `TreePanel` (title/summary gen, `buildPairs`, layout, active-path) |
| `src/adapters/claude.js` | **Host adapter** — fetch + normalize Claude's tree (API). |
| `src/adapters/claude-write.js` | Claude write driver — jump-to-node + fork-from-node via Claude's native UI |
| `src/adapters/chatgpt.js` | **Host adapter** — fetch + normalize ChatGPT's `mapping` tree (API + bearer token). Read-only. |
| `src/adapters/gemini.js` | **Host adapter** — parse Gemini's conversation from the DOM (no API). Read-only. |
| `src/tree.js` | Canvas renderer — grid, edges, node cards, pan/zoom/fit |
| `src/panel.js` | Panel shell — header, view toggle, outline, color menu, collapse/resize, Open-in-Nodea |
| `src/content.js` | Orchestrator — mount, fetch, SPA-navigation + poll refresh |
| `src/bridge.js` | **Nodea-side** content script — relays the "Open in Nodea" payload (stashed in `chrome.storage`) into the logged-in Nodea app tab via `postMessage` |
| `src/background.js` | Service worker — toolbar-toggle relay **+ `NX_FETCH_TREE`**: re-fetches a Claude tree (direct credentialed GET, falling back to an open claude.ai tab) for Nodea's "Update Conversation" |
| `src/theme.css` | Scoped `--nx-*` tokens mirroring `globals.css` (light + dark) |

## Write features (Version B — validated 2026-06-02 on live Claude)

Driven by `src/adapters/claude-write.js`. Everything uses Claude's OWN native controls,
so every branch created is a real Claude conversation in Claude's backend (the same tree
the reader renders). DOM contract verified live:

- **Click a node → go to that spot.** Walks the version pager (`Previous/Next version`)
  top-down to display that branch, then scrolls + flashes the message.
- **Branch from a node.** Select a node → the composer appears in the panel → type a prompt
  → **Branch ↳**. If the node has a child, it edits that child (native fork = new sibling
  continuation); if it's a leaf, it sends via the composer. Then the tree refreshes.

Known limits: nodes are matched by message text + depth (Claude exposes no message UUID in
the DOM), so **assistant-retry siblings** (identical user text) and exact-duplicate prompts
aren't individually addressable yet. User-edit branches work.

## Update sync (Claude → Nodea, validated path 2026-06-02)

Imported conversations get an **"Update"** button in Nodea's chat header. Clicking it asks the
extension (page → `bridge.js` → service worker) to re-fetch the original Claude tree by its
stored `source_conversation_id`; Nodea then diffs by `source_message_id` and appends only the
new branches. **Append-only / non-destructive** — Claude-side deletions stay in Nodea, and
in-place text edits aren't patched (Claude forks edits into new messages, which arrive as new
nodes). The service worker fetches Claude directly with your cookies; if Claude rejects the
extension-origin request, it falls back to any open `claude.ai` tab.

## Offline tests

`node test/adapters.test.mjs` loads each adapter in a `node:vm` sandbox with mocked
globals and asserts the normalization logic against representative payloads — ChatGPT's
`mapping` tree (with a real branch + system/tool/hidden nodes that must be dropped and
re-linked) and a Gemini stub DOM — then runs the output through `buildPairs` to confirm
the branch structure survives into the renderer. It also validates the manifest. This
proves the **logic**; it does not prove the live site still serves that shape — see the
recon checklist in `STORE-SUBMISSION.md` §7.

## Not yet (deliberately)

- **ChatGPT / Gemini branch-writing.** Both ship read-only (visualize + Open in Nodea).
  In-place branching needs a `chatgpt-write.js` / `gemini-write.js` driver like Claude's.
- **Gemini branches.** The DOM adapter captures the visible thread as a linear chain;
  prompt-edit versions and "Show drafts" alternatives aren't surfaced as siblings yet.
- **Grok / Copilot / others** — each is a new adapter under `src/adapters/`; Claude,
  ChatGPT, and Gemini prove the API-tree and DOM patterns.
