// Offline test harness for the Nodea Tree host adapters.
//
// The adapters are browser IIFEs that hang off window.NX. We load them into a
// node:vm sandbox with just enough mocked globals (window, location, document,
// fetch) to exercise the pure normalization logic — the part most likely to
// break — without a real browser. Run: `node extension/test/adapters.test.mjs`.
//
// What this proves: given a representative raw payload from each host, the
// adapter emits the correct flat node list ({id,parent_id,role,content}) AND
// the shared buildPairs() turns it into the right branch structure. It does NOT
// prove the live site still serves that exact shape — see STORE-SUBMISSION.md
// for the live-recon checklist.
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.resolve(__dirname, '..')

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (detail ? '  → ' + detail : ''))
  }
}
function eq(name, got, want) {
  check(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want))
}

// Build a fresh sandbox sharing one window.NX across the files loaded into it.
function makeContext({ pathname = '/', fetchFn, documentObj } = {}) {
  const ctx = {}
  ctx.window = ctx
  ctx.location = { pathname, href: 'https://example.com' + pathname }
  ctx.document = documentObj || { querySelector: () => null, querySelectorAll: () => [] }
  ctx.fetch = fetchFn || (async () => ({ ok: false, status: 0, json: async () => ({}) }))
  ctx.console = console
  ctx.setTimeout = setTimeout
  ctx.chrome = { runtime: {}, storage: { local: { get() {}, set() {} } } }
  vm.createContext(ctx)
  return ctx
}
function load(ctx, rel) {
  const file = path.join(EXT, rel)
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file })
}

// ───────────────────────────── ChatGPT ─────────────────────────────────────
// A conversation that branches at a1 (user edited their 2nd prompt), plus a
// system root, a tool message, and a hidden assistant message — all of which
// must be dropped while keeping the alternating user/assistant tree intact.
const CHATGPT_FIXTURE = {
  conversation_id: 'conv-123',
  title: 'My chat',
  current_node: 'a2b',
  mapping: {
    root: { id: 'root', message: null, parent: null, children: ['sys'] },
    sys: {
      id: 'sys',
      message: { id: 'sys', author: { role: 'system' }, content: { content_type: 'text', parts: [''] }, create_time: 1 },
      parent: 'root',
      children: ['u1'],
    },
    u1: {
      id: 'u1',
      message: { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['Hello'] }, create_time: 10 },
      parent: 'sys',
      children: ['a1'],
    },
    a1: {
      id: 'a1',
      message: { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Hi there'] }, create_time: 20 },
      parent: 'u1',
      children: ['u2', 'u2b'],
    },
    u2: {
      id: 'u2',
      message: { id: 'u2', author: { role: 'user' }, content: { content_type: 'text', parts: ['Tell me a joke'] }, create_time: 30 },
      parent: 'a1',
      children: ['tool1'],
    },
    tool1: {
      id: 'tool1',
      message: { id: 'tool1', author: { role: 'tool' }, content: { content_type: 'text', parts: ['(searching the web)'] }, create_time: 31 },
      parent: 'u2',
      children: ['a2'],
    },
    a2: {
      id: 'a2',
      message: { id: 'a2', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Why did the chicken cross the road?'] }, create_time: 40 },
      parent: 'tool1',
      children: ['hidden'],
    },
    hidden: {
      id: 'hidden',
      message: { id: 'hidden', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['internal'] }, metadata: { is_visually_hidden_from_conversation: true }, create_time: 41 },
      parent: 'a2',
      children: [],
    },
    u2b: {
      id: 'u2b',
      message: { id: 'u2b', author: { role: 'user' }, content: { content_type: 'text', parts: ['Tell me a fact'] }, create_time: 35 },
      parent: 'a1',
      children: ['a2b'],
    },
    a2b: {
      id: 'a2b',
      message: { id: 'a2b', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Honey never spoils.'] }, create_time: 45 },
      parent: 'u2b',
      children: [],
    },
  },
}

function testChatGPT() {
  console.log('\nChatGPT adapter')
  let capturedAuth = null
  let capturedConvUrl = null
  const fetchFn = async (url, opts) => {
    if (url.includes('/api/auth/session')) {
      return { ok: true, status: 200, json: async () => ({ accessToken: 'tok-xyz' }) }
    }
    if (url.includes('/backend-api/conversation/')) {
      capturedAuth = opts && opts.headers && opts.headers.Authorization
      capturedConvUrl = url
      return { ok: true, status: 200, json: async () => CHATGPT_FIXTURE }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  const ctx = makeContext({ pathname: '/c/12345678-1234-4123-8123-123456789012', fetchFn })
  load(ctx, 'src/util.js')
  load(ctx, 'src/adapters/chatgpt.js')
  const NX = ctx.window.NX
  const adapter = NX.adapter

  eq('host id', adapter.host, 'chatgpt')
  eq('source tag', adapter.source, 'chatgpt')
  eq('display name', adapter.displayName, 'ChatGPT')
  eq('conversationIdFromUrl', adapter.conversationIdFromUrl(), '12345678-1234-4123-8123-123456789012')

  // ── normalize ──
  const tree = adapter._normalize(CHATGPT_FIXTURE)
  eq('conv id', tree.id, 'conv-123')
  eq('conv name', tree.name, 'My chat')
  eq('kept node count (system/tool/hidden/root dropped)', tree.nodes.length, 6)
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]))
  check('system root dropped', !byId.sys && !byId.root)
  check('tool message dropped', !byId.tool1)
  check('hidden assistant dropped', !byId.hidden)
  eq('first user re-parented to root (null)', byId.u1.parent_id, null)
  eq('assistant a1 parents to user u1', byId.a1.parent_id, 'u1')
  eq('a2 re-links across dropped tool node to u2', byId.a2.parent_id, 'u2')
  eq('branch sibling u2b parents to a1', byId.u2b.parent_id, 'a1')
  eq('content extracted from parts', byId.a2b.content, 'Honey never spoils.')
  eq('role mapped', byId.u1.role, 'user')
  eq('created_at from create_time', byId.u1.created_at, new Date(10 * 1000).toISOString())
  eq('currentLeaf', tree.currentLeaf, 'a2b')

  // ── buildPairs: the branch must survive into the renderer's pair graph ──
  const pairs = NX.buildPairs(tree.nodes)
  eq('pair count', pairs.length, 3)
  const pById = Object.fromEntries(pairs.map((p) => [p.id, p]))
  eq('root pair a1 has no parent', pById.a1.parentPairId, null)
  eq('pair a2 branches off a1', pById.a2.parentPairId, 'a1')
  eq('pair a2b branches off a1 (sibling of a2)', pById.a2b.parentPairId, 'a1')

  // ── fetchTree plumbing: token → authorized conversation GET ──
  return adapter.fetchTree().then((t) => {
    eq('fetchTree node count', t.nodes.length, 6)
    eq('used bearer token from session', capturedAuth, 'Bearer tok-xyz')
    check('hit backend conversation endpoint with url id', capturedConvUrl.includes('/backend-api/conversation/12345678-1234-4123-8123-123456789012'), capturedConvUrl)
  })
}

// ───────────────────────────── Gemini ──────────────────────────────────────
// Gemini has no API — build a stub DOM shaped like its real one: a list of
// <conversation-container>, each resolving a user-query and a model-response.
function fakeContainer(userText, modelText) {
  const map = {
    'user-query .query-text': userText != null ? { textContent: userText } : null,
    'model-response message-content .markdown': modelText != null ? { textContent: modelText } : null,
  }
  return { querySelector: (sel) => map[sel] || null }
}
function fakeDoc(containers) {
  return {
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === 'conversation-container' ? containers : []),
  }
}

function testGemini() {
  console.log('\nGemini adapter')
  const containers = [
    fakeContainer('What is 2+2?', '4'),
    fakeContainer('Explain why', 'Two plus two equals four because counting.'),
  ]
  const ctx = makeContext({ pathname: '/u/0/app/c_abc123', documentObj: fakeDoc(containers) })
  load(ctx, 'src/util.js')
  load(ctx, 'src/adapters/gemini.js')
  const NX = ctx.window.NX
  const adapter = NX.adapter

  eq('host id', adapter.host, 'gemini')
  eq('source tag', adapter.source, 'gemini')
  eq('display name', adapter.displayName, 'Gemini')
  eq('conversationIdFromUrl (handles /u/0/app/)', adapter.conversationIdFromUrl(), 'c_abc123')

  const tree = adapter._parse(ctx.document, 'c_abc123')
  eq('node count (2 turns → 4 nodes)', tree.nodes.length, 4)
  const ids = tree.nodes.map((n) => n.id)
  eq('deterministic user id', ids[0], 'gem-c_abc123-0-u')
  eq('deterministic assistant id', ids[1], 'gem-c_abc123-0-a')
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]))
  eq('first user is root', byId['gem-c_abc123-0-u'].parent_id, null)
  eq('first answer parents to first prompt', byId['gem-c_abc123-0-a'].parent_id, 'gem-c_abc123-0-u')
  eq('second prompt chains off first answer', byId['gem-c_abc123-1-u'].parent_id, 'gem-c_abc123-0-a')
  eq('content captured', byId['gem-c_abc123-0-a'].content, '4')
  eq('currentLeaf is last answer', tree.currentLeaf, 'gem-c_abc123-1-a')
  check('deterministic timestamps (stable across reads)', adapter._parse(ctx.document, 'c_abc123').nodes[0].created_at === byId['gem-c_abc123-0-u'].created_at)

  const pairs = NX.buildPairs(tree.nodes)
  eq('pair count', pairs.length, 2)
  const pairById = Object.fromEntries(pairs.map((p) => [p.id, p]))
  eq('second pair chains off first', pairById['gem-c_abc123-1-a'].parentPairId, 'gem-c_abc123-0-a')

  // Fallback path: a streaming answer (model text not yet present) keeps the
  // prompt as the active leaf rather than dropping the turn.
  const streaming = adapter._parse(fakeDoc([fakeContainer('Mid-stream prompt', null)]), 'c_xyz')
  eq('streaming turn keeps the user prompt', streaming.nodes.length, 1)
  eq('streaming leaf is the prompt', streaming.currentLeaf, 'gem-c_xyz-0-u')
}

// ───────────────────────────── manifest ────────────────────────────────────
function testManifest() {
  console.log('\nmanifest.json')
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))
  eq('manifest version', manifest.manifest_version, 3)
  check('name is model-neutral (not "for Claude")', !/for Claude\b/i.test(manifest.name) || /ChatGPT/i.test(manifest.name), manifest.name)
  check('name mentions all three hosts', /Claude/.test(manifest.name) && /ChatGPT/.test(manifest.name) && /Gemini/.test(manifest.name), manifest.name)
  check('version bumped past 0.2.x', manifest.version >= '0.3.0', manifest.version)
  for (const host of ['https://claude.ai/*', 'https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://gemini.google.com/*']) {
    check('host_permission ' + host, manifest.host_permissions.includes(host))
  }
  // Every referenced content-script file must exist on disk.
  let missing = []
  for (const cs of manifest.content_scripts) {
    for (const js of cs.js || []) if (!fs.existsSync(path.join(EXT, js))) missing.push(js)
    for (const css of cs.css || []) if (!fs.existsSync(path.join(EXT, css))) missing.push(css)
  }
  check('all content_script files exist', missing.length === 0, missing.join(', '))
  // Each AI host block must load exactly one adapter.
  const blocks = manifest.content_scripts.filter((cs) => (cs.js || []).some((j) => j.includes('adapters/')))
  eq('three adapter-bearing content_script blocks', blocks.length, 3)
}

const run = async () => {
  console.log('Nodea Tree — adapter test harness')
  await testChatGPT()
  testGemini()
  testManifest()
  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + `: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
run().catch((e) => {
  console.error('harness crashed:', e)
  process.exit(2)
})
