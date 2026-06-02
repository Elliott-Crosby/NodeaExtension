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
