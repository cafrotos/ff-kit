import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { LocalTaskSource, resolveLocalDir } from '../ff-worker/src/adapters/task-source/local.mjs'
import { assertLifecycleSource } from '../ff-worker/src/adapters/types.mjs'
import { makeTaskSource, createAdapters } from '../ff-worker/src/adapters/index.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { validate } from '../scripts/lib/schema.mjs'
import { runDoctor } from '../scripts/lib/doctor.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

export const LOCAL = { poll_lists: ['Doing', 'QA Fail'], done_list: 'Done', accept_list: 'Accepted', park_list: 'Todo' }

function setup(t, local = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-local-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let tick = 0
  const source = new LocalTaskSource({ config: { ...LOCAL, ...local }, root, now: () => Date.UTC(2026, 9, 23, 0, 0, tick++) })
  return { root, source }
}

test('local: thỏa hợp đồng TaskSource + lifecycle', (t) => {
  const { source } = setup(t)
  assertLifecycleSource(source)
  assert.equal(makeTaskSource({ task_source: { adapter: 'local' } }, { local: source }), source)
  for (const m of ['listNames', 'moveCard', 'addComment', 'pullDossier']) assert.equal(typeof source[m], 'function')
})

test('local: create ghi <id>.md front-matter, id tăng đơn điệu, poll theo poll_lists', async (t) => {
  const { root, source } = setup(t)
  const a = await source.create({ title: 'Lỗi đăng nhập', description: 'Mô tả\nnhiều dòng', labels: ['bug'] })
  const b = await source.create({ title: 'Thêm tìm kiếm', list: 'qa fail' })
  await source.create({ title: 'ở done', list: 'Done' })
  assert.deepEqual([a.id, b.id], ['1', '2'])
  const text = fs.readFileSync(path.join(root, 'ff-cards/1.md'), 'utf8')
  assert.match(text, /^---\n[\s\S]*title: Lỗi đăng nhập[\s\S]*list: Doing[\s\S]*depends_on: \[\][\s\S]*---\n\nMô tả\nnhiều dòng\n$/)
  const polled = await source.poll()
  assert.deepEqual(polled.map((c) => [c.id, c.list, c.name]), [['1', 'Doing', 'Lỗi đăng nhập'], ['2', 'QA Fail', 'Thêm tìm kiếm']])
  assert.deepEqual(polled[0].labels, ['bug'])
  assert.equal(polled[0].pos, 1)
  // id không bao giờ tái dùng kể cả khi xóa file cuối
  fs.rmSync(path.join(root, 'ff-cards/3.md'))
  assert.equal((await source.create({ title: 'x' })).id, '4')
})

test('local: list lạ bị từ chối; không bao giờ tạo list', async (t) => {
  const { source } = setup(t)
  await assert.rejects(source.create({ title: 'x', list: 'Nope' }), /Không tìm thấy list 'Nope'/)
  await source.create({ title: 'ok' })
  await assert.rejects(source.moveCard('1', 'Nope'), /Không tìm thấy list/)
  await assert.rejects(source.moveCard('99', 'Done'), /Không tìm thấy thẻ #99/)
  assert.deepEqual(source.listNames(), ['Doing', 'QA Fail', 'Done', 'Accepted', 'Todo'])
})

test('local: moveCard/moveTo đổi list + updated; observeCard phản ánh', async (t) => {
  const { source } = setup(t)
  await source.create({ title: 'a' })
  await source.moveCard('1', 'done')
  assert.deepEqual(await source.poll(), [])
  const obs = await source.observeCard('1')
  assert.equal(obs.list, 'Done'); assert.equal(obs.assignedToMe, true); assert.equal(obs.closed, false)
  await source.moveTo('1', 'Doing')
  assert.equal((await source.observeCard('1')).list, 'Doing')
  assert.deepEqual(await source.observeCard('404'), { list: null, assignedToMe: false, closed: true, description: '', comments: [] })
})

test('local: comment, readComments(after), findComment', async (t) => {
  const { source } = setup(t)
  await source.create({ title: 'a' })
  const c1 = await source.addComment('1', 'một', { author: 'qa' })
  await source.comment('1', '[ff] evt-9 xong')
  const all = await source.readComments('1')
  assert.deepEqual(all.map((c) => [c.text, c.author]), [['một', 'qa'], ['[ff] evt-9 xong', 'ff']])
  assert.deepEqual((await source.readComments('1', { after: c1.at })).map((c) => c.text), ['[ff] evt-9 xong'])
  assert.equal((await source.findComment('1', 'evt-9')).text, '[ff] evt-9 xong')
  assert.equal(await source.findComment('1', 'evt-1'), null)
  assert.deepEqual(await source.readComments('1', {}).then((c) => c.length), 2)
})

test('local: pullDossier có đủ mục, marker, comment; dòng comment hỏng bị bỏ qua', async (t) => {
  const { root, source } = setup(t)
  await source.create({ title: 'Lỗi A', description: 'chi tiết', labels: ['bug', 'p1'] })
  await source.create({ title: 'B', dependsOn: ['1'] })
  await source.addComment('1', 'ghi chú\nhai dòng', { author: 'user' })
  fs.appendFileSync(path.join(root, 'ff-cards/1.comments.jsonl'), 'không phải json\n')
  const { text, marker } = await source.pullDossier({ id: '1' })
  assert.match(text, /^# Thẻ local 1\n/)
  for (const h of ['## Tiêu đề\nLỗi A', '## Mô tả (Description)\n\nchi tiết', 'feature/1-loi-a', '## Loại\nbug, p1', '## Checklist', '- user · 2026-10-23: ghi chú hai dòng']) assert.ok(text.includes(h), h)
  assert.match(marker.at, /^2026-10-23T/)
  assert.match((await source.fetchDossier({ id: '2' })), /Phụ thuộc: #1/)
  await assert.rejects(source.pullDossier({ id: '77' }), /Không tìm thấy thẻ local #77/)
})

test('local: depends_on -> waitingOn tới khi thẻ phụ thuộc ở done/accept', async (t) => {
  const { source } = setup(t)
  await source.create({ title: 'nền' })
  await source.create({ title: 'sau', dependsOn: ['1'] })
  await assert.rejects(source.create({ title: 'lạc', dependsOn: ['9'] }), /không có thẻ #9/)
  assert.deepEqual((await source.poll()).map((c) => [c.id, c.waitingOn]), [['1', []], ['2', ['1']]])
  await source.moveCard('1', 'Todo')
  assert.deepEqual((await source.poll()).find((c) => c.id === '2').waitingOn, ['1'])
  await source.moveCard('1', 'Accepted')
  assert.deepEqual((await source.poll())[0].waitingOn, [])
  await source.moveCard('1', 'Done')
  assert.deepEqual((await source.poll())[0].waitingOn, [])
})

test('local: file sửa tay vẫn đọc được (front-matter thiếu trường, depends_on kiểu #n)', async (t) => {
  const { root, source } = setup(t)
  fs.mkdirSync(path.join(root, 'ff-cards'))
  fs.writeFileSync(path.join(root, 'ff-cards/7.md'), '---\ntitle: tay\nlist: doing\ndepends_on: "#3"\n---\nmô tả tay\n')
  fs.writeFileSync(path.join(root, 'ff-cards/ghi-chu.md'), 'không phải thẻ')
  const [c] = await source.poll()
  assert.deepEqual([c.id, c.name, c.list, c.dependsOn, c.waitingOn], ['7', 'tay', 'Doing', ['3'], ['3']])
  assert.equal((await source.create({ title: 'sau' })).id, '8')
})

test('local: tạo đồng thời từ nhiều tiến trình cho id duy nhất, không file hỏng', async (t) => {
  const { root } = setup(t)
  const mod = path.resolve('ff-worker/src/adapters/task-source/local.mjs')
  const code = `import(${JSON.stringify(mod)}).then(async m=>{const s=new m.LocalTaskSource({config:${JSON.stringify(LOCAL)},root:${JSON.stringify(root)}});for(let i=0;i<8;i++)await s.create({title:'t'+i})})`
  await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', code], { stdio: 'inherit' })
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`exit ${c}`))))
  })))
  const ids = fs.readdirSync(path.join(root, 'ff-cards')).filter((n) => /^\d+\.md$/.test(n)).map((n) => parseInt(n))
  assert.equal(ids.length, 32)
  assert.equal(new Set(ids).size, 32)
  assert.equal(Math.max(...ids), 32)
  assert.deepEqual(fs.readdirSync(path.join(root, 'ff-cards')).filter((n) => n.startsWith('.tmp-') || n === '.lock'), [])
})

test('local: dir phải trong workspace, không .ff, không ..', () => {
  assert.throws(() => resolveLocalDir('/w', '../x'), /không có '\.\.'/)
  assert.throws(() => resolveLocalDir('/w', '/abs'), /tương đối/)
  assert.throws(() => resolveLocalDir('/w', '.ff/cards'), /\.ff/)
  assert.equal(resolveLocalDir('/w'), '/w/ff-cards')
  assert.equal(resolveLocalDir('/w', 'tickets/bugs'), '/w/tickets/bugs')
})

function localConfig(extra = {}, driver) {
  const c = baseConfig()
  c.worker.task_source = { adapter: 'local', local: { ...LOCAL, ...extra } }
  if (driver) c.worker.driver = { enabled: true }
  return c
}

test('schema: adapter local hợp lệ; thiếu khối local / khóa lạ / dir xấu bị bắt', () => {
  const ok = (c) => validate(loadCfg(c))
  assert.deepEqual(ok(localConfig()), [])
  const missing = localConfig(); delete missing.worker.task_source.local
  assert.ok(ok(missing).length)
  assert.ok(ok(localConfig({ board_id: 'x' })).length)
  assert.ok(ok(localConfig({ dir: '../out' })).some((e) => /local\/dir/.test(e)))
  assert.ok(ok(localConfig({ dir: '.ff/cards' })).some((e) => /local\/dir/.test(e)))
  assert.deepEqual(ok(localConfig({ dir: 'tickets', accept_list: 'A', reopen_list: 'R' }, true)), [])
  assert.ok(ok(localConfig({}, true)).some((e) => /driver/.test(e)))
})
function loadCfg(raw) { return JSON.parse(JSON.stringify(raw)) }

test('createAdapters dựng LocalTaskSource, không cần secret Trello', async (t) => {
  const w = makeWorkspace({ config: localConfig() })
  t.after(w.cleanup)
  const { source } = createAdapters({ root: w.root, config: loadConfig(w.root).config })
  assert.equal(source.name, 'local')
  await source.create({ title: 'x' })
  assert.equal((await source.poll()).length, 1)
})

test('doctor: local — thư mục chưa có OK, không cần .ff.env, lỗi dir / list bị báo', (t) => {
  const w = makeWorkspace({ config: localConfig() })
  t.after(w.cleanup)
  const run = () => runDoctor(w.root, loadConfig(w.root))
  let d = run()
  assert.equal(d.groups.worker, true, JSON.stringify(d.checks.filter((c) => !c.ok)))
  assert.ok(d.checks.some((c) => /Thẻ local: thư mục ff-cards chưa có/.test(c.msg)))
  fs.mkdirSync(path.join(w.root, 'ff-cards'))
  d = run()
  assert.ok(d.checks.some((c) => c.ok && /ff-cards đọc\/ghi được/.test(c.msg)))
  fs.chmodSync(path.join(w.root, 'ff-cards'), 0o500)
  try { if (process.getuid?.() !== 0) assert.equal(run().groups.worker, false) }
  finally { fs.chmodSync(path.join(w.root, 'ff-cards'), 0o700) }
})
