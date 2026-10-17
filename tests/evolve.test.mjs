import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { appendKnowledgeEvent } from '../scripts/lib/knowledge-log.mjs'
import { buildFixture, redactText, evalPair, runVariant, labelFor, listCases, gradeRuns, renderReport, readGrade, evalDirs } from '../scripts/lib/evals.mjs'
import { detectRepeats, decideProposal, validateEdits, proposeEvolution, applyProposal, wikiCandidate, rejectProposal, readProposal, readProposals, evolveJobs } from '../scripts/lib/evolve.mjs'
import { main } from '../scripts/cli/main.mjs'

const GUARD = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url))
const sh = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim() }
const SECRET = 'sk-abcdefghijklmnop1234'
const DOSSIER = `# Thẻ\nLọc đơn hàng.\napi_key=${SECRET}\nBearer abcdef123456\ndb postgres://admin:hunter2@db.local/x\nJWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456\n`
const LEDGER = '| Mã | Trích |\n|---|---|\n| D-01 | Lọc |\n| U-01 | Giữ bộ lọc khi tải lại: Có |\n'

async function seed(t, { cards = ['501', '502'], skill = 'ff-understand', route = 'B', config = baseConfig() } = {}) {
  const ws = makeWorkspace({ config, files: { '.ff.env': 'TOKEN=topsecretvalue\n' } })
  t.after(ws.cleanup)
  const repo = path.join(ws.root, 'web')
  const base = sh(repo, 'rev-parse', 'HEAD')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n'); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'feat')
  const feature = sh(repo, 'rev-parse', 'HEAD')
  for (const c of cards) {
    const d = path.join(ws.root, 'trellocards', `${c}-loc`)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, '01-dossier.md'), DOSSIER)
    fs.writeFileSync(path.join(d, '01b-ledger.md'), LEDGER)
    fs.mkdirSync(path.join(ws.root, `.ff/ship-test/${c}`), { recursive: true })
    fs.writeFileSync(path.join(ws.root, `.ff/ship-test/${c}/root.json`), JSON.stringify({ version: 1, cardId: c, revision: '', repos: { web: { featureSha: feature, baseSha: base, testSha: feature } } }))
    fs.mkdirSync(path.join(ws.root, '.ff/gates'), { recursive: true })
    fs.writeFileSync(path.join(ws.root, `.ff/gates/${c}-rev-1-GATE_C.json`), JSON.stringify({ cardId: c, gate: 'GATE_C', scope: 'rev-1', approved: false, answer: 'Cần sửa: thiếu lọc theo ngày', at: '2026-10-20T00:00:00Z' }))
    await appendKnowledgeEvent(ws.root, { type: 'escape_recorded', eventId: `e${c}`, proposalId: `p${c}`, cardId: c, revision: 'rev-1', escapedRevision: '', route, skill, evidence: `Brief bỏ sót luật lọc ngày (thẻ ${c})`, confirmedBy: 'human', at: '2026-10-20T00:00:00Z' })
  }
  return { ...ws, repo, base, feature, config }
}
const fakePlugin = (t, { git = false } = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-plug-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  fs.mkdirSync(path.join(d, '.claude-plugin'), { recursive: true }); fs.writeFileSync(path.join(d, '.claude-plugin/plugin.json'), '{"name":"ff-kit"}\n')
  fs.mkdirSync(path.join(d, 'skills/ff-understand'), { recursive: true }); fs.writeFileSync(path.join(d, 'skills/ff-understand/SKILL.md'), '# Hiểu\nHỏi người khi thiếu luật.\nKết thúc.\n')
  fs.mkdirSync(path.join(d, 'references'), { recursive: true }); fs.writeFileSync(path.join(d, 'references/x.md'), 'ref\n')
  if (git) { sh(d, 'init', '-q', '-b', 'main'); sh(d, 'add', '.'); sh(d, 'commit', '-qm', 'init') }
  return d
}
const okRunner = async ({ cwd, caseId }) => {
  const card = fs.readdirSync(path.join(cwd, 'cards'))[0]
  fs.writeFileSync(path.join(cwd, 'cards', card, 'questions.md'), `hỏi ${path.basename(cwd).length > 0 ? caseId : ''}`)
  return { transcript: JSON.stringify({ type: 'result', result: 'xong' }) + '\n', stderr: '', exitCode: 0 }
}

test('detector: ngưỡng min_cards, cooldown, ngả khác nhau không gộp', async t => {
  const w = await seed(t)
  await appendKnowledgeEvent(w.root, { type: 'escape_recorded', eventId: 'x1', cardId: '600', revision: 'rev-1', route: 'A', skill: 'ff-kit:ff-understand', evidence: 'e', confirmedBy: 'human' })
  const now = new Date('2026-10-23T00:00:00Z')
  let d = detectRepeats(w.root, w.config, { now })
  assert.deepEqual(d.candidates.map(c => [c.skill, c.route, c.cards]), [['ff-understand', 'B', ['501', '502']]])
  assert.match(d.skipped.find(s => s.route === 'A').reason, /1\/2/)
  assert.equal(d.candidates[0].context.gateFixes.length, 2)
  // cùng thẻ lặp không tính thêm
  await appendKnowledgeEvent(w.root, { type: 'escape_recorded', eventId: 'x2', cardId: '600', revision: 'rev-2', route: 'A', skill: 'ff-understand', evidence: 'e2', confirmedBy: 'human' })
  assert.equal(detectRepeats(w.root, w.config, { now }).candidates.length, 1)
  // config min_cards=3 → chưa đủ
  assert.equal(detectRepeats(w.root, { ...w.config, evolve: { min_cards: 3 } }, { now }).candidates.length, 0)
  // cooldown: đã có đề xuất 3 ngày trước → chặn; 8 ngày trước → qua
  const mk = (id, at) => { fs.mkdirSync(path.join(w.root, '.ff/evolve', id), { recursive: true }); fs.writeFileSync(path.join(w.root, '.ff/evolve', id, 'status.json'), JSON.stringify({ id, skill: 'ff-understand', route: 'B', cards: ['700'], createdAt: at })) }
  mk('p1', '2026-10-20T00:00:00Z')
  d = detectRepeats(w.root, w.config, { now })
  assert.equal(d.candidates.length, 0); assert.match(d.skipped.find(s => s.route === 'B').reason, /p1/)
  fs.rmSync(path.join(w.root, '.ff/evolve/p1'), { recursive: true }); mk('p2', '2026-10-10T00:00:00Z')
  assert.equal(detectRepeats(w.root, w.config, { now }).candidates.length, 1)
  assert.equal(evolveJobs(w.root, w.config, { now }).length, 1)
})

test('fixture: dossier lọc secret, sha, đáp án từ phiếu + U-xx + Gate; không đọc .ff.env; từ chối thẻ chưa có phiếu', async t => {
  const w = await seed(t, { cards: ['501'] })
  assert.throws(() => buildFixture(w.root, w.config, { cardId: '999' }), /escape_recorded/)
  const f = buildFixture(w.root, w.config, { cardId: '501' })
  const dir = f.dir
  assert.equal(f.suite, 'ff-understand'); assert.equal(f.case, '501-rev-1')
  const all = fs.readdirSync(dir).map(n => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n')
  for (const s of [SECRET, 'hunter2', 'abcdef123456', 'eyJhbGci', 'topsecretvalue']) assert.ok(!all.includes(s), s)
  assert.match(fs.readFileSync(path.join(dir, 'expected.md'), 'utf8'), /Brief bỏ sót luật lọc ngày[\s\S]*U-01[\s\S]*thiếu lọc theo ngày/)
  assert.match(fs.readFileSync(path.join(dir, 'git-facts.md'), 'utf8'), new RegExp(w.base) )
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'))
  assert.equal(c.repos[0].baseSha, w.base); assert.equal(c.repos[0].featureSha, w.feature); assert.equal(c.phase, 'understand')
  assert.ok(fs.existsSync(path.join(evalDirs(w.root).fixtures, 'README.md')))
  assert.match(fs.readFileSync(path.join(evalDirs(w.root).fixtures, 'ff-understand/expected.md'), 'utf8'), /\| 501-rev-1 \|/)
  buildFixture(w.root, w.config, { cardId: '501' }) // idempotent: không nhân đôi dòng
  assert.equal(fs.readFileSync(path.join(evalDirs(w.root).fixtures, 'ff-understand/expected.md'), 'utf8').match(/\| 501-rev-1 \|/g).length, 1)
  assert.equal(redactText('Bearer abc.def'), 'Bearer [REDACTED]')
})

test('labelFor và quy tắc quyết định', () => {
  assert.equal(labelFor([0], [1]), 'sửa được'); assert.equal(labelFor([1], [1]), 'không đổi'); assert.equal(labelFor([1], [0]), 'tệ đi')
  assert.equal(labelFor([0, 1], [1, 1]), 'nhiễu'); assert.equal(labelFor([0, 0], [1, 1]), 'sửa được'); assert.equal(labelFor([0, null], [1, 1]), 'nhiễu')
  const g = labels => ({ cases: labels.map((label, i) => ({ case: 'c' + i, label })) })
  assert.equal(decideProposal(g(['sửa được', 'không đổi'])).decision, 'đề xuất')
  assert.equal(decideProposal(g(['sửa được', 'tệ đi'])).decision, 'giữ nguyên')
  assert.equal(decideProposal(g(['không đổi', 'nhiễu'])).decision, 'giữ nguyên')
  assert.equal(decideProposal(g(['nhiễu'])).decision, 'giữ nguyên')
  const none = decideProposal({ cases: [] }); assert.equal(none.decision, 'giữ nguyên'); assert.match(none.reasons[0], /thiếu/)
})

test('runner: dựng workspace tại sha, trần ngân sách, dừng sớm khi tệ đi, grader mù', async t => {
  const w = await seed(t, { cards: ['501', '502', '503'], config: { ...baseConfig(), evolve: { max_cases: 2, repeat: 2 } } })
  for (const c of ['501', '502', '503']) buildFixture(w.root, w.config, { cardId: c })
  const A = fakePlugin(t), B = fakePlugin(t)
  const seen = []
  const runner = async a => { seen.push(a); assert.equal(sh(path.join(a.cwd, 'web'), 'rev-parse', 'HEAD'), w.base); assert.ok(fs.existsSync(path.join(a.cwd, 'cards', '501-eval', '01-dossier.md')) || fs.existsSync(path.join(a.cwd, 'cards'))); assert.ok(!fs.existsSync(path.join(a.cwd, '.ff.env'))); return okRunner(a) }
  // run đơn: trần 2 ca × 2 lần = 4 lần chạy; --repeat 9 bị kẹp về 2
  const m = await runVariant(w.root, w.config, { suite: 'ff-understand', variant: B, repeat: 9, runner })
  assert.equal(seen.length, 4); assert.deepEqual(m.dropped, ['503-rev-1']); assert.equal(m.repeat, 2)
  assert.ok(fs.existsSync(path.join(evalDirs(w.root).runs, m.runId, '501-rev-1/rep-1/transcript.jsonl')))
  assert.ok(fs.existsSync(path.join(evalDirs(w.root).runs, m.runId, '501-rev-1/rep-2/artifacts/questions.md')))
  // worktree tạm đã dọn
  assert.ok(!sh(w.repo, 'worktree', 'list').includes('ff-eval-'))
  // cặp: ca đầu sửa được, ca hai tệ đi → ca ba (nếu có trần) không chạy
  const prompts = []
  const grader = async ({ prompt, caseName }) => {
    prompts.push(prompt)
    const bad = caseName === '502-rev-1'
    // X/Y ẩn danh: chọn theo nội dung "B" bằng cách đọc marker trong kết quả
    const verd = {}
    for (const id of [...prompt.matchAll(/=== ([XY]\d) ===([\s\S]*?)(?==== |$)/g)]) verd[id[1]] = { grade: /bản-vá/.test(id[2]) === !bad ? 'đạt' : 'trượt', evidence: [`${id[1]} thấy`] }
    return JSON.stringify({ verdicts: verd })
  }
  const pairRunner = async a => { const r = await okRunner(a); const card = path.join(a.cwd, 'cards', fs.readdirSync(path.join(a.cwd, 'cards'))[0]); if (a.variantDir === B) fs.writeFileSync(path.join(card, 'out.md'), 'bản-vá ' + a.caseId); else fs.writeFileSync(path.join(card, 'out.md'), 'cũ'); return r }
  // ca 502: B có marker nhưng bad → đảo: grader cho B trượt
  const [res] = await evalPair(w.root, w.config, { suite: 'ff-understand', baseline: { dir: A }, variants: [{ key: 'skill', dir: B }], runner: pairRunner, grader, random: () => 0.7 })
  const labels = res.grade.cases.map(c => [c.case, c.label])
  assert.deepEqual(labels, [['501-rev-1', 'sửa được'], ['502-rev-1', 'tệ đi']])
  assert.equal(res.grade.stoppedEarly, true)
  assert.match(renderReport(res.grade), /tệ đi/)
  assert.equal(readGrade(w.root, res.grade.pairId).cases.length, 2)
  // mù: prompt không lộ đường dẫn plugin/tên bản vá; ánh xạ chỉ nằm trong kết quả
  for (const p of prompts) { assert.ok(!p.includes(A) && !p.includes(B)); assert.ok(!/skill-variant|baseline|bản vá|\bpatch\b/i.test(p.replace('bản-vá', ''))) }
  assert.ok(res.grade.cases.every(c => c.blind && ['A', 'B'].includes(c.blind.X)))
})

test('grader: thứ tự A/B ngẫu nhiên theo từng ca và nhãn đúng với cả hai thứ tự', async t => {
  const w = await seed(t, { cards: ['501'] })
  buildFixture(w.root, w.config, { cardId: '501' })
  const A = fakePlugin(t), B = fakePlugin(t)
  const runner = async a => { const r = await okRunner(a); const card = path.join(a.cwd, 'cards', fs.readdirSync(path.join(a.cwd, 'cards'))[0]); fs.writeFileSync(path.join(card, 'out.md'), a.variantDir === B ? 'GOOD' : 'BAD'); return r }
  const grader = async ({ prompt }) => ({ verdicts: Object.fromEntries([...prompt.matchAll(/=== ([XY]\d) ===([\s\S]*?)(?==== |$)/g)].map(m => [m[1], { grade: /GOOD/.test(m[2]) ? 'đạt' : 'trượt', evidence: ['dòng: ' + m[1]] }])) })
  const mapping = new Set()
  for (const r of [0.1, 0.9]) {
    const [res] = await evalPair(w.root, w.config, { suite: 'ff-understand', baseline: { dir: A }, variants: [{ key: 's', dir: B }], runner, grader, random: () => r, repeat: 1 })
    assert.equal(res.grade.cases[0].label, 'sửa được')
    mapping.add(res.grade.cases[0].blind.X)
    assert.match(res.grade.cases[0].evidence.B[0], /^dòng: B1/) // bằng chứng được gỡ ẩn danh
  }
  assert.deepEqual([...mapping].sort(), ['A', 'B'])
  // chấm lại hai run có sẵn
  const m1 = await runVariant(w.root, w.config, { suite: 'ff-understand', variant: A, label: 'a', runner, repeat: 1 })
  const m2 = await runVariant(w.root, w.config, { suite: 'ff-understand', variant: B, label: 'b', runner, repeat: 1 })
  const g = await gradeRuns(w.root, w.config, { runA: m1.runId, runB: m2.runId, grader, random: () => 0.2 })
  assert.equal(g.cases[0].label, 'sửa được')
})

test('validateEdits: chỉ skills/references .md, một file, tên dự án/secret bị chặn', t => {
  const p = fakePlugin(t)
  const good = [{ path: 'skills/ff-understand/SKILL.md', old: 'Kết thúc.', new: 'Kết thúc, kèm luật lọc.' }]
  assert.equal(validateEdits(p, good).ok, true)
  for (const bad of [
    [{ path: 'scripts/x.mjs', old: 'a', new: 'b' }], [{ path: 'skills/../hooks/h.md', old: 'a', new: 'b' }], [{ path: 'skills/ff-understand/SKILL.md', old: 'không có', new: 'b' }],
    [{ path: 'skills/ff-understand/SKILL.md', old: 'Kết thúc.', new: 'xem tiniweb' }], [{ path: 'skills/ff-understand/SKILL.md', old: 'Kết thúc.', new: `key sk-${'a'.repeat(20)}` }],
    [{ path: 'skills/ff-understand/SKILL.md', old: 'Kết thúc.', new: 'x' }, { path: 'references/x.md', old: 'ref', new: 'y' }],
  ]) assert.equal(validateEdits(p, bad).ok, false, JSON.stringify(bad))
  assert.equal(validateEdits(p, good, { projectNames: ['luật lọc'] }).ok, false)
})

const llmFor = edits => async () => JSON.stringify({ explanation: 'Skill không nhắc kiểm luật lọc ngày.', skill_edits: edits, wiki_entry: { domain: 'don-hang', statement: 'Lọc theo ngày giữ nguyên khi tải lại', section: 'Quyết định đã chốt', type: 'người', source: 'U-01 thẻ #501', scope: 'orders' } })
const GOODEDIT = [{ path: 'skills/ff-understand/SKILL.md', old: 'Kết thúc.', new: 'Kết thúc, kèm luật lọc.' }]
async function proposeFlow(t, { labelFor: pick = () => 'đạt', edits = GOODEDIT, git = true } = {}) {
  const w = await seed(t)
  const plugin = fakePlugin(t, { git })
  const runner = async a => { const r = await okRunner(a); const card = path.join(a.cwd, 'cards', fs.readdirSync(path.join(a.cwd, 'cards'))[0]); fs.writeFileSync(path.join(card, 'out.md'), a.variantDir === plugin && !fs.existsSync(path.join(a.cwd, 'ff-wiki')) ? 'BASE' : 'NEW'); return r }
  const grader = async ({ prompt }) => ({ verdicts: Object.fromEntries([...prompt.matchAll(/=== ([XY]\d) ===([\s\S]*?)(?==== |$)/g)].map(m => [m[1], { grade: /NEW/.test(m[2]) ? 'đạt' : 'trượt', evidence: ['e'] }])) })
  const notes = []
  const s = await proposeEvolution(w.root, w.config, { skill: 'ff-understand', route: 'B' }, { llm: llmFor(edits), runner, grader, notify: async (root, ev) => notes.push(ev), pluginDir: plugin, random: () => 0.3, now: new Date('2026-10-23T00:00:00Z'), id: 'ff-understand-B-1' })
  return { w, plugin, s, notes }
}

test('propose: bó đủ nội dung, quyết định đề xuất, thông báo, không áp dụng gì', async t => {
  const { w, plugin, s, notes } = await proposeFlow(t)
  assert.equal(s.status, 'proposed'); assert.equal(s.decision, 'đề xuất'); assert.deepEqual(s.proposedCandidates.sort(), ['skill', 'wiki'])
  const dir = path.join(w.root, '.ff/evolve', s.id)
  for (const f of ['status.json', 'skill.diff', 'wiki-proposal.json', 'pair-table.md', 'evidence.md', 'experience-draft.md', 'explanation.md']) assert.ok(fs.existsSync(path.join(dir, f)), f)
  assert.ok(!fs.existsSync(path.join(dir, 'work')))
  assert.match(fs.readFileSync(path.join(dir, 'skill.diff'), 'utf8'), /^diff --git a\/skills\/ff-understand\/SKILL.md b\/skills\/ff-understand\/SKILL.md/)
  assert.match(fs.readFileSync(path.join(dir, 'pair-table.md'), 'utf8'), /sửa được/)
  assert.match(fs.readFileSync(path.join(dir, 'experience-draft.md'), 'utf8'), /Tình huống[\s\S]*Bài học[\s\S]*thẻ #501[\s\S]*Phạm vi[\s\S]*Kết quả eval/)
  const wp = JSON.parse(fs.readFileSync(path.join(dir, 'wiki-proposal.json'), 'utf8'))
  assert.deepEqual([wp.version, wp.job, wp.pages[0].domain, wp.pages[0].ops[0].op, wp.pages[0].ops[0].type, wp.pages[0].ops[0].source], [1, 'evolve', 'don-hang', 'add', 'người', 'U-01 thẻ #501'])
  assert.ok(!fs.existsSync(path.join(w.root, 'ff-wiki')), 'overlay không được ghi vào wiki thật')
  assert.match(s.pinnedNote, /ghim/)
  assert.equal(notes.length, 1); assert.match(notes[0].title, /đề xuất/)
  assert.equal(fs.readFileSync(path.join(plugin, 'skills/ff-understand/SKILL.md'), 'utf8').includes('luật lọc'), false)
  assert.match(fs.readFileSync(path.join(evalDirs(w.root).fixtures, 'ff-understand/results.md'), 'utf8'), /\| Ca \| A \(hiện tại\)/)
})

test('propose: bản vá sai luật → giữ nguyên kèm lý do; chưa đủ ngưỡng thì từ chối', async t => {
  const { s } = await proposeFlow(t, { edits: [{ path: 'scripts/x.mjs', old: 'a', new: 'b' }] })
  assert.equal(s.candidates.skill.decision, 'giữ nguyên'); assert.match(s.candidates.skill.reasons[0], /không hợp lệ/)
  const w = await seed(t, { cards: ['501'] })
  await assert.rejects(proposeEvolution(w.root, w.config, { skill: 'ff-understand', route: 'B' }, { llm: llmFor([]), pluginDir: fakePlugin(t) }), /chưa đủ điều kiện/)
})

test('apply: từ chối checkout bẩn, áp diff, ghi EXPERIENCE, wiki feature-detect, reject', async t => {
  const { w, plugin, s } = await proposeFlow(t)
  await assert.rejects(applyProposal(w.root, s.id, w.config, {}), /--plugin-repo/)
  fs.writeFileSync(path.join(plugin, 'dirty.txt'), 'x')
  await assert.rejects(applyProposal(w.root, s.id, w.config, { pluginRepo: plugin, applyWiki: async () => ({ applied: false, reason: 'n/a' }) }), /chưa commit/)
  assert.equal(readProposal(w.root, s.id).status, 'proposed')
  fs.rmSync(path.join(plugin, 'dirty.txt'))
  const wikiCalls = []
  const r = await applyProposal(w.root, s.id, w.config, { pluginRepo: plugin, applyWiki: async (root, cfg, file) => { wikiCalls.push(file); return { applied: false, reason: 'wiki chưa có' } } })
  assert.match(fs.readFileSync(path.join(plugin, 'skills/ff-understand/SKILL.md'), 'utf8'), /kèm luật lọc/)
  assert.match(fs.readFileSync(path.join(plugin, 'EXPERIENCE.md'), 'utf8'), /ff-understand/)
  assert.equal(wikiCalls.length, 1); assert.ok(r.notes.some(n => /wiki chưa có/.test(n)))
  assert.equal(readProposal(w.root, s.id).status, 'applied')
  await assert.rejects(applyProposal(w.root, s.id, w.config, { pluginRepo: plugin }), /proposed/)
  assert.throws(() => rejectProposal(w.root, s.id, ''), /--reason/)
  assert.throws(() => rejectProposal(w.root, s.id, 'x'), /đã áp dụng/)
})

test('apply wiki: gọi applyProposal và ghi EXPERIENCE ở workspace; reject đánh dấu', async t => {
  const { w, s } = await proposeFlow(t)
  const r = await applyProposal(w.root, s.id, w.config, { only: 'wiki', applyWiki: async () => ({ applied: true }) })
  assert.deepEqual(r.applied, ['tri thức dự án → wiki']); assert.ok(fs.existsSync(path.join(w.root, 'EXPERIENCE.md')))
  const w2 = await proposeFlow(t)
  rejectProposal(w2.w.root, w2.s.id, 'không cần')
  assert.equal(readProposals(w2.w.root)[0].status, 'rejected')
})

test('CLI: eval fixture, evolve detect/list/show/reject; guard luôn hỏi evolve apply', async t => {
  const w = await seed(t)
  const cap = () => { const b = { out: '', err: '' }; return { b, ctx: { cwd: w.root, stdout: { write: s => b.out += s }, stderr: { write: s => b.err += s } } } }
  let c = cap(); assert.equal(await main(['eval', 'fixture', '501'], c.ctx), 0, c.b.err); assert.match(c.b.out, /ff-understand\/501-rev-1/)
  c = cap(); assert.equal(await main(['evolve', 'detect'], c.ctx), 0); assert.match(c.b.out, /ĐỦ NGƯỠNG/)
  c = cap(); assert.equal(await main(['evolve', 'list'], c.ctx), 0); assert.match(c.b.out, /Chưa có/)
  c = cap(); assert.equal(await main(['evolve', 'reject', 'nope', '--reason', 'x'], c.ctx), 1)
  c = cap(); assert.equal(await main(['evolve', 'propose'], c.ctx), 2)
  assert.equal(listCases(w.root, 'ff-understand').length, 1)
  for (const cmd of ['ff evolve apply abc --plugin-repo /x', 'cd . && ff evolve apply abc']) {
    const r = spawnSync('node', [GUARD, '--cwd', w.root, '--cmd', cmd], { encoding: 'utf8' })
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask', cmd)
  }
  for (const cmd of ['ff evolve apply --help', 'ff evolve list', 'ff evolve show abc', 'ff eval run x --variant y']) {
    const r = spawnSync('node', [GUARD, '--cwd', w.root, '--cmd', cmd], { encoding: 'utf8' })
    assert.equal(r.stdout, '', cmd)
  }
})

test('wiki: ứng viên đúng schema applyProposal, áp thật vào wiki; U-xx không có trong ledger / thiếu nguồn → không có ứng viên', async t => {
  const { w, s } = await proposeFlow(t)
  const r = await applyProposal(w.root, s.id, w.config, { only: 'wiki' }) // applyWiki mặc định = wiki.applyProposal thật
  assert.deepEqual(r.applied, ['tri thức dự án → wiki'])
  const page = fs.readFileSync(path.join(w.root, 'ff-wiki/don-hang.md'), 'utf8')
  assert.match(page, /K-don-hang-1 \| Lọc theo ngày giữ nguyên khi tải lại \| nguồn: U-01 thẻ #501 \| loại: người/)
  const bad = await seed(t)
  for (const w2 of [{ domain: 'x', statement: 's', type: 'người', source: 'U-99 thẻ #501' }, { domain: 'x', statement: 's', type: 'người', source: 'người' }, { domain: 'Bad Name', statement: 's', type: 'người', source: 'U-01 thẻ #501' }, null]) {
    const c = wikiCandidate(bad.root, bad.config, w2, 'id', ['501'])
    assert.equal(c.ok, false, JSON.stringify(w2))
  }
  const ok = wikiCandidate(bad.root, bad.config, { domain: 'x', statement: 's', type: 'người', source: 'U-01 thẻ #501' }, 'id', ['501'])
  assert.ok(ok.ok); assert.deepEqual(Object.keys(ok.overlay), ['ff-wiki/x.md'])
})
