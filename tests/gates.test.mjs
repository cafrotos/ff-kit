import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateQuestions, answerFor, recordGates, isApproved, bodyHash, hasMarker } from '../scripts/lib/gates.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'

const fixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/hooks/ask-post.json', import.meta.url)), 'utf8'))
const Q = '[#123] Duyệt Brief?'
const CARD = 'trellocards/123-loc'
const BRIEF = '> Trạng thái: CHỜ DUYỆT\n# Brief 123\nNội dung\n'
const input = (gate = 'GATE_A', q = Q) => ({ questions: [{ header: gate, question: q, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }], multiSelect: false }] })
const respWith = (answer, q = Q) => ({ ...fixture.tool_response, answers: { [q]: answer } })

function ws(t, files = {}) {
  const w = makeWorkspace({ files: { [`${CARD}/brief.md`]: BRIEF, ...files } })
  t.after(w.cleanup)
  return { root: w.root, config: loadConfig(w.root).config }
}

test('fixture spike đọc được câu trả lời', () => {
  const q = fixture.tool_input.questions[0].question
  assert.equal(typeof answerFor(fixture.tool_response, q), 'string')
})

test('gateQuestions lọc header GATE_* và lấy id thẻ', () => {
  assert.deepEqual(gateQuestions(input()), [{ gate: 'GATE_A', cardId: '123', question: Q }])
  assert.deepEqual(gateQuestions({ questions: [{ header: 'Q1', question: Q }] }), [])
  assert.equal(gateQuestions({ questions: [{ header: 'GATE_B', question: 'Duyệt design?' }] })[0].cardId, null)
})

test('hasMarker khớp bộ đọc ff.sh: không cần ">", chỉ 10 dòng đầu', () => {
  assert.equal(hasMarker('> Trạng thái: ĐÃ DUYỆT 2026-10-13\n'), true)
  assert.equal(hasMarker('Trạng thái: ĐÃ DUYỆT\n'), true)
  assert.equal(hasMarker('- Trạng thái: ĐÃ DUYỆT\n'), true)
  assert.equal(hasMarker('> Trạng thái: ĐÃ DUYỆT'.normalize('NFD')), true)
  assert.equal(hasMarker('x\n'.repeat(10) + 'Trạng thái: ĐÃ DUYỆT\n'), false)
})

test('bodyHash bỏ dòng trạng thái, giữ phần thân', () => {
  assert.equal(bodyHash(BRIEF), bodyHash(BRIEF.replace('CHỜ DUYỆT', 'ĐÃ DUYỆT 2026-10-13')))
  assert.equal(bodyHash(BRIEF), bodyHash(BRIEF.replace(/\n/g, '\r\n')))
  assert.notEqual(bodyHash(BRIEF), bodyHash(BRIEF.replace('Nội dung', 'Nội dung khác')))
})

test('Duyệt → approved khi nội dung còn khớp; sửa thân → mất duyệt', (t) => {
  const { root, config } = ws(t)
  recordGates(root, config, input(), respWith('Duyệt'))
  const withMarker = BRIEF.replace('CHỜ DUYỆT', 'ĐÃ DUYỆT 2026-10-13')
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', withMarker), true)
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', withMarker + 'thêm dòng\n'), false)
  const rec = JSON.parse(fs.readFileSync(path.join(root, '.ff/gates/123-GATE_A.json'), 'utf8'))
  assert.equal(rec.answer, 'Duyệt')
  assert.deepEqual(Object.keys(rec.hashes), ['brief.md'])
})

test('chèn dòng "Trạng thái: …" khác khuôn hoặc sửa ledger sau khi duyệt → mất duyệt', (t) => {
  const LEDGER = '| D-01 | Nội dung | Mô tả | |\n'
  const { root, config } = ws(t, { [`${CARD}/01b-ledger.md`]: LEDGER })
  recordGates(root, config, input(), respWith('Duyệt'))
  const withMarker = BRIEF.replace('CHỜ DUYỆT', 'ĐÃ DUYỆT 2026-10-13')
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', withMarker, LEDGER), true)
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', withMarker.replace('# Brief 123', 'Trạng thái: thêm quyền xoá DB\n# Brief 123'), LEDGER), false)
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', withMarker, LEDGER + '| D-02 | x | y | |\n'), false)
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', withMarker), false)
})

test('Cần sửa hoặc trả lời tự do → không duyệt', (t) => {
  const { root, config } = ws(t)
  recordGates(root, config, input(), respWith('Cần sửa'))
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', BRIEF), false)
  recordGates(root, config, input(), respWith('ok tùy bạn'))
  assert.equal(isApproved(root, '123', 'GATE_A', 'brief.md', BRIEF), false)
})

test('GATE_B hash mọi 03-design.md kể cả task-N/', (t) => {
  const q = '[#123] Duyệt design?'
  const { root, config } = ws(t, { [`${CARD}/03-design.md`]: 'A\n', [`${CARD}/task-1/03-design.md`]: 'B\n' })
  const [rec] = recordGates(root, config, input('GATE_B', q), respWith('Duyệt', q))
  assert.deepEqual(Object.keys(rec.hashes).sort(), ['03-design.md', 'task-1/03-design.md'])
  assert.equal(isApproved(root, '123', 'GATE_B', 'task-1/03-design.md', 'B\n'), true)
})

test('answerFor chịu được mảng và thiếu dữ liệu', () => {
  assert.equal(answerFor({ answers: [{ question: Q, answer: 'Duyệt' }] }, Q), 'Duyệt')
  assert.equal(answerFor(null, Q), null)
  assert.equal(answerFor({ answers: {} }, Q), null)
})

test('câu trả lời chỉ có trong tool_input.answers (docs hooks) vẫn được ghi', (t) => {
  const { root, config } = ws(t)
  const inp = { ...input(), answers: { [Q]: 'Duyệt' } }
  const [rec] = recordGates(root, config, inp, null)
  assert.equal(rec.approved, true)
})
