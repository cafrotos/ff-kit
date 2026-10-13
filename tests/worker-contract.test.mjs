import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeChannel, makeTaskSource } from '../ff-worker/src/adapters/index.mjs'
import { formatEvent } from '../ff-worker/src/adapters/channel/console.mjs'
import { RocketChatChannel } from '../ff-worker/src/adapters/channel/rocketchat.mjs'
import { TrelloTaskSource } from '../ff-worker/src/adapters/task-source/trello.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('console channel formats notifications with task id and kind', async () => {
  const lines = []
  const channel = makeChannel({ channel: { adapter: 'console' } }, { write: (line) => lines.push(line) })
  await channel.notify({ taskId: '123', kind: 'gate', title: 'Gate A', body: 'Review now' })
  assert.deepEqual(lines, ['[123] [gate] Gate A\nReview now\n'])
})

test('console formatter handles events without optional fields', () => {
  assert.equal(formatEvent({ kind: 'info', title: 'Ready' }), '[worker] [info] Ready')
})

test('unknown channel and task source adapters fail with actionable messages', () => {
  assert.throws(() => makeChannel({ channel: { adapter: 'slack' } }), /channel adapter.*slack/i)
  assert.throws(() => makeTaskSource({ task_source: { adapter: 'manual' } }), /task source adapter.*manual/i)
})

test('ff-worker package bin executes when npm invokes it through a symlink', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-worker-bin-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const entry = path.resolve('ff-worker/src/index.mjs')
  const bin = path.join(dir, 'ff-worker')
  fs.symlinkSync(entry, bin)
  const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Dùng: ff-worker --config <ff\.config\.yaml>/)
})

test('Rocket.Chat channel sends one-way messages and does not read chat', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-worker-env-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const envFile = path.join(dir, '.ff.env')
  fs.writeFileSync(envFile, 'RC_URL=https://chat.example\nRC_USER_ID=user\nRC_AUTH_TOKEN=secret\nRC_ROOM_ID=room\n')
  const calls = []
  const channel = new RocketChatChannel({ envFile, fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json({ success: true }) } })
  await channel.notify({ taskId: '5', kind: 'gate', title: 'Review', body: 'Attach to tmux' })
  assert.match(calls[0].url, /chat\.postMessage$/)
  assert.match(calls[0].options.body, /Attach to tmux/)
  assert.equal(calls.length, 1)
})

test('Trello adapter maps cards and emits a dossier with checklist/comments', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-worker-env-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const envFile = path.join(dir, '.ff.env')
  fs.writeFileSync(envFile, 'TRELLO_API_KEY=key\nTRELLO_API_TOKEN=secret\n')
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/boards/')) return Response.json([{ id: 'list1', name: 'Doing' }, { id: 'done', name: 'Ready' }])
    if (String(url).includes('/lists/')) return Response.json([{ id: 'remote1', idShort: 42, name: 'Search', url: 'https://trello.test/42', idMembers: [], labels: [] }])
    if (String(url).includes('/checklists')) return Response.json([{ name: 'Acceptance', checkItems: [{ name: 'works', state: 'incomplete' }] }])
    if (String(url).includes('/actions')) return Response.json([{ data: { text: 'Ship it' }, memberCreator: { fullName: 'User' }, date: '2026-01-01' }])
    if (String(url).includes('/cards/remote1?')) return Response.json({ idShort: 42, name: 'Search', desc: 'Find users', url: 'https://trello.test/42', labels: [] })
    return Response.json({ ok: true })
  }
  const source = new TrelloTaskSource({ config: { board_id: 'board', poll_lists: ['Doing'], done_list: 'Ready' }, envFile, fetchImpl })
  const cards = await source.poll()
  assert.equal(cards[0].id, '42')
  assert.equal(cards[0].trelloCardId, 'remote1')
  const dossier = await source.fetchDossier(cards[0])
  assert.match(dossier, /\[#?\s*\] works/)
  assert.match(dossier, /User · 2026-01-01: Ship it/)
  assert.ok(calls.every((url) => url.includes('key=key') && url.includes('token=secret')))
})
