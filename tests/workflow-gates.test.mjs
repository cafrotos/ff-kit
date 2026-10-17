import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { recordGates, isApproved } from '../scripts/lib/gates.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { makeWorkspace, git } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { checkCompletedTasks } from '../ff-worker/src/core/runtime.mjs'
import { writeTask } from '../ff-worker/src/core/task-store.mjs'
import { spawnSync } from 'node:child_process'

const card = 'trellocards/123-task'
const dossier = '# Task\n## Mô tả\nGiữ bộ lọc khi chuyển trang.\n'
const ledger = '| Mã | Trích nguyên văn | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Giữ bộ lọc khi chuyển trang. | Mô tả | sự kiện |\n'
const brief = '# Brief\n| Việc | Nguồn |\n|---|---|\n| Giữ bộ lọc | D-01 |\n'
const spec = '# Spec\n- **AC-01** Giữ bộ lọc — D-01\n'
const design = '---\ngate_b:\n  new_behavior: false\n  precedent_deviation: false\n  open_decisions: false\n---\n# Design\n| Việc | Nguồn |\n|---|---|\n| Theo precedent | D-01 |\n'
function setup(t, extra = {}) {
  const w = makeWorkspace({ files: { [`${card}/01-dossier.md`]: dossier, [`${card}/01b-ledger.md`]: ledger,
    [`${card}/brief.md`]: brief, [`${card}/02-spec.md`]: spec, [`${card}/03-design.md`]: design, ...extra } })
  t.after(w.cleanup)
  return { ...w, config: loadConfig(w.root).config }
}
function approve(w, gate, scope = '') {
  const question = `[#123] ${scope ? `[${scope}] ` : ''}Duyệt?`
  return recordGates(w.root, w.config, { questions: [{ header: gate, question }] }, { answers: { [question]: 'Duyệt' } })[0]
}
async function state(w) {
  const c = capture(w.root)
  assert.equal(await main(['state', '123', '--json'], c.ctx), 0)
  return JSON.parse(c.buf.out)
}
test('state JSON ignores marker-only approval and exposes authoritative gate status', async (t) => {
  const w = setup(t)
  fs.appendFileSync(path.join(w.root, card, 'brief.md'), '> Trạng thái: ĐÃ DUYỆT\n')
  assert.equal((await state(w)).gates.GATE_A.status, 'pending')
  approve(w, 'GATE_A')
  assert.equal((await state(w)).gates.GATE_A.status, 'approved')
  fs.appendFileSync(path.join(w.root, card, 'brief.md'), 'Thay đổi yêu cầu\n')
  assert.equal((await state(w)).gates.GATE_A.status, 'stale')
})
test('auto Gate B is bound to design, spec, dossier and the approved Gate A', async (t) => {
  const w = setup(t)
  let c = capture(w.root)
  assert.equal(await main(['gate-auto', '123', '--reason', 'Theo precedent'], c.ctx), 1)
  approve(w, 'GATE_A')
  c = capture(w.root)
  assert.equal(await main(['gate-auto', '123', '--reason', 'Theo precedent'], c.ctx), 0, c.buf.err)
  assert.equal((await state(w)).gates.GATE_B.status, 'auto_passed')
  assert.equal(isApproved(w.root, '123', 'GATE_B', '03-design.md', design, ledger), false, 'auto pass must not impersonate user approval')
  for (const filename of ['02-spec.md', '03-design.md', '01-dossier.md']) {
    const file = path.join(w.root, card, filename), old = fs.readFileSync(file, 'utf8')
    fs.appendFileSync(file, 'changed\n')
    assert.equal((await state(w)).gates.GATE_B.status, 'stale', filename)
    fs.writeFileSync(file, old)
  }
  approve(w, 'GATE_A')
  assert.equal((await state(w)).gates.GATE_B.status, 'stale', 'new approval invalidates previous dependency')
})
test('auto Gate B rejects missing or non-boolean eligibility declarations', async (t) => {
  const w = setup(t)
  approve(w, 'GATE_A')
  for (const body of [design.replace('new_behavior: false', 'new_behavior: true'), design.replace('open_decisions: false', 'open_decisions: "false"'), '# Design\n']) {
    fs.writeFileSync(path.join(w.root, card, '03-design.md'), body)
    const c = capture(w.root)
    assert.equal(await main(['gate-auto', '123', '--reason', 'Theo precedent'], c.ctx), 1)
  }
})
test('reopen creates a new contract and revision Gate hashes delta instead of the old Brief', async (t) => {
  const w = setup(t)
  approve(w, 'GATE_A')
  const rootReceipt = fs.readFileSync(path.join(w.root, '.ff/gates/123-GATE_A.json'), 'utf8')
  const c = capture(w.root)
  assert.equal(await main(['reopen', '123', '--reason', 'Bộ lọc vẫn bị mất'], c.ctx), 0, c.buf.err)
  let s = await state(w)
  assert.equal(s.activeRevision, 'rev-1')
  assert.equal(s.activeDir, `${card}/rev-1`)
  assert.equal(s.gates.GATE_A.status, 'pending')
  assert.equal(await main(['reopen', '123', '--reason', 'khác'], capture(w.root).ctx), 1, 'do not abandon unfinished revision')
  const delta = path.join(w.root, card, 'rev-1/delta.md')
  fs.writeFileSync(delta, brief)
  const receipt = approve(w, 'GATE_A', 'rev-1')
  assert.deepEqual(Object.keys(receipt.hashes), ['rev-1/delta.md'])
  assert.equal((await state(w)).gates.GATE_A.status, 'approved')
  assert.equal(fs.readFileSync(path.join(w.root, '.ff/gates/123-GATE_A.json'), 'utf8'), rootReceipt)
  fs.appendFileSync(delta, 'changed\n')
  assert.equal((await state(w)).gates.GATE_A.status, 'stale')
})
test('revision receipt is invalidated by changed dossier and cannot approve another revision', async (t) => {
  const w = setup(t, { [`${card}/rev-1/delta.md`]: brief })
  approve(w, 'GATE_A', 'rev-1')
  assert.equal((await state(w)).gates.GATE_A.status, 'approved')
  fs.appendFileSync(path.join(w.root, card, '01-dossier.md'), 'Nội dung mới\n')
  assert.equal((await state(w)).gates.GATE_A.status, 'stale')
  fs.mkdirSync(path.join(w.root, card, 'rev-2'))
  fs.writeFileSync(path.join(w.root, card, 'rev-2/delta.md'), brief)
  assert.equal((await state(w)).gates.GATE_A.status, 'pending')
})

test('worker cannot complete a reopened task from the previous Gate C', async (t) => {
  const w = setup(t, { [`${card}/05-verify-report.md`]: '# Old report\n' })
  approve(w, 'GATE_C')
  fs.mkdirSync(path.join(w.root, card, 'rev-1'))
  fs.writeFileSync(path.join(w.root, card, 'rev-1/delta.md'), brief)
  writeTask(w.root, { cardId: '123', slug: 'task', phase: 'running', session: 'ff-123' })
  const moved = []
  const result = await checkCompletedTasks({ root: w.root, config: w.config, source: { moveTo: async (...args) => moved.push(args) }, channel: { notify: async () => {} }, tmux: { killSession() {} } })
  assert.deepEqual(result, [])
  assert.deepEqual(moved, [])
})

test('reopen locks new tests in a separate revision manifest and preserves original hashes', async (t) => {
  const w = setup(t, { 'worktrees/123-task/.keep': '', 'tests/old.spec.ts': 'old\n', 'tests/rev-1.spec.ts': 'revision\n' })
  assert.equal(await main(['lock-tests', '123-task', 'tests/old.spec.ts'], capture(w.root).ctx), 0)
  const original = fs.readFileSync(path.join(w.root, 'worktrees/123-task/.ff-test-lock'), 'utf8')
  const c = capture(w.root)
  assert.equal(await main(['lock-tests', '123-task', '--revision', 'rev-1', 'tests/rev-1.spec.ts'], c.ctx), 0, c.buf.err)
  assert.equal(fs.readFileSync(path.join(w.root, 'worktrees/123-task/.ff-test-lock'), 'utf8'), original)
  assert.match(fs.readFileSync(path.join(w.root, 'worktrees/123-task/.ff-test-lock.rev-1'), 'utf8'), /tests\/rev-1.spec.ts/)
})

test('Gate hook rejects missing revision identity instead of approving old contracts', (t) => {
  const w = setup(t, { [`${card}/rev-1/delta.md`]: brief })
  const hook = path.resolve('scripts/hooks/ask-pre.mjs')
  const run = (question) => spawnSync(process.execPath, [hook], { cwd: w.root, encoding: 'utf8', input: JSON.stringify({ cwd: w.root, tool_input: { questions: [{ header: 'GATE_A', question, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }] }] } }) })
  assert.equal(run('[#123] Duyệt?').status, 2)
  assert.equal(run('[#123] [rev-1] Duyệt?').status, 0)
  assert.throws(() => approve(w, 'GATE_A'), /rev-1/)
})

test('one root Gate A remains valid when cluster briefs are added after approval', async (t) => {
  const w = setup(t)
  approve(w, 'GATE_A')
  fs.rmSync(path.join(w.root, card, '03-design.md'))
  fs.mkdirSync(path.join(w.root, card, 'task-1'))
  for (const [name, body] of [['brief.md', brief], ['02-spec.md', spec], ['03-design.md', design]]) fs.writeFileSync(path.join(w.root, card, 'task-1', name), body)
  const c = capture(w.root)
  assert.equal(await main(['gate-auto', '123', '--task', 'task-1', '--reason', 'Theo precedent'], c.ctx), 0, c.buf.err)
  const s = await state(w)
  assert.equal(s.gates.GATE_A.status, 'approved')
  assert.equal(s.gates.GATE_B.status, 'auto_passed')
  assert.equal(s.readyForBuild, true)
})

test('revision cluster auto gate checks the selected design rather than its parent', async (t) => {
  const w = setup(t, { [`${card}/rev-1/delta.md`]: brief, [`${card}/rev-1/02-spec.md`]: spec, [`${card}/rev-1/03-design.md`]: design,
    [`${card}/rev-1/task-1/02-spec.md`]: spec, [`${card}/rev-1/task-1/03-design.md`]: design + '\nnot-a-real-file.ts:999\n' })
  approve(w, 'GATE_A', 'rev-1')
  const c = capture(w.root)
  assert.equal(await main(['gate-auto', '123', '--task', 'task-1', '--reason', 'Theo precedent'], c.ctx), 1)
})

test('Gate C and worker completion invalidate when the active delta changes', async (t) => {
  const w = setup(t, { [`${card}/rev-1/delta.md`]: brief, [`${card}/rev-1/02-spec.md`]: spec, [`${card}/rev-1/03-design.md`]: design, [`${card}/rev-1/05-verify-report.md`]: '# Verified\n' })
  approve(w, 'GATE_A', 'rev-1')
  approve(w, 'GATE_B', 'rev-1')
  approve(w, 'GATE_C', 'rev-1')
  fs.appendFileSync(path.join(w.root, card, 'rev-1/delta.md'), 'Changed contract\n')
  assert.equal((await state(w)).gates.GATE_C.status, 'stale')
  writeTask(w.root, { cardId: '123', slug: 'task', phase: 'running' })
  const moved = []
  assert.deepEqual(await checkCompletedTasks({ root: w.root, config: w.config, source: { moveTo: async (...args) => moved.push(args) }, channel: {}, tmux: {} }), [])
  assert.deepEqual(moved, [])
})

test('authorized relock add locks later clusters without rehashing older tests', async (t) => {
  const w = setup(t, { 'worktrees/123-task/.keep': '', 'tests/task-1.spec.ts': 'first\n', 'tests/task-2.spec.ts': 'second\n' })
  assert.equal(await main(['lock-tests', '123-task', 'tests/task-1.spec.ts'], capture(w.root).ctx), 0)
  const c = capture(w.root)
  assert.equal(await main(['relock', '123-task', '--reason', 'Thêm cụm mới', '--add', 'tests/task-2.spec.ts'], c.ctx), 0, c.buf.err)
  const manifest = fs.readFileSync(path.join(w.root, 'worktrees/123-task/.ff-test-lock'), 'utf8')
  assert.match(manifest, /tests\/task-1.spec.ts/)
  assert.match(manifest, /tests\/task-2.spec.ts/)
  fs.chmodSync(path.join(w.root, 'tests/task-1.spec.ts'), 0o600)
  fs.writeFileSync(path.join(w.root, 'tests/task-1.spec.ts'), 'tampered\n')
  assert.equal(await main(['relock', '123-task', '--reason', 'Thêm cụm', '--add', 'tests/task-2.spec.ts'], capture(w.root).ctx), 1, '--add must not bless changes in old tests')
})

test('ac-matrix selects active revision clusters and cannot count old tests as new coverage', async (t) => {
  const w = setup(t, { [`${card}/rev-1/delta.md`]: brief, [`${card}/rev-1/task-1/02-spec.md`]: spec,
    'qa/tests/123-task/task-1-behavior.spec.ts': "test('AC-01: old', () => {})\n" })
  const config = fs.readFileSync(path.join(w.root, 'ff.config.yaml'), 'utf8')
  fs.writeFileSync(path.join(w.root, 'ff.config.yaml'), config + '\ne2e:\n  dir: qa\n  tests_dir: qa/tests\n')
  const c = capture(w.root)
  assert.equal(await main(['ac-matrix', '123', 'task-1'], c.ctx), 1)
  assert.match(c.buf.out, /AC-01: MISSING/)
  fs.writeFileSync(path.join(w.root, 'qa/tests/123-task/rev-1-task-1-behavior.spec.ts'), "test('AC-01: new', () => {})\n")
  assert.equal(await main(['lock-tests', '123-task', '--revision', 'rev-1', 'qa/tests/123-task/rev-1-task-1-behavior.spec.ts'], capture(w.root).ctx), 1, 'no copy yet')
  fs.mkdirSync(path.join(w.root, 'worktrees/123-task'))
  assert.equal(await main(['lock-tests', '123-task', '--revision', 'rev-1', 'qa/tests/123-task/rev-1-task-1-behavior.spec.ts'], capture(w.root).ctx), 0)
  assert.equal(await main(['ac-matrix', '123', 'task-1'], capture(w.root).ctx), 0)
  assert.equal(await main(['ac-matrix', '123'], capture(w.root).ctx), 0)
})

test('reopen cluster mode ignores parent design placeholder as an extra Gate B', async (t) => {
  const w = setup(t)
  assert.equal(await main(['reopen', '123', '--reason', 'Fix'], capture(w.root).ctx), 0)
  fs.writeFileSync(path.join(w.root, card, 'rev-1/delta.md'), brief)
  approve(w, 'GATE_A', 'rev-1')
  fs.mkdirSync(path.join(w.root, card, 'rev-1/task-1'))
  fs.writeFileSync(path.join(w.root, card, 'rev-1/task-1/02-spec.md'), spec)
  fs.writeFileSync(path.join(w.root, card, 'rev-1/task-1/03-design.md'), design)
  assert.equal(await main(['gate-auto', '123', '--task', 'task-1', '--reason', 'Theo precedent'], capture(w.root).ctx), 0)
  assert.equal((await state(w)).readyForBuild, true)
  fs.writeFileSync(path.join(w.root, card, 'rev-1/05-verify-report.md'), '# Verified\n')
  approve(w, 'GATE_C', 'rev-1')
  assert.equal((await state(w)).gates.GATE_C.status, 'approved')
})

test('reopen refuses the ship branch before creating revision files or a wrong baseline', async (t) => {
  const w = setup(t, { [`${card}/01-dossier.md`]: dossier + '\n## Branch\n```text\nfeature/task\n```\n' })
  assert.equal(await main(['copy', '123'], capture(w.root).ctx), 0)
  const copy = path.join(w.root, 'worktrees/123-task/web')
  git(copy, 'switch', 'dev')
  assert.equal(await main(['reopen', '123', '--reason', 'Fix'], capture(w.root).ctx), 1)
  assert.equal(fs.existsSync(path.join(w.root, card, 'rev-1')), false)
})

test('lock-tests resolves a repo-relative path to the card worktree copy, never the base repo', async (t) => {
  const w = setup(t, { 'web/math.test.js': 'base\n', 'worktrees/123-task/web/math.test.js': 'card copy\n' })
  const c = capture(w.root)
  assert.equal(await main(['lock-tests', '123-task', 'web/math.test.js'], c.ctx), 0, c.buf.err)
  assert.match(fs.readFileSync(path.join(w.root, 'worktrees/123-task/.ff-test-lock'), 'utf8'), /  worktrees\/123-task\/web\/math\.test\.js\n$/)
  assert.ok(fs.statSync(path.join(w.root, 'web/math.test.js')).mode & 0o200, 'base repo file stays writable')
  const base = capture(w.root)
  assert.equal(await main(['relock', '123-task', '--reason', 'x', '--add', path.join(w.root, 'web/math.test.js')], base.ctx), 1)
  assert.match(base.buf.err, /repo gốc/)
})
