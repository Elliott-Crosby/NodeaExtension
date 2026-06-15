// Nodea Tree for Claude — shared utilities, constants, and tree math.
// Ported verbatim from the live Nodea TreePanel so the extension's geometry and
// text generation match the app exactly. See src/app/app/TreePanel.tsx.
//
// All exports hang off the shared isolated-world namespace `window.NX`.
(function () {
  'use strict'
  const NX = (window.NX = window.NX || {})

  // ── Layout constants (verbatim from TreePanel) ────────────────────────────
  NX.C = {
    LAYOUT_W: 240,
    H_SPACING: 280,
    V_SPACING: 180,
    GRID_PX: 24,
    MIN_READABLE_SCALE: 0.65,
    NODE_W: { detailed: 240, compact: 190, mini: 150 },
    NODE_H: { detailed: 104, compact: 52, mini: 40 },
    NODE_H_FULL: { detailed: 220, compact: 140, mini: 90 },
    V_SPACING_FULL: 320,
  }

  // ── Colour palette (node colors menu) ─────────────────────────────────────
  NX.PALETTE = [
    { id: 'default', label: 'Default', hex: '' },
    { id: 'red', label: 'Red', hex: '#ef4444' },
    { id: 'orange', label: 'Orange', hex: '#f97316' },
    { id: 'yellow', label: 'Yellow', hex: '#eab308' },
    { id: 'green', label: 'Green', hex: '#22c55e' },
    { id: 'blue', label: 'Blue', hex: '#3b82f6' },
    { id: 'indigo', label: 'Indigo', hex: '#6366f1' },
    { id: 'violet', label: 'Violet', hex: '#8b5cf6' },
  ]

  // ── Title / summary generation (verbatim ports) ───────────────────────────
  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but',
    'this', 'that', 'what', 'how', 'why', 'can', 'you', 'me', 'i', 'my', 'do', 'be', 'are',
    'was', 'with', 'as', 'from', 'have', 'has', 'had', 'will', 'not', 'no', 'so', 'get',
    'if', 'then', 'please', 'just', 'let', 'know', 'tell', 'make', 'use', 'need',
  ])

  NX.generateTitle = function (userPrompt) {
    const clean = (userPrompt || '').replace(/[^\w\s]/g, ' ').toLowerCase()
    const words = clean.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    if (words.length >= 2) {
      return words.slice(0, 5).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
    const sentence = (userPrompt || '').split(/[.!?\n]/)[0].trim()
    if (sentence.length <= 50) return sentence || 'Untitled'
    return sentence.slice(0, 47) + '…'
  }

  NX.generateSummary = function (aiResponse) {
    const stripped = (aiResponse || '')
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s*[-*+>\d.]\s+/gm, '')
      .replace(/\n+/g, ' ')
      .trim()
    const firstSentence = (stripped.match(/^[^.!?]+[.!?]/) || [])[0]
    const out = (firstSentence || stripped).trim()
    return out.length > 120 ? out.slice(0, 117) + '…' : out
  }

  NX.stripMarkdownPlain = function (text) {
    return (text || '')
      .replace(/```[\s\S]*?```/g, '[code block]')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s*[-*+>]\s+/gm, '')
      .trim()
  }

  NX.getZoomMode = function (scale) {
    if (scale >= 0.85) return 'detailed'
    if (scale >= 0.55) return 'compact'
    return 'mini'
  }

  // ── Pair building (verbatim port of buildPairs) ───────────────────────────
  // nodes: [{ id, parent_id, role: 'user'|'assistant', content, created_at }]
  NX.buildPairs = function (dbNodes) {
    const nodeMap = new Map(dbNodes.map((n) => [n.id, n]))
    const pairs = []
    const pairedUserIds = new Set()
    const sorted = [...dbNodes].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))

    for (const node of sorted) {
      if (node.role !== 'assistant') continue
      const userParent = node.parent_id ? nodeMap.get(node.parent_id) : null
      if (!userParent || userParent.role !== 'user') continue
      pairedUserIds.add(userParent.id)

      let parentPairId = null
      const gp = userParent.parent_id ? nodeMap.get(userParent.parent_id) : null
      if (gp && gp.role === 'assistant') parentPairId = gp.id

      pairs.push({ id: node.id, userNode: userParent, aiNode: node, parentPairId })
    }

    for (const node of sorted) {
      if (node.role !== 'user' || pairedUserIds.has(node.id)) continue
      let parentPairId = null
      const parent = node.parent_id ? nodeMap.get(node.parent_id) : null
      if (parent && parent.role === 'assistant') parentPairId = parent.id
      pairs.push({ id: node.id, userNode: node, aiNode: null, parentPairId })
    }

    return pairs
  }

  // ── Layout (verbatim port of computePairLayout) ───────────────────────────
  NX.computePairLayout = function (pairs, vSpacing) {
    vSpacing = vSpacing || NX.C.V_SPACING
    const childrenMap = new Map()
    for (const pair of pairs) {
      const k = pair.parentPairId
      if (!childrenMap.has(k)) childrenMap.set(k, [])
      childrenMap.get(k).push(pair)
    }
    const positions = new Map()
    let leafIdx = 0

    function walk(id, depth) {
      const children = childrenMap.get(id) || []
      if (children.length === 0) {
        const x = leafIdx * NX.C.H_SPACING
        leafIdx++
        positions.set(id, { x, y: depth * vSpacing })
        return x
      }
      const xs = children.map((c) => walk(c.id, depth + 1))
      const x = (xs[0] + xs[xs.length - 1]) / 2
      positions.set(id, { x, y: depth * vSpacing })
      return x
    }

    for (const pair of childrenMap.get(null) || childrenMap.get(undefined) || []) walk(pair.id, 0)
    return positions
  }

  // ── Active path (verbatim port of getActivePairIds) ───────────────────────
  NX.getActivePairIds = function (pairs, selectedNodeId) {
    if (!selectedNodeId) return new Set()
    const selPair = pairs.find(
      (p) =>
        p.id === selectedNodeId ||
        p.userNode.id === selectedNodeId ||
        (p.aiNode && p.aiNode.id === selectedNodeId)
    )
    if (!selPair) return new Set()
    const pairMap = new Map(pairs.map((p) => [p.id, p]))
    const active = new Set()
    let cur = selPair
    while (cur) {
      active.add(cur.id)
      cur = cur.parentPairId ? pairMap.get(cur.parentPairId) : undefined
    }
    return active
  }

  // ── Small DOM helper ──────────────────────────────────────────────────────
  NX.el = function (tag, style, props) {
    const node = document.createElement(tag)
    if (style) Object.assign(node.style, style)
    if (props) {
      for (const k in props) {
        if (k === 'text') node.textContent = props[k]
        else if (k === 'html') node.innerHTML = props[k]
        else if (k.startsWith('on') && typeof props[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), props[k])
        } else if (k === 'title') node.title = props[k]
        else node.setAttribute(k, props[k])
      }
    }
    return node
  }

  NX.svgEl = function (tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k])
    return node
  }
})()
