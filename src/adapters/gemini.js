// Nodea Tree — Gemini (gemini.google.com) data adapter.
//
// Same contract as the other adapters: produce a flat list of
//   { id, parent_id, role: 'user'|'assistant', content, created_at }
//
// Unlike Claude and ChatGPT, Gemini exposes NO clean conversation API — the app
// talks to an obfuscated `batchexecute` RPC whose shape changes often and whose
// payloads aren't safe to depend on. So this adapter reads the rendered DOM
// instead: Gemini lays each turn out as a <conversation-container> holding one
// <user-query> and one <model-response>. We walk those top→bottom (chronological)
// and build a LINEAR chain — turn N's user node hangs off turn N-1's answer.
//
// Consequences of the DOM approach (honest limits):
//   • Branches (prompt edits / "Show drafts" alternatives) aren't surfaced as
//     siblings yet — only the thread Gemini currently shows is captured.
//   • Gemini exposes no per-message id or timestamp in the DOM, so we synthesize
//     stable, deterministic ones from the turn index (same input → same output,
//     which keeps the panel's change-detection from re-rendering on every poll).
// Read-only (Version A): no NX.write, so the panel runs in visualize-only mode.
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})

  // Deterministic synthetic timestamps (Gemini gives us none). A fixed epoch +
  // turn offset preserves order without ever depending on the wall clock.
  const BASE_TIME = Date.parse('2020-01-01T00:00:00Z')

  // Conversation id from gemini.google.com[/u/N]/app/<id>. A brand-new chat has
  // no id until the first exchange; fall back to a sentinel so a visible thread
  // still renders during that brief window.
  function conversationIdFromUrl() {
    const m = location.pathname.match(/\/app\/([\w-]+)/)
    if (m) return m[1]
    return null
  }

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()

  // First non-empty text from a list of selectors, scoped to `root`.
  function pickText(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel)
      if (el) {
        const t = norm(el.textContent)
        if (t) return t
      }
    }
    return ''
  }

  // Parse a document into the flat node list. Pure (takes the document + conv id)
  // so the offline test harness can drive it with a stub DOM.
  function parse(doc, convId) {
    const id = convId || 'gemini-current'
    let containers = Array.prototype.slice.call(doc.querySelectorAll('conversation-container'))
    // Fallback for DOM revisions that drop the container element: pair the raw
    // <user-query> / <model-response> custom elements by document order.
    if (!containers.length) {
      const queries = doc.querySelectorAll('user-query, [data-test-id="user-query"]')
      if (queries.length) containers = Array.prototype.slice.call(queries).map((q) => q.parentElement || q)
    }

    const nodes = []
    let prevAssistantId = null
    let turn = 0
    containers.forEach((c) => {
      const userText = pickText(c, [
        'user-query .query-text',
        '.query-text',
        '[data-test-id="user-query"] .query-text',
        'user-query',
      ])
      const modelText = pickText(c, [
        'model-response message-content .markdown',
        'model-response .markdown',
        'message-content .markdown',
        'model-response message-content',
        'model-response',
        '[data-test-id="model-response"]',
      ])
      if (!userText && !modelText) return

      const t = turn++
      const userId = 'gem-' + id + '-' + t + '-u'
      if (userText) {
        nodes.push({
          id: userId,
          parent_id: prevAssistantId,
          role: 'user',
          content: userText,
          created_at: new Date(BASE_TIME + t * 60000).toISOString(),
        })
      }
      if (modelText) {
        const aiId = 'gem-' + id + '-' + t + '-a'
        nodes.push({
          id: aiId,
          parent_id: userText ? userId : prevAssistantId,
          role: 'assistant',
          content: modelText,
          created_at: new Date(BASE_TIME + t * 60000 + 1000).toISOString(),
        })
        prevAssistantId = aiId
      } else if (userText) {
        // Answer still streaming — leave the user prompt as the active leaf.
        prevAssistantId = userId
      }
    })

    const name =
      (nodes.length && NX.generateTitle ? NX.generateTitle(nodes[0].content) : '') ||
      'Gemini conversation'
    return { id, name, nodes, currentLeaf: prevAssistantId }
  }

  // Best-effort "jump to this node": find the rendered turn by role + text and
  // scroll/flash it. The DOM only holds the thread Gemini currently shows, so a
  // node it can't find is a no-op (returns false).
  function revealNode(node) {
    if (!node) return false
    const want = norm(node.content).slice(0, 160)
    if (!want) return false
    const sel = node.role === 'user' ? 'user-query' : 'model-response'
    const els = document.querySelectorAll(sel)
    for (const el of els) {
      if (norm(el.textContent).indexOf(want) !== -1) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const prev = el.style.boxShadow
        el.style.transition = 'box-shadow .2s'
        el.style.boxShadow = '0 0 0 3px #7c3aed'
        setTimeout(() => { el.style.boxShadow = prev }, 1300)
        return true
      }
    }
    return false
  }

  NX.adapter = {
    host: 'gemini',
    source: 'gemini', // tags the "Open in Nodea" payload (see AI_SOURCES)
    displayName: 'Gemini',
    conversationIdFromUrl,
    revealNode,
    _parse: parse, // test seam

    async fetchTree() {
      // The DOM IS the source of truth — no network call.
      return parse(document, conversationIdFromUrl())
    },

    async fetchTreeById(convId) {
      // Gemini's DOM only ever holds the open conversation; only the active one
      // is readable. Returns it when the id matches, else null.
      const cur = conversationIdFromUrl()
      if (convId && cur && convId !== cur) return null
      return parse(document, cur)
    },
  }
})()
