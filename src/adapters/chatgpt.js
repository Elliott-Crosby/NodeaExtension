// Nodea Tree — ChatGPT (chatgpt.com) data adapter.
//
// Same job as adapters/claude.js: turn whatever the host exposes into a flat
// list of nodes the renderer understands:
//
//   { id, parent_id, role: 'user'|'assistant', content, created_at }
//
// ChatGPT, like Claude, keeps a REAL branch tree in its backend — every prompt
// edit / response regeneration forks a sibling. The content script runs on the
// chatgpt.com origin, so it can read that tree with the user's own session:
//
//   1) GET /api/auth/session            → { accessToken }   (the bearer token)
//   2) GET /backend-api/conversation/ID → { mapping, current_node, title }
//
// `mapping` is a node graph: every entry is { id, message, parent, children }.
// We keep the user/assistant messages, drop system/tool/hidden ones, and
// re-link each kept node to its nearest kept ancestor so the alternating
// user→assistant tree survives the dropped nodes. Read-only (Version A): no
// branch-writing yet, so this adapter does not define NX.write.
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})

  // Conversation id from the URL. Handles chatgpt.com/c/<uuid>, the legacy
  // chat.openai.com/c/<uuid>, and GPT chats at /g/<gpt>/c/<uuid>.
  function conversationIdFromUrl() {
    const m = location.pathname.match(/\/c\/([0-9a-f-]{36})/i)
    return m ? m[1] : null
  }

  // Pull readable text out of a ChatGPT message regardless of content_type.
  function extractText(message) {
    const c = message && message.content
    if (!c) return ''
    if (Array.isArray(c.parts)) {
      const parts = c.parts
        .map((p) => {
          if (typeof p === 'string') return p
          if (p && typeof p.text === 'string') return p.text // multimodal part
          return ''
        })
        .filter(Boolean)
      if (parts.length) return parts.join('\n\n')
    }
    if (typeof c.text === 'string') return c.text // code / execution_output
    return ''
  }

  // user / assistant only — system + tool messages are conversation plumbing.
  function roleOf(message) {
    const r = message && message.author && message.author.role
    if (r === 'user') return 'user'
    if (r === 'assistant') return 'assistant'
    return null
  }

  function isHidden(message) {
    return !!(message && message.metadata && message.metadata.is_visually_hidden_from_conversation)
  }

  // Normalize a ChatGPT conversation payload → flat node list for the renderer.
  // Exposed as _normalize for the offline test harness.
  function normalize(convo) {
    const mapping = (convo && convo.mapping) || {}
    const idFromUrl = conversationIdFromUrl()

    // 1) Decide which mapping nodes we keep (real, visible user/assistant text).
    const kept = new Set()
    for (const id in mapping) {
      const entry = mapping[id]
      const msg = entry && entry.message
      if (!roleOf(msg) || isHidden(msg)) continue
      if (!extractText(msg).trim()) continue
      kept.add(id)
    }

    // 2) Re-link to the nearest kept ancestor so dropping system/tool/root nodes
    //    doesn't sever the tree (a first user message re-parents to null = root).
    function nearestKeptAncestor(id) {
      let cur = mapping[id] && mapping[id].parent
      const guard = new Set()
      while (cur && !guard.has(cur)) {
        guard.add(cur)
        if (kept.has(cur)) return cur
        cur = mapping[cur] && mapping[cur].parent
      }
      return null
    }

    const nodes = []
    kept.forEach((id) => {
      const msg = mapping[id].message
      nodes.push({
        id,
        parent_id: nearestKeptAncestor(id),
        role: roleOf(msg),
        content: extractText(msg).trim(),
        created_at:
          typeof msg.create_time === 'number'
            ? new Date(msg.create_time * 1000).toISOString()
            : new Date(0).toISOString(),
      })
    })

    // 3) Active leaf: ChatGPT's current_node, re-linked if it isn't a kept node.
    let leaf = convo && convo.current_node
    if (leaf && !kept.has(leaf)) leaf = nearestKeptAncestor(leaf)

    return {
      id: (convo && convo.conversation_id) || idFromUrl,
      name: (convo && convo.title) || 'Conversation',
      nodes,
      currentLeaf: leaf || null,
    }
  }

  // ── Session token (cached) ────────────────────────────────────────────────
  // The backend conversation endpoint needs a bearer token; /api/auth/session
  // mints it from the user's cookies. Cached until a 401 forces a refresh.
  let _token = null
  async function getToken() {
    if (_token) return _token
    const res = await fetch('/api/auth/session', { credentials: 'include' })
    if (!res.ok) throw new Error('session ' + res.status)
    const json = await res.json().catch(() => null)
    if (!json || !json.accessToken) throw new Error('not signed in to ChatGPT')
    _token = json.accessToken
    return _token
  }

  async function fetchConversation(convId) {
    const doFetch = (token) =>
      fetch('/backend-api/conversation/' + convId, {
        credentials: 'include',
        headers: { Authorization: 'Bearer ' + token },
      })
    let res = await doFetch(await getToken())
    if (res.status === 401) {
      _token = null // stale token — mint a fresh one and retry once
      res = await doFetch(await getToken())
    }
    if (!res.ok) throw new Error('conversation fetch ' + res.status)
    return res.json()
  }

  // Best-effort "jump to this node" for a visualize-only host: find the
  // message in the rendered thread by role + text and scroll/flash it. Only
  // messages on the branch ChatGPT is currently displaying exist in the DOM,
  // so an off-path node is simply a no-op (returns false).
  function revealNode(node) {
    if (!node) return false
    const want = (node.content || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!want) return false
    const els = document.querySelectorAll('[data-message-author-role="' + node.role + '"]')
    for (const el of els) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (t.indexOf(want) !== -1) {
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

  NX.adapter = {
    host: 'chatgpt',
    source: 'chatgpt', // tags the "Open in Nodea" payload (see AI_SOURCES)
    displayName: 'ChatGPT',
    conversationIdFromUrl,
    revealNode,
    _normalize: normalize, // test seam

    async fetchTree() {
      return this.fetchTreeById(conversationIdFromUrl())
    },

    async fetchTreeById(convId) {
      if (!convId) return null
      return normalize(await fetchConversation(convId))
    },
  }
})()
