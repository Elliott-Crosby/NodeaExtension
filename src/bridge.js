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
//   PUSH    (Nodea → Claude, on the "Push to Claude" button — reverse sync):
//     page   → bridge: { __nodea: 'push-request', requestId, sourceConversationId, sourceOrgId, source, items }
//     bridge → SW    : chrome.runtime NX_PUSH_TO_SOURCE  (drives a claude.ai tab)
//     bridge → page :  { __nodea: 'push-result', requestId, ok, results | error }
//
//   AUTH    (extension → Nodea, login carry-over for "Open in Nodea"):
//     page   → bridge: { __nodea: 'request-auth' }                (or on load)
//     bridge → page :  { __nodea: 'auth-session', session: { access_token, refresh_token } }
//
// A content script shares the page's window for postMessage but lives in an
// isolated world, so all page traffic goes through window.postMessage. We only
// trust same-window, same-origin messages.
(function () {
  'use strict'

  function post(msg) {
    try { window.postMessage(msg, window.location.origin) } catch (e) {}
  }

  // ── Login carry-over ───────────────────────────────────────────────────────
  // The extension holds its OWN Nodea session (chrome.storage `nx_session`),
  // separate from the nodea.ai cookie session. Hand it to the Nodea page so a
  // user signed into the extension is signed into the site too (the page adopts
  // it via supabase.auth.setSession). Same-origin postMessage only, same channel
  // the import tree already uses. We relay the tokens the page needs; nothing
  // leaves this window.
  function readSession() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get('nx_session', function (res) {
          if (chrome.runtime && chrome.runtime.lastError) return resolve(null)
          resolve((res && res.nx_session) || null)
        })
      } catch (e) {
        resolve(null)
      }
    })
  }
  function sendAuthSession() {
    readSession().then(function (s) {
      if (s && s.access_token && s.refresh_token) {
        post({ __nodea: 'auth-session', session: { access_token: s.access_token, refresh_token: s.refresh_token } })
      }
    })
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

  // ── Push: replay Nodea-authored branches back into Claude (reverse sync) ─────
  function handlePush(d) {
    const requestId = d.requestId
    const reply = function (extra) { post(Object.assign({ __nodea: 'push-result', requestId: requestId }, extra)) }
    try {
      chrome.runtime.sendMessage(
        {
          type: 'NX_PUSH_TO_SOURCE',
          convId: d.sourceConversationId,
          orgId: d.sourceOrgId || null,
          source: d.source || 'claude',
          items: Array.isArray(d.items) ? d.items : [],
        },
        function (resp) {
          const err = chrome.runtime && chrome.runtime.lastError
          if (err || !resp) return reply({ ok: false, error: (err && err.message) || 'extension unavailable' })
          if (resp.ok) reply({ ok: true, results: resp.results || [] })
          else reply({ ok: false, error: resp.error || 'push failed' })
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
    if (d.__nodea === 'app-ready') { deliver(); sendAuthSession() }
    else if (d.__nodea === 'ping') post({ __nodea: 'ext-present' })
    else if (d.__nodea === 'request-auth') sendAuthSession()
    else if (d.__nodea === 'update-request') handleUpdate(d)
    else if (d.__nodea === 'push-request') handlePush(d)
  })

  // Push the current session whenever it changes (sign in/out in another tab or
  // a token refresh) so an already-open Nodea tab stays in sync.
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.nx_session && changes.nx_session.newValue) sendAuthSession()
    })
  } catch (e) {}

  // Announce presence on load: triggers import delivery if one is pending, and
  // lets the "Update" button know the extension is installed. Also offer the
  // session up front in case the page's auth listener is already mounted.
  post({ __nodea: 'ext-present' })
  sendAuthSession()
  pendingPromise.then(function (payload) {
    console.info('[Nodea bridge] loaded on', window.location.origin, '— pending import:', !!payload)
    if (payload) post({ __nodea: 'ext-ready' })
  })
})()
