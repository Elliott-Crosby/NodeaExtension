// Nodea Tree for Claude — panel shell.
// The right-side dock that mirrors Nodea's Conversation Tree panel: header with
// collapse + view toggle + node count, the canvas (TreeView) or outline, a
// color menu, and the "Open in Nodea" handoff footer.
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})
  const { el } = NX

  const DEFAULT_WIDTH = 340
  const MIN_WIDTH = 240
  const MAX_WIDTH = 720

  function icon(html, size) {
    size = size || 14
    return `<svg width="${size}" height="${size}" viewBox="0 0 14 14" fill="none">${html}</svg>`
  }
  const ICONS = {
    collapse: icon('<path d="M9 2l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 2l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.45"/>'),
    expand: icon('<path d="M9 2L4 7l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 2L0 7l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>'),
    tree: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="0.5" width="4" height="3" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="0.5" y="8.5" width="3.5" height="3" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="8" y="8.5" width="3.5" height="3" rx="0.8" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="3.5" x2="6" y2="6.5" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="6.5" x2="2.25" y2="8.5" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="6.5" x2="9.75" y2="8.5" stroke="currentColor" stroke-width="1.1"/></svg>',
    outline: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="1" y1="3" x2="11" y2="3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="3" y1="6.5" x2="11" y2="6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><line x1="5" y1="10" x2="11" y2="10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    full: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="0.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="0.5" y="7.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1"/><rect x="7.5" y="7.5" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="4.5" x2="6" y2="6" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="6" x2="2.5" y2="7.5" stroke="currentColor" stroke-width="1.1"/><line x1="6" y1="6" x2="9.5" y2="7.5" stroke="currentColor" stroke-width="1.1"/></svg>',
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
    }
    this.collapsed = false
    this.width = DEFAULT_WIDTH

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

    this._buildComposer()
    this._buildFooter()
    this._buildColorMenu()

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
    const h = el('div', {
      position: 'absolute', left: '0', top: '0', width: '5px', height: '100%',
      cursor: 'col-resize', zIndex: '20', background: 'transparent', transition: 'background 0.15s',
    }, { title: 'Drag to resize' })
    h.addEventListener('mouseenter', function () { h.style.background = 'var(--nx-accent)'; h.style.opacity = '0.35' })
    h.addEventListener('mouseleave', function () { h.style.background = 'transparent'; h.style.opacity = '1' })
    h.addEventListener('mousedown', function (e) {
      e.preventDefault()
      const ox = e.clientX, ow = self.width
      function move(ev) {
        const delta = ox - ev.clientX
        self.width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, ow + delta))
        self.dock.style.width = self.width + 'px'
      }
      function up() {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        self.tree && self.tree.render()
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    })
    this.dock.appendChild(h)
  }

  Panel.prototype._buildHeader = function () {
    const self = this
    const header = el('div', {}, { class: 'nx-header' })

    const collapseBtn = el('button', {}, { class: 'nx-icon-btn', title: 'Collapse tree', html: ICONS.collapse })
    collapseBtn.addEventListener('click', function () { self.setCollapsed(true) })
    header.appendChild(collapseBtn)

    const titleSpan = el('span', {
      fontSize: '13px', fontWeight: '600', color: 'var(--nx-text-primary)', flex: '1',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }, { text: 'Conversation Tree' })
    header.appendChild(titleSpan)

    // view toggle
    const toggle = el('div', {}, { class: 'nx-toggle' })
    this._toggleBtns = {}
    ;['tree', 'outline', 'full'].forEach(function (mode) {
      const b = el('button', {}, {
        class: 'nx-toggle-btn' + (mode === self.state.viewMode ? ' nx-active' : ''),
        title: mode === 'tree' ? 'Tree view (summaries)' : mode === 'outline' ? 'Outline view' : 'Full view (raw text)',
        html: ICONS[mode],
      })
      b.addEventListener('click', function () { self.setViewMode(mode) })
      self._toggleBtns[mode] = b
      toggle.appendChild(b)
    })
    header.appendChild(toggle)

    this._countBadge = el('span', {}, { class: 'nx-count', text: '0' })
    header.appendChild(this._countBadge)

    this.dock.appendChild(header)
  }

  Panel.prototype._buildFooter = function () {
    const self = this
    const footer = el('div', {}, { class: 'nx-footer' })
    const btn = el('button', {}, { class: 'nx-open-btn', html: 'Open in Nodea&nbsp;→' })
    btn.addEventListener('click', function () { self._openInNodea() })
    footer.appendChild(btn)
    this.dock.appendChild(footer)
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
    const wrap = el('div', { flex: '1', overflowY: 'auto' })
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

  // ── Node selection: highlight + navigate Claude to that spot ──────────────
  Panel.prototype._onNodeSelect = function (id, pair) {
    const self = this
    this.state.selectedNodeId = id
    if (this.state.viewMode === 'outline') this._renderBody()
    else this.tree && this.tree.render()
    this._selectedPair = pair
    this._showComposer(pair)
    // Drive Claude's native UI to display this branch (the "go to that spot").
    if (NX.write && pair) {
      const pairs = NX.buildPairs(this.state.nodes || [])
      const target = pairs.find((p) => p.id === pair.id) || pair
      NX.write.navigateAndReveal(pairs, target).then(function (res) {
        if (res && !res.ok) self._setComposerStatus('Couldn’t jump to this branch (' + res.reason + ')')
      })
    }
  }

  // ── Branch composer (fork from the selected node) ─────────────────────────
  Panel.prototype._buildComposer = function () {
    const self = this
    const box = el('div', { display: 'none' }, { class: 'nx-compose' })

    this._composeLabel = el('div', {}, { class: 'nx-compose-label', text: 'Branch from this node' })
    box.appendChild(this._composeLabel)

    this._composeInput = el('textarea', {}, {
      class: 'nx-compose-input',
      placeholder: 'Type a new prompt to branch from here…',
      rows: '2',
    })
    this._composeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self._doFork() }
    })
    box.appendChild(this._composeInput)

    const row = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' })
    this._composeStatus = el('div', {}, { class: 'nx-compose-status', text: '' })
    row.appendChild(this._composeStatus)
    this._composeBtn = el('button', {}, { class: 'nx-compose-btn', html: 'Branch&nbsp;↳' })
    this._composeBtn.addEventListener('click', function () { self._doFork() })
    row.appendChild(this._composeBtn)
    box.appendChild(row)

    this._composeBox = box
    this.dock.appendChild(box)
  }

  Panel.prototype._showComposer = function (pair) {
    if (!this._composeBox) return
    const title = pair ? NX.generateTitle(pair.userNode.content) : ''
    this._composeLabel.textContent = 'Branch from: ' + title
    this._composeStatus.textContent = ''
    this._composeBox.style.display = 'block'
  }

  Panel.prototype._setComposerStatus = function (msg) {
    if (this._composeStatus) this._composeStatus.textContent = msg
  }

  Panel.prototype._doFork = function () {
    const self = this
    const text = (this._composeInput.value || '').trim()
    if (!text) { this._setComposerStatus('Type a prompt first.'); return }
    if (!this._selectedPair || !NX.write) { this._setComposerStatus('Select a node first.'); return }
    const pairs = NX.buildPairs(this.state.nodes || [])
    const target = pairs.find((p) => p.id === self._selectedPair.id) || self._selectedPair
    this._composeBtn.disabled = true
    this._setComposerStatus('Branching…')
    NX.write.forkFromNode(pairs, target, text).then(function (res) {
      self._composeBtn.disabled = false
      if (res && res.ok) {
        self._composeInput.value = ''
        self._setComposerStatus(res.mode === 'continue' ? 'Continuing…' : 'Branch created — generating…')
        // Repopulate the tree once the new reply has had time to stream.
        if (NX.requestRefresh) {
          setTimeout(NX.requestRefresh, 2500)
          setTimeout(NX.requestRefresh, 6000)
          setTimeout(function () { NX.requestRefresh(); self._setComposerStatus('') }, 9000)
        }
      } else {
        self._setComposerStatus('Failed: ' + ((res && res.reason) || 'unknown'))
      }
    })
  }

  // ── View switching ────────────────────────────────────────────────────────
  Panel.prototype.setViewMode = function (mode) {
    this.state.viewMode = mode
    for (const m in this._toggleBtns) {
      this._toggleBtns[m].classList.toggle('nx-active', m === mode)
    }
    this._renderBody()
  }

  Panel.prototype._renderBody = function () {
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

  // ── Collapse ──────────────────────────────────────────────────────────────
  Panel.prototype.setCollapsed = function (collapsed) {
    this.collapsed = collapsed
    if (collapsed) {
      this.dock.style.display = 'none'
      this._showStrip()
    } else {
      if (this._strip) this._strip.style.display = 'none'
      this.dock.style.display = 'flex'
      this.tree && this.tree.render()
    }
  }
  Panel.prototype.toggle = function () { this.setCollapsed(!this.collapsed) }

  Panel.prototype._showStrip = function () {
    const self = this
    if (!this._strip) {
      const strip = el('div', {}, { class: 'nx-strip' })
      const b = el('button', {}, { class: 'nx-icon-btn nx-strip-btn', title: 'Expand tree', html: ICONS.expand })
      b.addEventListener('click', function () { self.setCollapsed(false) })
      strip.appendChild(b)
      strip.appendChild(el('div', { marginTop: '16px', opacity: '0.22', color: 'var(--nx-text-primary)' }, {
        html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="6" y="1" width="6" height="4" rx="1.2" stroke="currentColor" stroke-width="1.2"/><rect x="1" y="13" width="5" height="4" rx="1.2" stroke="currentColor" stroke-width="1.2"/><rect x="12" y="13" width="5" height="4" rx="1.2" stroke="currentColor" stroke-width="1.2"/><line x1="9" y1="5" x2="9" y2="9" stroke="currentColor" stroke-width="1.2"/><line x1="9" y1="9" x2="3.5" y2="13" stroke="currentColor" stroke-width="1.2"/><line x1="9" y1="9" x2="14.5" y2="13" stroke="currentColor" stroke-width="1.2"/></svg>',
      }))
      this._strip = strip
      this.root.appendChild(strip)
    }
    this._strip.style.display = 'flex'
  }

  // ── Open in Nodea (handoff) ───────────────────────────────────────────────
  // No import endpoint exists yet (it's on the roadmap), so v1 copies the active
  // branch as Markdown to the clipboard and opens the Nodea app. The structured
  // tree-import handshake is the follow-up.
  Panel.prototype._openInNodea = function () {
    const pairs = NX.buildPairs(this.state.nodes || [])
    const active = NX.getActivePairIds(pairs, this.state.selectedNodeId)
    const chain = (active.size ? pairs.filter((p) => active.has(p.id)) : pairs).sort(
      (a, b) => +new Date(a.userNode.created_at) - +new Date(b.userNode.created_at)
    )
    let md = `# ${this.state.convName}\n\n_Exported from Claude via Nodea Tree_\n\n`
    for (const p of chain) {
      md += `**You:** ${(p.userNode.content || '').trim()}\n\n`
      if (p.aiNode) md += `**Claude:** ${(p.aiNode.content || '').trim()}\n\n`
      md += '---\n\n'
    }
    try { navigator.clipboard.writeText(md) } catch (e) {}
    window.open('https://nodea.ai/app', '_blank', 'noopener')
  }

  // ── Public: feed new tree data in ─────────────────────────────────────────
  Panel.prototype.update = function (data) {
    const convChanged = data.convId && data.convId !== this.state.convId
    this.state.nodes = data.nodes || this.state.nodes
    this.state.convId = data.convId || this.state.convId
    this.state.convName = data.convName || this.state.convName
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
