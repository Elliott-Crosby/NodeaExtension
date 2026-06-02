// Nodea Tree for Claude — extension-native auth client.
//
// A thin wrapper the panel uses to sign in / up / out against Nodea's Supabase.
// The actual network calls live in the service worker (background.js) — claude.ai's
// page CSP would block a cross-origin fetch from this content-script context, and
// the worker isn't subject to it. The session lives in chrome.storage.local
// (`nx_session`); this is the extension's OWN login, separate from the nodea.ai
// website cookie session (the two run in parallel).
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (r) {
          const err = chrome.runtime && chrome.runtime.lastError
          resolve(err ? { ok: false, error: err.message } : (r || { ok: false, error: 'no response' }))
        })
      } catch (e) {
        resolve({ ok: false, error: String((e && e.message) || e) })
      }
    })
  }

  const auth = {
    // Current session (or null), read straight from storage — no network.
    getSession: function () {
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
    },
    signIn: function (email, password) {
      return send({ type: 'NX_AUTH_SIGNIN', email: email, password: password })
    },
    signUp: function (email, password) {
      return send({ type: 'NX_AUTH_SIGNUP', email: email, password: password })
    },
    signOut: function () {
      return send({ type: 'NX_AUTH_SIGNOUT' })
    },
    refresh: function () {
      return send({ type: 'NX_AUTH_REFRESH' })
    },
    // Notify on session changes (login/logout in any tab, or token refresh).
    onChange: function (cb) {
      try {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area === 'local' && changes.nx_session) cb((changes.nx_session.newValue) || null)
        })
      } catch (e) {}
    },
  }

  NX.auth = auth
})()
