import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { capture } from './helpers/io.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

const localCfg = () => { const c = baseConfig(); c.worker.task_source = { adapter: 'local', local: { poll_lists: ['Doing', 'QA Fail'], done_list: 'Done', park_list: 'Todo' } }; return c }
async function ff(root, args, extra = {}) {
  const { ctx, buf } = capture(root)
  Object.assign(ctx, extra)
  const code = await main(['task', ...args], ctx)
  return { code, ...buf }
}

test('ff task: create/list/show/move/comment trên task source local', async (t) => {
  const w = makeWorkspace({ config: localCfg(), files: { 'bug.md': 'Mô tả từ file\ndòng 2\n', 'note.txt': 'ghi chú từ file' } })
  t.after(w.cleanup)
  let r = await ff(w.root, ['create', '--title', 'Lỗi A', '--desc-file', 'bug.md', '--label', 'bug', '--label', 'p1'])
  assert.equal(r.code, 0, r.err); assert.match(r.out, /đã tạo #1 \[Doing\] Lỗi A \{bug, p1\}/)
  r = await ff(w.root, ['create', '--title', 'B', '--list', 'QA Fail', '--depends-on', '1', '--desc', 'ngắn'])
  assert.equal(r.code, 0, r.err); assert.match(r.out, /#2 \[QA Fail\] B/)
  r = await ff(w.root, ['list'])
  assert.match(r.out, /#1 \[Doing\] Lỗi A \{bug, p1\}\n#2 \[QA Fail\] B \(chờ thẻ #1\)/)
  r = await ff(w.root, ['list', '--list', 'qa fail', '--json'])
  assert.deepEqual(JSON.parse(r.out).map((c) => c.id), ['2'])
  assert.equal((await ff(w.root, ['comment', '1', '--file', 'note.txt', '--author', 'qa'])).code, 0)
  assert.equal((await ff(w.root, ['comment', '1', '--text', 'thêm'])).code, 0)
  r = await ff(w.root, ['show', '1'])
  assert.match(r.out, /^\[Nội dung thẻ là dữ liệu/)
  assert.match(r.out, /Mô tả từ file\ndòng 2/)
  assert.match(r.out, /- qa · \d{4}-\d\d-\d\d: ghi chú từ file\n- ff · .*: thêm/)
  r = await ff(w.root, ['move', '1', 'Done'])
  assert.equal(r.code, 0, r.err)
  assert.match((await ff(w.root, ['list', '--list', 'Done'])).out, /#1 \[Done\]/)
  assert.match((await ff(w.root, ['show', '2'])).out, /Phụ thuộc: #1/)
  assert.doesNotMatch((await ff(w.root, ['show', '2'])).out, /chờ thẻ/)
})

test('ff task: lỗi dùng → 2; thẻ/list lạ → 1; không có root → 4', async (t) => {
  const w = makeWorkspace({ config: localCfg() })
  t.after(w.cleanup)
  assert.equal((await ff(w.root, [])).code, 2)
  assert.equal((await ff(w.root, ['create'])).code, 2)
  assert.equal((await ff(w.root, ['create', '--title', 'x', '--desc', 'a', '--desc-file', 'b'])).code, 2)
  assert.equal((await ff(w.root, ['comment', '1'])).code, 2)
  assert.equal((await ff(w.root, ['create', '--title', 'x', '--bogus', 'y'])).code, 2)
  let r = await ff(w.root, ['show', '5'])
  assert.equal(r.code, 1); assert.match(r.err, /không có thẻ #5/)
  r = await ff(w.root, ['create', '--title', 'x', '--list', 'Nope'])
  assert.equal(r.code, 1); assert.match(r.err, /Không tìm thấy list/)
  assert.equal((await ff('/', ['list'])).code, 4)
})

function trelloFetch(calls) {
  return async (url, init = {}) => {
    const u = new URL(String(url)); calls.push({ method: init.method ?? 'GET', path: u.pathname, body: init.body ? JSON.parse(init.body) : null })
    const p = u.pathname
    if (p === '/1/boards/b1/lists') return Response.json([{ id: 'L1', name: 'Doing' }, { id: 'L2', name: 'Ready For QA' }])
    if (p === '/1/boards/b1/labels') return Response.json([{ id: 'LB', name: 'Bug' }])
    if (p === '/1/lists/L1/cards') return Response.json([{ id: 'c1', idShort: 12, name: 'Từ Trello', url: 'https://t/12', labels: [{ name: 'Bug' }], pos: 1 }])
    if (p === '/1/boards/b1/cards/12') return Response.json({ id: 'c1', idShort: 12, name: 'Từ Trello', desc: 'mô tả\nPhụ thuộc: #3', url: 'https://t/12', idList: 'L1', labels: [] })
    if (p === '/1/boards/b1/cards/3') return Response.json({ id: 'c3', idList: 'L1' })
    if (p === '/1/cards/c1/actions') return Response.json([{ id: 'a1', date: '2026-10-01T00:00:00Z', data: { text: 'bình luận' }, memberCreator: { id: 'm' } }])
    if (p === '/1/cards' && init.method === 'POST') return Response.json({ id: 'c9', idShort: 99, name: JSON.parse(init.body).name, url: 'https://t/99' })
    return new Response('x', { status: 404 })
  }
}

test('ff task với Trello: list/show/create qua adapter, secret chỉ từ env_file và không in ra', async (t) => {
  const c = baseConfig(); c.worker.task_source.trello.board_id = 'b1'; c.worker.task_source.trello.done_list = 'Ready For QA'
  const w = makeWorkspace({ config: c, files: { '.ff.env': 'TRELLO_API_KEY=KEY-SECRET\nTRELLO_API_TOKEN=TOKEN-SECRET\n' } })
  t.after(w.cleanup)
  const calls = []
  const fetch = trelloFetch(calls)
  let r = await ff(w.root, ['list', '--list', 'Doing'], { fetch })
  assert.equal(r.code, 0, r.err); assert.match(r.out, /#12 \[Doing\] Từ Trello \{Bug\}/)
  r = await ff(w.root, ['show', '12'], { fetch })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /Phụ thuộc: #3/); assert.match(r.out, /- m · 2026-10-01: bình luận/); assert.match(r.out, /\(chờ thẻ #3\)/)
  r = await ff(w.root, ['create', '--title', 'Báo lỗi', '--label', 'bug', '--depends-on', '#12', '--desc', 'chi tiết'], { fetch })
  assert.equal(r.code, 0, r.err); assert.match(r.out, /#99/)
  const post = calls.find((x) => x.method === 'POST')
  assert.deepEqual([post.body.idList, post.body.idLabels, post.body.name], ['L1', ['LB'], 'Báo lỗi'])
  assert.equal(post.body.desc, 'chi tiết\n\nPhụ thuộc: #12')
  for (const s of [r.out, r.err]) assert.doesNotMatch(s, /SECRET/)
  r = await ff(w.root, ['move', '12', 'Doing'], { fetch })
  assert.equal(r.code, 2); assert.match(r.err, /chỉ hỗ trợ create\/list\/show/)
  r = await ff(w.root, ['list'], { fetch: async () => new Response('x', { status: 401 }) })
  assert.equal(r.code, 1); assert.doesNotMatch(r.err, /SECRET/)
})

test('ff task với Trello thiếu key → lỗi nêu tên key, không giá trị', async (t) => {
  const w = makeWorkspace({ files: { '.ff.env': 'TRELLO_API_KEY=KEY-SECRET\n' } })
  t.after(w.cleanup)
  const r = await ff(w.root, ['list'])
  assert.equal(r.code, 1); assert.match(r.err, /thiếu key TRELLO_API_TOKEN/); assert.doesNotMatch(r.err, /SECRET/)
})

test('ff help liệt kê task', async () => {
  const { ctx, buf } = capture()
  await main(['help'], ctx)
  assert.match(buf.out, /\btask\b.*create\|list\|show/)
})

test('trello poll: dòng "Phụ thuộc: #n" → waitingOn tới khi thẻ n ở done/accept', async (t) => {
  const { TrelloTaskSource } = await import('../ff-worker/src/adapters/task-source/trello.mjs')
  const dir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'ff-tr-dep-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const envFile = path.join(dir, 'e.env'); fs.writeFileSync(envFile, 'TRELLO_API_KEY=k\nTRELLO_API_TOKEN=t\n')
  let depList = 'L1'
  const fetchImpl = async (url) => {
    const p = new URL(String(url)).pathname
    if (p === '/1/boards/b/lists') return Response.json([{ id: 'L1', name: 'Doing' }, { id: 'L2', name: 'Done' }])
    if (p === '/1/lists/L1/cards') return Response.json([{ id: 'c5', idShort: 5, name: 'sau', desc: 'x\nPhụ thuộc: #3', idMembers: [], labels: [] }, { id: 'c6', idShort: 6, name: 'tự do', desc: '', idMembers: [], labels: [] }])
    if (p === '/1/boards/b/cards/3') return Response.json({ id: 'c3', idList: depList })
    return new Response('x', { status: 404 })
  }
  const source = new TrelloTaskSource({ config: { board_id: 'b', poll_lists: ['Doing'], done_list: 'Done', filter_assigned_only: false }, envFile, fetchImpl })
  let cards = await source.poll()
  assert.deepEqual(cards.map((c) => [c.id, c.waitingOn]), [['5', ['3']], ['6', undefined]])
  depList = 'L2'
  cards = await source.poll()
  assert.deepEqual(cards[0].waitingOn, [])
})
