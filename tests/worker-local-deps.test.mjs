import './helpers/hermetic-home.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { createAdapters } from '../ff-worker/src/adapters/index.mjs'
import { processTasks, launchAgentTask, discoverTasks } from '../ff-worker/src/core/worker.mjs'
import { readTask } from '../ff-worker/src/core/task-store.mjs'
import { main } from '../scripts/cli/main.mjs'
import { capture } from './helpers/io.mjs'

function workspace(t) {
  const c = baseConfig()
  c.worker.max_concurrent_tasks = 5
  c.worker.task_source = { adapter: 'local', local: { poll_lists: ['Doing', 'QA Fail'], done_list: 'Done', accept_list: 'Accepted' } }
  const w = makeWorkspace({ config: c })
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  return { ...w, config, ...createAdapters({ root: w.root, config }) }
}

function fakeTmux() {
  const started = []
  return { started, hasSession: (name) => started.some((x) => x.session === name), inspectPane: () => ({ status: 'idle' }), start: async (session, cwd, command, prompt, opts) => { if (started.some((x) => x.session === session)) return { existing: true }; started.push({ session, cwd, command, prompt, opts }); return { existing: false } } }
}

const cycle = (w, tmux, notified = []) => processTasks({
  root: w.root, config: w.config, source: w.source, channel: { name: 't', notify: async (e) => notified.push(e) },
  launchTask: (card, task, options) => launchAgentTask({ root: w.root, config: w.config, tmux, card, task, ...options }), log: () => {},
})

test('worker + local: poll → dossier kéo về → phiên tmux khởi chạy với prompt trỏ dossier', async (t) => {
  const w = workspace(t)
  await w.source.create({ title: 'Loi dang nhap', description: 'Người dùng báo không đăng nhập được', labels: ['bug'] })
  const tmux = fakeTmux(), notified = []
  const tasks = await cycle(w, tmux, notified)
  assert.equal(tasks.length, 1)
  const dossier = path.join(w.root, 'trellocards/1-loi-dang-nhap/01-dossier.md')
  const text = fs.readFileSync(dossier, 'utf8')
  assert.match(text, /## Tiêu đề\nLoi dang nhap/); assert.match(text, /Người dùng báo không đăng nhập được/)
  assert.deepEqual(tmux.started.map((s) => s.session), ['ff-1'])
  assert.match(tmux.started[0].prompt, /thẻ #1/); assert.match(tmux.started[0].prompt, /trellocards\/1-loi-dang-nhap\/01-dossier\.md/)
  assert.equal(readTask(w.root, '1').phase, 'running')
  assert.equal(readTask(w.root, '1').lastPull.at.slice(0, 2), '20')
  assert.match(notified[0].title, /Đã nhận thẻ: Loi dang nhap/)
  // vòng sau: không khởi chạy lại, không pull dossier thừa
  await cycle(w, tmux)
  assert.equal(tmux.started.length, 1)
})

test('worker + local: thẻ có phụ thuộc chưa xong không được bắt đầu; status hiện "chờ thẻ"; xong thì chạy', async (t) => {
  const w = workspace(t)
  await w.source.create({ title: 'nền' })
  await w.source.create({ title: 'sau nền', dependsOn: ['1'] })
  await w.source.create({ title: 'độc lập' })
  const tmux = fakeTmux()
  await cycle(w, tmux)
  assert.deepEqual(tmux.started.map((s) => s.session), ['ff-1', 'ff-3'])
  assert.equal(readTask(w.root, '2'), null)
  assert.equal(fs.existsSync(path.join(w.root, 'trellocards/2-sau-nen')), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.root, '.ff/waiting.json'), 'utf8')), { 2: ['1'] })
  const { ctx, buf } = capture(w.root)
  ctx.which = () => true; ctx.spawn = () => ({ status: 1, stdout: '', stderr: '' })
  await main(['worker', 'status'], ctx)
  assert.match(buf.out, /thẻ #2: chờ thẻ #1/)
  // phụ thuộc ở Todo (không phải done) vẫn chờ; sang Done thì chạy
  await cycle(w, tmux)
  assert.equal(tmux.started.length, 2)
  await w.source.moveCard('1', 'Done')
  await cycle(w, tmux)
  assert.deepEqual(tmux.started.map((s) => s.session), ['ff-1', 'ff-3', 'ff-2'])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.root, '.ff/waiting.json'), 'utf8')), {})
  assert.match(fs.readFileSync(path.join(w.root, 'trellocards/2-sau-nen/01-dossier.md'), 'utf8'), /Phụ thuộc: #1/)
})

test('worker + local: thẻ đã chạy không bị chặn lại khi thêm phụ thuộc về sau', async (t) => {
  const w = workspace(t)
  await w.source.create({ title: 'a' })
  const tmux = fakeTmux()
  await cycle(w, tmux)
  const file = path.join(w.root, 'ff-cards/1.md')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('depends_on: []', 'depends_on: [9]'))
  const tasks = await cycle(w, tmux)
  assert.equal(tasks.length, 1)
  assert.equal(readTask(w.root, '1').phase, 'running')
  assert.equal(fs.existsSync(path.join(w.root, '.ff/waiting.json')), false)
})

test('driver discovery + local: bỏ qua thẻ chờ phụ thuộc, vẫn khám phá thẻ khác', async (t) => {
  const w = workspace(t)
  await w.source.create({ title: 'nền' })
  await w.source.create({ title: 'sau', dependsOn: ['1'] })
  const found = await discoverTasks({ root: w.root, config: w.config, source: w.source })
  assert.deepEqual(found.map((o) => o.cardId), ['1'])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.root, '.ff/waiting.json'), 'utf8')), { 2: ['1'] })
})
