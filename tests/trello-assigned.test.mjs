import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TrelloTaskSource } from '../ff-worker/src/adapters/task-source/trello.mjs'

const ME = 'a'.repeat(24)
const OTHER = 'b'.repeat(24)

function setup(t, trello = {}, { meFails = false, logs } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-trello-as-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const envFile = path.join(dir, 'e.env')
  fs.writeFileSync(envFile, 'TRELLO_API_KEY=key\nTRELLO_API_TOKEN=secret\n')
  const calls = []
  const cards = [
    { id: 'c1', idShort: 1, name: 'mine', url: 'u1', idMembers: [ME], labels: [] },
    { id: 'c2', idShort: 2, name: 'none', url: 'u2', idMembers: [], labels: [] },
    { id: 'c3', idShort: 3, name: 'other', url: 'u3', idMembers: [OTHER], labels: [] },
    { id: 'c4', idShort: 4, name: 'multi', url: 'u4', idMembers: [OTHER, ME], labels: [] },
  ]
  const fetchImpl = async (url) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('/members/me')) return meFails ? new Response('x', { status: 401 }) : Response.json({ id: ME })
    if (u.includes('/members/alice')) return Response.json({ id: ME })
    if (u.includes('/boards/')) return Response.json([{ id: 'L', name: 'Doing' }])
    if (u.includes('/lists/')) return Response.json(cards)
    return Response.json({})
  }
  const source = new TrelloTaskSource({ config: { board_id: 'b', poll_lists: ['Doing'], ...trello }, envFile, fetchImpl, log: logs ? (l) => logs.push(l) : undefined })
  return { source, calls }
}
const ids = (cards) => cards.map((c) => c.id)

test('trello: mặc định lọc theo chủ token (/members/me), bỏ thẻ chưa gán, giữ thẻ nhiều thành viên', async (t) => {
  const { source, calls } = setup(t)
  assert.deepEqual(ids(await source.poll()), ['1', '4'])
  assert.ok(calls.some((u) => u.includes('/members/me')))
})

test('trello: filter_assigned_only=false trả mọi thẻ', async (t) => {
  const { source, calls } = setup(t, { filter_assigned_only: false })
  assert.deepEqual(ids(await source.poll()), ['1', '2', '3', '4'])
  assert.ok(!calls.some((u) => u.includes('/members/')))
})

test('trello: assignee 24 hex dùng trực tiếp, không gọi /members', async (t) => {
  const { source, calls } = setup(t, { assignee: OTHER })
  assert.deepEqual(ids(await source.poll()), ['3', '4'])
  assert.ok(!calls.some((u) => u.includes('/members/')))
})

test('trello: assignee username được resolve một lần', async (t) => {
  const { source, calls } = setup(t, { assignee: '@alice' })
  await source.poll(); await source.poll()
  assert.equal(calls.filter((u) => u.includes('/members/alice')).length, 1)
})

test('trello: /members/me lỗi -> poll throw (fail closed)', async (t) => {
  const { source } = setup(t, {}, { meFails: true })
  await assert.rejects(() => source.poll(), /401/)
})

test('trello: log một lần khi không có thẻ nào được giao', async (t) => {
  const logs = []
  const { source } = setup(t, { assignee: 'c'.repeat(24) }, { logs })
  assert.deepEqual(await source.poll(), [])
  await source.poll()
  assert.equal(logs.length, 1)
})

import YAML from 'yaml'
import { parseConfigText } from '../scripts/lib/config.mjs'
import { baseConfig } from './helpers/fixture.mjs'

test('config: filter_assigned_only mặc định true sau merge, không ghi vào raw; false giữ nguyên', () => {
  const b = baseConfig()
  delete b.worker.task_source.trello.filter_assigned_only
  const { config, raw } = parseConfigText(YAML.stringify(b))
  assert.equal(config.worker.task_source.trello.filter_assigned_only, true)
  assert.equal('filter_assigned_only' in raw.worker.task_source.trello, false)
  b.worker.task_source.trello.filter_assigned_only = false
  assert.equal(parseConfigText(YAML.stringify(b)).config.worker.task_source.trello.filter_assigned_only, false)
})

function parkSetup(t, { card, cardStatus = 200, trello = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-trello-park-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const envFile = path.join(dir, 'e.env')
  fs.writeFileSync(envFile, 'TRELLO_API_KEY=key\nTRELLO_API_TOKEN=secret\n')
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url))
    calls.push({ path: u.pathname, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined })
    if (u.pathname === '/1/members/me') return Response.json({ id: ME })
    if (u.pathname === '/1/boards/b/lists') return Response.json([{ id: 'L1', name: 'Doing' }, { id: 'L2', name: 'Parked' }])
    if (u.pathname.endsWith('/actions')) return Response.json([])
    if (u.pathname === '/1/cards/c1' && (init.method ?? 'GET') === 'GET') return cardStatus === 200 ? Response.json(card) : new Response('x', { status: cardStatus })
    return Response.json({})
  }
  return { source: new TrelloTaskSource({ config: { board_id: 'b', poll_lists: ['Doing'], ...trello }, envFile, fetchImpl }), calls }
}

test('trello: observeCard trả list/assignedToMe/closed', async (t) => {
  const { source } = parkSetup(t, { card: { idList: 'L2', idMembers: [ME], closed: false, desc: 'd' } })
  const o = await source.observeCard('c1')
  assert.equal(o.list, 'Parked'); assert.equal(o.assignedToMe, true); assert.equal(o.closed, false); assert.equal(o.description, 'd')
  const other = parkSetup(t, { card: { idList: 'L1', idMembers: [OTHER], closed: true } })
  const o2 = await other.source.observeCard('c1')
  assert.deepEqual([o2.list, o2.assignedToMe, o2.closed], ['Doing', false, true])
})

test('trello: observeCard 404 → closed, lỗi khác throw', async (t) => {
  const gone = await parkSetup(t, { cardStatus: 404 }).source.observeCard('c1')
  assert.deepEqual([gone.list, gone.assignedToMe, gone.closed], [null, false, true])
  await assert.rejects(parkSetup(t, { cardStatus: 500 }).source.observeCard('c1'), /HTTP 500/)
})

test('trello: moveCard resolve list theo tên rồi PUT idList; thiếu list → throw', async (t) => {
  const { source, calls } = parkSetup(t, { card: {} })
  await source.moveCard('c1', ' parked ')
  const put = calls.find((c) => c.method === 'PUT')
  assert.equal(put.path, '/1/cards/c1'); assert.deepEqual(put.body, { idList: 'L2' })
  await assert.rejects(source.moveCard('c1', 'Nope'), /Nope/)
})

test('trello: addComment POST actions/comments', async (t) => {
  const { source, calls } = parkSetup(t, { card: {} })
  await source.addComment('c1', 'hello')
  const post = calls.find((c) => c.method === 'POST')
  assert.equal(post.path, '/1/cards/c1/actions/comments'); assert.deepEqual(post.body, { text: 'hello' })
})

test('config: park_list/poll_interval_sec/park_close_after_minutes mặc định, raw không đổi', async () => {
  const { baseConfig } = await import('./helpers/fixture.mjs')
  const { validate } = await import('../scripts/lib/schema.mjs')
  const b = baseConfig()
  const r = parseConfigText(YAML.stringify(b))
  assert.equal(r.config.worker.park_close_after_minutes, 60)
  assert.equal(r.config.worker.task_source.trello.poll_interval_sec, 300)
  assert.equal('poll_interval_sec' in r.raw.worker.task_source.trello, false)
  assert.equal('park_close_after_minutes' in r.raw.worker, false)
  assert.deepEqual(validate(r.config), [])
  b.worker.task_source.trello.park_list = 'Parked'
  assert.deepEqual(validate(parseConfigText(YAML.stringify(b)).config), [])
  b.worker.task_source.trello.park_list = '  '
  assert.notDeepEqual(validate(parseConfigText(YAML.stringify(b)).config), [])
  b.worker.task_source.trello.park_list = 'Parked'; b.worker.park_close_after_minutes = 0
  assert.notDeepEqual(validate(parseConfigText(YAML.stringify(b)).config), [])
})
