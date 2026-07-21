// Nodea Tree for Claude — write driver (Version C, re-validated against live DOM).
//
// Drives Claude's OWN native controls — nothing is faked, every branch is a real
// Claude conversation in Claude's backend (the same tree the reader sees).
//
// DOM contract (verified 2026-07-21 on claude.ai):
//   • user message:      [data-testid="user-message"]
//   • edit (→ branch):   [data-testid="action-bar-edit"] (inside the message's own block)
//   • edit field:        a visible <textarea> + a "Save" button
//   • version pager:     button[aria-label="Previous version"] / "Next version" + a "k / n" span
//   • composer:          [data-testid="chat-input"] (ProseMirror contenteditable)
//   • send:              there is NO send button anymore — sending is Enter in the composer
//
// CRITICAL LESSON (2026-07-21): not every human message renders as a
// user-message bubble. Structured replies (e.g. answer cards,
// [data-testid="ask-user-answers-card"]) are human turns with NO bubble, no
// edit control, and no pager. So `ums[depth]` does NOT correspond to tree
// depth — indexing by depth silently targeted the wrong message and created
// branches one level away from where the user asked ("wrong spot" bug).
// Everything below aligns rendered messages onto the expected path BY CONTENT
// and refuses to edit anything it can't verify against the tree.
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // Does a rendered user-message element show `nodeText`? Exact equality is too
  // strict — the DOM copy can carry attachment chips / UI text or truncate long
  // prompts — so also accept a bounded match, gated to ≥20 chars so short
  // prompts like "hi" can't match the wrong sibling.
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

  // Rendered user-message bubbles, in thread (document) order.
  function renderedUms() {
    return [...document.querySelectorAll('[data-testid="user-message"]')]
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

  // ── Path alignment ─────────────────────────────────────────────────────────
  // The rendered user-message bubbles are a SUBSEQUENCE of the displayed
  // root→target path: turns that render as answer cards (etc.) contribute no
  // bubble, and their rendered text differs from the stored message text — so
  // cards can only be verified indirectly, by seeing their descendants. Walk
  // the bubbles in order and align each one against the path using the tree's
  // own texts: a bubble either matches the next expected turn, matches a later
  // turn (skipped turns = card-rendered), matches a SIBLING of an expected
  // turn (wrong version → page it), or matches a descendant of the target
  // (target displayed, card-rendered). Returns one of:
  //   { done, el }             — path verified displayed; el = target's bubble (null if card)
  //   { page: el, want, turn } — bubble shows the wrong sibling of `turn`; pager must go to `want`
  //   { missing: pair }        — a versioned turn has no bubble on screen (virtualized?)
  //   { unknown: el }          — a bubble matches nothing we know (stale tree)
  function alignPath(pairs, path) {
    const target = path[path.length - 1]
    const byId = new Map(pairs.map((p) => [p.id, p]))
    const isUnder = (p, ancestor) => {
      let cur = p
      while (cur) {
        if (cur.id === ancestor.id) return true
        cur = cur.parentPairId ? byId.get(cur.parentPairId) : null
      }
      return false
    }
    const ums = renderedUms()
    let umIdx = 0
    let k = 0
    let lastEl = null
    while (k < path.length) {
      const el = ums[umIdx]
      if (!el) {
        // Out of bubbles. Remaining turns that have sibling versions can't be
        // trusted sight-unseen; turns with no siblings are the only version
        // there is, so they're displayed by definition.
        for (let j = k; j < path.length; j++) {
          const hasSibs = pairs.some((p) => p.parentPairId === path[j].parentPairId && p.id !== path[j].id)
          if (hasSibs) return { missing: path[j] }
        }
        return { done: true, el: lastEl }
      }
      // Next expected turn?
      if (textMatches(el.textContent, path[k].userNode.content)) {
        lastEl = el
        umIdx++
        k++
        continue
      }
      // A later path turn? (the skipped turns render without bubbles)
      let later = -1
      for (let j = k + 1; j < path.length; j++) {
        if (textMatches(el.textContent, path[j].userNode.content)) { later = j; break }
      }
      if (later >= 0) {
        lastEl = el
        umIdx++
        k = later + 1
        continue
      }
      // A wrong sibling version of an expected turn?
      for (let j = k; j < path.length; j++) {
        const sibs = pairs.filter((p) => p.parentPairId === path[j].parentPairId && p.id !== path[j].id)
        if (sibs.some((s) => textMatches(el.textContent, s.userNode.content))) {
          return { page: el, want: siblingIndex(pairs, path[j]), turn: path[j] }
        }
      }
      // A descendant of the target? Then the whole path (incl. a card-rendered
      // target) is displayed — that's the evidence cards can give.
      const sub = pairs.find((p) => isUnder(p, target) && textMatches(el.textContent, p.userNode.content))
      if (sub) return { done: true, el: lastEl }
      return { unknown: el }
    }
    return { done: true, el: lastEl }
  }

  // Switch Claude's displayed branch until `target`'s whole path is on screen.
  // Content-aligned (see alignPath) — never indexes bubbles by tree depth.
  async function navigateToNode(pairs, target) {
    const path = ancestors(pairs, target)
    let scrolledToTop = false
    for (let tries = 0; tries < 30; tries++) {
      const res = alignPath(pairs, path)
      if (res.done) return { ok: true, el: res.el }
      if (res.unknown) {
        // A rendered message matches nothing in the tree we hold — our tree is
        // stale (or the thread has content we can't model). Bail explicitly
        // instead of guessing (guessing is how branches land in wrong spots).
        return { ok: false, reason: 'displayed thread does not match the tree — refresh and retry' }
      }
      if (res.page) {
        const pg = pagerFor(res.page)
        if (!pg) {
          return { ok: false, reason: 'no branch control where "' + norm(res.turn.userNode.content).slice(0, 24) + '…" should be' }
        }
        if (!res.want || res.want > pg.total) return { ok: false, reason: 'branch version out of range' }
        if (res.want === pg.cur) {
          return { ok: false, reason: 'displayed branch does not match the tree — refresh and retry' }
        }
        // One pager step per loop turn: React swaps the buttons on each
        // switch, so burst-clicking a soon-stale node silently drops clicks.
        ;(res.want > pg.cur ? pg.next : pg.prev).click()
        await sleep(350)
        continue
      }
      // A path turn isn't rendered: likely virtualized out. Anchor at the top
      // once, then walk downward to materialize turns.
      const ums = renderedUms()
      const sc = ums.length ? scrollContainerOf(ums[0]) : null
      if (!sc) {
        await sleep(250)
        continue
      }
      if (!scrolledToTop) {
        scrolledToTop = true
        sc.scrollTop = 0
      } else if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) {
        return { ok: false, reason: 'message not found in the displayed thread' }
      } else {
        sc.scrollTop += sc.clientHeight * 0.8
      }
      await sleep(350)
    }
    return { ok: false, reason: 'could not display the target branch' }
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
    // Navigation failed → whatever is on screen is some OTHER branch; scrolling
    // would flash the wrong node and read as "jumped nowhere".
    if (!res.ok) return res
    await sleep(150)
    let el = res.el
    if (el && !el.isConnected) {
      el = renderedUms().find((e) => textMatches(e.textContent, target.userNode.content)) || null
    }
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flash(el)
    }
    return res
  }

  // Edit control for one specific user-message element. Walk up from the
  // message until the wrapping block that contains its action bar — but stop
  // before an ancestor that holds OTHER user messages, so we can never grab a
  // neighboring message's edit control.
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

  // Enter-to-send: Claude's composer has no send button anymore (2026-07 UI),
  // so sending means dispatching Enter on the ProseMirror editor.
  function dispatchEnter(el) {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
    el.dispatchEvent(new KeyboardEvent('keydown', init))
    el.dispatchEvent(new KeyboardEvent('keyup', init))
  }

  // Create a new branch from `target` with a new prompt.
  //   • target has children in the tree → edit target's DISPLAYED child user
  //     message (verified by content against the tree) → native sibling fork.
  //   • target is a leaf pair → continue via the composer (Enter to send).
  async function forkFromNode(pairs, target, text) {
    const nav = await navigateToNode(pairs, target)
    if (!nav.ok) return nav
    await sleep(250)

    const kids = pairs.filter((p) => p.parentPairId === target.id)

    if (kids.length) {
      // The message we edit MUST be a child of target in the tree — verified by
      // content, never by position. (Editing any verified child creates a
      // sibling under target, which is exactly the requested branch point.)
      // When we know target's own bubble, only look BELOW it, so a same-text
      // message higher in the thread can't be picked.
      let ums = renderedUms()
      if (nav.el && nav.el.isConnected) {
        const at = ums.indexOf(nav.el)
        if (at >= 0) ums = ums.slice(at + 1)
      }
      const childEl = ums.find((el) =>
        kids.some((k) => textMatches(el.textContent, k.userNode.content))
      )
      if (!childEl) {
        // Children exist but none is on screen as an editable bubble — e.g.
        // the displayed child is an answer card (cards have no edit control).
        // Refuse: guessing here is how branches end up in the wrong place.
        return { ok: false, reason: 'the branch point’s next message can’t be edited (structured content) — try branching one node lower' }
      }
      const childEdit = editButtonFor(childEl)
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

    // Leaf pair: nothing displays below it, so the composer continues from it.
    const ci = composerEl()
    if (!ci) return { ok: false, reason: 'composer not found' }
    ci.focus()
    document.execCommand('insertText', false, text)
    await sleep(150)
    if (norm(ci.textContent).indexOf(norm(text).slice(0, 40)) === -1) {
      return { ok: false, reason: 'composer did not accept text' }
    }
    dispatchEnter(ci)
    // Verify the send actually happened (composer empties). If Enter didn't
    // take, fall back to hunting for any send-labeled button.
    for (let waited = 0; waited < 3000; waited += 150) {
      await sleep(150)
      if (!norm(ci.textContent)) return { ok: true, mode: 'continue' }
    }
    const send = [...document.querySelectorAll('button[aria-label]')].find((b) =>
      /^send\b/i.test(b.getAttribute('aria-label') || '')
    )
    if (send && !send.disabled) {
      send.click()
      await sleep(400)
      if (!norm(ci.textContent)) return { ok: true, mode: 'continue' }
    }
    return { ok: false, reason: 'could not send — press Enter in Claude’s box to send it yourself' }
  }

  NX.write = {
    navigateToNode, navigateAndReveal, forkFromNode,
    ancestors, siblingIndex, pagerFor, textMatches, alignPath,
  }
})()
