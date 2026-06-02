# Nodea Tree for Claude

A Chrome (Manifest V3) extension that surfaces Claude's **hidden branch tree** as a
Nodea-style conversation map docked on the right of `claude.ai`. This is **Version A**
(visualize, read-only) — the acquisition wedge described in the vault note
*Browser Extension — Tree for AI Chats*.

Every time you edit a prompt or retry a response in Claude, it forks a branch in its
own backend — but Claude only shows a `< 2/3 >` pager. This extension reads that tree
and draws it the way Nodea does, then offers **Open in Nodea →** to take the
conversation into the real app.

## What it does (v1)

- Reads the full conversation tree from Claude's own API (read-only, with your cookies).
- Renders it with Nodea's exact geometry and theme: dotted-grid canvas, bezier edges,
  detailed / compact / mini node cards (zoom-driven), active-path highlighting.
- Tree / Outline / Full view toggle, node count, collapse, drag-to-resize — mirroring
  the live `TreePanel`.
- Per-node colors (saved per conversation via `chrome.storage`).
- **Open in Nodea** — copies the active branch as Markdown and opens the Nodea app.
  _(The structured tree-import handshake is a follow-up; no import endpoint exists yet.)_
- Light/dark theme auto-detected from Claude.

## How to test (no localhost — load unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Open `claude.ai` and a conversation that has branches (edit/retry a message to make some).
5. The tree dock appears on the right. The toolbar icon toggles it.

After editing any file: click **↻ reload** on the extension card in `chrome://extensions`,
then refresh the Claude tab.

**Debugging:** content-script logs (`[Nodea Tree] …`) show in the normal page DevTools
console (F12 on the Claude tab). Service-worker logs are behind the "service worker"
link on the extension card.

## ⚠️ The one file that needs live recon

Everything except `src/adapters/claude.js` is host-agnostic. The adapter assumes Claude's
conversation endpoint is:

```
GET /api/organizations/{org}/chat_conversations/{convId}?tree=True&rendering_mode=messages
→ { chat_messages: [ { uuid, parent_message_uuid, sender, text|content, created_at } ], current_leaf_message_uuid }
```

This shape is reverse-engineered, not official — **verify it against the live site** before
trusting it. The fastest check (per the vault doc) is the no-code recon:

1. Open `claude.ai` with a branched chat, open DevTools → **Network**.
2. Find the `chat_conversations/<uuid>` request and inspect its JSON response.
3. Confirm the field names (`parent_message_uuid`, `sender`, `text`/`content`,
   `current_leaf_message_uuid`). If they differ, adjust `normalize()` /
   `extractText()` / `senderToRole()` in `src/adapters/claude.js`. Nothing else changes.

## File map

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest; injects on `https://claude.ai/*` |
| `src/util.js` | Constants + pure functions ported verbatim from Nodea's `TreePanel` (title/summary gen, `buildPairs`, layout, active-path) |
| `src/adapters/claude.js` | **Host adapter** — fetch + normalize Claude's tree. The recon target. |
| `src/tree.js` | Canvas renderer — grid, edges, node cards, pan/zoom/fit |
| `src/panel.js` | Panel shell — header, view toggle, outline, color menu, collapse/resize, Open-in-Nodea |
| `src/content.js` | Orchestrator — mount, fetch, SPA-navigation + poll refresh |
| `src/background.js` | Toolbar-click → toggle relay |
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

## Not in v1 (deliberately)

- ChatGPT / Gemini / Grok adapters — each is a new file under `src/adapters/`; Claude proves the pattern.
- Sticky notes, full Nodea import handshake.
