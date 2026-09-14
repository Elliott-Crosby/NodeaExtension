# 🚀 CHROME WEB STORE SUBMISSION — ACTION FILE

> **FOR THE NEXT AGENT / HUMAN:** This file is the checklist + ready-to-paste copy for
> publishing the multi-model **"Nodea Tree"** extension to the Chrome Web Store. Work top
> to bottom. Items marked **[CODE DONE]** are already implemented in this repo. Items
> marked **[DO IN DASHBOARD]** must be entered by hand at
> <https://chrome.google.com/webstore/devconsole>. Items marked **[TODO]** still need work.

Last reviewed: 2026-06-17 · Extension version: `0.3.0` · **This is the multi-model rename:**
the listing broadens from Claude-only to **Claude + ChatGPT + Gemini**. The Web Store item
keeps its existing ID; the rename + new hosts reach existing users via normal auto-update,
but **adding hosts that read personal communications triggers a fresh privacy review** —
expect extra scrutiny and keep the data form truthful (see §3).

---

## 0. Status summary

| # | Item | Status |
|---|------|--------|
| 1 | No remote code / eval / innerHTML-injection | **[CODE DONE]** — verified clean |
| 2 | MV3 manifest, icons 16/48/128, minimal perms (`storage`) | **[CODE DONE]** |
| 3 | New hosts added (chatgpt.com, chat.openai.com, gemini.google.com) | **[CODE DONE]** (2026-06-17) |
| 4 | ChatGPT + Gemini adapters + offline tests passing | **[CODE DONE]** — `node test/adapters.test.mjs` (52/52) |
| 5 | Name + description broadened, version bumped to 0.3.0 | **[CODE DONE]** |
| 6 | Privacy page covers all hosts + OpenAI/Google non-affiliation | **[CODE DONE]** — `src/app/privacy/page.tsx`; must be **deployed** before submitting |
| 7 | Privacy practices form + Limited Use cert | **[DO IN DASHBOARD]** — see §3 |
| 8 | Screenshots (1280×800 ×1–5) showing all three hosts | **[TODO]** — capture, see §4 |
| 9 | Listing copy (description, single purpose, justifications) | **[DO IN DASHBOARD]** — copy ready in §2 |
| 10 | Test account in reviewer notes | **[TODO]** — provide a working Nodea login, see §5 |
| 11 | Build a clean ZIP (no `.git`, `test/`, or `*.md`) | **[TODO]** — see §6 |
| 12 | Live-verify each host still serves the expected shape | **[TODO]** — see §7 recon checklist |

---

## 1. Pre-flight (do these before opening the dashboard)

- [ ] **Deploy the site** so `https://nodea.ai/privacy` returns 200 and shows the updated
      (multi-host) policy. The dashboard rejects a privacy URL that isn't reachable, and
      reviewers cross-check the listing against the live policy.
- [ ] Confirm `manifest.json` has **no** `localhost` entries.
- [ ] Confirm `version` is higher than the currently published one (CWS requires it). This
      repo is at `0.3.0`.
- [ ] Run the offline adapter tests: `node extension/test/adapters.test.mjs` → `ALL PASS`.
- [ ] Do the live recon in §7 — the adapter shapes are reverse-engineered, not official.

---

## 2. Listing copy — paste into the dashboard

**Name (this IS the Web Store display name — it comes from `manifest.json`):**
`Nodea Tree — Branch Maps for Claude, ChatGPT & Gemini`

**Single purpose (required field):**
> Visualizes the hidden branch tree of your Claude, ChatGPT, and Gemini conversations as
> an interactive map, and lets you open that conversation tree in the Nodea app.

**Detailed description:**
> Claude and ChatGPT quietly fork a real branch when you edit a prompt or retry a reply,
> but expose it through only a tiny pager. Nodea Tree reads those hidden trees and draws
> them as visual maps docked beside the chat. On Gemini, which does not expose a true
> branch API or branchable tree, Nodea visualizes the current path and locally preserves
> drafts you have viewed so they survive reloads.
>
> • See the full branch tree on Claude and ChatGPT; visualize the current path on Gemini.
> • Jump to a node and create a real branch through Claude or ChatGPT's native controls.
> • Gemini is visualization/import only because true Gemini branching is not technically
>   available to browser extensions.
> • "Open in Nodea" rebuilds the available map in the Nodea app (nodea.ai), preserving
>   every captured path and tagging it with the source.
>
> Your data stays in your browser while you visualize. Conversation content is only sent
> to your own Nodea account when you explicitly click "Open in Nodea". See our privacy
> policy: https://nodea.ai/privacy
>
> Not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, or Google.
> "Claude" is a trademark of Anthropic, PBC; "ChatGPT" of OpenAI; "Gemini" of Google LLC.

**Permission justifications (required per permission):**
- `storage` → "Saves per-conversation display preferences, preserves Gemini paths the user has viewed so branches survive reloads, records local structural health counts without message text, and stages the one-shot 'Open in Nodea' handoff payload. All are stored locally."
- Host `https://claude.ai/*` → "Read the user's Claude conversation tree (with their existing session) to render it, and inject the tree-panel UI."
- Host `https://chatgpt.com/*`, `https://chat.openai.com/*` → "Read the user's ChatGPT conversation tree via ChatGPT's own API, render it, and drive user-initiated native branch navigation/edit actions."
- Host `https://gemini.google.com/*` → "Read the user's Gemini conversation from the page (Gemini exposes no conversation API) to render its tree, and inject the tree-panel UI."
- Host `https://nodea.ai/*`, `https://www.nodea.ai/*` → "Deliver the 'Open in Nodea' conversation payload into the user's logged-in Nodea tab."

**Privacy policy URL:** `https://nodea.ai/privacy`

**Category:** Productivity (or Developer Tools)

---

## 3. Privacy practices form [DO IN DASHBOARD]

Declare data collection (be truthful — this is what the code actually does):
- ✅ **Personal communications** — Claude / ChatGPT / Gemini conversation messages (read; transmitted to Nodea only on user action).
- ✅ **Authentication information** — the user's Nodea email + session tokens (the extension's own login; see privacy page §1).
- ✅ **User activity** — only if you log any; otherwise leave unchecked.
- ❌ Not: health, financial, location, web history.

Certifications (check all three — they are true for this extension):
- [ ] Not selling/transferring data to third parties outside approved use cases.
- [ ] Not using/transferring data for purposes unrelated to the single purpose.
- [ ] Not using/transferring data to determine creditworthiness / for lending.

The privacy page contains the matching **Limited Use** statement reviewers look for, now
covering all four read hosts plus the OpenAI/Google non-affiliation disclaimer.

---

## 4. Screenshots [TODO]

Capture **1–5** at **1280×800** (or 640×400). Show that it's no longer Claude-only:
1. The tree panel docked on a branched **claude.ai** conversation (the hero shot).
2. The tree panel on a branched **chatgpt.com** conversation.
3. The tree panel on a **gemini.google.com** conversation.
4. The "Open in Nodea" result — the same tree rebuilt in the Nodea app, with its source logo.

Tip: load the unpacked extension (see `README.md`), open a branched chat on each host, and
screenshot at a 1280-wide window.

---

## 5. Reviewer notes [TODO]

Paste into the "Notes for reviewers" field so Google can test the gated flow:

> To test: (1) install the extension; (2) open a conversation on claude.ai, chatgpt.com,
> or gemini.google.com (on Claude/ChatGPT, edit or retry a message to create a branch);
> (3) the tree panel appears on the right; (4) sign in to the free Nodea account below
> inside the panel; (5) click "Open in Nodea" — it opens nodea.ai and rebuilds the tree.
> Test Nodea login: <EMAIL> / <PASSWORD>   ← **fill in a real working test account**

---

## 6. Build the upload ZIP [TODO]

The ZIP must contain `manifest.json` at its root and **must not** include `.git/`, the
`test/` folder, or the `*.md` docs. PowerShell, from the repo root:

```powershell
$src = "extension"
$out = "nodea-tree-0.3.0.zip"
$exclude = @(".git", ".gitignore", "test", "STORE-SUBMISSION.md", "README.md", "MULTI-MODEL-RENAME.md")
$items = Get-ChildItem $src -Force | Where-Object { $exclude -notcontains $_.Name }
Compress-Archive -Path $items.FullName -DestinationPath $out -Force
```

Verify the ZIP root has `manifest.json` directly (not nested in an `extension/` folder),
and that `src/adapters/chatgpt.js` and `src/adapters/gemini.js` are present.

---

## 7. Live recon checklist (verify before trusting the adapters) [TODO]

The adapters target reverse-engineered shapes. Confirm each on the live site (logged in,
DevTools open) before submitting — if a shape drifted, only the named adapter file changes.

- **ChatGPT** (`src/adapters/chatgpt.js`): on a chat, Network tab →
  `GET /backend-api/conversation/<id>` should return `{ mapping, current_node, title }`
  where each `mapping[id]` is `{ message, parent, children }` and `message.author.role` /
  `message.content.parts` hold role + text. The bearer token comes from
  `GET /api/auth/session` → `{ accessToken }`. If field names differ, adjust `normalize()`
  / `extractText()` / `roleOf()`.
- **Gemini** (`src/adapters/gemini.js`): on a chat, inspect the DOM for
  `<conversation-container>` elements each holding a `<user-query>` (`.query-text`) and a
  `<model-response>` (`message-content .markdown`). If the tag/class names changed, update
  the selector lists in `pickText()` / `parse()`.
- **Claude** (`src/adapters/claude.js`): unchanged from the prior submission.

---

## 8. After upload

- First review may take longer than usual because the update **adds hosts that read
  personal communications** — the privacy page + truthful data form are what get it through.
- If rejected, read the cited policy, fix, **bump the version**, re-upload.

---

## Done in this version (was the "known follow-up" in the prior submission)

The extension is no longer Claude-only. `MULTI-MODEL-RENAME.md` (the plan) is now executed:
name broadened, version bumped, ChatGPT + Gemini adapters added, hosts + permissions +
privacy page updated. ChatGPT ships native branch navigation/writing; Gemini is
**visualize + import** only because Gemini exposes no true branch API or branchable tree.
