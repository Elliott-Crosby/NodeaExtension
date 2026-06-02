// Nodea Tree for Claude — Claude.ai data adapter.
//
// THIS IS THE ONE FILE TO ADJUST AFTER LIVE RECON. Everything else (layout,
// rendering, theming) is host-agnostic. The job here is to turn whatever
// claude.ai exposes into a flat list of nodes the renderer understands:
//
//   { id, parent_id, role: 'user'|'assistant', content, created_at }
//
// Strategy (no main-world injection needed): the content script runs on the
// claude.ai origin, so it can call Claude's own conversation API with the
// user's cookies and read the FULL branch tree (every message carries a
// parent_message_uuid). This is Version A — read-only, robust.
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})

  const ROOT_SENTINELS = new Set([
    null,
    undefined,
    '',
    '00000000-0000-4000-8000-000000000000',
  ])

  // Conversation UUID from the URL: claude.ai/chat/<uuid>
  function conversationIdFromUrl() {
    const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i)
    return m ? m[1] : null
  }

  // Resolve the active org. Cached after first lookup.
  let _orgPromise = null
  function getOrgId() {
    if (_orgPromise) return _orgPromise
    _orgPromise = fetch('/api/organizations', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('orgs ' + r.status))))
      .then((orgs) => {
        if (!Array.isArray(orgs) || orgs.length === 0) throw new Error('no orgs')
        // Prefer an org that actually has chat capability; fall back to first.
        const chatOrg =
          orgs.find((o) => (o.capabilities || []).includes('chat')) || orgs[0]
        return chatOrg.uuid
      })
      .catch((e) => {
        _orgPromise = null // allow retry
        throw e
      })
    return _orgPromise
  }

  // Pull readable text out of a message regardless of shape.
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

  // Normalize Claude's chat_messages → flat node list for the renderer.
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
    const currentLeaf =
      convo.current_leaf_message_uuid ||
      convo.current_leaf_message_id ||
      null
    return {
      id: convo.uuid || conversationIdFromUrl(),
      name: convo.name || convo.title || 'Conversation',
      nodes,
      currentLeaf,
    }
  }

  // Public: fetch + normalize the current conversation's full tree.
  NX.adapter = {
    host: 'claude',
    conversationIdFromUrl,

    async fetchTree() {
      const convoId = conversationIdFromUrl()
      if (!convoId) return null
      const orgId = await getOrgId()
      const url =
        `/api/organizations/${orgId}/chat_conversations/${convoId}` +
        `?tree=True&rendering_mode=messages`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error('conversation fetch ' + res.status)
      const json = await res.json()
      return normalize(json)
    },
  }
})()
