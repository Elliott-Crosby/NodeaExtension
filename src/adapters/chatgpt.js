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
// user→assistant tree survives the dropped nodes. This adapter is READ-only; the
// jump-to-node / fork write half lives in adapters/chatgpt-write.js (NX.write).
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

  // ChatGPT threads carry non-conversational user/assistant turns that still hold
  // text, and they must be dropped for two reasons: they render as garbage nodes,
  // and — worse — they sit BETWEEN a real user turn and its real answer, so
  // leaving them in re-parents the answer onto plumbing and breaks the
  // user→assistant pairing (the answer is lost, the thread looks empty/wrong).
  // The offenders, all observed live on chatgpt.com (2026-07-22):
  //   • content_type 'code'                → tool calls: a web `search("…")`
  //     query, or a `{"skipped_mainline":true}` control message
  //   • recipient !== 'all'                → message addressed to a tool
  //     (web / python / a tool namespace like "t2uay3k.sj1i4kz"), not the user
  //   • channel 'analysis' / 'commentary'  → reasoning-model scratch turns
  //   • *_editable_context / thoughts / …  → memory writes & internal context
  const NON_CONVO_CONTENT = new Set([
    'code',
    'user_editable_context',
    'model_editable_context',
    'thoughts',
    'reasoning_recap',
    'tether_quote',
    'tether_browsing_display',
    'system_error',
  ])
  function isConversational(message) {
    if (!roleOf(message) || isHidden(message)) return false
    const c = (message && message.content) || {}
    if (NON_CONVO_CONTENT.has(c.content_type)) return false
    if (message.recipient && message.recipient !== 'all') return false
    if (message.channel === 'analysis' || message.channel === 'commentary') return false
    return true
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
      if (!isConversational(msg)) continue
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

  // ChatGPT's current app shell uses `w-screen`, so a margin on <body> alone
  // does not narrow it: the composer/header can remain full-viewport and slide
  // beneath the dock. Give body an explicit carved-out width and make the
  // stage consume that width. The transform also contains fixed descendants
  // (dialogs, toasts, composer controls) inside the safe area.
  function pushContentCSS(width) {
    const w = Math.max(0, width | 0)
    if (!w) return ''
    return (
      'html{overflow-x:hidden!important}' +
      'body{width:calc(100vw - ' + w + 'px)!important;min-width:0!important;margin:0 ' + w + 'px 0 0!important;transform:translateX(0)!important}' +
      '.stage-layout{width:100%!important;max-width:100%!important;min-width:0!important}'
    )
  }

  NX.adapter = {
    host: 'chatgpt',
    source: 'chatgpt', // tags the "Open in Nodea" payload (see AI_SOURCES)
    displayName: 'ChatGPT',
    conversationIdFromUrl,
    revealNode,
    pushContentCSS,
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
