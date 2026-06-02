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

  // 1-based index of a pair among its siblings, ordered by creation (= pager order).
  function siblingIndex(pairs, pair) {
    const sibs = pairs
      .filter((p) => p.parentPairId === pair.parentPairId)
      .sort((a, b) => +new Date(a.userNode.created_at) - +new Date(b.userNode.created_at))
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
      const wantText = norm(desired.userNode.content)
      let tries = 0
      let done = false
      while (tries++ < 10) {
        const ums = document.querySelectorAll('[data-testid="user-message"]')
        const el = ums[depth]
        if (!el) {
          await sleep(150)
          continue
        }
        if (norm(el.textContent) === wantText) {
          done = true
          break
        }
        const pg = pagerFor(el)
        if (!pg) return { ok: false, reason: 'no branch control at depth ' + depth }
        const want = siblingIndex(pairs, desired)
        if (!want || want > pg.total) return { ok: false, reason: 'branch index out of range at depth ' + depth }
        const delta = want - pg.cur
        const btn = delta > 0 ? pg.next : pg.prev
        for (let i = 0; i < Math.abs(delta); i++) btn.click()
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
    await sleep(150)
    const depth = ancestors(pairs, target).length - 1
    const ums = document.querySelectorAll('[data-testid="user-message"]')
    const el = ums[depth]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flash(el)
    }
    return res
  }

  // Create a new branch from `target` with a new prompt.
  //   • If target has a displayed child → edit that child (native fork = new sibling continuation).
  //   • If target is a leaf → send via the composer (new continuation).
  async function forkFromNode(pairs, target, text) {
    const nav = await navigateToNode(pairs, target)
    if (!nav.ok) return nav
    await sleep(250)
    const depth = ancestors(pairs, target).length - 1
    const ums = document.querySelectorAll('[data-testid="user-message"]')
    if (!ums[depth] || norm(ums[depth].textContent) !== norm(target.userNode.content)) {
      return { ok: false, reason: 'target node is not displayed' }
    }
    const edits = document.querySelectorAll('[data-testid="action-bar-edit"]')
    const childEdit = edits[depth + 1]

    if (childEdit) {
      // Fork: edit target's child user message → Claude makes a sibling branch.
      childEdit.click()
      await sleep(280)
      const ta = [...document.querySelectorAll('textarea')].find((t) => t.offsetParent !== null)
      if (!ta) return { ok: false, reason: 'edit field did not open' }
      setTextareaValue(ta, text)
      await sleep(120)
      const save = [...document.querySelectorAll('button')].find((b) => norm(b.textContent) === 'Save')
      if (!save) return { ok: false, reason: 'Save button not found' }
      save.click()
      return { ok: true, mode: 'branch' }
    }

    // Leaf: continue via the composer.
    const ci = document.querySelector('[data-testid="chat-input"]')
    if (!ci) return { ok: false, reason: 'composer not found' }
    ci.focus()
    document.execCommand('insertText', false, text)
    let send = null
    let waited = 0
    while (waited < 2000) {
      send = document.querySelector('button[aria-label="Send message"]')
      if (send && !send.disabled) break
      await sleep(100)
      waited += 100
    }
    if (!send) return { ok: false, reason: 'Send button not found' }
    if (send.disabled) return { ok: false, reason: 'composer did not accept text' }
    send.click()
    return { ok: true, mode: 'continue' }
  }

  NX.write = { navigateToNode, navigateAndReveal, forkFromNode, ancestors, siblingIndex, pagerFor }
})()
