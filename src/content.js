// Nodea Tree for Claude — orchestrator.
// Mounts the panel, fetches the conversation tree, and keeps it fresh across
// claude.ai's SPA navigation (URL changes without full reloads).
(function () {
  'use strict'
  const NX = window.NX
  if (!NX || !NX.Panel || !NX.adapter) return

  let panel = null
  let lastConvId = null
  let lastSig = ''

  function ensurePanel() {
    if (!panel) panel = new NX.Panel()
    return panel
  }

  async function refresh(force) {
    const convId = NX.adapter.conversationIdFromUrl()
    if (!convId) return // not on a conversation page
    if (!force && convId === lastConvId && document.hidden) return
    try {
      const tree = await fetchTreeWithRetry()
      if (!tree) return
      // Cheap change-detection so we don't re-render on every poll.
      const sig = convId + ':' + tree.nodes.length + ':' + (tree.currentLeaf || '')
      if (!force && sig === lastSig) return
      lastSig = sig
      lastConvId = convId
      ensurePanel().update({
        nodes: tree.nodes,
        convId: tree.id,
        convName: tree.name,
        currentLeaf: tree.currentLeaf,
      })
    } catch (e) {
      // Transient "Failed to fetch" happens during page load / SPA nav; the next
      // poll recovers. Log at debug level so it doesn't surface as an extension
      // error. A persistent failure here means the adapter shape needs a look.
      console.debug('[Nodea Tree] tree fetch unavailable (will retry):', e && e.message)
    }
  }

  // Fetch the tree with a short backoff — rides out load-time network races
  // ("Failed to fetch") instead of waiting a full poll cycle.
  async function fetchTreeWithRetry() {
    let lastErr
    for (let i = 0; i < 3; i++) {
      try {
        return await NX.adapter.fetchTree()
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 500 * (i + 1)))
      }
    }
    throw lastErr
  }

  // Detect SPA URL changes (pushState / popstate).
  function watchUrl() {
    let last = location.href
    const fire = function () {
      if (location.href !== last) {
        last = location.href
        lastSig = ''
        refresh(true)
      }
    }
    ;['pushState', 'replaceState'].forEach(function (m) {
      const orig = history[m]
      history[m] = function () {
        const r = orig.apply(this, arguments)
        setTimeout(fire, 50)
        return r
      }
    })
    window.addEventListener('popstate', function () { setTimeout(fire, 50) })
  }

  // Let the panel request a fresh tree fetch (e.g. after creating a branch).
  NX.requestRefresh = function () { refresh(true) }

  // Messages from the toolbar / service worker.
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg) return
      if (msg.type === 'NX_TOGGLE') { ensurePanel().toggle(); return }
      // The service worker fell back to us: fetch a tree from inside the
      // claude.ai page context (guaranteed-good auth) for "Update Conversation".
      if (msg.type === 'NX_FETCH_TREE_IN_PAGE') {
        NX.adapter
          .fetchTreeById(msg.convId)
          .then(function (tree) { sendResponse({ ok: true, tree: tree }) })
          .catch(function (e) { sendResponse({ ok: false, error: (e && e.message) || 'fetch failed' }) })
        return true // keep the channel open for the async response
      }
    })
  } catch (e) {}

  function start() {
    if (!NX.adapter.conversationIdFromUrl()) {
      // Wait for the user to open a conversation.
    } else {
      ensurePanel()
      refresh(true)
    }
    watchUrl()
    // Light poll to catch new branches / messages within a conversation.
    setInterval(function () { refresh(false) }, 4000)
    window.addEventListener('focus', function () { refresh(true) })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
