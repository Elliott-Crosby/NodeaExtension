# Renaming the extension for multi-model support

> ✅ **DONE in v0.3.0 (2026-06-17).** This plan has been executed: the extension is now
> **"Nodea Tree — Branch Maps for Claude, ChatGPT & Gemini"**, with `src/adapters/chatgpt.js`
> and `src/adapters/gemini.js` added, hosts + permissions + privacy page updated, and the
> Web Store listing copy rewritten in [`STORE-SUBMISSION.md`](./STORE-SUBMISSION.md). The
> notes below are kept as the rationale + the template for the **next** host (Grok, etc.).

> Original context: v0.2.0 shipped as **"Nodea Tree for Claude"** (Claude-only). When
> ChatGPT / Gemini / Grok adapters land, the name and listing should broaden. This note
> records how.

## Can the name be changed after launch?

**Yes.** The extension's name lives in `manifest.json` (`"name"`) and in the Web Store
listing. You can change both in any future version — the extension keeps its same item ID
and existing users get the rename via the normal auto-update. There is no penalty for
renaming.

## When you add other models, do this:

1. **Rename** to something model-neutral, e.g. **"Nodea Tree for AI Chats"** or
   **"Nodea — Branch Tree for AI Chats"**. Update both:
   - `manifest.json` → `"name"` and `"description"`
   - The Web Store listing name + description
2. **Bump `version`** (CWS requires a higher version on every upload).
3. **Add the new host(s)** to `host_permissions` and a new content-script `matches` block,
   e.g. `https://chatgpt.com/*`, `https://gemini.google.com/*`. Each new host needs its own
   adapter file under `src/adapters/` (Claude proves the pattern).
4. **Re-justify the new host permissions** in the dashboard, and update the privacy page
   (`src/app/privacy/page.tsx`) to mention the additional sites whose conversation data is
   read.
5. **Update screenshots** to show more than just Claude.

## Naming tip
Adding hosts expands what data the extension touches → expect a fresh privacy review on the
update. Keep the single-purpose statement honest ("visualize and import AI chat branch
trees") so it still covers every supported model.
