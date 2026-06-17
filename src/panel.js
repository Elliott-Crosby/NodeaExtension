// Nodea Tree for Claude — panel shell.
// The right-side dock that mirrors Nodea's Conversation Tree panel: header with
// collapse + view-mode dropdown + node count, the canvas (TreeView) or outline, a
// color menu, and the "Open in Nodea" handoff footer.
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})
  const { el } = NX

  // Host-aware labels — the active adapter (claude/chatgpt/gemini) decides the
  // brand name shown in the UI and the `source` tag stamped on imports. Falls
  // back to Claude so an adapter that predates these fields still works.
  function hostLabel() {
    return (NX.adapter && NX.adapter.displayName) || 'Claude'
  }
  function hostSource() {
    return (NX.adapter && NX.adapter.source) || 'claude'
  }
  // Branch-writing (jump-to-node, fork-from-node) needs a host write driver.
  // Only Claude ships one today; without it the panel runs visualize-only.
  function canWrite() {
    return !!NX.write
  }

  const DEFAULT_WIDTH = 340
  const MIN_WIDTH = 240
  const MAX_WIDTH = 720

  // Where "Open in Nodea" sends the tree. For local Nodea dev, change this to
  // 'http://localhost:3000/app' (the bridge content script already matches it).
  const NODEA_APP_URL = 'https://nodea.ai/app'

  // chrome.runtime.getURL throws "Extension context invalidated" when this
  // content script is the stale copy of a since-reloaded extension. The guard
  // for the function's existence isn't enough — the call itself throws — so wrap
  // it. Returns '' on failure; callers already treat '' as "no logo".
  function safeRuntimeURL(path) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL(path)
      }
    } catch (_) {}
    return ''
  }

  function icon(html, size) {
    size = size || 14
    return `<svg width="${size}" height="${size}" viewBox="0 0 14 14" fill="none">${html}</svg>`
  }
  const ICONS = {
    collapse: icon('<path d="M9 2l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 2l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.45"/>'),
    expand: icon('<path d="M9 2L4 7l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 2L0 7l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>'),
    tree: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="0.5" width="4" height="3" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="0.5" y="8.5" width="3.5" height="3" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="8" y="8.5" width="3.5" height="3" rx="0.8" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="3.5" x2="6" y2="6.5" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="6.5" x2="2.25" y2="8.5" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="6.5" x2="9.75" y2="8.5" stroke="currentColor" stroke-width="1.1"/></svg>',
    outline: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="1" y1="3" x2="11" y2="3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="3" y1="6.5" x2="11" y2="6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="5" y1="10" x2="11" y2="10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    full: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="0.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1"/><line x1="4.8" y1="2" x2="7.2" y2="2" stroke="currentColor" stroke-width="0.7" opacity="0.7"/><line x1="4.8" y1="3.2" x2="6.5" y2="3.2" stroke="currentColor" stroke-width="0.7" opacity="0.7"/><rect x="0.5" y="7.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1"/><line x1="1.3" y1="9" x2="3.7" y2="9" stroke="currentColor" stroke-width="0.7" opacity="0.7"/><line x1="1.3" y1="10.2" x2="3" y2="10.2" stroke="currentColor" stroke-width="0.7" opacity="0.7"/><rect x="7.5" y="7.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1"/><line x1="8.3" y1="9" x2="10.7" y2="9" stroke="currentColor" stroke-width="0.7" opacity="0.7"/><line x1="8.3" y1="10.2" x2="10" y2="10.2" stroke="currentColor" stroke-width="0.7" opacity="0.7"/><line x1="6" y1="4.5" x2="6" y2="6" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="6" x2="2.5" y2="7.5" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="6" x2="9.5" y2="7.5" stroke="currentColor" stroke-width="1.1"/></svg>',
    chevron: '<svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.5 4 8l4.5-6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  }
  const VIEW_MODES = [
    { id: 'tree',    label: 'Tree' },
    { id: 'outline', label: 'Outline' },
    { id: 'full',    label: 'Full' },
  ]

  function _loadPanelWidth() {
    try {
      const w = parseInt(localStorage.getItem('nx-panel-width'), 10)
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) return w
    } catch (_) {}
    return DEFAULT_WIDTH
  }

  // Initials for the account avatar — up to two letters from the email's local
  // part ("ada.lovelace@x.com" → "AL", "ada@x.com" → "AD").
  function initialsForEmail(email) {
    const local = String(email || '').split('@')[0]
    const parts = local.split(/[.\-_+]+/).filter(Boolean)
    let s = parts.length >= 2 ? parts[0].charAt(0) + parts[1].charAt(0) : local.slice(0, 2)
    return (s || '?').toUpperCase()
  }

  function Panel() {
    const self = this
    this.state = {
      nodes: [],
      selectedNodeId: null,
      viewMode: 'tree',
      colors: {},
      convId: null,
      convName: 'Conversation',
      currentLeaf: null,
    }
    this.collapsed = false
    this.width = _loadPanelWidth()

    // Root (own CSS-var scope so we never touch Claude's styles)
    this.root = el('div', {}, { id: 'nodea-ext-root' })
    this.root.className = 'nx-root'
    this._applyTheme()

    this.dock = el('div', { width: this.width + 'px' }, { class: 'nx-dock' })
    this.root.appendChild(this.dock)

    this._buildResizeHandle()
    this._buildHeader()

    // Body host (canvas or outline gets swapped in here)
    this.body = el('div', { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0', position: 'relative' })
    this.dock.appendChild(this.body)

    this._buildArmBanner()
    this._buildFooter()
    this._buildColorMenu()
    this._installSendInterceptor()

    this.tree = new NX.TreeView(this.body, this.state, {
      onSelect: function (id, pair) { self._onNodeSelect(id, pair) },
      onColorMenu: function (pairId, x, y) { self._openColorMenu(pairId, x, y) },
    })

    // React to OS / Claude theme flips
    this._themeMql = window.matchMedia('(prefers-color-scheme: dark)')
    this._themeMql.addEventListener('change', function () { self._applyTheme() })
    this._themeObserver = new MutationObserver(function () { self._applyTheme() })
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })

    document.body.appendChild(this.root)
    this._pushContent(this.width)
    this._initAuth()
  }

  Panel.prototype._applyTheme = function () {
    const de = document.documentElement
    const cls = (de.className || '') + ' ' + (de.getAttribute('data-theme') || '')
    let dark
    if (/dark/i.test(cls)) dark = true
    else if (/light/i.test(cls)) dark = false
    else dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    this.root.setAttribute('data-nx-theme', dark ? 'dark' : 'light')
  }

  Panel.prototype._buildResizeHandle = function () {
    const self = this
    // Wide (14px) transparent grab zone straddling the panel's left edge, lifted
    // above the floating header pills (z 30) and tree canvas so the whole edge is
    // grabbable. A thin line, centered in the zone, lights up on hover/drag.
    const h = el('div', {}, { class: 'nx-resize-handle', title: 'Drag to resize' })
    // Thin indicator line, centered on the seam; lit via CSS :hover / .nx-dragging.
    h.appendChild(el('div', {}, { class: 'nx-resize-bar' }))

    h.addEventListener('mousedown', function (e) {
      e.preventDefault()
      h.classList.add('nx-dragging')
      // Lock selection + cursor for the whole document while dragging so a fast
      // drag that outruns the grab zone doesn't drop the grab or select text.
      const prevUserSelect = document.body.style.userSelect
      const prevCursor = document.body.style.cursor
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
      const ox = e.clientX, ow = self.width
      function move(ev) {
        const delta = ox - ev.clientX
        self.width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, ow + delta))
        self.dock.style.width = self.width + 'px'
        self._pushContent(self.width)
      }
      function up() {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        h.classList.remove('nx-dragging')
        document.body.style.userSelect = prevUserSelect
        document.body.style.cursor = prevCursor
        try { localStorage.setItem('nx-panel-width', String(self.width)) } catch (_) {}
        self.tree && self.tree.render()
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    })
    this.dock.appendChild(h)
  }

  Panel.prototype._buildHeader = function () {
    const self = this
    // Floating header: two translucent, backdrop-blurred pills hovering over the
    // canvas (mirrors the app's TreePanel TopBar). The container itself is
    // click-through; only the pills take pointer events.
    const header = el('div', {}, { class: 'nx-header' })
    this._header = header

    // ── Left pill: collapse + brand lockup ──────────────────────────────────
    const leftPill = el('div', {}, { class: 'nx-pill nx-pill-left' })

    const collapseBtn = el('button', {}, { class: 'nx-icon-btn', title: 'Collapse tree', html: ICONS.collapse })
    collapseBtn.addEventListener('click', function () { self.setCollapsed(true) })
    leftPill.appendChild(collapseBtn)

    const iconURL = safeRuntimeURL('icons/icon128.png')
    if (iconURL) leftPill.appendChild(el('img', {}, { class: 'nx-logo', src: iconURL, alt: 'Nodea' }))

    leftPill.appendChild(el('span', {}, { class: 'nx-wordmark', text: 'Nodea' }))
    header.appendChild(leftPill)

    // ── Right pill: view-mode dropdown + node count ─────────────────────────
    const rightPill = el('div', {}, { class: 'nx-pill nx-pill-right' })
    this._rightPill = rightPill

    // view-mode dropdown (Tree / Outline / Full)
    const viewWrap = el('div', {}, { class: 'nx-viewmode' })
    const trigger = el('button', {}, { class: 'nx-viewmode-btn', title: 'View mode' })
    const triggerIcon = el('span', {}, { class: 'nx-viewmode-icon', html: ICONS[self.state.viewMode] })
    trigger.appendChild(triggerIcon)
    trigger.appendChild(el('span', {}, { class: 'nx-viewmode-caret', html: ICONS.chevron }))
    viewWrap.appendChild(trigger)

    const menu = el('div', {}, { class: 'nx-viewmode-menu' })
    this._viewMenuItems = {}
    VIEW_MODES.forEach(function (m) {
      const item = el('button', {}, { class: 'nx-viewmode-item' + (m.id === self.state.viewMode ? ' nx-active' : '') })
      item.appendChild(el('span', {}, { class: 'nx-viewmode-icon', html: ICONS[m.id] }))
      item.appendChild(el('span', { flex: '1', textAlign: 'left' }, { text: m.label }))
      item.appendChild(el('span', {}, { class: 'nx-viewmode-check', html: ICONS.check }))
      item.addEventListener('click', function (e) {
        e.stopPropagation()
        self.setViewMode(m.id)
        self._closeViewMenu()
      })
      self._viewMenuItems[m.id] = item
      menu.appendChild(item)
    })
    viewWrap.appendChild(menu)

    trigger.addEventListener('click', function (e) {
      e.stopPropagation()
      viewWrap.classList.contains('nx-open') ? self._closeViewMenu() : self._openViewMenu()
    })
    // Dismiss on any outside click.
    window.addEventListener('click', function () { self._closeViewMenu() })

    rightPill.appendChild(viewWrap)
    this._viewWrap = viewWrap
    this._viewTriggerIcon = triggerIcon
    // Kept for _applyAuthState's show/hide of the control while gated.
    this._viewToggle = viewWrap

    this._countBadge = el('span', {}, { class: 'nx-count', text: '0' })
    rightPill.appendChild(this._countBadge)

    header.appendChild(rightPill)
    this.dock.appendChild(header)
  }

  // Auth is a hard gate: until you sign in to Nodea (the extension's OWN session,
  // parallel to the website), the panel shows the login screen and the tree stays
  // hidden — no using Nodea without an account. The footer carries the handoff +
  // identity once you're in.
  Panel.prototype._buildFooter = function () {
    const self = this
    this._authMode = 'signin'
    this._showPwd = false
    this._footer = el('div', {}, { class: 'nx-footer' })
    this.dock.appendChild(this._footer)
    // Dismiss the account popup on any click outside it.
    window.addEventListener('click', function () { self._closeAcctMenu() })
  }

  // Load the extension's stored session, then keep the panel in sync with any
  // login / logout / token refresh (here or in another Claude tab).
  Panel.prototype._initAuth = function () {
    const self = this
    if (!NX.auth) { this._applyAuthState(); return }
    NX.auth.getSession().then(function (s) { self._session = s; self._applyAuthState() })
    NX.auth.onChange(function (s) { self._session = s; self._applyAuthState() })
  }

  Panel.prototype._applyAuthState = function () {
    this._authed = !!(this._session && this._session.user)
    // The right pill (view-mode + count) is meaningless while gated; the left
    // pill (collapse + brand) stays so the panel can still be dismissed.
    if (this._rightPill) this._rightPill.style.display = this._authed ? '' : 'none'
    if (!this._authed) this._disarmBranch()
    this._renderFooter()
    this._renderBody()
  }

  Panel.prototype._renderFooter = function () {
    if (!this._footer) return
    if (!this._authed) { this._footer.style.display = 'none'; this._footer.innerHTML = ''; this._openBtn = null; return }
    this._footer.style.display = ''
    this._footer.innerHTML = ''
    this._renderAccount()
  }

  // ── Signed in: handoff + identity ──────────────────────────────────────────
  // The identity collapses to a small initials avatar in the footer's bottom-left
  // (mirrors the nodea.ai/app sidebar). Clicking it pops up the email + Log out.
  Panel.prototype._renderAccount = function () {
    const self = this
    const email = (this._session.user && this._session.user.email) || 'your account'

    const row = el('div', {}, { class: 'nx-foot-row' })

    const acct = el('div', {}, { class: 'nx-acct' })

    // Popup (hidden until the avatar is clicked) — anchored above the avatar.
    const menu = el('div', {}, { class: 'nx-acct-menu' })
    menu.appendChild(el('div', {}, { class: 'nx-acct-menu-email', text: email, title: email }))
    const logout = el('button', {}, { class: 'nx-acct-logout', text: 'Log out' })
    logout.addEventListener('click', function () { self._logout() })
    menu.appendChild(logout)
    menu.addEventListener('click', function (e) { e.stopPropagation() })
    acct.appendChild(menu)
    this._acctMenu = menu
    this._acctMenuOpen = false

    const avatar = el('button', {}, {
      class: 'nx-acct-avatar',
      text: initialsForEmail(email),
      title: 'Signed in to Nodea as ' + email,
    })
    avatar.addEventListener('click', function (e) {
      e.stopPropagation()
      self._toggleAcctMenu()
    })
    acct.appendChild(avatar)
    row.appendChild(acct)

    // Secondary, low-key upsell link to the full app's extra features.
    const more = el('a', {}, {
      class: 'nx-more-link',
      html: 'More with Nodea&nbsp;→',
      href: 'https://nodea.ai',
      target: '_blank',
      rel: 'noopener',
      title: 'Merge branches, sticky notes, colors & search — only in the full app',
    })
    row.appendChild(more)

    const btn = el('button', {}, { class: 'nx-open-btn', html: 'Open in Nodea&nbsp;→' })
    btn.addEventListener('click', function () { self._openInNodea() })
    this._openBtn = btn
    row.appendChild(btn)

    this._footer.appendChild(row)
  }

  Panel.prototype._toggleAcctMenu = function () {
    if (this._acctMenuOpen) this._closeAcctMenu()
    else this._openAcctMenu()
  }
  Panel.prototype._openAcctMenu = function () {
    if (!this._acctMenu) return
    this._acctMenu.style.display = 'flex'
    this._acctMenuOpen = true
  }
  Panel.prototype._closeAcctMenu = function () {
    if (!this._acctMenu) return
    this._acctMenu.style.display = 'none'
    this._acctMenuOpen = false
  }

  // ── Signed out: full-panel login (implements the "Nodea Login.html" design) ──
  // An animated branch-map graphic (edges draw in, nodes pop, a packet travels
  // the active path) over Nodea's dotted-grid surface, then the brand lockup,
  // Sign in / Create account tabs, and email + password fields.
  Panel.prototype._authTreeSVG = function () {
    return (
      '<svg class="nx-tree" viewBox="0 0 168 116" aria-label="A conversation branch map">' +
        '<defs>' +
          '<radialGradient id="nxHalo" cx="50%" cy="50%" r="50%">' +
            '<stop offset="0" stop-color="#8b5cf6" stop-opacity=".55" />' +
            '<stop offset="1" stop-color="#8b5cf6" stop-opacity="0" />' +
          '</radialGradient>' +
          '<path id="nxFlow" d="M84,18 C84,40 122,40 122,60 C122,80 138,82 138,100" />' +
        '</defs>' +
        '<path class="nx-edge nx-e1" style="--len:95" d="M84,18 C84,40 46,40 46,60" />' +
        '<path class="nx-edge nx-active nx-e2" style="--len:95" d="M84,18 C84,40 122,40 122,60" />' +
        '<path class="nx-edge nx-e3" style="--len:75" d="M122,60 C122,80 102,82 102,100" />' +
        '<path class="nx-edge nx-active nx-e4" style="--len:75" d="M122,60 C122,80 138,82 138,100" />' +
        '<circle class="nx-halo" cx="122" cy="60" r="17" fill="url(#nxHalo)" />' +
        '<circle class="nx-halo nx-h2" cx="138" cy="100" r="17" fill="url(#nxHalo)" />' +
        '<g class="nx-node nx-n1"><circle cx="84" cy="18" r="9.5" fill="#7c3aed" /><circle cx="84" cy="18" r="3.4" fill="#fff" /></g>' +
        '<g class="nx-node nx-n2"><circle cx="46" cy="60" r="8.5" fill="#fff" stroke="#c4b5fd" stroke-width="3" /></g>' +
        '<g class="nx-node nx-n3"><circle cx="122" cy="60" r="9.5" fill="#7c3aed" /><circle cx="122" cy="60" r="3.4" fill="#fff" /></g>' +
        '<g class="nx-node nx-n4"><circle cx="102" cy="100" r="8.5" fill="#fff" stroke="#c4b5fd" stroke-width="3" /></g>' +
        '<g class="nx-node nx-n5"><circle cx="138" cy="100" r="9.5" fill="#7c3aed" /><circle cx="138" cy="100" r="3.4" fill="#fff" /></g>' +
        '<g class="nx-packet">' +
          '<circle r="4.5" fill="#fff" stroke="#7c3aed" stroke-width="2.5">' +
            '<animateMotion dur="3s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">' +
              '<mpath href="#nxFlow" />' +
            '</animateMotion>' +
          '</circle>' +
        '</g>' +
      '</svg>'
    )
  }

  Panel.prototype._renderAuthScreen = function () {
    const self = this
    const mode = this._authMode
    const SIGNUP = mode === 'signup'
    const MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>'
    const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
    const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
    const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/></svg>'
    const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
    const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    const iconURL = safeRuntimeURL('icons/icon128.png')

    const wrap = el('div', {}, { class: 'nx-login' })

    // Backdrop: dotted-grid surface + faint background bezier edges.
    wrap.appendChild(el('div', {}, { class: 'nx-login-stage' }))
    wrap.appendChild(el('div', {}, {
      class: 'nx-login-stage-edges',
      html:
        '<svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<path d="M180,140 C180,260 360,240 360,360" /><path d="M180,140 C180,300 60,320 60,440" />' +
          '<path d="M1030,640 C1030,520 880,540 880,420" /><path d="M1030,640 C1030,720 1140,720 1140,760" />' +
          '<circle cx="180" cy="140" r="6" /><circle cx="360" cy="360" r="5" /><circle cx="60" cy="440" r="5" />' +
          '<circle cx="1030" cy="640" r="6" /><circle cx="880" cy="420" r="5" />' +
        '</svg>',
    }))

    const card = el('div', {}, { class: 'nx-login-card' })

    // Animated branch map — what Nodea draws.
    card.appendChild(el('div', {}, { class: 'nx-tree-wrap', html: this._authTreeSVG() }))

    // Brand lockup.
    const brand = el('div', {}, { class: 'nx-login-brand' })
    const row = el('div', {}, { class: 'nx-login-brand-row' })
    if (iconURL) row.appendChild(el('img', {}, { class: 'nx-login-ico', src: iconURL, alt: 'Nodea' }))
    row.appendChild(el('span', {}, { class: 'nx-login-name', text: 'Nodea Tree' }))
    brand.appendChild(row)
    brand.appendChild(el('div', {}, { class: 'nx-login-tag', html: 'Branch maps <b>for ' + hostLabel() + '</b>' }))
    card.appendChild(brand)

    // Tabs.
    const tabs = el('div', {}, { class: 'nx-login-tabs' })
    ;[['signin', 'Sign in'], ['signup', 'Create account']].forEach(function (t) {
      const b = el('button', {}, { class: 'nx-login-tab' + (mode === t[0] ? ' nx-active' : ''), type: 'button', text: t[1] })
      b.addEventListener('click', function () {
        if (self._authMode === t[0]) return
        self._authMode = t[0]
        self._rebuildAuthScreen()
      })
      tabs.appendChild(b)
    })
    card.appendChild(tabs)

    // Email field.
    const emailField = el('div', {}, { class: 'nx-login-field' })
    emailField.appendChild(el('label', {}, { class: 'nx-login-label', text: 'Email' }))
    const emailWrap = el('div', {}, { class: 'nx-login-input-wrap', html: MAIL })
    const emailIn = el('input', {}, { class: 'nx-login-input', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' })
    if (this._authEmail) emailIn.value = this._authEmail
    emailIn.addEventListener('input', function () { self._authEmail = emailIn.value })
    emailWrap.appendChild(emailIn)
    emailField.appendChild(emailWrap)
    card.appendChild(emailField)

    // Password field with eye toggle.
    const pwField = el('div', {}, { class: 'nx-login-field' })
    pwField.appendChild(el('label', {}, { class: 'nx-login-label', text: 'Password' }))
    const pwWrap = el('div', {}, { class: 'nx-login-input-wrap', html: LOCK })
    const pwdIn = el('input', {}, {
      class: 'nx-login-input', type: this._showPwd ? 'text' : 'password',
      placeholder: '••••••••', autocomplete: SIGNUP ? 'new-password' : 'current-password',
    })
    pwWrap.appendChild(pwdIn)
    const eye = el('button', {}, { class: 'nx-login-eye', type: 'button', 'aria-label': 'Show password', html: this._showPwd ? EYE_OFF : EYE })
    eye.addEventListener('click', function () {
      self._showPwd = !self._showPwd
      pwdIn.type = self._showPwd ? 'text' : 'password'
      eye.innerHTML = self._showPwd ? EYE_OFF : EYE
      pwdIn.focus()
    })
    pwWrap.appendChild(eye)
    pwField.appendChild(pwWrap)
    card.appendChild(pwField)

    // Stay signed in + Forgot.
    const rowBetween = el('div', {}, { class: 'nx-login-row-between' })
    const remember = el('label', {}, { class: 'nx-login-remember' })
    const cb = el('input', {}, { type: 'checkbox' })
    cb.checked = true
    remember.appendChild(cb)
    remember.appendChild(el('span', {}, { class: 'nx-login-box', html: CHECK }))
    remember.appendChild(document.createTextNode('Stay signed in'))
    rowBetween.appendChild(remember)
    const forgot = el('a', {}, { class: 'nx-login-forgot', href: 'https://nodea.ai/login', target: '_blank', rel: 'noopener', text: 'Forgot?' })
    rowBetween.appendChild(forgot)
    card.appendChild(rowBetween)

    // Inline message (validation / auth errors / notices).
    const msg = el('div', {}, { class: 'nx-login-msg' })
    card.appendChild(msg)
    const setMsg = function (text, kind) {
      msg.textContent = text || ''
      msg.className = 'nx-login-msg' + (text ? ' nx-show nx-' + kind : '')
    }

    // Submit.
    const submitLabel = SIGNUP ? 'Create account' : 'Sign in'
    const submit = el('button', {}, { class: 'nx-login-submit', type: 'button', html: '<span>' + submitLabel + '</span>' + ARROW })
    card.appendChild(submit)

    const submitForm = function () {
      const email = emailIn.value.trim()
      const password = pwdIn.value
      if (!/.+@.+\..+/.test(email)) { setMsg('Enter a valid email.', 'error'); emailIn.focus(); return }
      if (!password || (SIGNUP && password.length < 8)) {
        setMsg(SIGNUP ? 'Password needs at least 8 characters.' : 'Enter your password.', 'error')
        pwdIn.focus(); return
      }
      submit.disabled = true
      submit.innerHTML = '<span>' + (SIGNUP ? 'Creating…' : 'Just a sec…') + '</span>'
      setMsg('')
      const op = SIGNUP ? NX.auth.signUp(email, password) : NX.auth.signIn(email, password)
      op.then(function (r) {
        if (r && r.ok && r.session) {
          self._session = r.session
          self._authEmail = ''
          self._applyAuthState() // tree unlocks
        } else if (r && r.ok && r.needsConfirm) {
          self._authMode = 'signin'
          self._pendingNotice = { text: 'Check your email to confirm, then sign in.', kind: 'ok' }
          self._rebuildAuthScreen()
        } else {
          submit.disabled = false
          submit.innerHTML = '<span>' + submitLabel + '</span>' + ARROW
          setMsg((r && r.error) || 'Something went wrong.', 'error')
        }
      })
    }
    submit.addEventListener('click', submitForm)
    ;[emailIn, pwdIn].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitForm() } })
    })

    // Footer — separate-login note + terms.
    card.appendChild(el('p', {}, {
      class: 'nx-login-foot',
      html: 'Your extension login is separate from the website.<br/>By continuing you agree to the ' +
        '<a href="https://nodea.ai/privacy" target="_blank" rel="noopener">Terms</a> &amp; ' +
        '<a href="https://nodea.ai/privacy" target="_blank" rel="noopener">Privacy</a>.',
    }))

    wrap.appendChild(card)

    if (this._pendingNotice) { setMsg(this._pendingNotice.text, this._pendingNotice.kind); this._pendingNotice = null }

    return wrap
  }

  // Force the gated body to rebuild the login screen (tab/mode switches, notices).
  Panel.prototype._rebuildAuthScreen = function () {
    if (this._authed || !this.body) return
    this.body.innerHTML = ''
    this.body.appendChild(this._renderAuthScreen())
  }

  Panel.prototype._logout = function () {
    this._session = null
    this._authMode = 'signin'
    this._applyAuthState()
    if (NX.auth) NX.auth.signOut()
  }

  Panel.prototype._buildColorMenu = function () {
    const self = this
    const menu = el('div', { display: 'none' }, { class: 'nx-color-menu' })
    NX.PALETTE.forEach(function (p) {
      const sw = el('button', {}, { class: 'nx-swatch', title: p.label })
      sw.style.background = p.hex || 'transparent'
      if (!p.hex) sw.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="10" x2="10" y2="2" stroke="var(--nx-text-muted)" stroke-width="1.4"/></svg>'
      sw.addEventListener('click', function (e) {
        e.stopPropagation()
        if (self._colorTarget) {
          if (p.hex) self.state.colors[self._colorTarget] = p.hex
          else delete self.state.colors[self._colorTarget]
          self._persistColors()
          self.tree.render()
        }
        self._closeColorMenu()
      })
      menu.appendChild(sw)
    })
    this._colorMenu = menu
    this.root.appendChild(menu)
    window.addEventListener('click', function () { self._closeColorMenu() })
  }

  Panel.prototype._openColorMenu = function (pairId, x, y) {
    this._colorTarget = pairId
    Object.assign(this._colorMenu.style, { display: 'flex', left: x + 'px', top: y + 'px' })
  }
  Panel.prototype._closeColorMenu = function () {
    this._colorTarget = null
    this._colorMenu.style.display = 'none'
  }

  Panel.prototype._persistColors = function () {
    if (!this.state.convId) return
    try { chrome.storage.local.set({ ['nx_colors_' + this.state.convId]: this.state.colors }) } catch (e) {}
  }

  // ── Outline view (port of OutlineView) ────────────────────────────────────
  Panel.prototype._renderOutline = function () {
    const self = this
    const pairs = NX.buildPairs(this.state.nodes || [])
    const childrenMap = new Map()
    for (const p of pairs) {
      const k = p.parentPairId
      if (!childrenMap.has(k)) childrenMap.set(k, [])
      childrenMap.get(k).push(p)
    }
    // paddingTop clears the floating header pills (outline starts at dock top).
    const wrap = el('div', { flex: '1', overflowY: 'auto', paddingTop: '56px' })
    if (pairs.length === 0) {
      wrap.appendChild(el('div', { padding: '20px', color: 'var(--nx-text-muted)', fontSize: '12px', textAlign: 'center' }, { html: 'Nodes will appear<br>as you chat' }))
      return wrap
    }
    function renderBranch(pairId, depth) {
      const children = childrenMap.get(pairId) || childrenMap.get(pairId === null ? undefined : pairId) || []
      children.forEach(function (pair) {
        const isActive =
          pair.id === self.state.selectedNodeId ||
          pair.userNode.id === self.state.selectedNodeId ||
          (pair.aiNode && pair.aiNode.id === self.state.selectedNodeId)
        const title = NX.generateTitle(pair.userNode.content)
        const summary = pair.aiNode ? NX.generateSummary(pair.aiNode.content) : ''
        const short = summary.length > 80 ? summary.slice(0, 77) + '…' : summary
        const row = el('div', {
          paddingLeft: 12 + depth * 16 + 'px',
          paddingRight: '12px',
          paddingTop: '7px',
          paddingBottom: '7px',
          cursor: 'pointer',
          background: isActive ? 'var(--nx-node-active-bg)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--nx-accent)' : '2px solid transparent',
          borderBottom: '1px solid var(--nx-border)',
        })
        row.appendChild(el('div', { fontSize: '12px', fontWeight: '600', color: 'var(--nx-text-primary)', lineHeight: '1.35' }, { text: title }))
        if (short) row.appendChild(el('div', { fontSize: '11px', color: 'var(--nx-text-muted)', lineHeight: '1.4', marginTop: '2px' }, { text: short }))
        row.addEventListener('click', function () {
          self._onNodeSelect(pair.aiNode ? pair.aiNode.id : pair.userNode.id, pair)
        })
        wrap.appendChild(row)
        renderBranch(pair.id, depth + 1)
      })
    }
    renderBranch(null, 0)
    return wrap
  }

  // ── Node selection: highlight, navigate Claude there, arm branching ───────
  Panel.prototype._onNodeSelect = function (id, pair) {
    const self = this
    this.state.selectedNodeId = id
    if (this.state.viewMode === 'outline') this._renderBody()
    else this.tree && this.tree.render()
    this._selectedPair = pair
    // Arm branching: the user's NEXT prompt in the host's own box forks from
    // here. Only when the host has a write driver (Claude); otherwise selecting
    // a node just highlights its path in the tree (visualize-only hosts).
    if (pair && canWrite()) this._armBranch(pair)
    // Drive the host's native UI to display this branch (the "go to that spot").
    if (canWrite() && pair) {
      const pairs = NX.buildPairs(this.state.nodes || [])
      const target = pairs.find((p) => p.id === pair.id) || pair
      NX.write.navigateAndReveal(pairs, target).then(function (res) {
        if (res && !res.ok) self._setArmStatus('Couldn’t jump to this branch (' + res.reason + ')')
      })
    }
  }

  // ── Arm banner: shows which node the next prompt will branch from ──────────
  Panel.prototype._buildArmBanner = function () {
    const self = this
    const bar = el('div', { display: 'none' }, { class: 'nx-armbar' })
    const main = el('div', { flex: '1', minWidth: '0' })
    this._armLabel = el('div', {}, { class: 'nx-arm-label', text: 'Branching' })
    this._armStatus = el('div', {}, { class: 'nx-arm-status', text: '' })
    main.appendChild(this._armLabel)
    main.appendChild(this._armStatus)
    bar.appendChild(main)
    const x = el('button', {}, { class: 'nx-arm-x', title: 'Cancel branching (Esc)', html: '✕' })
    x.addEventListener('click', function () { self._disarmBranch() })
    bar.appendChild(x)
    this._armBar = bar
    this.dock.appendChild(bar)
  }

  Panel.prototype._armBranch = function (pair) {
    this._armed = pair
    const title = NX.generateTitle(pair.userNode.content)
    this._armLabel.textContent = '↳ Branching from: ' + title
    this._armStatus.textContent = 'Type your prompt in ' + hostLabel() + '’s box — it forks here.'
    this._armBar.style.display = 'flex'
  }

  Panel.prototype._disarmBranch = function () {
    this._armed = null
    if (this._armBar) this._armBar.style.display = 'none'
  }

  Panel.prototype._setArmStatus = function (msg) {
    if (this._armStatus) this._armStatus.textContent = msg
  }

  // Intercept Claude's native send (Enter / Send button) while armed, and
  // reroute it to fork from the selected node instead of appending at the leaf.
  // No-op on visualize-only hosts (no write driver → branching never arms).
  Panel.prototype._installSendInterceptor = function () {
    const self = this
    if (!canWrite()) return
    const readComposer = function () {
      const ci = document.querySelector('[data-testid="chat-input"]')
      return ci ? (ci.textContent || '') : ''
    }
    const clearComposer = function () {
      const ci = document.querySelector('[data-testid="chat-input"]')
      if (!ci) return
      ci.focus()
      document.execCommand('selectAll', false, null)
      document.execCommand('delete', false, null)
    }
    self._restoreComposer = function (text) {
      const ci = document.querySelector('[data-testid="chat-input"]')
      if (!ci) return
      ci.focus()
      document.execCommand('selectAll', false, null)
      document.execCommand('delete', false, null)
      document.execCommand('insertText', false, text)
    }
    const trigger = function (e) {
      const text = readComposer().trim()
      if (!text) return false // empty: let Claude handle normally
      e.preventDefault()
      e.stopImmediatePropagation()
      clearComposer()
      self._performFork(self._armed, text)
      return true
    }
    document.addEventListener('keydown', function (e) {
      if (!self._armed) return
      if (e.key === 'Escape') { self._disarmBranch(); return }
      const ci = e.target.closest && e.target.closest('[data-testid="chat-input"]')
      if (ci && e.key === 'Enter' && !e.shiftKey) trigger(e)
    }, true)
    document.addEventListener('click', function (e) {
      if (!self._armed) return
      const btn = e.target.closest && e.target.closest('button[aria-label="Send message"]')
      if (btn) trigger(e)
    }, true)
  }

  Panel.prototype._performFork = function (target, text) {
    const self = this
    if (!target || !NX.write) return
    this._armed = null // stop intercepting so our own programmatic send isn't blocked
    this._setArmStatus('Branching…')
    const pairs = NX.buildPairs(this.state.nodes || [])
    const t = pairs.find((p) => p.id === target.id) || target
    NX.write.forkFromNode(pairs, t, text).then(function (res) {
      if (res && res.ok) {
        self._setArmStatus(res.mode === 'continue' ? 'Continuing…' : 'Branch created — generating…')
        if (NX.requestRefresh) {
          setTimeout(NX.requestRefresh, 2500)
          setTimeout(NX.requestRefresh, 6000)
          setTimeout(function () { NX.requestRefresh(); self._disarmBranch() }, 9000)
        } else {
          setTimeout(function () { self._disarmBranch() }, 4000)
        }
      } else {
        // Fork didn't go through — put the prompt back in the composer so it's
        // never silently lost, and re-arm so the user can retry from this node.
        self._armed = t
        self._restoreComposer && self._restoreComposer(text)
        self._setArmStatus('Failed: ' + ((res && res.reason) || 'unknown') + ' — your prompt was restored, try again')
      }
    }).catch(function (err) {
      // Unexpected throw mid-fork: same recovery — restore the text, re-arm.
      self._armed = t
      self._restoreComposer && self._restoreComposer(text)
      self._setArmStatus('Failed: ' + ((err && err.message) || 'unexpected error') + ' — your prompt was restored, try again')
    })
  }

  // ── View switching ────────────────────────────────────────────────────────
  Panel.prototype.setViewMode = function (mode) {
    this.state.viewMode = mode
    if (this._viewTriggerIcon) this._viewTriggerIcon.innerHTML = ICONS[mode] || ''
    for (const m in this._viewMenuItems) {
      this._viewMenuItems[m].classList.toggle('nx-active', m === mode)
    }
    this._renderBody()
  }

  Panel.prototype._openViewMenu = function () {
    if (this._viewWrap) this._viewWrap.classList.add('nx-open')
  }
  Panel.prototype._closeViewMenu = function () {
    if (this._viewWrap) this._viewWrap.classList.remove('nx-open')
  }

  Panel.prototype._renderBody = function () {
    // Gate: no tree until signed in. Keep an already-mounted login screen as-is
    // (a background tree update must not wipe a half-typed email/password).
    if (!this._authed) {
      if (this.body.querySelector('.nx-login')) return
      this.body.innerHTML = ''
      this.body.appendChild(this._renderAuthScreen())
      return
    }
    // swap body content
    this.body.innerHTML = ''
    if (this.state.viewMode === 'outline') {
      this.body.appendChild(this._renderOutline())
    } else {
      // rebuild canvas (TreeView appends its own container)
      this.tree = new NX.TreeView(this.body, this.state, {
        onSelect: (id, pair) => this._onNodeSelect(id, pair),
        onColorMenu: (pairId, x, y) => this._openColorMenu(pairId, x, y),
      })
      this.tree.render()
    }
  }

  // ── Push Claude's content over so the fixed panel never covers it ──────────
  // We reserve space by putting a right margin on <body>: Claude's chat column is
  // a %-width child of <body>, so the margin reflows it leftward, while the panel
  // (position:fixed) ignores the margin and stays flush against the reclaimed
  // edge. Deliberately NOT <main>: on a real conversation page (/chat/<uuid>)
  // there is no <main> element — it only exists on /new — so targeting <main>
  // pushed nothing on the very pages where the panel actually mounts. No
  // transition: drag-resize sets a new width every pointermove, and easing each
  // step would make the content lag behind the dock edge.
  Panel.prototype._pushContent = function (width) {
    if (!this._pushStyle) {
      this._pushStyle = document.createElement('style')
      this._pushStyle.id = 'nx-push-style'
      document.head.appendChild(this._pushStyle)
    }
    const w = Math.max(0, width | 0)
    this._pushStyle.textContent = 'body { margin-right: ' + w + 'px !important; }'
  }

  Panel.prototype.setCollapsed = function (collapsed) {
    this.collapsed = collapsed
    if (collapsed) {
      this.dock.style.display = 'none'
      this._showStrip()
      this._pushContent(48)
    } else {
      if (this._strip) this._strip.style.display = 'none'
      this.dock.style.display = 'flex'
      this._pushContent(this.width)
      this.tree && this.tree.render()
    }
  }
  Panel.prototype.toggle = function () { this.setCollapsed(!this.collapsed) }

  Panel.prototype._showStrip = function () {
    const self = this
    if (!this._strip) {
      const strip = el('div', {}, { class: 'nx-strip' })
      // The purple Nodea app logo IS the expand control while collapsed — click
      // it to bring the diagram back out (same as the arrow).
      const iconURL = safeRuntimeURL('icons/icon128.png')
      if (iconURL) {
        const logo = el('img', {}, { class: 'nx-strip-logo', src: iconURL, alt: 'Expand Nodea tree', title: 'Expand tree' })
        logo.addEventListener('click', function () { self.setCollapsed(false) })
        strip.appendChild(logo)
      }
      const b = el('button', {}, { class: 'nx-icon-btn nx-strip-btn', title: 'Expand tree', html: ICONS.expand })
      b.addEventListener('click', function () { self.setCollapsed(false) })
      strip.appendChild(b)
      this._strip = strip
      this.root.appendChild(strip)
    }
    this._strip.style.display = 'flex'
  }

  // ── Open in Nodea (structured tree import) ────────────────────────────────
  // Hand the WHOLE branch tree to Nodea so it rebuilds the real node graph
  // (every branch, with parent links + source ids), not pasted Markdown. We
  // open the Nodea tab with `noopener`, so we can't postMessage it directly;
  // instead we stash the payload in chrome.storage and the Nodea-side content
  // script bridge (src/bridge.js) relays it into the logged-in app tab, which
  // inserts it via Nodea's normal Supabase path. Stamping each node with its
  // Claude message id is what later lets "Update Conversation" diff & re-sync.
  Panel.prototype._openInNodea = async function () {
    const self = this
    // Gate the handoff on the extension's own Nodea session.
    if (!this._session || !this._session.user) { this._renderFooter(); return }
    const setBtn = function (html, disabled) {
      if (self._openBtn) { self._openBtn.innerHTML = html; self._openBtn.disabled = !!disabled }
    }
    const nodes = (this.state.nodes || []).map(function (n) {
      return {
        id: n.id,
        parent_id: n.parent_id || null,
        role: n.role === 'assistant' ? 'assistant' : 'user',
        content: n.content || '',
        created_at: n.created_at || null,
      }
    })
    if (!nodes.length) {
      setBtn('Nothing to import', false)
      setTimeout(function () { setBtn('Open in Nodea&nbsp;→', false) }, 1800)
      return
    }

    setBtn('Preparing…', true)
    let orgId = null
    try { orgId = NX.adapter.getOrgId ? await NX.adapter.getOrgId() : null } catch (e) {}

    const payload = {
      v: 1,
      source: hostSource(),
      sourceConversationId: this.state.convId || null,
      sourceOrgId: orgId,
      name: this.state.convName || 'Imported conversation',
      currentLeaf: this.state.currentLeaf || null,
      selectedLeaf: this.state.selectedNodeId || null,
      exportedAt: Date.now(),
      nodes: nodes,
    }

    let stored = false
    try {
      await new Promise(function (resolve, reject) {
        chrome.storage.local.set({ nx_import: payload }, function () {
          const err = chrome.runtime && chrome.runtime.lastError
          if (err) reject(err); else resolve()
        })
      })
      stored = true
    } catch (e) {
      // Extension storage unavailable — fall back to the old clipboard handoff
      // so the button still does something useful.
      try { navigator.clipboard.writeText(this._activeBranchMarkdown()) } catch (e2) {}
    }

    window.open(NODEA_APP_URL + (stored ? '?import=' + hostSource() : ''), '_blank', 'noopener')
    setBtn(stored ? 'Sent to Nodea&nbsp;✓' : 'Opened Nodea', false)
    setTimeout(function () { setBtn('Open in Nodea&nbsp;→', false) }, 2600)
  }

  // Markdown of the active branch — the pre-import fallback when extension
  // storage isn't available.
  Panel.prototype._activeBranchMarkdown = function () {
    const pairs = NX.buildPairs(this.state.nodes || [])
    const active = NX.getActivePairIds(pairs, this.state.selectedNodeId)
    const chain = (active.size ? pairs.filter((p) => active.has(p.id)) : pairs).sort(
      (a, b) => +new Date(a.userNode.created_at) - +new Date(b.userNode.created_at)
    )
    const host = hostLabel()
    let md = `# ${this.state.convName}\n\n_Exported from ${host} via Nodea Tree_\n\n`
    for (const p of chain) {
      md += `**You:** ${(p.userNode.content || '').trim()}\n\n`
      if (p.aiNode) md += `**${host}:** ${(p.aiNode.content || '').trim()}\n\n`
      md += '---\n\n'
    }
    return md
  }

  // ── Public: feed new tree data in ─────────────────────────────────────────
  Panel.prototype.update = function (data) {
    const convChanged = data.convId && data.convId !== this.state.convId
    this.state.nodes = data.nodes || this.state.nodes
    this.state.convId = data.convId || this.state.convId
    this.state.convName = data.convName || this.state.convName
    if (data.currentLeaf) this.state.currentLeaf = data.currentLeaf
    if (data.currentLeaf && (convChanged || !this.state.selectedNodeId)) {
      this.state.selectedNodeId = data.currentLeaf
    }
    if (convChanged) {
      this._loadColors()
      this.tree && (this.tree._initialFitDone = false)
    }
    this._countBadge.textContent = String(NX.buildPairs(this.state.nodes).length)
    this._renderBody()
  }

  Panel.prototype._loadColors = function () {
    const self = this
    if (!this.state.convId) return
    try {
      chrome.storage.local.get('nx_colors_' + this.state.convId, function (res) {
        self.state.colors = res['nx_colors_' + self.state.convId] || {}
        self.tree && self.tree.render()
      })
    } catch (e) { this.state.colors = {} }
  }

  NX.Panel = Panel
})()
