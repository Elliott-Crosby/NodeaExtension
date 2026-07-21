// Nodea Tree for Claude — write driver (Version B, validated against live DOM).
//
// Drives Claude's OWN native controls — nothing is faked, every branch is a real
// Claude conversation in Claude's backend (the same tree the reader sees).
//
// DOM contract (verified 2026-06-02 on claude.ai):
//   • user message:      [data-testid="user-message"]   (index-aligned, top→bottom = depth)
//   • edit (→ branch):   [data-testid="action-bar-edit"] (index-aligned with user messages)
//   • edit field:        a visible <textarea> + a "Save" button
//   • version pager:     button[aria-label="Previous version"] / "Next version" + a "k / n" span
//   • composer:          [data-testid="chat-input"] (contenteditable) + button[aria-label="Send message"]
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // Does a rendered user-message element show `nodeText`? Exact equality is too
  // strict — the DOM copy can carry attachment chips / UI text or truncate long
  // prompts — so also accept a bounded-prefix match (either direction), gated to
  // ≥20 chars so short prompts like "hi" can't match the wrong sibling.
  function textMatches(domText, nodeText) {
    const a = norm(domText)
    const b = norm(nodeText)
    if (a === b) return true
    if (!a || !b) return false
    if (a.length >= b.length) {
      // DOM copy is longer → likely carries extra UI text; the FULL node text
      // must appear in it (full, so near-identical long siblings can't cross-match).
      return b.length >= 20 && a.indexOf(b) !== -1
    }
    // DOM copy is shorter → likely truncated; compare the visible prefix.
    const at = a.replace(/[….]+$/, '')
    return at.length >= 20 && at === b.slice(0, at.length)
  }

  // Claude's composer: primary testid plus a ProseMirror fallback for churn.
  function composerEl() {
    return (
      document.querySelector('[data-testid="chat-input"]') ||
      document.querySelector('div.ProseMirror[contenteditable="true"]')
    )
  }

  // Find the version pager controls for a given user-message element (walk up).
  function pagerFor(umEl) {
    let n = umEl
    let depth = 0
    while (n && depth < 6) {
      const prev = n.querySelector && n.querySelector('button[aria-label="Previous version"]')
      const next = n.querySelector && n.querySelector('button[aria-label="Next version"]')
      let span = null
      if (n.querySelectorAll) {
        span = [...n.querySelectorAll('span')].find((e) => /^\d+\s*\/\s*\d+$/.test(norm(e.textContent)))
      }
      if (prev && next && span) {
        const m = norm(span.textContent).match(/(\d+)\s*\/\s*(\d+)/)
        return { prev, next, cur: +m[1], total: +m[2] }
      }
      n = n.parentElement
      depth++
    }
    return null
  }

  // Top-down path of pairs from root to target.
  function ancestors(pairs, target) {
    const byId = new Map(pairs.map((p) => [p.id, p]))
    const path = []
    let cur = target
    while (cur) {
      path.push(cur)
      cur = cur.parentPairId ? byId.get(cur.parentPairId) : null
    }
    return path.reverse()
  }

  // 1-based index of a pair among its siblings, ordered by creation (= pager
  // order). Id tiebreak keeps the order deterministic when timestamps collide.
  function siblingIndex(pairs, pair) {
    const sibs = pairs
      .filter((p) => p.parentPairId === pair.parentPairId)
      .sort(
        (a, b) =>
          (+new Date(a.userNode.created_at) - +new Date(b.userNode.created_at)) ||
          String(a.userNode.id).localeCompare(String(b.userNode.id))
      )
    return sibs.findIndex((p) => p.id === pair.id) + 1
  }

  // React-controlled textarea value set (native setter + input event).
  function setTextareaValue(ta, text) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, text)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // Switch Claude's displayed branch, top-down, until `target` is on screen.
  async function navigateToNode(pairs, target) {
    const path = ancestors(pairs, target)
    for (let depth = 0; depth < path.length; depth++) {
      const desired = path[depth]
      let tries = 0
      let done = false
      while (tries++ < 14) {
        const ums = document.querySelectorAll('[data-testid="user-message"]')
        const el = ums[depth]
        if (!el) {
          await sleep(150)
          continue
        }
        if (textMatches(el.textContent, desired.userNode.content)) {
          done = true
          break
        }
        const pg = pagerFor(el)
        if (!pg) return { ok: false, reason: 'no branch control at depth ' + depth }
        const want = siblingIndex(pairs, desired)
        if (!want || want > pg.total) return { ok: false, reason: 'branch index out of range at depth ' + depth }
        // One pager step per loop turn: React swaps the buttons on each switch,
        // so burst-clicking a soon-stale node silently drops clicks.
        const btn = want > pg.cur ? pg.next : pg.prev
        btn.click()
        await sleep(300)
      }
      if (!done) return { ok: false, reason: 'could not display depth ' + depth }
    }
    return { ok: true, depth: path.length - 1 }
  }

  function flash(el) {
    if (!el) return
    const bubble = el.closest('[data-user-message-bubble]') || el
    const prev = bubble.style.boxShadow
    bubble.style.transition = 'box-shadow .2s'
    bubble.style.boxShadow = '0 0 0 3px #7c3aed'
    setTimeout(() => { bubble.style.boxShadow = prev }, 1300)
  }

  // Navigate to a node and scroll/highlight it (the "go to that spot" action).
  async function navigateAndReveal(pairs, target) {
    const res = await navigateToNode(pairs, target)
    // Navigation failed → the element at `depth` is some OTHER branch's message;
    // scrolling to it would flash the wrong node and read as "jumped nowhere".
    if (!res.ok) return res
    await sleep(150)
    const depth = ancestors(pairs, target).length - 1
    const ums = document.querySelectorAll('[data-testid="user-message"]')
    const el = ums[depth]
    if (el && textMatches(el.textContent, target.userNode.content)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flash(el)
    }
    return res
  }

  // Edit control for one specific user-message element. Walk up from the
  // message until the wrapping block that contains its action bar — but stop
  // before an ancestor that holds OTHER user messages. The old global
  // `edits[depth+1]` index-alignment silently picked the WRONG message (or
  // none) as soon as any message lacked an edit control.
  function editButtonFor(umEl) {
    let n = umEl
    for (let up = 0; n && up < 8; up++) {
      if (n.querySelectorAll && n.querySelectorAll('[data-testid="user-message"]').length > 1) break
      const btn = n.querySelector && n.querySelector('[data-testid="action-bar-edit"]')
      if (btn) return btn
      n = n.parentElement
    }
    return null
  }

  // Create a new branch from `target` with a new prompt.
  //   • If target has a displayed child → edit that child (native fork = new sibling continuation).
  //   • If target is the displayed leaf → send via the composer (new continuation).
  async function forkFromNode(pairs, target, text) {
    const nav = await navigateToNode(pairs, target)
    if (!nav.ok) return nav
    await sleep(250)
    const depth = ancestors(pairs, target).length - 1
    const ums = document.querySelectorAll('[data-testid="user-message"]')
    if (!ums[depth] || !textMatches(ums[depth].textContent, target.userNode.content)) {
      return { ok: false, reason: 'target node is not displayed' }
    }
    const childUm = ums[depth + 1]

    if (childUm) {
      // Fork: edit target's child user message → Claude makes a sibling branch.
      // If the edit control can't be found, FAIL — falling through to the
      // composer here appended the prompt at the displayed leaf, i.e. a branch
      // silently created in the wrong place.
      const childEdit = editButtonFor(childUm)
      if (!childEdit) return { ok: false, reason: 'edit control not found on the child message' }
      childEdit.click()
      await sleep(280)
      const ta = [...document.querySelectorAll('textarea')].find((t) => t.offsetParent !== null)
      if (!ta) return { ok: false, reason: 'edit field did not open' }
      setTextareaValue(ta, text)
      await sleep(120)
      const save = [...document.querySelectorAll('button')].find(
        (b) => norm(b.textContent) === 'Save' || /^save\b/i.test(b.getAttribute('aria-label') || '')
      )
      if (!save) return { ok: false, reason: 'Save button not found' }
      save.click()
      return { ok: true, mode: 'branch' }
    }

    // No displayed child → target is the displayed leaf; continue via the composer.
    const ci = composerEl()
    if (!ci) return { ok: false, reason: 'composer not found' }
    ci.focus()
    document.execCommand('insertText', false, text)
    let send = null
    let waited = 0
    while (waited < 2000) {
      send =
        document.querySelector('button[aria-label="Send message"]') ||
        [...document.querySelectorAll('button[aria-label]')].find((b) =>
          /^send\b/i.test(b.getAttribute('aria-label') || '')
        ) ||
        null
      if (send && !send.disabled) break
      await sleep(100)
      waited += 100
    }
    if (!send) return { ok: false, reason: 'Send button not found' }
    if (send.disabled) return { ok: false, reason: 'composer did not accept text' }
    send.click()
    return { ok: true, mode: 'continue' }
  }

  NX.write = { navigateToNode, navigateAndReveal, forkFromNode, ancestors, siblingIndex, pagerFor, textMatches }
})()
