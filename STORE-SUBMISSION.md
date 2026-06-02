# 🚀 CHROME WEB STORE SUBMISSION — ACTION FILE

> **FOR THE NEXT AGENT / HUMAN:** This file is the checklist + ready-to-paste copy for
> publishing "Nodea Tree for Claude" to the Chrome Web Store. Work top to bottom.
> Items marked **[CODE DONE]** are already implemented in this repo. Items marked
> **[DO IN DASHBOARD]** must be entered by hand at
> <https://chrome.google.com/webstore/devconsole>. Items marked **[TODO]** still need work.

Last reviewed: 2026-06-02 · Extension version: `0.2.0`

---

## 0. Status summary

| # | Item | Status |
|---|------|--------|
| 1 | No remote code / eval / innerHTML-injection | **[CODE DONE]** — verified clean |
| 2 | MV3 manifest, icons 16/48/128, minimal perms (`storage`) | **[CODE DONE]** |
| 3 | Remove `localhost` host permissions for prod build | **[CODE DONE]** (2026-06-02) |
| 4 | Privacy policy page live at `nodea.ai/privacy` | **[CODE DONE]** — `src/app/privacy/page.tsx`; must be **deployed** before submitting |
| 5 | Anthropic non-affiliation disclaimer | **[CODE DONE]** in privacy page + listing copy below |
| 6 | Privacy practices form + Limited Use cert | **[DO IN DASHBOARD]** — see §3 |
| 7 | Screenshots (1280×800 ×1–5) | **[TODO]** — capture, see §4 |
| 8 | Listing copy (description, single purpose, justifications) | **[DO IN DASHBOARD]** — copy ready in §2 |
| 9 | Test account in reviewer notes | **[TODO]** — provide a working Nodea login, see §5 |
| 10 | Build a clean ZIP (no `.git`, no `STORE-SUBMISSION.md`) | **[TODO]** — see §6 |

---

## 1. Pre-flight (do these before opening the dashboard)

- [ ] **Deploy the site** so `https://nodea.ai/privacy` returns 200. The dashboard rejects a privacy URL that isn't reachable.
- [ ] Confirm `manifest.json` has **no** `localhost` entries (already removed).
- [ ] Bump `version` in `manifest.json` if re-submitting after a rejection (CWS requires a higher version each upload).

---

## 2. Listing copy — paste into the dashboard

**Name:** `Nodea Tree for Claude — Branch Map for claude.ai`
(Claude-only for now — kept deliberately explicit. See `MULTI-MODEL-RENAME.md` before broadening.)

**Single purpose (required field):**
> For Claude (claude.ai) only. Visualizes the hidden branch tree of your Claude.ai
> conversations as an interactive map, and lets you open that conversation tree in the
> Nodea app.

**Short / detailed description:**
> Claude quietly forks a new branch every time you edit a prompt or retry a reply — but
> it only shows a tiny `< 2/3 >` pager. Nodea Tree for Claude reads that hidden tree and
> draws it as a visual conversation map docked beside claude.ai: dotted-grid canvas,
> branch edges, zoomable node cards, and active-path highlighting.
>
> • See every branch of a conversation at a glance.
> • Click a node to jump to that point in the chat.
> • Branch from any node using Claude's own native controls.
> • "Open in Nodea" rebuilds the whole tree in the Nodea app (nodea.ai), preserving every
>   branch — then keep it in sync with "Update Conversation".
>
> Your data stays in your browser while you visualize. Conversation content is only sent
> to your Nodea account when you explicitly click "Open in Nodea". See our privacy policy:
> https://nodea.ai/privacy
>
> Not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" is a trademark of
> Anthropic, PBC.

**Permission justifications (required per permission):**
- `storage` → "Saves per-conversation display preferences (e.g. node colors) locally and stages the one-shot 'Open in Nodea' handoff payload."
- Host `https://claude.ai/*` → "Read the user's conversation tree (with their existing session) to render it, and inject the tree panel UI."
- Host `https://nodea.ai/*`, `https://www.nodea.ai/*` → "Deliver the 'Open in Nodea' conversation payload into the user's logged-in Nodea tab."

**Privacy policy URL:** `https://nodea.ai/privacy`

**Category:** Productivity (or Developer Tools)

---

## 3. Privacy practices form [DO IN DASHBOARD]

Declare data collection (be truthful — this is what the code actually does):
- ✅ **Personal communications** — Claude conversation messages (read; transmitted to Nodea only on user action).
- ✅ **User activity** — only if you log any; otherwise leave unchecked.
- ❌ Not: health, financial, location, web history, authentication info.

Certifications (check all three — they are true for this extension):
- [ ] Not selling/transferring data to third parties outside approved use cases.
- [ ] Not using/transferring data for purposes unrelated to the single purpose.
- [ ] Not using/transferring data to determine creditworthiness / for lending.

The privacy page (§4 item 4) contains the matching **Limited Use** statement reviewers look for.

---

## 4. Screenshots [TODO]

Capture **1–5** at **1280×800** (or 640×400). Suggested shots:
1. The tree panel docked on a branched claude.ai conversation (the hero shot).
2. A zoomed-in node card / active-path highlight.
3. The "Open in Nodea" result — the same tree rebuilt in the Nodea app.

Tip: load the unpacked extension (see `README.md`), open a branched Claude chat, and screenshot at a 1280-wide window.

---

## 5. Reviewer notes [TODO]

Paste into the "Notes for reviewers" field so Google can test the gated flow:

> To test "Open in Nodea": (1) install the extension, (2) open a claude.ai conversation
> with branches (edit or retry a message to create one), (3) the tree panel appears on
> the right, (4) click "Open in Nodea" — it opens nodea.ai and rebuilds the tree.
> Test Nodea login: <EMAIL> / <PASSWORD>   ← **fill in a real working test account**

---

## 6. Build the upload ZIP [TODO]

The ZIP must contain `manifest.json` at its root and **must not** include `.git/`,
`LICENSE` is fine, but exclude this file and the README is optional.

PowerShell, from the repo root:

```powershell
$src = "extension"
$out = "nodea-tree-for-claude-0.2.0.zip"
$exclude = @(".git", "STORE-SUBMISSION.md", "README.md")
$items = Get-ChildItem $src -Force | Where-Object { $exclude -notcontains $_.Name }
Compress-Archive -Path $items.FullName -DestinationPath $out -Force
```

Verify the ZIP root has `manifest.json` directly (not nested in an `extension/` folder).

---

## 7. After upload

- First review typically takes a few days; extensions reading personal communications
  may get extra scrutiny — the privacy page + truthful data form are what get it through.
- If rejected, read the cited policy, fix, **bump the version**, re-upload.

---

## ⚠️ Known follow-up (not a blocker for this submission)

The extension name is **"Nodea Tree for Claude"** and is Claude-only today. Multi-model
support (ChatGPT/Gemini/etc.) is planned — see the rename note in
[`MULTI-MODEL-RENAME.md`](./MULTI-MODEL-RENAME.md) for how to evolve the name/listing later.
