import './helpers/hermetic-home.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeWorkspace } from './helpers/fixture.mjs'
import { doctorStatus } from '../scripts/lib/state.mjs'
import { isApproved } from '../scripts/lib/gates.mjs'

const HOOK = (n) => fileURLToPath(new URL(`../scripts/hooks/${n}.mjs`, import.meta.url))
const preFixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/hooks/ask-pre.json', import.meta.url)), 'utf8'))
const postFixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/hooks/ask-post.json', import.meta.url)), 'utf8'))
const ENV = { '.ff.env': 'TRELLO_API_KEY=a\nTRELLO_API_TOKEN=b\n' }
const CARD = 'trellocards/123-loc'
const CARD_FILES = {
  [`${CARD}/01-dossier.md`]: '# Thẻ 123\nCho phép lọc ứng viên.\n',
  [`${CARD}/01b-ledger.md`]: '| Mã | Trích | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Cho phép lọc ứng viên. | Mô tả | |\n',
  [`${CARD}/brief.md`]: '| # | Mục | Nguồn |\n|---|---|---|\n| 1 | Lọc | D-01 |\n',
}

function runHook(name, input) {
  return new Promise((resolve) => {
    const p = spawn('node', [HOOK(name)], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (c) => { out += c })
    p.stderr.on('data', (c) => { err += c })
    p.on('close', (status) => resolve({ status, out, err }))
    p.stdin.end(JSON.stringify(input))
  })
}
const askInput = (cwd, question, header) => ({ ...preFixture, cwd, tool_input: { questions: [{ header, question, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }], multiSelect: false }] } })

async function listen(t) {
  const got = []
  const s = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => { got.push(JSON.parse(b)); res.writeHead(204).end() })
  })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  t.after(() => { s.closeAllConnections(); s.close() })
  return { port: s.address().port, got }
}
function ws(t, files = {}) {
  const w = makeWorkspace({ files: { ...ENV, ...CARD_FILES, ...files } })
  t.after(w.cleanup)
  return w.root
}

test('hooks no-op ngoài workspace', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-none-'))
  for (const name of ['session-start', 'ask-pre', 'ask-post', 'notification']) {
    const r = await runHook(name, askInput(dir, '[#1] x', 'GATE_A'))
    assert.deepEqual([r.status, r.out, r.err], [0, '', ''], name)
  }
  fs.rmSync(dir, { recursive: true })
})

test('session-start: xanh và đỏ, luôn exit 0', async (t) => {
  const root = ws(t)
  const g = await runHook('session-start', { cwd: root })
  assert.equal(g.status, 0)
  assert.match(g.out, /ff doctor: xanh/)
  assert.match(g.out, /Worker chưa chạy.*\/ff-worker start/)
  assert.equal(doctorStatus(root), 'green')
  fs.rmSync(path.join(root, '.ff.env'))
  const w = await runHook('session-start', { cwd: root })
  assert.equal(w.status, 0)
  assert.match(w.out, /\/ff-worker start/)
  assert.equal(doctorStatus(root), 'green')
  assert.equal(doctorStatus(root, 'worker'), 'red')
  fs.rmSync(path.join(root, 'trellocards'), { recursive: true })
  const r = await runHook('session-start', { cwd: root })
  assert.equal(r.status, 0)
  assert.match(r.out, /ĐỎ nhóm core/)
  assert.equal(doctorStatus(root), 'red')
})

test('ask-pre: Gate thiếu [#id] → exit 2', async (t) => {
  const r = await runHook('ask-pre', askInput(ws(t), 'Duyệt Brief?', 'GATE_A'))
  assert.equal(r.status, 2)
  assert.match(r.err, /\[#<id thẻ>\]/)
})

test('ask-pre: trace-check đỏ → exit 2 kèm lỗi', async (t) => {
  const root = ws(t, { [`${CARD}/brief.md`]: '# trống\n' })
  const r = await runHook('ask-pre', askInput(root, '[#123] Duyệt Brief?', 'GATE_A'))
  assert.equal(r.status, 2)
  assert.match(r.err, /D-01 chưa được dòng nào phủ/)
})

test('ask-pre: trace xanh → notify gate kèm lệnh attach', async (t) => {
  const root = ws(t)
  const { port, got } = await listen(t)
  fs.mkdirSync(path.join(root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ff/worker.json'), JSON.stringify({ port }))
  const r = await runHook('ask-pre', askInput(root, '[#123] Duyệt Brief?', 'GATE_A'))
  assert.equal(r.status, 0, r.err)
  assert.equal(got[0].kind, 'gate')
  assert.equal(got[0].taskId, '123')
  assert.match(got[0].body, /tmux attach -t ff-123/)
  assert.match(got[0].body, /Remote Control 'ff-123/)
  await runHook('ask-pre', askInput(root, 'Chọn màu nút?', 'Màu'))
  assert.equal(got[1].kind, 'ask')
})

test('ask-pre: worker vắng → vẫn exit 0', async (t) => {
  const r = await runHook('ask-pre', askInput(ws(t), '[#123] Duyệt Brief?', 'GATE_A'))
  assert.equal(r.status, 0)
})

test('ask-post ghi Gate đã Duyệt', async (t) => {
  const root = ws(t)
  const q = '[#123] Duyệt Brief?'
  const input = { ...postFixture, cwd: root, tool_input: { questions: [{ header: 'GATE_A', question: q }] }, tool_response: { ...postFixture.tool_response, answers: { [q]: 'Duyệt' } } }
  const r = await runHook('ask-post', input)
  assert.equal(r.status, 0)
  const brief = fs.readFileSync(path.join(root, CARD, 'brief.md'), 'utf8')
  const ledger = fs.readFileSync(path.join(root, CARD, '01b-ledger.md'), 'utf8')
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', brief, ledger), true)
})

test('notification gửi attention', async (t) => {
  const root = ws(t)
  const { port, got } = await listen(t)
  fs.mkdirSync(path.join(root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ff/worker.json'), JSON.stringify({ port }))
  await runHook('notification', { cwd: root, message: 'Claude cần quyền chạy lệnh' })
  assert.deepEqual([got[0].kind, got[0].title], ['attention', 'Claude cần quyền chạy lệnh'])
})

test('standalone ask-post missing answer preserves the prior Gate receipt',async t=>{
  const root=ws(t),question='[#123] Duyệt Brief?',file=path.join(root,'.ff/gates/123-GATE_A.json')
  await runHook('ask-post',{...askInput(root,question,'GATE_A'),tool_response:{answers:{[question]:'Duyệt'}}})
  const before=fs.readFileSync(file,'utf8')
  await runHook('ask-post',askInput(root,question,'GATE_A'))
  assert.equal(fs.readFileSync(file,'utf8'),before)
})
test('standalone question snapshots and answers survive without driver or worker',async t=>{
  const root=ws(t),question='[#123] Chọn cách lưu?',input={...askInput(root,question,'Q1'),tool_use_id:'standalone-tool'}
  assert.equal((await runHook('ask-pre',input)).status,0)
  assert.equal((await runHook('ask-post',{...input,tool_response:{answers:{[question]:'Có'}}})).status,0)
  const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs')
  const records=readQuestionHistory(root,'123')
  assert.equal(records.length,1)
  assert.deepEqual([records[0].status,records[0].runId],['answered','standalone:spike'])
})

test('ask-pre: Gate options must be exactly Duyệt / Cần sửa (no "(Recommended)" suffix)', async (t) => {
  const root = ws(t)
  const input = askInput(root, '[#123] Duyệt Brief?', 'GATE_A')
  input.tool_input.questions[0].options = [{ label: 'Duyệt (Recommended)' }, { label: 'Cần sửa' }]
  const r = await runHook('ask-pre', input)
  assert.equal(r.status, 2)
  assert.match(r.err, /đúng hai lựa chọn "Duyệt" và "Cần sửa"/)
})
