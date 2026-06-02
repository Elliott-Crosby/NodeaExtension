// Nodea Tree for Claude — canvas renderer.
// Replicates the live Nodea TreePanel canvas: dotted grid, bezier edges,
// detailed/compact/mini node cards, active-path highlighting, node colors.
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})
  const { C, el, svgEl } = NX

  // A TreeView owns one scrollable/zoomable canvas inside a host element.
  // state is supplied + mutated by panel.js (selectedNodeId, viewMode, colors…).
  function TreeView(host, state, callbacks) {
    this.host = host
    this.state = state
    this.cb = callbacks || {}

    this.scale = 1
    this.pan = { x: 0, y: 0 }
    this.dragging = false
    this._drag = null
    this._initialFitDone = false

    this.container = el('div', {
      flex: '1',
      overflow: 'hidden',
      position: 'relative',
      cursor: 'grab',
    })
    this.host.appendChild(this.container)

    this.world = el('div', {
      position: 'absolute',
      top: '0',
      left: '0',
      transformOrigin: '0 0',
    })
    this.container.appendChild(this.world)

    this._bindPanZoom()
  }

  TreeView.prototype._applyGrid = function () {
    const s = this.scale
    const px = C.GRID_PX * s
    Object.assign(this.container.style, {
      backgroundImage:
        'radial-gradient(circle, var(--nx-grid-dot) 1.3px, transparent 1.3px)',
      backgroundSize: `${px}px ${px}px`,
      backgroundPosition: `${((this.pan.x % px) + px) % px}px ${((this.pan.y % px) + px) % px}px`,
    })
  }

  TreeView.prototype._applyTransform = function () {
    this.world.style.transform = `translate(${this.pan.x}px,${this.pan.y}px) scale(${this.scale})`
    this._applyGrid()
  }

  TreeView.prototype._storageKey = function () {
    return 'nx-view:' + window.location.pathname
  }
  TreeView.prototype._saveView = function () {
    try { localStorage.setItem(this._storageKey(), JSON.stringify({ scale: this.scale, pan: this.pan })) } catch (_) {}
  }
  TreeView.prototype._loadView = function () {
    try { return JSON.parse(localStorage.getItem(this._storageKey())) } catch (_) { return null }
  }

  TreeView.prototype._bindPanZoom = function () {
    const self = this
    const c = this.container

    function isMouseWheel(e) {
      if (e.deltaMode !== 0) return true
      return e.deltaX === 0 && Math.abs(e.deltaY) >= 100 && Number.isInteger(e.deltaY)
    }
    c.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault()
        if (e.ctrlKey || isMouseWheel(e)) {
          const rect = c.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top
          const f = e.deltaY < 0 ? 1.1 : 0.91
          const cur = self.scale
          const next = Math.max(0.25, Math.min(2.5, cur * f))
          const ratio = next / cur
          self.scale = next
          self.pan = { x: mx - ratio * (mx - self.pan.x), y: my - ratio * (my - self.pan.y) }
          self.render()
          self._saveView()
        } else {
          self.pan = { x: self.pan.x - e.deltaX, y: self.pan.y - e.deltaY }
          self._applyTransform()
          self._saveView()
        }
      },
      { passive: false }
    )

    c.addEventListener('pointerdown', function (e) {
      const t = e.target
      if (t.closest('[data-node]')) return
      self.dragging = true
      c.style.cursor = 'grabbing'
      self._drag = { mx: e.clientX, my: e.clientY, px: self.pan.x, py: self.pan.y }
      c.setPointerCapture(e.pointerId)
    })
    c.addEventListener('pointermove', function (e) {
      if (!self.dragging || !self._drag) return
      self.pan = {
        x: self._drag.px + (e.clientX - self._drag.mx),
        y: self._drag.py + (e.clientY - self._drag.my),
      }
      self._applyTransform()
    })
    function endDrag() {
      self.dragging = false
      self._drag = null
      c.style.cursor = 'grab'
      self._saveView()
    }
    c.addEventListener('pointerup', endDrag)
    c.addEventListener('pointercancel', endDrag)
  }

  // ── Derived geometry ──────────────────────────────────────────────────────
  TreeView.prototype._derive = function () {
    const pairs = NX.buildPairs(this.state.nodes || [])
    const viewMode = this.state.viewMode || 'tree'
    const vSpacing = viewMode === 'full' ? C.V_SPACING_FULL : C.V_SPACING
    const positions = NX.computePairLayout(pairs, vSpacing)
    const active = NX.getActivePairIds(pairs, this.state.selectedNodeId)
    return { pairs, positions, active, viewMode, vSpacing }
  }

  // ── Fit the whole tree into view ──────────────────────────────────────────
  TreeView.prototype.fitView = function () {
    const { positions, viewMode } = this._derive()
    if (positions.size === 0) return
    const cw = this.container.clientWidth
    const ch = this.container.clientHeight
    if (!cw || !ch) return
    const nodeHMax = (viewMode === 'full' ? C.NODE_H_FULL : C.NODE_H).detailed
    const ps = Array.from(positions.values())
    const hPad = 40
    const bx0 = Math.min(...ps.map((p) => p.x))
    const bx1 = Math.max(...ps.map((p) => p.x)) + C.LAYOUT_W
    const by0 = Math.min(...ps.map((p) => p.y))
    const by1 = Math.max(...ps.map((p) => p.y)) + nodeHMax
    const bw = bx1 - bx0 + hPad * 2
    const bh = by1 - by0
    const sByW = cw / bw
    const sByH = (ch - 28) / (bh + 32)
    const s = Math.max(C.MIN_READABLE_SCALE, Math.min(sByW, sByH, 1.15))
    this.scale = s
    this.pan = { x: (cw - (bx1 - bx0) * s) / 2 - bx0 * s, y: 24 - by0 * s }
    this.render()
  }

  // ── Build one node card's inner content per zoom mode ──────────────────────
  function nodeInner(pair, zoomMode, viewMode) {
    const title = pair.aiNode
      ? NX.generateTitle(pair.userNode.content)
      : NX.generateTitle(pair.userNode.content)
    const summary = pair.aiNode ? NX.generateSummary(pair.aiNode.content) : ''
    const userFull = (pair.userNode.content || '').trim()
    const aiFull = pair.aiNode ? NX.stripMarkdownPlain(pair.aiNode.content) : ''

    if (viewMode === 'full') {
      const wrap = el('div', {
        padding: zoomMode === 'detailed' ? '10px 11px' : '8px 9px',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      })
      const clampU = zoomMode === 'mini' ? 1 : zoomMode === 'compact' ? 3 : 5
      const clampA = zoomMode === 'mini' ? 1 : zoomMode === 'compact' ? 3 : 6
      wrap.appendChild(
        el('div', {
          flex: '1 1 0',
          minHeight: '0',
          fontSize: '11.5px',
          fontWeight: '600',
          color: 'var(--nx-text-primary)',
          lineHeight: '1.4',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: String(clampU),
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }, { text: userFull || '(empty)' })
      )
      if (aiFull) {
        wrap.appendChild(el('div', { borderTop: '1px dashed var(--nx-border)', flexShrink: '0' }))
        wrap.appendChild(
          el('div', {
            flex: '1 1 0',
            minHeight: '0',
            fontSize: '10.5px',
            color: 'var(--nx-text-secondary)',
            lineHeight: '1.45',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: String(clampA),
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }, { text: aiFull })
        )
      }
      return wrap
    }

    // tree (summary) view
    if (zoomMode === 'detailed') {
      const wrap = el('div', {
        padding: '9px 10px 8px 10px',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
      })
      wrap.appendChild(
        el('div', {
          fontSize: '11.5px',
          fontWeight: '600',
          color: 'var(--nx-text-primary)',
          lineHeight: '1.3',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }, { text: title })
      )
      if (summary) {
        wrap.appendChild(
          el('div', {
            fontSize: '10.5px',
            color: 'var(--nx-text-secondary)',
            lineHeight: '1.4',
            overflow: 'hidden',
            maxHeight: '32px',
          }, { text: summary })
        )
      }
      return wrap
    }
    if (zoomMode === 'compact') {
      const wrap = el('div', {
        padding: '7px 9px',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '2px',
      })
      wrap.appendChild(
        el('div', {
          fontSize: '10.5px',
          fontWeight: '600',
          color: 'var(--nx-text-primary)',
          lineHeight: '1.3',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }, { text: title })
      )
      if (summary) {
        wrap.appendChild(
          el('div', {
            fontSize: '9.5px',
            color: 'var(--nx-text-muted)',
            lineHeight: '1.3',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }, { text: summary })
        )
      }
      return wrap
    }
    // mini
    const wrap = el('div', {
      padding: '0 8px',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
    })
    wrap.appendChild(
      el('div', {
        fontSize: '9.5px',
        fontWeight: '600',
        color: 'var(--nx-text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: '1',
      }, { text: title })
    )
    return wrap
  }

  // ── Full render ───────────────────────────────────────────────────────────
  TreeView.prototype.render = function () {
    const self = this
    const { pairs, positions, active, viewMode } = this._derive()
    const zoomMode = NX.getZoomMode(this.scale)
    const nodeW = C.NODE_W[zoomMode]
    const nodeH = (viewMode === 'full' ? C.NODE_H_FULL : C.NODE_H)[zoomMode]
    const nodeHMax = (viewMode === 'full' ? C.NODE_H_FULL : C.NODE_H).detailed
    const colors = this.state.colors || {}

    // Canvas size
    let canvasW = 400
    let canvasH = 400
    if (positions.size > 0) {
      const xs = Array.from(positions.values()).map((p) => p.x)
      const ys = Array.from(positions.values()).map((p) => p.y)
      canvasW = Math.max(...xs) + C.LAYOUT_W + 80
      canvasH = Math.max(...ys) + nodeHMax + 80
    }

    this.world.innerHTML = ''
    Object.assign(this.world.style, { width: canvasW + 'px', height: canvasH + 'px', userSelect: 'none' })

    // Edges
    const svg = svgEl('svg', { width: canvasW, height: canvasH })
    Object.assign(svg.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'visible' })
    for (const pair of pairs) {
      if (!pair.parentPairId) continue
      const p0 = positions.get(pair.parentPairId)
      const p1 = positions.get(pair.id)
      if (!p0 || !p1) continue
      const isActivePath = active.has(pair.id) && active.has(pair.parentPairId)
      const cx = C.LAYOUT_W / 2
      const x1 = p0.x + cx
      const y1 = p0.y + nodeH
      const x2 = p1.x + cx
      const y2 = p1.y
      const stroke = isActivePath ? 'var(--nx-accent)' : 'var(--nx-edge-color)'
      const sw = isActivePath ? 2 : 1.5
      const dash = isActivePath ? null : '4 3'
      let path
      if (Math.abs(x1 - x2) < 2) {
        path = svgEl('line', { x1, y1, x2, y2 })
      } else {
        const cy = y1 + (y2 - y1) * 0.5
        path = svgEl('path', { d: `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`, fill: 'none' })
      }
      path.setAttribute('stroke', stroke)
      path.setAttribute('stroke-width', sw)
      path.setAttribute('stroke-linecap', 'round')
      if (dash) path.setAttribute('stroke-dasharray', dash)
      svg.appendChild(path)
    }
    this.world.appendChild(svg)

    // Nodes
    for (const pair of pairs) {
      const pos = positions.get(pair.id)
      if (!pos) continue
      const isActive =
        pair.id === this.state.selectedNodeId ||
        pair.userNode.id === this.state.selectedNodeId ||
        (pair.aiNode && pair.aiNode.id === this.state.selectedNodeId)
      const isOnPath = active.has(pair.id)
      const isInactive = active.size > 0 && !isOnPath
      const color =
        colors[pair.id] || colors[pair.userNode.id] || (pair.aiNode ? colors[pair.aiNode.id] : '') || ''

      const borderCol = color || (isActive ? 'var(--nx-accent)' : 'var(--nx-node-border)')
      const bgCol = color ? color + '14' : isActive ? 'var(--nx-node-active-bg)' : 'var(--nx-node-bg)'
      const offsetX = pos.x + (C.LAYOUT_W - nodeW) / 2

      const outer = el('div', {
        position: 'absolute',
        left: offsetX + 'px',
        top: pos.y + 'px',
        opacity: isInactive ? '0.72' : '1',
        transition: 'opacity 0.2s',
      })
      outer.setAttribute('data-node', 'true')

      const card = el('div', {
        width: nodeW + 'px',
        height: nodeH + 'px',
        background: bgCol,
        border: `1.5px solid ${borderCol}`,
        borderRadius: '10px',
        cursor: 'pointer',
        overflow: 'hidden',
        position: 'relative',
        boxShadow: isActive ? `0 0 0 3px ${color ? color + '30' : 'var(--nx-accent-bg)'}` : 'none',
        transition: 'border-color 0.12s, box-shadow 0.12s',
      })
      card.setAttribute('data-node', 'true')
      card.appendChild(nodeInner(pair, zoomMode, viewMode))

      // hover affordance
      card.addEventListener('mouseenter', function () {
        if (!isActive) {
          card.style.borderColor = color || 'var(--nx-border-strong)'
          card.style.boxShadow = 'var(--nx-shadow-sm)'
        }
        dotsBtn.style.opacity = '1'
      })
      card.addEventListener('mouseleave', function () {
        card.style.borderColor = borderCol
        if (!isActive) card.style.boxShadow = 'none'
        dotsBtn.style.opacity = '0'
      })
      card.addEventListener('click', function () {
        self.cb.onSelect && self.cb.onSelect(pair.aiNode ? pair.aiNode.id : pair.userNode.id, pair)
      })

      // color ⋯ button
      const dotsBtn = el('button', {
        position: 'absolute',
        top: '4px',
        right: '4px',
        background: 'var(--nx-modal-bg)',
        border: '1px solid var(--nx-border)',
        cursor: 'pointer',
        color: 'var(--nx-text-muted)',
        padding: '2px 3px',
        borderRadius: '5px',
        opacity: '0',
        transition: 'opacity 0.1s',
        lineHeight: '0',
      }, {
        title: 'Node color',
        html:
          '<svg width="10" height="10" viewBox="0 0 12 12" fill="none">' +
          '<circle cx="6" cy="2" r="1" fill="currentColor"/>' +
          '<circle cx="6" cy="6" r="1" fill="currentColor"/>' +
          '<circle cx="6" cy="10" r="1" fill="currentColor"/></svg>',
      })
      dotsBtn.setAttribute('data-node', 'true')
      dotsBtn.addEventListener('click', function (e) {
        e.stopPropagation()
        const r = dotsBtn.getBoundingClientRect()
        self.cb.onColorMenu && self.cb.onColorMenu(pair.id, r.left - 150, r.bottom + 6)
      })
      card.appendChild(dotsBtn)

      outer.appendChild(card)
      this.world.appendChild(outer)
    }

    this._applyTransform()

    if (!this._initialFitDone && positions.size > 0) {
      this._initialFitDone = true
      const saved = this._loadView()
      if (saved) {
        this.scale = saved.scale
        this.pan = saved.pan
        this._applyTransform()
      } else {
        setTimeout(function () { self.fitView() }, 60)
      }
    }
  }

  NX.TreeView = TreeView
})()
