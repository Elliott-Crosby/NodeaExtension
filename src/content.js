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
    if (!convId) {
      // Not on a conversation page — hide the dock and give the space back
      // instead of leaving a stale tree pushing the host's layout around.
      if (panel) panel.setVisible(false)
      return
    }
    if (!force && convId === lastConvId && document.hidden) return
    try {
      const tree = await fetchTreeWithRetry()
      if (!tree) return
      // Cheap change-detection so we don't re-render on every poll. Includes
      // total content length so a streaming reply (same node count, same leaf,
      // growing text) still re-renders instead of freezing on its first chunk.
      let chars = 0
      for (const n of tree.nodes) chars += (n.content || '').length
      const sig = convId + ':' + tree.nodes.length + ':' + (tree.currentLeaf || '') + ':' + chars
      if (!force && sig === lastSig) return
      lastSig = sig
      lastConvId = convId
      ensurePanel().setVisible(true)
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

  const norm = function (s) { return (s || '').replace(/\s+/g, ' ').trim() }
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  // After forking a prompt into Claude, poll the conversation tree until the new
  // user message (and ideally its reply) appears, so we can hand its real Claude
  // id back to Nodea. `before` is the set of the parent's user-children that
  // existed pre-fork, so the new sibling is whatever's not in it.
  async function pollForNewChild(parentId, before, text) {
    const want = norm(text)
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      let tree
      try { tree = await NX.adapter.fetchTree() } catch (e) { continue }
      const nodes = tree.nodes || []
      const candidates = nodes.filter(function (n) {
        return n.parent_id === parentId && n.role === 'user' && !before.has(n.id)
      })
      if (!candidates.length) continue
      const chosen =
        candidates.find(function (n) { return norm(n.content) === want }) ||
        candidates.sort(function (a, b) { return +new Date(b.created_at) - +new Date(a.created_at) })[0]
      if (!chosen) continue
      const reply = nodes.find(function (n) {
        return n.parent_id === chosen.id && n.role === 'assistant' && (n.content || '').trim()
      })
      if (reply) return { userId: chosen.id, assistantId: reply.id }
      // Prompt landed but the reply is still streaming — wait a bit, then return
      // the prompt id alone so at least the branch is recorded.
      if (i > 15) return { userId: chosen.id, assistantId: null }
    }
    return null
  }

  // Replay Nodea-authored prompts into Claude, one at a time, returning a result
  // per item. Anchors each prompt either on an existing Claude node ('source') or
  // on a prompt pushed earlier this run ('localUser', resolved via `session`).
  async function pushBranches(expectedConvId, items) {
    const results = []
    const session = new Map() // localUserId → { userId, assistantId } discovered in Claude
    for (const item of items) {
      const r = { localUserId: item.localUserId, ok: false }
      try {
        if (NX.adapter.conversationIdFromUrl() !== expectedConvId) {
          r.error = 'not on the target conversation'; results.push(r); continue
        }
        const pr = item.parentRef || {}
        let targetClaudeId = null
        if (pr.kind === 'source') targetClaudeId = pr.id
        else if (pr.kind === 'localUser') {
          const resolved = session.get(pr.id)
          targetClaudeId = resolved && resolved.assistantId
        }
        if (!targetClaudeId) { r.error = 'branch point not in Claude yet'; results.push(r); continue }

        const tree = await NX.adapter.fetchTree()
        const nodes = tree.nodes || []
        const pairs = NX.buildPairs(nodes)
        let targetPair = pairs.find(function (p) { return p.aiNode && p.aiNode.id === targetClaudeId })
        if (!targetPair) targetPair = pairs.find(function (p) { return p.userNode && p.userNode.id === targetClaudeId })
        if (!targetPair) { r.error = 'branch point not found in Claude tree'; results.push(r); continue }

        const before = new Set(
          nodes.filter(function (n) { return n.parent_id === targetClaudeId && n.role === 'user' })
               .map(function (n) { return n.id })
        )

        const fork = await NX.write.forkFromNode(pairs, targetPair, item.text)
        if (!fork || !fork.ok) { r.error = (fork && fork.reason) || 'could not create branch'; results.push(r); continue }

        const found = await pollForNewChild(targetClaudeId, before, item.text)
        if (!found) { r.error = 'branch created but new id not found'; results.push(r); continue }

        r.ok = true
        r.claudeUserId = found.userId
        r.claudeAssistantId = found.assistantId || null
        session.set(item.localUserId, { userId: found.userId, assistantId: found.assistantId || null })
        results.push(r)
      } catch (e) {
        r.error = (e && e.message) || 'push error'
        results.push(r)
      }
    }
    // Refresh the panel so the user sees the new branches that just landed.
    try { NX.requestRefresh() } catch (e) {}
    return results
  }

  // Messages from the toolbar / service worker.
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg) return
      if (msg.type === 'NX_TOGGLE') { ensurePanel().toggle(); return }
      // Readiness probe used by the service worker before it drives a push.
      if (msg.type === 'NX_PING') {
        sendResponse({ ok: true, convId: NX.adapter.conversationIdFromUrl() })
        return
      }
      // The service worker fell back to us: fetch a tree from inside the
      // claude.ai page context (guaranteed-good auth) for "Update Conversation".
      if (msg.type === 'NX_FETCH_TREE_IN_PAGE') {
        NX.adapter
          .fetchTreeById(msg.convId)
          .then(function (tree) { sendResponse({ ok: true, tree: tree }) })
          .catch(function (e) { sendResponse({ ok: false, error: (e && e.message) || 'fetch failed' }) })
        return true // keep the channel open for the async response
      }
      // Reverse sync: replay Nodea-authored branches into this Claude conversation.
      if (msg.type === 'NX_PUSH_IN_PAGE') {
        pushBranches(msg.convId, Array.isArray(msg.items) ? msg.items : [])
          .then(function (results) { sendResponse({ ok: true, results: results }) })
          .catch(function (e) { sendResponse({ ok: false, error: (e && e.message) || 'push failed' }) })
        return true // keep the channel open for the (long-running) async response
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
