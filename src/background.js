// Nodea Tree for Claude — service worker.
//
// Two jobs:
//  1) Relay toolbar-icon clicks to the active claude.ai tab (toggle the panel).
//  2) Fetch a Claude conversation tree on behalf of Nodea's "Update Conversation"
//     button. The Nodea page can't reach claude.ai (cross-origin, no cookies),
//     but this service worker can — claude.ai is in host_permissions, so a
//     credentialed GET carries the user's session. If Claude rejects the
//     extension-origin request, we fall back to asking an open claude.ai tab's
//     content script to fetch from inside the page (guaranteed-good auth).

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'NX_TOGGLE' }).catch(() => {})
})

// ── Nodea account (native to the extension, parallel to the website) ──────────
// The extension holds its OWN Supabase session, separate from the nodea.ai
// cookie session. The panel renders login/signup; these handlers do the actual
// network calls (the service worker isn't bound by claude.ai's page CSP) and
// persist the session in chrome.storage.local under `nx_session`. The anon key
// is a public client key (same one the website ships), safe to embed here.
const SB_URL = 'https://kzqhpygdhphjaiymqcmq.supabase.co'
const SB_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6cWhweWdkaHBoamFpeW1xY21xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTE0MDQsImV4cCI6MjA5MDkyNzQwNH0.goD6gMdCFTDpQneNH9m_1A4gCCnBEOaWTm0GdlZkDWc'

async function sbAuth(path, body) {
  const res = await fetch(SB_URL + '/auth/v1/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

function authError(res, data) {
  return (
    (data && (data.error_description || data.msg || data.error)) ||
    'Request failed (' + res.status + ')'
  )
}

function publicSession(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
  }
}

async function storeSession(data) {
  const session = publicSession(data)
  await chrome.storage.local.set({ nx_session: session })
  return session
}

async function handleAuth(msg) {
  if (msg.type === 'NX_AUTH_SIGNIN') {
    const { res, data } = await sbAuth('token?grant_type=password', { email: msg.email, password: msg.password })
    if (!res.ok || !data.access_token) return { ok: false, error: authError(res, data) }
    return { ok: true, session: await storeSession(data) }
  }
  if (msg.type === 'NX_AUTH_SIGNUP') {
    const { res, data } = await sbAuth('signup', { email: msg.email, password: msg.password })
    if (!res.ok) return { ok: false, error: authError(res, data) }
    // Auto-confirm on → a session comes back. Confirmation required → no token.
    if (data.access_token) return { ok: true, session: await storeSession(data) }
    return { ok: true, needsConfirm: true }
  }
  if (msg.type === 'NX_AUTH_SIGNOUT') {
    try {
      const { nx_session } = await chrome.storage.local.get('nx_session')
      if (nx_session && nx_session.access_token) {
        await fetch(SB_URL + '/auth/v1/logout', {
          method: 'POST',
          headers: { apikey: SB_ANON, Authorization: 'Bearer ' + nx_session.access_token },
        }).catch(() => {})
      }
    } catch (e) {}
    await chrome.storage.local.remove('nx_session')
    return { ok: true }
  }
  if (msg.type === 'NX_AUTH_REFRESH') {
    const { nx_session } = await chrome.storage.local.get('nx_session')
    if (!nx_session || !nx_session.refresh_token) return { ok: false, error: 'no session' }
    const { res, data } = await sbAuth('token?grant_type=refresh_token', { refresh_token: nx_session.refresh_token })
    if (!res.ok || !data.access_token) {
      await chrome.storage.local.remove('nx_session')
      return { ok: false, error: authError(res, data) }
    }
    return { ok: true, session: await storeSession(data) }
  }
  return null
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('NX_AUTH_') !== 0) return
  handleAuth(msg)
    .then((r) => sendResponse(r || { ok: false, error: 'unknown auth action' }))
    .catch((e) => sendResponse({ ok: false, error: (e && e.message) || 'auth failed' }))
  return true // async response
})

// ── Normalize Claude's payload → flat node list (mirrors adapters/claude.js) ──
const ROOT_SENTINELS = new Set([null, undefined, '', '00000000-0000-4000-8000-000000000000'])

function extractText(msg) {
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text
  if (Array.isArray(msg.content)) {
    const parts = msg.content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c.text === 'string') return c.text
        if (c && c.type === 'text' && c.text) return c.text
        return ''
      })
      .filter(Boolean)
    if (parts.length) return parts.join('\n\n')
  }
  return msg.text || ''
}

function senderToRole(msg) {
  const s = (msg.sender || msg.role || '').toLowerCase()
  if (s === 'human' || s === 'user') return 'user'
  if (s === 'assistant' || s === 'ai') return 'assistant'
  return s || 'user'
}

function normalize(convo) {
  const messages = convo.chat_messages || convo.messages || []
  const nodes = messages.map((m) => {
    let parent = m.parent_message_uuid
    if (parent === undefined) parent = m.parent_uuid
    if (ROOT_SENTINELS.has(parent)) parent = null
    return {
      id: m.uuid || m.id,
      parent_id: parent,
      role: senderToRole(m),
      content: extractText(m),
      created_at: m.created_at || m.createdAt || new Date(0).toISOString(),
    }
  })
  return {
    id: convo.uuid || null,
    name: convo.name || convo.title || 'Conversation',
    nodes,
    currentLeaf: convo.current_leaf_message_uuid || convo.current_leaf_message_id || null,
  }
}

async function resolveOrg() {
  const r = await fetch('https://claude.ai/api/organizations', { credentials: 'include' })
  if (!r.ok) throw new Error('orgs ' + r.status)
  const orgs = await r.json()
  if (!Array.isArray(orgs) || !orgs.length) throw new Error('no orgs')
  const chatOrg = orgs.find((o) => (o.capabilities || []).includes('chat')) || orgs[0]
  return chatOrg && chatOrg.uuid
}

// Primary path: fetch straight from the service worker with the user's cookies.
async function fetchTreeDirect(convId, orgId) {
  const org = orgId || (await resolveOrg())
  const url =
    `https://claude.ai/api/organizations/${org}/chat_conversations/${convId}` +
    `?tree=True&rendering_mode=messages`
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('conversation fetch ' + res.status)
  return normalize(await res.json())
}

// Fallback: have an open claude.ai tab fetch from inside the page context.
async function fetchTreeViaTab(convId) {
  let tabs = []
  try { tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' }) } catch (e) {}
  for (const t of tabs) {
    if (!t.id) continue
    try {
      const resp = await chrome.tabs.sendMessage(t.id, { type: 'NX_FETCH_TREE_IN_PAGE', convId })
      if (resp && resp.ok && resp.tree) return resp.tree
    } catch (e) { /* tab without our content script — try the next */ }
  }
  throw new Error('no claude.ai tab available')
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'NX_FETCH_TREE') {
    ;(async () => {
      try {
        let tree
        try {
          tree = await fetchTreeDirect(msg.convId, msg.orgId)
        } catch (directErr) {
          // Direct fetch failed (e.g. Claude rejected the extension origin, or
          // no session) — try a logged-in claude.ai tab before giving up.
          try {
            tree = await fetchTreeViaTab(msg.convId)
          } catch (tabErr) {
            throw directErr // surface the more informative direct error
          }
        }
        sendResponse({ ok: true, tree })
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || 'fetch failed' })
      }
    })()
    return true // async response
  }
})

// ── Reverse sync: replay Nodea-authored branches into Claude ──────────────────
// Unlike a read, a push has to drive Claude's own UI (edit/continue), which only
// works inside a claude.ai page. So the service worker prepares a tab parked on
// the target conversation, then hands the heavy lifting to that tab's content
// script (NX_PUSH_IN_PAGE). The DOM driving is inherently approximate — see
// adapters/claude-write.js — so this is best-effort and append-only.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pingTab(tabId) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'NX_PING' })
    return resp && resp.ok ? resp : null
  } catch (e) {
    return null // no content script in that tab yet
  }
}

// Return the id of a claude.ai tab whose content script is live and sitting on
// `convId`. Reuses an existing tab when possible, otherwise navigates/creates one
// and waits for the content script to come up. Throws if it can't get there.
async function ensureConversationTab(convId) {
  const target = 'https://claude.ai/chat/' + convId
  // 1) Already on the conversation?
  let tabs = []
  try { tabs = await chrome.tabs.query({ url: 'https://claude.ai/chat/' + convId + '*' }) } catch (e) {}
  for (const t of tabs) {
    if (!t.id) continue
    const p = await pingTab(t.id)
    if (p && p.convId === convId) { try { await chrome.tabs.update(t.id, { active: true }) } catch (e) {} ; return t.id }
  }

  // 2) Repurpose any open claude.ai tab by navigating it to the conversation.
  let anyTabId = null
  try {
    const claudeTabs = await chrome.tabs.query({ url: 'https://claude.ai/*' })
    if (claudeTabs && claudeTabs.length && claudeTabs[0].id) anyTabId = claudeTabs[0].id
  } catch (e) {}

  let tabId
  if (anyTabId) {
    await chrome.tabs.update(anyTabId, { url: target, active: true })
    tabId = anyTabId
  } else {
    // 3) No claude.ai tab at all — open one.
    const created = await chrome.tabs.create({ url: target, active: true })
    tabId = created && created.id
  }
  if (!tabId) throw new Error('could not open claude.ai')

  // Wait for the content script to load on the right conversation.
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const p = await pingTab(tabId)
    if (p && p.convId === convId) return tabId
  }
  throw new Error('claude.ai did not finish loading — make sure you are signed in')
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'NX_PUSH_TO_SOURCE') {
    ;(async () => {
      try {
        if (!msg.convId) throw new Error('no conversation id')
        if (!Array.isArray(msg.items) || msg.items.length === 0) { sendResponse({ ok: true, results: [] }); return }
        const tabId = await ensureConversationTab(msg.convId)
        // Let Claude finish painting the message list before we drive it.
        await sleep(900)
        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'NX_PUSH_IN_PAGE',
          convId: msg.convId,
          orgId: msg.orgId || null,
          items: msg.items,
        })
        if (!resp) throw new Error('no response from claude.ai tab')
        if (resp.ok) sendResponse({ ok: true, results: resp.results || [] })
        else sendResponse({ ok: false, error: resp.error || 'push failed' })
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || 'push failed' })
      }
    })()
    return true // async response (kept open through the whole push)
  }
})
