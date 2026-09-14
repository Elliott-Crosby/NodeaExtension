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
  const CACHE_PREFIX = 'nx-gemini-tree:'
  const DIAGNOSTICS_KEY = 'nx-gemini-diagnostics'

  // Conversation id from gemini.google.com[/u/N]/app/<id>. A brand-new chat has
  // no id until the first exchange; fall back to a sentinel so a visible thread
  // still renders during that brief window.
  function conversationIdFromUrl() {
    const m = location.pathname.match(/\/app\/([\w-]+)/)
    if (m) return m[1]
    return null
  }

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()

  // Gemini does not expose message ids. Derive compact deterministic ids from
  // the path + content instead of the turn index so alternate prompts/drafts
  // become real siblings and can be merged with paths seen in earlier page
  // loads. FNV-1a is sufficient here: these are local UI identities, not
  // security tokens.
  function hashText(value) {
    let h = 0x811c9dc5
    const s = String(value || '')
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(36)
  }

  function nodeId(convId, parentId, role, content) {
    return 'gem-' + convId + '-' + hashText((parentId || 'root') + '|' + role + '|' + norm(content))
  }

  // Visible text of an element, minus Gemini's screen-reader-only labels. Gemini
  // injects `.cdk-visually-hidden` spans ("You said", "Gemini said") that
  // textContent would otherwise pull in — so a prompt reads "You said <prompt>"
  // and every node title is prefixed. Strip them on a clone before reading.
  function visibleText(el) {
    if (typeof el.cloneNode === 'function' && typeof el.querySelectorAll === 'function') {
      const clone = el.cloneNode(true)
      clone.querySelectorAll('.cdk-visually-hidden').forEach((n) => n.remove())
      return norm(clone.textContent)
    }
    return norm(el.textContent)
  }

  // First non-empty text from a list of selectors, scoped to `root`.
  function pickText(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel)
      if (el) {
        const t = visibleText(el)
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
      const userId = nodeId(id, prevAssistantId, 'user', userText)
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
        const aiId = nodeId(id, userText ? userId : prevAssistantId, 'assistant', modelText)
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

  // Gemini only renders the currently selected path. Keep a local union of the
  // paths the user has actually viewed so branches do not vanish on reload or
  // when Gemini switches which draft/path is present in the DOM.
  function mergeTrees(cached, live) {
    if (!cached || cached.id !== live.id) return live
    const byId = new Map()
    ;(cached.nodes || []).forEach((n) => byId.set(n.id, n))
    ;(live.nodes || []).forEach((n) => byId.set(n.id, n))
    return {
      id: live.id,
      name: live.name || cached.name,
      nodes: Array.from(byId.values()),
      currentLeaf: live.currentLeaf || cached.currentLeaf || null,
    }
  }

  async function loadCachedTree(convId) {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return null
      const key = CACHE_PREFIX + convId
      const result = await chrome.storage.local.get(key)
      return result && result[key] ? result[key] : null
    } catch (_) { return null }
  }

  async function saveCachedTree(tree) {
    try {
      if (!tree || !tree.id || !tree.nodes.length || !chrome || !chrome.storage || !chrome.storage.local) return
      const item = {}
      item[CACHE_PREFIX + tree.id] = tree
      await chrome.storage.local.set(item)
    } catch (_) {}
  }

  // Keep only structural health signals. Never store message text, URLs, or
  // account identifiers in diagnostics.
  async function recordDiagnostics(patch) {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return
      const result = await chrome.storage.local.get(DIAGNOSTICS_KEY)
      const previous = (result && result[DIAGNOSTICS_KEY]) || {}
      const item = {}
      item[DIAGNOSTICS_KEY] = Object.assign({}, previous, patch)
      await chrome.storage.local.set(item)
    } catch (_) {}
  }

  async function clearCachedTree(convId) {
    try {
      if (!convId || !chrome || !chrome.storage || !chrome.storage.local) return false
      await chrome.storage.local.remove(CACHE_PREFIX + convId)
      await recordDiagnostics({ lastCacheClearAt: new Date().toISOString() })
      return true
    } catch (_) { return false }
  }

  async function persistentTree(convId) {
    try {
      const live = parse(document, convId)
      const cached = await loadCachedTree(convId)
      const merged = mergeTrees(cached, live)
      if (live.nodes.length) await saveCachedTree(merged)
      await recordDiagnostics({
        lastSuccessAt: new Date().toISOString(),
        lastResult: live.nodes.length ? 'ok' : 'empty_dom',
        liveNodeCount: live.nodes.length,
        cachedNodeCount: cached && cached.nodes ? cached.nodes.length : 0,
        mergedNodeCount: merged.nodes.length,
      })
      return merged
    } catch (error) {
      await recordDiagnostics({
        lastFailureAt: new Date().toISOString(),
        lastResult: 'adapter_failure',
        errorKind: error && error.name ? String(error.name).slice(0, 80) : 'Error',
      })
      throw error
    }
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

  // Gemini pins its whole app shell to the full viewport width — <html>, <body>,
  // <chat-app-orchestrator>, <chat-app> and <main.chat-app> are all 100vw — and
  // clips horizontal overflow on <html>. The panel's default push (a right
  // margin on <body>) therefore shifts nothing: body's box moves but its width
  // stays 100vw, so the chat keeps its full width and slides UNDER the dock.
  // Fix: shrink the shell by narrowing <html> itself. Everything inside is
  // width:100%, so it reflows in one step. Empty at width 0 (panel hidden) so
  // Gemini reclaims the full viewport. Verified live on gemini.google.com
  // 2026-07-22: main's right edge tracks 100vw − width exactly.
  function pushContentCSS(width) {
    const w = Math.max(0, width | 0)
    if (!w) return ''
    return (
      'html{width:calc(100vw - ' + w + 'px)!important;min-width:0!important;overflow-x:hidden!important}' +
      'body{width:100%!important;min-width:0!important;margin-right:0!important;transform:translateX(0)!important}'
    )
  }

  NX.adapter = {
    host: 'gemini',
    source: 'gemini', // tags the "Open in Nodea" payload (see AI_SOURCES)
    displayName: 'Gemini',
    conversationIdFromUrl,
    revealNode,
    pushContentCSS,
    clearCachedTree,
    _parse: parse, // test seam
    _mergeTrees: mergeTrees,

    async fetchTree() {
      // The live DOM supplies the current path; local storage preserves other
      // paths/drafts observed previously for the same conversation.
      return persistentTree(conversationIdFromUrl())
    },

    async fetchTreeById(convId) {
      // Gemini's DOM only ever holds the open conversation; only the active one
      // is readable. Returns it when the id matches, else null.
      const cur = conversationIdFromUrl()
      if (convId && cur && convId !== cur) return null
      return persistentTree(cur)
    },
  }
})()
