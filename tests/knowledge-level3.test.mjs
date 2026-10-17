import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { main } from '../scripts/cli/main.mjs'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { workflowPackage } from './helpers/workflow.mjs'
import { prepareWorkflowSnapshot } from '../scripts/lib/workflow-snapshot.mjs'
import { appendKnowledgeEvent, readKnowledgeEvents, shadowStats, questionHash, recordOutcome, proposeEscape, confirmEscapes } from '../scripts/lib/knowledge-log.mjs'
import { readDecisions } from '../scripts/lib/knowledge.mjs'

const SESSION = '35349a6a-f735-4d64-b646-c7bbfe5affad'
const scope = { cardId: '123', revision: '', runId: 'run-1', dispatchId: 'dispatch-1' }
const CTX = { repo: 'web', businessScope: 'filters', decisionKey: 'reload', class: 'default-value', normalizedOptions: { 'Có': 'persist', 'Không': 'page-only' } }
const sections = { function: 'a', current: 'b', requested: 'c', target: 'd', impact: 'e', acceptance: 'f', uncertainty: 'g' }
const decision = (extra = {}) => ({ id: 'Q1', question: 'Giữ khi reload?', options: [{ label: 'Có', description: 'Giữ.' }, { label: 'Không', description: 'Không giữ.' }], recommendation: 'Có; vì D-01.', ...extra })
const packet = decisions => ({ version: 1, phase: 'understand', headline: 'H', sections, decisions, nextAction: 'Chốt.' })
const cap = cwd => { const buf = { out: '', err: '' }; return { buf, ctx: { cwd, stdout: { write: s => buf.out += s }, stderr: { write: s => buf.err += s } } } }
function hook(name, w, input, env = {}) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [`scripts/hooks/${name}.mjs`], { env: { ...process.env, FF_CARD_ID: '123', FF_RUN_ID: 'run-1', CLAUDE_PLUGIN_ROOT: w.workflow?.path, CLAUDE_ENV_FILE: path.join(w.root, '.ff/claude-env'), ...env } })
    let out = '', err = ''; p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b)
    p.on('close', status => resolve({ status, out, err })); p.stdin.end(JSON.stringify({ cwd: w.root, session_id: SESSION, ...input }))
  })
}
async function bound(t, ctxFor = CTX) {
  const w = makeHarnessFixture(t)
  const pkg = path.join(w.root, 'fixture-plugin'); workflowPackage(pkg)
  w.workflow = prepareWorkflowSnapshot({ root: w.root, packageRoot: pkg, cliVersion: '0.1.0' })
  w.seedTask(w.task({ ...scope, claudeSessionId: SESSION, workflow: w.workflow, pendingDispatch: { ...scope, stage: 'understand' } }))
  w.writeArtifact('trellocards/123-harness/01-dossier.md', '# Thẻ 123\nGiữ bộ lọc\n')
  w.writeArtifact('trellocards/123-harness/01b-ledger.md', '| Mã | Trích | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Giữ bộ lọc | Mô tả | |\n')
  w.writeArtifact('trellocards/123-harness/brief.md', 'Giữ bộ lọc | D-01\n')
  assert.equal((await hook('session-start', w, {})).status, 0)
  await present(w, [decision(ctxFor ? { decisionContext: ctxFor } : {})])
  return w
}
async function present(w, decisions) {
  const rel = 'trellocards/123-harness/human-output.json'
  w.writeArtifact(rel, JSON.stringify(packet(decisions)))
  const c = cap(w.root); assert.equal(await main(['present', '123', '--file', rel], c.ctx), 0, c.buf.err); return c
}
const ask = (id, header, question, answer, labels = ['Có', 'Không']) => {
  const qs = [{ header, question, options: labels.map(label => ({ label, description: 'mô tả khác hẳn packet' })) }]
  return { tool_use_id: id, tool_input: { questions: qs }, ...(answer ? { tool_response: { answers: { [question]: answer } } } : {}) }
}
const Q = '[#123] Giữ khi reload?'
const lastDecision = w => readDecisions(w.root).filter(d => d.provenance?.source === 'cli').at(-1)
const decideArgs = ['decide', '123', '--class', 'default-value', '--decision-key', 'reload', '--repo', 'web', '--question', 'Giữ khi reload?', '--options', 'Có|Không']
async function decideNow(w) { const c = cap(w.root); assert.equal(await main(decideArgs, c.ctx), 0, c.buf.err); return JSON.parse(c.buf.out) }
async function seedShadow(root, cls, repo, results) {
  for (const [i, match] of results.entries()) await appendKnowledgeEvent(root, { type: 'shadow_result', eventId: `seed:${cls}:${repo}:${i}:${Math.random()}`, class: cls, repo, match })
}

// ---- KNW-04 ----
test('KNW-04: Q answer is captured with class/decisionKey/repo/scope/value/hash even when option descriptions differ', async t => {
  const w = await bound(t)
  const i = ask('t1', 'Q1', Q, 'Có')
  const pre = await hook('ask-pre', w, ask('t1', 'Q1', Q))
  assert.equal(pre.status, 0, pre.err)
  assert.doesNotMatch(pre.out, /thiếu class\/decisionKey/)
  assert.equal((await hook('ask-post', w, i)).status, 0)
  const d = lastDecision(w)
  assert.deepEqual([d.class, d.decisionKey, d.repo, d.businessScope, d.normalizedValue, d.cardId, d.revision, d.scopeStatus], ['default-value', 'reload', 'web', 'filters', 'persist', '123', '', 'scoped'])
  assert.equal(d.questionHash, questionHash('Giữ khi reload?'))
  assert.equal(d.provenance.actor, 'human'); assert.equal(d.provenance.source, 'cli')
  assert.ok(d.project && d.policyVersion && d.answeredAt)
})
test('KNW-04: Q without decisionContext warns the agent via additionalContext and is recorded as unscoped', async t => {
  const w = await bound(t, null)
  const pre = await hook('ask-pre', w, ask('t2', 'Q1', Q))
  assert.equal(pre.status, 0, pre.err)
  const ctx = JSON.parse(pre.out.trim().split('\n').at(-1)).hookSpecificOutput.additionalContext
  assert.match(ctx, /Q1 thiếu class\/decisionKey/); assert.match(ctx, /unscoped/)
  assert.equal((await hook('ask-post', w, ask('t2', 'Q1', Q, 'Có'))).status, 0)
  const d = lastDecision(w)
  assert.equal(d.scopeStatus, 'unscoped'); assert.equal(d.class, undefined); assert.equal(d.normalizedValue, 'có'); assert.equal(d.answer, 'Có')
  // câu hỏi tự soạn, lệch câu chữ so với packet cũng unscoped
  const pre2 = await hook('ask-pre', w, ask('t3', 'Q1', '[#123] Câu khác hẳn?'))
  assert.match(pre2.out, /thiếu class\/decisionKey/)
})
test('KNW-04: soft Q with context but no ff decide yet warns about the missing shadow prediction', async t => {
  const w = await bound(t)
  const pre = await hook('ask-pre', w, ask('t4', 'Q1', Q))
  assert.match(pre.out, /chưa chạy ff decide/)
  await decideNow(w)
  const pre2 = await hook('ask-pre', w, ask('t5', 'Q1', Q))
  assert.doesNotMatch(pre2.out, /chưa chạy ff decide/)
})
test('KNW-04: Gate answers are recorded with class gate and decisionKey = gate header', async t => {
  const w = await bound(t)
  w.writeArtifact('trellocards/123-harness/brief.md', '| # | Mục | Nguồn |\n|---|---|---|\n| 1 | Giữ bộ lọc | D-01 |\n')
  const gq = '[#123] Duyệt Brief?'
  const g = (answer) => ({ tool_use_id: 'g1', tool_input: { questions: [{ header: 'GATE_A', question: gq, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }] }] }, ...(answer ? { tool_response: { answers: { [gq]: answer } } } : {}) })
  assert.equal((await hook('ask-pre', w, g())).status, 0)
  await hook('ask-post', w, g('Cần sửa'))
  const d = lastDecision(w)
  assert.deepEqual([d.class, d.decisionKey, d.scopeStatus, d.normalizedValue], ['gate', 'GATE_A', 'gate', 'cần sửa'])
})
test('ff present flags decisions without decisionContext and rejects unknown classes', async t => {
  const w = await bound(t)
  const c = await present(w, [decision()])
  assert.match(c.buf.err, /Q1 thiếu decisionContext/)
  w.writeArtifact('trellocards/123-harness/human-output.json', JSON.stringify(packet([decision({ decisionContext: { ...CTX, class: 'typo' } })])))
  const r = cap(w.root); assert.equal(await main(['present', '123', '--file', 'trellocards/123-harness/human-output.json'], r.ctx), 2); assert.match(r.buf.err, /class không hợp lệ/)
})
test('old records without class/decisionKey stay readable and never become precedents', async t => {
  const w = await bound(t)
  const { appendDecision } = await import('../scripts/lib/knowledge.mjs')
  for (let i = 0; i < 3; i++) await appendDecision(w.root, { decisionId: `old${i}`, cardId: '123', normalizedValue: 'persist', provenance: { source: 'cli', originId: `o${i}` } })
  const r = await decideNow(w)
  assert.equal(r.verdict, 'escalate'); assert.equal(r.prediction, null)
})

// ---- KNW-10 unit ----
test('shadowStats: abstain outside window, trusted at 9/10, mismatch on trusted resets, untrusted mismatch is just a miss', () => {
  const ev = (match, cls = 'naming', repo = 'r') => ({ type: 'shadow_result', class: cls, repo, match })
  let s = shadowStats([ev(null), ...Array(10).fill(0).map(() => ev(true))]).get('naming', 'r')
  assert.equal(s.abstains, 1); assert.equal(s.trusted, true); assert.equal(s.windowSize, 10)
  s = shadowStats([...Array(9).fill(0).map(() => ev(true))]).get('naming', 'r'); assert.equal(s.trusted, false)
  s = shadowStats([ev(false), ...Array(9).fill(0).map(() => ev(true))]).get('naming', 'r'); assert.equal(s.trusted, true, '9/10 đủ ngưỡng')
  s = shadowStats([ev(false), ev(false), ...Array(8).fill(0).map(() => ev(true))]).get('naming', 'r'); assert.equal(s.trusted, false, '8/10 chưa đủ')
})
test('shadowStats: reset on mismatch while trusted, per class+repo isolation, configurable window', () => {
  const ev = (match, cls = 'naming', repo = 'r') => ({ type: 'shadow_result', class: cls, repo, match })
  const trusted = Array(10).fill(0).map(() => ev(true))
  let st = shadowStats([...trusted, ev(false)])
  assert.equal(st.get('naming', 'r').trusted, false); assert.equal(st.get('naming', 'r').resets, 1); assert.equal(st.get('naming', 'r').windowSize, 0)
  st = shadowStats([...trusted, ev(false), ...Array(9).fill(0).map(() => ev(true))]); assert.equal(st.get('naming', 'r').trusted, false, 'sau reset phải đủ 10 lần mới')
  st = shadowStats([...trusted, ev(false), ...Array(10).fill(0).map(() => ev(true))]); assert.equal(st.get('naming', 'r').trusted, true)
  st = shadowStats(trusted); assert.equal(st.get('naming', 'other').trusted, false); assert.equal(st.get('copy-text', 'r').trusted, false)
  st = shadowStats([ev(true), ev(true)], { shadow_window: 2, shadow_min_match: 2 }); assert.equal(st.get('naming', 'r').trusted, true)
  st = shadowStats([...trusted, { type: 'shadow_reset', class: 'naming', repo: 'r' }]); assert.equal(st.get('naming', 'r').trusted, false)
})

// ---- KNW-10 decide ----
async function seedPrecedents(w, n, value = 'persist') {
  const { appendDecision } = await import('../scripts/lib/knowledge.mjs')
  const prepared = JSON.parse(fs.readFileSync(path.join(w.root, '.ff/presentations/123.understand.root.json')))
  for (let i = 0; i < n; i++) await appendDecision(w.root, { decisionId: `p${i}${value}`, ...CTX, project: prepared.project, policyVersion: prepared.policyVersion, normalizedValue: value, provenance: { source: 'cli', originId: `origin${i}${value}` } })
}
test('decide: precedents alone are not enough; untrusted class escalates with a recorded prediction, trusted class proceeds', async t => {
  const w = await bound(t); await seedPrecedents(w, 3)
  let r = await decideNow(w)
  assert.equal(r.verdict, 'escalate'); assert.equal(r.prediction, 'persist'); assert.equal(r.default, null); assert.match(r.reason, /Chế độ bóng/); assert.equal(r.shadow.trusted, false)
  const pred = readKnowledgeEvents(w.root, { type: 'shadow_prediction' }).at(-1)
  assert.deepEqual([pred.class, pred.repo, pred.decisionKey, pred.predicted, pred.auto], ['default-value', 'web', 'reload', 'persist', false])
  await seedShadow(w.root, 'default-value', 'web', Array(10).fill(true))
  r = await decideNow(w)
  assert.equal(r.verdict, 'proceed'); assert.equal(r.default, 'persist'); assert.equal(readKnowledgeEvents(w.root, { type: 'shadow_prediction' }).at(-1).auto, true)
  await seedShadow(w.root, 'default-value', 'other-repo', Array(10).fill(true))
  const rows = readDecisions(w.root); assert.equal(rows.at(-1).provenance.source, 'agent')
})
test('decide: trusted class still needs precedent rules (min origins, conflicts) and never auto-decides hard/risk/gates', async t => {
  const w = await bound(t); await seedShadow(w.root, 'default-value', 'web', Array(10).fill(true))
  await seedPrecedents(w, 2); assert.equal((await decideNow(w)).verdict, 'escalate')
  await seedPrecedents(w, 3); assert.equal((await decideNow(w)).verdict, 'proceed')
  await seedPrecedents(w, 1, 'page-only'); const r = await decideNow(w); assert.equal(r.verdict, 'escalate'); assert.match(r.reason, /Conflicting/)
  // lớp cứng / từ khóa rủi ro / gate: kể cả đã "trusted"
  await seedShadow(w.root, 'migration', 'web', Array(10).fill(true))
  const gate = cap(w.root); assert.equal(await main(['decide', '--gate', 'GATE_A', '123'], gate.ctx), 0); assert.equal(JSON.parse(gate.buf.out).verdict, 'escalate')
})
test('decide --contradict returns a trusted class to shadow; --stats reports accuracy per class and repo', async t => {
  const w = await bound(t); await seedPrecedents(w, 3); await seedShadow(w.root, 'default-value', 'web', Array(10).fill(true))
  assert.equal((await decideNow(w)).verdict, 'proceed')
  const c = cap(w.root); assert.equal(await main(['decide', '--contradict', '123', '--class', 'default-value', '--repo', 'web', '--reason', 'người sửa ở Gate'], c.ctx), 0, c.buf.err)
  const r = await decideNow(w); assert.equal(r.verdict, 'escalate'); assert.match(r.reason, /Chế độ bóng/)
  const s = cap(w.root); assert.equal(await main(['decide', '--stats'], s.ctx), 0)
  const rep = JSON.parse(s.buf.out), row = rep.classes.find(x => x.class === 'default-value' && x.repo === 'web')
  assert.deepEqual([rep.window, rep.minMatch, row.matches, row.resets, row.trusted, row.accuracy], [10, 9, 10, 1, false, 1])
  const f = cap(w.root); assert.equal(await main(['decide', '--stats', '--class', 'naming'], f.ctx), 0); assert.deepEqual(JSON.parse(f.buf.out).classes, [])
})

// ---- end-to-end ----
test('E2E: 3 human answers -> shadow predictions -> after enough matches decide proceeds; a contradiction resets', async t => {
  const w = await bound(t)
  const answer = async (n, value) => {
    const r = await decideNow(w)               // agent consults ff decide in shadow first
    const id = `e2e${n}`
    assert.equal((await hook('ask-pre', w, ask(id, 'Q1', Q))).status, 0)
    assert.equal((await hook('ask-post', w, ask(id, 'Q1', Q, value))).status, 0)
    return r
  }
  const out = []
  for (let n = 0; n < 3; n++) out.push(await answer(n, 'Có'))
  assert.deepEqual(out.map(r => r.prediction), [null, 'persist', 'persist'])
  assert.ok(out.every(r => r.verdict === 'escalate'))
  for (let n = 3; n < 11; n++) { const r = await answer(n, 'Có'); assert.equal(r.verdict, 'escalate', `lượt ${n} chưa đủ 10 lần dự đoán`); assert.equal(r.prediction, 'persist') }
  const results = readKnowledgeEvents(w.root, { type: 'shadow_result' })
  assert.deepEqual([results.length, results.filter(r => r.match === true).length, results.filter(r => r.match === null).length], [11, 10, 1])
  const trusted = await decideNow(w)
  assert.equal(trusted.verdict, 'proceed'); assert.equal(trusted.default, 'persist'); assert.equal(trusted.shadow.trusted, true)
  // người trả lời ngược một dự đoán đã tin -> về bóng
  assert.equal((await hook('ask-pre', w, ask('e2e-x', 'Q1', Q))).status, 0)
  assert.equal((await hook('ask-post', w, ask('e2e-x', 'Q1', Q, 'Không'))).status, 0)
  const last = readKnowledgeEvents(w.root, { type: 'shadow_result' }).at(-1)
  assert.deepEqual([last.predicted, last.actual, last.match, last.auto], ['persist', 'page-only', false, true])
  const after = await decideNow(w)
  assert.equal(after.verdict, 'escalate'); assert.equal(after.shadow.trusted, false)
  const c = cap(w.root); await main(['decide', '--stats'], c.ctx)
  const row = JSON.parse(c.buf.out).classes[0]
  assert.deepEqual([row.class, row.repo, row.mismatches, row.resets, row.trusted], ['default-value', 'web', 1, 1, false])
})

// ---- KNW-05 ----
test('outcome_recorded is durable and idempotent; invalid outcome rejected', async t => {
  const w = makeHarnessFixture(t)
  await recordOutcome(w.root, { cardId: '123', revision: '', outcome: 'qa_pass', source: 'acceptance', key: 'k1' })
  await recordOutcome(w.root, { cardId: '123', revision: '', outcome: 'qa_pass', source: 'acceptance', key: 'k1' })
  await recordOutcome(w.root, { cardId: '123', revision: '', outcome: 'merged', source: 'base_branch_landed' })
  const ev = readKnowledgeEvents(w.root, { type: 'outcome_recorded' })
  assert.deepEqual(ev.map(e => e.outcome), ['qa_pass', 'merged'])
  await assert.rejects(recordOutcome(w.root, { cardId: '123', outcome: 'ok', source: 'x' }), /outcome/)
})
test('ff reopen records a reopen outcome', async t => {
  const w = makeWorkspace({ files: { 'trellocards/123-f/01-dossier.md': '# D\n' } }); t.after(w.cleanup)
  const c = cap(w.root); assert.equal(await main(['reopen', '123', '--reason', 'Lỗi QA'], c.ctx), 0, c.buf.err)
  const ev = readKnowledgeEvents(w.root, { type: 'outcome_recorded' })
  assert.deepEqual([ev[0].outcome, ev[0].revision, ev[0].source, ev[0].detail], ['reopen', 'rev-1', 'manual', 'Lỗi QA'])
})
test('escape: ff escape needs a reopened revision; proposal becomes escape_recorded only when the human approves Gate A of that revision', async t => {
  const w = makeWorkspace({ files: { 'trellocards/123-f/01-dossier.md': '# D\n' } }); t.after(w.cleanup)
  let c = cap(w.root); assert.equal(await main(['escape', '123', '--route', 'B', '--skill', 'ff-understand', '--evidence', 'AC-02 thiếu'], c.ctx), 1); assert.match(c.buf.err, /chưa reopen/)
  assert.equal(await main(['reopen', '123', '--reason', 'Lỗi QA'], cap(w.root).ctx), 0)
  for (const bad of [['--route', 'E', '--skill', 'ff-build', '--evidence', 'x'], ['--route', 'A', '--skill', 'ff-build']]) { c = cap(w.root); assert.equal(await main(['escape', '123', ...bad], c.ctx), 1) }
  c = cap(w.root); assert.equal(await main(['escape', '123', '--route', 'B', '--skill', 'ff-understand', '--evidence', 'AC-02 thiếu: spec không phủ'], c.ctx), 0, c.buf.err)
  assert.equal(readKnowledgeEvents(w.root, { type: 'escape_proposed' }).length, 1)
  assert.equal(readKnowledgeEvents(w.root, { type: 'escape_recorded' }).length, 0, 'agent tự đề xuất chưa phải sự thật')
  const gq = '[#123] [rev-1] Duyệt delta?', g = (id, answer) => ({ tool_use_id: id, tool_input: { questions: [{ header: 'GATE_A', question: gq, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }] }] }, tool_response: { answers: { [gq]: answer } } })
  await hook('ask-post', w, g('ga1', 'Cần sửa'), { FF_CARD_ID: '', FF_RUN_ID: '' })
  assert.equal(readKnowledgeEvents(w.root, { type: 'escape_recorded' }).length, 0, 'Cần sửa không xác nhận')
  const r = await hook('ask-post', w, g('ga2', 'Duyệt'), { FF_CARD_ID: '', FF_RUN_ID: '' }); assert.equal(r.status, 0, r.err)
  const rec = readKnowledgeEvents(w.root, { type: 'escape_recorded' })
  assert.equal(rec.length, 1)
  assert.deepEqual([rec[0].route, rec[0].skill, rec[0].revision, rec[0].escapedRevision, rec[0].confirmedBy, rec[0].confirmedAt], ['B', 'ff-understand', 'rev-1', '', 'human', 'gate_a'])
  assert.match(rec[0].evidence, /AC-02/); assert.ok(rec[0].gateDecisionId)
  await hook('ask-post', w, g('ga3', 'Duyệt'), { FF_CARD_ID: '', FF_RUN_ID: '' })
  assert.equal(readKnowledgeEvents(w.root, { type: 'escape_recorded' }).length, 1, 'idempotent')
})
test('confirmEscapes ignores proposals for another revision', async t => {
  const w = makeHarnessFixture(t)
  await proposeEscape(w.root, { cardId: '123', revision: 'rev-2', escapedRevision: 'rev-1', route: 'C', skill: 'ff-build', evidence: 'x' })
  assert.deepEqual(await confirmEscapes(w.root, { cardId: '123', revision: 'rev-1', gateDecisionId: 'd' }), [])
  assert.equal((await confirmEscapes(w.root, { cardId: '123', revision: 'rev-2', gateDecisionId: 'd' })).length, 1)
})

// ---- skill/reference text ----
test('skills and references carry the Q recipe: packet decisionContext, shadow ff decide first, auto-decision listed at next Gate, ff escape on reopen', () => {
  const read = f => fs.readFileSync(f, 'utf8')
  for (const f of ['skills/ff-understand/SKILL.md', 'skills/ff-build/SKILL.md', 'skills/ff-verify/SKILL.md']) {
    const s = read(f); assert.match(s, /decisionContext/, f); assert.match(s, /unscoped/, f); assert.match(s, /ff decide/, f); assert.match(s, /Nguồn: decide:/, f)
  }
  assert.match(read('skills/ff-understand/SKILL.md'), /TRƯỚC KHI hỏi/); assert.match(read('skills/ff-understand/SKILL.md'), /Tự quyết/)
  assert.match(read('skills/ff-understand/SKILL.md'), /Bash\(ff escape \*\)/); assert.match(read('skills/ff-understand/references/reopen.md'), /ff escape <id> --route/)
  assert.match(read('references/human-output.md'), /decisionContext.*bắt buộc/s)
  assert.match(read('references/decision-classes.md'), /Chế độ bóng \(KNW-10\)/)
})
