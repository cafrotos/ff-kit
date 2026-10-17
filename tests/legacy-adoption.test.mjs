// Thẻ làm tay / phiên bản cũ quay lại luồng chuẩn: supersede, gate bị từ chối có lý do, nhận thẻ vào driver, đóng thẻ legacy đã vào base_branch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const GUARD = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url))

export const card = 'trellocards/123-task'
export const dossier = '# Task\n## Mô tả\nGiữ bộ lọc khi chuyển trang.\n'
export const ledger = '| Mã | Trích nguyên văn | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Giữ bộ lọc khi chuyển trang. | Mô tả | sự kiện |\n'
export const brief = '# Brief\n| Việc | Nguồn |\n|---|---|\n| Giữ bộ lọc | D-01 |\n'
export function setup(t, extra = {}) {
  const w = makeWorkspace({ files: { [`${card}/01-dossier.md`]: dossier, [`${card}/01b-ledger.md`]: ledger, [`${card}/brief.md`]: brief, ...extra } })
  t.after(w.cleanup)
  return { ...w, config: loadConfig(w.root).config }
}

test('reopen --supersede: bỏ revision legacy chưa xong Gate C, ghi lý do, mở revision mới', async (t) => {
  const w = setup(t, { [`${card}/rev-1/delta.md`]: brief })
  const refused = capture(w.root)
  assert.equal(await main(['reopen', '123', '--reason', 'lỗi mới'], refused.ctx), 1)
  assert.match(refused.buf.err, /--supersede/)
  assert.equal(fs.existsSync(path.join(w.root, card, 'rev-2')), false)
  const ok = capture(w.root)
  assert.equal(await main(['reopen', '123', '--supersede', '--reason', 'code đã vào base_branch qua đường cũ'], ok.ctx), 0, ok.buf.err)
  const mark = JSON.parse(fs.readFileSync(path.join(w.root, card, 'rev-1/superseded.json'), 'utf8'))
  assert.equal(mark.revision, 'rev-1'); assert.match(mark.reason, /base_branch/)
  assert.deepEqual(Object.values(mark.gates), ['pending', 'absent', 'absent'])
  assert.ok(fs.existsSync(path.join(w.root, card, 'rev-2/revision.json')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.root, card, 'rev-2/revision.json'), 'utf8')).previousRevision, 'rev-1')
})

test('reopen --supersede không cần khi revision đã xong; và cần --reason', async (t) => {
  const w = setup(t)
  assert.equal(await main(['reopen', '123', '--supersede'], capture(w.root).ctx), 1)
  assert.equal(await main(['reopen', '123', '--reason', 'x', '--bogus'], capture(w.root).ctx), 1)
})

test('guard: ff reopen --supersede luôn hỏi người; reopen thường thì không', (t) => {
  const w = setup(t)
  const ask = (cmd) => spawnSync('node', [GUARD, '--cwd', w.root, '--cmd', cmd], { encoding: 'utf8' }).stdout.includes('"ask"')
  assert.equal(ask('ff reopen 123 --supersede --reason x'), true)
  assert.equal(ask('ff reopen 123 --reason x --supersede'), true)
  assert.equal(ask('ff reopen 123 --reason x'), false)
})

// --- Gate bị từ chối phải đến tay người ---
import { spawn } from 'node:child_process'
const HOOK = (n) => fileURLToPath(new URL(`../scripts/hooks/${n}.mjs`, import.meta.url))
const hookInput = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/hooks/ask-post.json', import.meta.url)), 'utf8'))
function runHook(name, input) {
  return new Promise((resolve) => {
    const p = spawn('node', [HOOK(name)], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (c) => { out += c }); p.stderr.on('data', (c) => { err += c })
    p.on('close', (status) => resolve({ status, out, err }))
    p.stdin.end(JSON.stringify(input))
  })
}
const gateInput = (cwd, header, question, answer) => ({ ...hookInput, cwd,
  tool_input: { questions: [{ header, question, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }], multiSelect: false }], ...(answer ? { answers: { [question]: answer } } : {}) },
  ...(answer ? { tool_response: { answers: { [question]: answer } } } : {}) })
const legacyRev = { [`${card}/rev-1/delta.md`]: brief, [`${card}/rev-1/05-verify-report.md`]: '# Report\n' }

test('ask-post: Duyệt Gate C khi thiếu Gate A/B của revision → báo người lý do + cách sửa, không ghi receipt', async (t) => {
  const w = setup(t, legacyRev)
  const q = '[#123] [rev-1] Duyệt báo cáo?'
  const r = await runHook('ask-post', gateInput(w.root, 'GATE_C', q, 'Duyệt'))
  assert.equal(r.status, 0)
  const out = JSON.parse(r.out)
  assert.match(out.systemMessage, /CHƯA được ghi nhận/)
  assert.match(out.systemMessage, /GATE_A.*chưa có bản ghi duyệt/)
  assert.match(out.systemMessage, /trình GATE_A/)
  assert.match(out.hookSpecificOutput.additionalContext, /GATE_A/)
  assert.equal(fs.existsSync(path.join(w.root, '.ff/gates/123-rev-1-GATE_C.json')), false)
})

test('ask-pre: Gate C khi Gate A/B của revision chưa có → cảnh báo agent trước khi hỏi (không chặn)', async (t) => {
  const w = setup(t, legacyRev)
  const r = await runHook('ask-pre', gateInput(w.root, 'GATE_C', '[#123] [rev-1] Duyệt báo cáo?'))
  assert.equal(r.status, 0, r.err)
  assert.match(JSON.parse(r.out.trim().split('\n')[0]).hookSpecificOutput.additionalContext, /sẽ KHÔNG ghi được.*GATE_A.*chưa có bản ghi duyệt/)
})
