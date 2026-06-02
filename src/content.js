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
      const tree = await NX.adapter.fetchTree()
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
      // Adapter shape mismatch or auth hiccup — surface once for debugging.
      console.warn('[Nodea Tree] refresh failed:', e && e.message)
    }
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

  // Toolbar action → toggle panel.
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'NX_TOGGLE') ensurePanel().toggle()
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
