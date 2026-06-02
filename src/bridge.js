// Nodea Tree for Claude — Nodea-side bridge.
//
// Runs as a content script on the Nodea app (nodea.ai / localhost). It connects
// the Nodea page (which can't reach claude.ai) to the extension. Two flows:
//
//   IMPORT  (Claude → Nodea, one-shot handoff from "Open in Nodea"):
//     bridge → page :  { __nodea: 'ext-ready' }                  (bridge present)
//     page   → bridge: { __nodea: 'app-ready' }                  (listener mounted)
//     bridge → page :  { __nodea: 'import-data', payload }       (here's the tree)
//
//   UPDATE  (Nodea → Claude → Nodea, on the "Update Conversation" button):
//     page   → bridge: { __nodea: 'ping' }                       (is the ext here?)
//     bridge → page :  { __nodea: 'ext-present' }
//     page   → bridge: { __nodea: 'update-request', requestId, sourceConversationId, sourceOrgId }
//     bridge → SW    : chrome.runtime NX_FETCH_TREE  → tree
//     bridge → page :  { __nodea: 'update-result', requestId, ok, tree | error }
//
// A content script shares the page's window for postMessage but lives in an
// isolated world, so all page traffic goes through window.postMessage. We only
// trust same-window, same-origin messages.
(function () {
  'use strict'

  function post(msg) {
    try { window.postMessage(msg, window.location.origin) } catch (e) {}
  }

  // ── Import handoff ─────────────────────────────────────────────────────────
  function readPending() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get('nx_import', function (res) {
          if (chrome.runtime && chrome.runtime.lastError) return resolve(null)
          resolve((res && res.nx_import) || null)
        })
      } catch (e) {
        resolve(null)
      }
    })
  }
  function clearPending() {
    try { chrome.storage.local.remove('nx_import', function () { void chrome.runtime.lastError }) } catch (e) {}
  }

  let delivered = false
  const pendingPromise = readPending()

  async function deliver() {
    if (delivered) return
    const payload = await pendingPromise
    if (!payload || delivered) return
    delivered = true
    clearPending()
    console.info('[Nodea bridge] delivering import (' + ((payload.nodes || []).length) + ' nodes) to', window.location.origin)
    post({ __nodea: 'import-data', payload: payload })
  }

  // ── Update: relay a tree re-fetch through the service worker ────────────────
  function handleUpdate(d) {
    const requestId = d.requestId
    const reply = function (extra) { post(Object.assign({ __nodea: 'update-result', requestId: requestId }, extra)) }
    try {
      chrome.runtime.sendMessage(
        { type: 'NX_FETCH_TREE', convId: d.sourceConversationId, orgId: d.sourceOrgId || null },
        function (resp) {
          const err = chrome.runtime && chrome.runtime.lastError
          if (err || !resp) return reply({ ok: false, error: (err && err.message) || 'extension unavailable' })
          if (resp.ok) reply({ ok: true, tree: resp.tree })
          else reply({ ok: false, error: resp.error || 'fetch failed' })
        }
      )
    } catch (e) {
      reply({ ok: false, error: 'extension unavailable' })
    }
  }

  // ── Page → bridge ──────────────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (e.source !== window || e.origin !== window.location.origin) return
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.__nodea === 'app-ready') deliver()
    else if (d.__nodea === 'ping') post({ __nodea: 'ext-present' })
    else if (d.__nodea === 'update-request') handleUpdate(d)
  })

  // Announce presence on load: triggers import delivery if one is pending, and
  // lets the "Update" button know the extension is installed.
  post({ __nodea: 'ext-present' })
  pendingPromise.then(function (payload) {
    console.info('[Nodea bridge] loaded on', window.location.origin, '— pending import:', !!payload)
    if (payload) post({ __nodea: 'ext-ready' })
  })
})()
