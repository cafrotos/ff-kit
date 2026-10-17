// Driver nhận thẻ làm tay / phiên bản cũ từ thư mục thẻ: không bao giờ tạo duyệt, Gate thiếu thành pending.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeHarnessFixture } from './helpers/harness.mjs'
import * as runtime from '../ff-worker/src/core/runtime.mjs'
import { readTask } from '../ff-worker/src/core/task-store.mjs'
import { inspectAdoption } from '../ff-worker/src/core/adopt.mjs'
import { recordGates } from '../scripts/lib/gates.mjs'
import { buildStagePrompt } from '../ff-worker/src/core/tmux-claude-runner.mjs'

const dossier = '# Task\n## Mô tả\nGiữ bộ lọc khi chuyển trang.\n'
const ledger = '| Mã | Trích nguyên văn | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Giữ bộ lọc khi chuyển trang. | Mô tả | sự kiện |\n'
const brief = '# Brief\n| Việc | Nguồn |\n|---|---|\n| Giữ bộ lọc | D-01 |\n'
const source = (cards) => ({ poll: async () => cards, fetchDossier: async () => dossier, moveTo: async () => {} })
const runner = { inspect: async task => ({ status: 'blocked', reason: 'session_unconfirmed', runId: task.runId, claudeSessionId: task.claudeSessionId }), start: async () => ({ status: 'blocked', reason: 'session_unconfirmed' }) }
function manual(t, files) {
  const f = makeHarnessFixture(t)
  for (const [name, text] of Object.entries({ '01-dossier.md': dossier, '01b-ledger.md': ledger, ...files })) f.writeArtifact(`trellocards/123-harness/${name}`, text)
  return f
}
const approve = (f, gate, scope = '') => { const q = `[#123] ${scope ? `[${scope}] ` : ''}Duyệt?`; recordGates(f.root, f.config, { questions: [{ header: gate, question: q }] }, { answers: { [q]: 'Duyệt' } }) }
const cycle = (f) => runtime.runHarnessCycle({ root: f.root, config: f.config, source: source([{ id: '123', name: 'harness' }]), channel: { notify: async () => {} }, runner, now: f.clock.now })

test('thẻ làm tay chỉ có Gate A duyệt: nhận vào revision gốc, B/C pending, không receipt nào bị bịa', async t => {
  const f = manual(t, { 'brief.md': brief, '02-spec.md': '# Spec\n', '03-design.md': '# Design\n' })
  approve(f, 'GATE_A')
  const a = inspectAdoption(f.root, f.config, '123')
  assert.deepEqual(a.gates, { GATE_A: 'approved', GATE_B: 'pending', GATE_C: 'pending' })
  assert.equal(a.stage, 'understand'); assert.deepEqual(a.pendingGates, ['GATE_B'])
  await cycle(f)
  const task = readTask(f.root, '123')
  assert.equal(task.adoption.source, 'card_dir'); assert.deepEqual(task.adoption.pendingGates, ['GATE_B'])
  assert.equal(task.history[0].reason, 'adopted')
  assert.equal(task.stage, 'understand')
  assert.ok(task.pendingEffects.some(e => e.reason === 'adopted'))
  assert.equal(fs.existsSync(path.join(f.root, '.ff/gates/123-GATE_B.json')), false)
  assert.equal(fs.existsSync(path.join(f.root, '.ff/stages')), false)
})

test('file ghi "ĐÃ DUYỆT" nhưng không có receipt vẫn là pending', t => {
  const f = manual(t, { 'brief.md': '> Trạng thái: ĐÃ DUYỆT 2026-10-01\n' + brief })
  const a = inspectAdoption(f.root, f.config, '123')
  assert.equal(a.gates.GATE_A, 'pending'); assert.deepEqual(a.pendingGates, ['GATE_A', 'GATE_B'])
})

test('revision legacy thiếu revision.json: nhận đúng revision đang mở, không reset về gốc', async t => {
  const f = manual(t, { 'brief.md': brief, 'rev-1/delta.md': brief })
  approve(f, 'GATE_A', 'rev-1')
  const a = inspectAdoption(f.root, f.config, '123')
  assert.equal(a.revision, 'rev-1'); assert.equal(a.legacyRevision, true); assert.equal(a.gates.GATE_A, 'approved')
  await cycle(f)
  const task = readTask(f.root, '123')
  assert.equal(task.revision, 'rev-1'); assert.ok(!task.history.some(h => h.reason === 'revision_changed'))
})

test('thẻ mới chỉ có dossier không bị coi là nhận', async t => {
  const f = manual(t, {})
  assert.equal(inspectAdoption(f.root, f.config, '123').adopted, false)
  await cycle(f)
  const task = readTask(f.root, '123')
  assert.equal(task.adoption, undefined); assert.deepEqual(task.history, [])
})

test('prompt pha có ghi chú nhận thẻ khi task được nhận', () => {
  const task = { cardId: '123', stateVersion: 2, stage: 'understand', executionStatus: 'idle', waitingOn: null, revision: '', runId: 'r', dispatchId: 'd', pendingDispatch: { runId: 'r', revision: '', dispatchId: 'd', stage: 'understand' }, adoption: { revision: '', pendingGates: ['GATE_B'] } }
  assert.match(buildStagePrompt(task), /nhận từ trạng thái có sẵn.*GATE_B/)
  assert.doesNotMatch(buildStagePrompt({ ...task, adoption: undefined }), /nhận từ/)
})
