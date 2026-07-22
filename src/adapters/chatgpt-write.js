// Nodea Tree — ChatGPT (chatgpt.com) write driver.
//
// The ChatGPT read adapter (adapters/chatgpt.js) is visualize-only. This driver
// adds the WRITE half — the same NX.write contract Claude ships — so the panel
// can jump to a branch and fork a new one on ChatGPT too.
//
// ChatGPT keeps a REAL branch tree: editing a user message forks a sibling
// version, regenerating an answer forks a sibling response, and every versioned
// turn carries a "< N/M >" pager. Nothing here is faked — we drive ChatGPT's own
// native controls, so each branch is a real ChatGPT conversation node.
//
// The big simplification over Claude (see claude-write.js's content-alignment
// gymnastics): ChatGPT stamps every rendered message with
//   data-message-id === the backend mapping node id
// which is exactly the id the reader uses. So we align the displayed thread to
// the tree BY ID — no fragile text matching, no "wrong-spot" guessing.
//
// DOM contract (verified live on chatgpt.com 2026-07-22):
//   • message:        [data-message-author-role="user"|"assistant"][data-message-id]
//   • edit (→ fork):  button[aria-label="Edit message"] (revealed on hover)
//   • edit field:     a visible <textarea> + a "Send" button (and "Cancel")
//   • version pager:  button[aria-label="Previous response"] /
//                     "Next response" + an "N / M" text node
//   • composer:       #prompt-textarea (div.ProseMirror[contenteditable])
//   • send:           no send button when empty — Enter in the composer sends
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // ── Message ↔ tree-node addressing (the whole trick: match by id) ──────────
  function msgEl(id) {
    if (!id) return null
    const sel = '[data-message-author-role][data-message-id="' + (window.CSS ? CSS.escape(id) : id) + '"]'
    return document.querySelector(sel)
  }
  function renderedIds() {
    return new Set(
      [...document.querySelectorAll('[data-message-author-role][data-message-id]')].map((e) =>
        e.getAttribute('data-message-id')
      )
    )
  }

  // Flatten the pair graph back to the underlying nodes so we can reason about
  // parents / siblings / versions the same way the tree does.
  function nodesFromPairs(pairs) {
    const byId = new Map()
    for (const p of pairs) {
      if (p.userNode) byId.set(p.userNode.id, p.userNode)
      if (p.aiNode) byId.set(p.aiNode.id, p.aiNode)
    }
    return byId
  }

  // Top-down path of pairs from root to target.
  function ancestors(pairs, target) {
    const byId = new Map(pairs.map((p) => [p.id, p]))
    const path = []
    let cur = target
    const guard = new Set()
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id)
      path.push(cur)
      cur = cur.parentPairId ? byId.get(cur.parentPairId) : null
    }
    return path.reverse()
  }

  // A node's version siblings: same parent, same role, in ChatGPT pager order
  // (creation time, id tiebreak). A user edit and an answer regeneration both
  // land here — they differ only in which role the pager hangs off.
  function versionSiblings(nodesById, node) {
    const sibs = []
    for (const n of nodesById.values()) {
      if (n.role === node.role && (n.parent_id || null) === (node.parent_id || null)) sibs.push(n)
    }
    sibs.sort(
      (a, b) =>
        +new Date(a.created_at) - +new Date(b.created_at) ||
        String(a.id).localeCompare(String(b.id))
    )
    return sibs
  }

  // The chat thread's scroll container (for materializing virtualized turns).
  function scrollContainerOf(el) {
    let n = el
    while (n && n !== document.body) {
      const s = getComputedStyle(n)
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 10) return n
      n = n.parentElement
    }
    return null
  }

  // The version pager governing a given message element. Walk up to the turn and
  // search within it; stop before an ancestor that holds OTHER messages so we
  // can never grab a neighbouring turn's pager.
  function pagerFor(el) {
    let n = el
    for (let up = 0; n && up < 8; up++) {
      if (n.querySelectorAll && n.querySelectorAll('[data-message-author-role]').length > 1 && up > 0) break
      const prev = n.querySelector && n.querySelector('button[aria-label="Previous response"]')
      const next = n.querySelector && n.querySelector('button[aria-label="Next response"]')
      let span = null
      if (n.querySelectorAll) {
        span = [...n.querySelectorAll('div, span')].find(
          (e) => e.children.length === 0 && /^\d+\s*\/\s*\d+$/.test(norm(e.textContent))
        )
      }
      if (prev && next && span) {
        const m = norm(span.textContent).match(/(\d+)\s*\/\s*(\d+)/)
        return { prev, next, cur: +m[1], total: +m[2] }
      }
      n = n.parentElement
    }
    return null
  }

  // ChatGPT reveals a turn's action bar (edit pencil) on hover.
  function hover(el) {
    ;['pointerover', 'mouseover', 'mouseenter'].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true }))
    )
  }

  // The "Edit message" control for a specific user-message element (bounded to
  // its own turn so we can't grab a neighbour's).
  function editButtonFor(umEl) {
    hover(umEl)
    let n = umEl
    for (let up = 0; n && up < 8; up++) {
      if (n.querySelectorAll && n.querySelectorAll('[data-message-author-role]').length > 1 && up > 0) break
      const btn = n.querySelector && n.querySelector('button[aria-label="Edit message"]')
      if (btn) return btn
      n = n.parentElement
    }
    return null
  }

  const composerEl = () =>
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div.ProseMirror[contenteditable="true"]')

  // React-controlled <textarea> value set (native setter + input event).
  function setTextareaValue(ta, text) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, text)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // The visible edit <textarea> (edit mode swaps the bubble for one).
  function visibleEditTextarea() {
    return [...document.querySelectorAll('textarea')].find((t) => t.offsetParent !== null) || null
  }

  // The "Send" button belonging to the open edit box (nearest to the textarea,
  // never the composer's own control).
  function editSendButton(ta) {
    let n = ta
    for (let up = 0; n && up < 6; up++) {
      const btn =
        n.querySelector &&
        [...n.querySelectorAll('button')].find(
          (b) => b.offsetParent !== null && norm(b.textContent) === 'Send'
        )
      if (btn) return btn
      n = n.parentElement
    }
    // Fallback: any visible button labelled exactly "Send".
    return [...document.querySelectorAll('button')].find(
      (b) => b.offsetParent !== null && norm(b.textContent) === 'Send'
    ) || null
  }

  function dispatchEnter(el) {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
    el.dispatchEvent(new KeyboardEvent('keydown', init))
    el.dispatchEvent(new KeyboardEvent('keyup', init))
  }

  // ── Navigation: page ChatGPT's branches until target's path is displayed ────
  async function navigateToNode(pairs, target) {
    const nodesById = nodesFromPairs(pairs)
    const path = ancestors(pairs, target)
    const wantIds = []
    for (const p of path) {
      if (p.userNode) wantIds.push(p.userNode.id)
      if (p.aiNode) wantIds.push(p.aiNode.id)
    }
    const targetLeafId = (target.aiNode || target.userNode).id
    let scrolledTop = false

    for (let tries = 0; tries < 40; tries++) {
      const shown = renderedIds()
      const missing = wantIds.find((id) => !shown.has(id))
      if (!missing) return { ok: true, el: msgEl(targetLeafId) }

      // Is a sibling VERSION of the missing turn on screen? Then page to ours.
      const node = nodesById.get(missing)
      const sibs = node ? versionSiblings(nodesById, node) : []
      const displayed = sibs.find((s) => shown.has(s.id))
      if (displayed && displayed.id !== missing) {
        const el = msgEl(displayed.id)
        const pg = el && pagerFor(el)
        if (pg) {
          const want = sibs.findIndex((s) => s.id === missing) + 1
          if (want >= 1 && want <= pg.total && want !== pg.cur) {
            // One step per loop: ChatGPT re-renders the pager on each switch, so
            // burst-clicking a soon-stale button drops clicks.
            ;(want > pg.cur ? pg.next : pg.prev).click()
            await sleep(450)
            continue
          }
          if (want === pg.cur) {
            // Pager already on our version but the id still isn't shown — our
            // tree and ChatGPT's order disagree. Bail rather than guess.
            return { ok: false, reason: 'displayed branch does not match the tree — refresh and retry' }
          }
        }
      }

      // Not a version mismatch we can page — the turn is probably virtualized
      // out. Anchor at the top once, then walk down to materialize it.
      const anchor = document.querySelector('[data-message-author-role][data-message-id]')
      const sc = anchor ? scrollContainerOf(anchor) : null
      if (!sc) { await sleep(250); continue }
      if (!scrolledTop) { scrolledTop = true; sc.scrollTop = 0 }
      else if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) {
        return { ok: false, reason: 'message not found in the displayed thread' }
      } else sc.scrollTop += sc.clientHeight * 0.8
      await sleep(350)
    }
    return { ok: false, reason: 'could not display the target branch' }
  }

  function flash(el) {
    if (!el) return
    const prev = el.style.boxShadow
    el.style.transition = 'box-shadow .2s'
    el.style.boxShadow = '0 0 0 3px #7c3aed'
    setTimeout(() => { el.style.boxShadow = prev }, 1300)
  }

  // Navigate to a node and scroll/highlight it (the "go to that spot" action).
  async function navigateAndReveal(pairs, target) {
    const res = await navigateToNode(pairs, target)
    if (!res.ok) return res
    await sleep(150)
    let el = res.el
    const targetLeafId = (target.aiNode || target.userNode).id
    if (!el || !el.isConnected) el = msgEl(targetLeafId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flash(el)
    }
    return res
  }

  // ── Fork: create a new branch from `target` with a new prompt ───────────────
  //   • target has children → edit target's DISPLAYED child user message
  //     (matched by id) → native sibling fork.
  //   • target is a leaf     → continue via the composer (Enter to send).
  async function forkFromNode(pairs, target, text) {
    const nav = await navigateToNode(pairs, target)
    if (!nav.ok) return nav
    await sleep(250)

    const kids = pairs.filter((p) => p.parentPairId === target.id)

    if (kids.length) {
      // Edit any existing child of target — that creates a sibling under target,
      // which is exactly the requested branch point. Match by id (reliable).
      let childEl = null
      for (const k of kids) {
        const el = k.userNode && msgEl(k.userNode.id)
        if (el) { childEl = el; break }
      }
      if (!childEl) {
        return { ok: false, reason: 'the branch point’s next message isn’t on screen to edit — open that branch first' }
      }
      const editBtn = editButtonFor(childEl)
      if (!editBtn) return { ok: false, reason: 'edit control not found on the child message' }
      editBtn.click()
      await sleep(320)
      const ta = visibleEditTextarea()
      if (!ta) return { ok: false, reason: 'edit box did not open' }
      setTextareaValue(ta, text)
      await sleep(120)
      const send = editSendButton(ta)
      if (!send) return { ok: false, reason: 'Send button not found in the edit box' }
      send.click()
      return { ok: true, mode: 'branch' }
    }

    // Leaf: nothing displays below it, so the composer continues from it.
    const ci = composerEl()
    if (!ci) return { ok: false, reason: 'composer not found' }
    ci.focus()
    document.execCommand('insertText', false, text)
    await sleep(150)
    if (norm(ci.textContent).indexOf(norm(text).slice(0, 40)) === -1) {
      return { ok: false, reason: 'composer did not accept text' }
    }
    dispatchEnter(ci)
    // Verify the send took (composer empties). Fall back to a send button.
    for (let waited = 0; waited < 3500; waited += 150) {
      await sleep(150)
      if (!norm(ci.textContent)) return { ok: true, mode: 'continue' }
    }
    const sb =
      document.querySelector('button[data-testid="send-button"]') ||
      [...document.querySelectorAll('button[aria-label]')].find((b) =>
        /^send\b/i.test(b.getAttribute('aria-label') || '')
      )
    if (sb && !sb.disabled) {
      sb.click()
      await sleep(400)
      if (!norm(ci.textContent)) return { ok: true, mode: 'continue' }
    }
    return { ok: false, reason: 'could not send — press Enter in ChatGPT’s box to send it yourself' }
  }

  NX.write = {
    navigateToNode, navigateAndReveal, forkFromNode,
    // exposed for the offline test harness / debugging
    ancestors, versionSiblings, pagerFor,
  }
})()
