import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorkspace, baseConfig, git } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { main } from '../scripts/cli/main.mjs'
import { decide } from '../scripts/lib/knowledge.mjs'
import { traceCheck } from '../scripts/lib/trace.mjs'
import { parsePage, renderPage, parseEntryLine, renderEntry, readWiki, syncWiki, applyProposal, markStale, recall, undoPage, wikiStatus, knowledgeIds, wikiEntries, cardRecallFiles, fold } from '../scripts/lib/wiki.mjs'

const SRC = ['export function validateEmail(v) {', '  return /@/.test(v)', '}', '', 'export function canDelete(user) {', '  return user.role === "admin"', '}', ''].join('\n')
function setup(t) {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const web = path.join(w.root, 'web')
  fs.mkdirSync(path.join(web, 'src'), { recursive: true })
  fs.writeFileSync(path.join(web, 'src/candidate.ts'), SRC)
  fs.writeFileSync(path.join(web, '.env'), 'TOKEN=abc\n')
  git(web, 'add', '-A'); git(web, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'c1')
  const sha = git(web, 'rev-parse', '--short', 'HEAD')
  const { config } = loadConfig(w.root)
  return { ...w, config, sha, web }
}
const add = (sha, extra = {}) => ({ op: 'add', section: 'Quy tắc', statement: 'Email ứng viên phải hợp lệ', type: 'code', repo: 'web', source: `src/candidate.ts:1-2@${sha}`, anchor: 'validateEmail', ...extra })
const prop = (...ops) => ({ version: 1, job: 'D0', pages: [{ domain: 'candidate', title: 'Ứng viên', ops }] })
const pageFile = w => path.join(w.root, 'ff-wiki/candidate.md')

test('round-trip parse/render and drift tolerance', () => {
  const e = { id: 'K-candidate-1', section: 'Quy tắc', statement: 'Có | dấu gạch: và dấu hai chấm', source: 'src/a.ts:1-2@abc1234', type: 'code', updated: '2026-10-23', repo: 'web', scope: '', decisionKey: '', value: '', anchor: 'foo', locked: true, stale: 'deadbee', review: '' }
  assert.deepEqual(parseEntryLine(renderEntry(e), 'Quy tắc'), e)
  const page = parsePage('# Ứng viên\n\nghi chú đầu\n\n## Quy tắc\ncâu ghi chú\n' + renderEntry(e) + '\n\n## Dữ liệu\n' + renderEntry({ ...e, id: 'K-candidate-2', section: 'Dữ liệu', stale: '', locked: false }) + '\n## Mục lạ\n- K-candidate-3 | x | nguồn: người | loại: người\n', 'candidate')
  assert.equal(page.entries.length, 3)
  const again = parsePage(renderPage(page), 'candidate')
  assert.deepEqual(again.entries, page.entries)
  assert.equal(again.title, 'Ứng viên')
  assert.equal(renderPage(again), renderPage(page))
  // sai lệch: in đậm, khóa không dấu, cờ viết khác, dấu hai chấm sau mã
  const d = parseEntryLine('* **K-candidate-9**: Quy tắc A | Nguon: src/x.ts:3@abcdef1 | Loai: code | khoa nguoi | can kiem lai', 'Quy tắc')
  assert.equal(d.id, 'K-candidate-9'); assert.equal(d.statement, 'Quy tắc A'); assert.equal(d.source, 'src/x.ts:3@abcdef1'); assert.equal(d.type, 'code'); assert.equal(d.locked, true); assert.equal(d.stale, 'có')
  assert.equal(parseEntryLine('- không phải mục'), null)
})

test('apply: good citation adds entry, writes index.md and index.json, ids monotonic', async t => {
  const w = setup(t)
  const r = await applyProposal(w.root, w.config, prop(add(w.sha), add(w.sha, { statement: 'Chỉ admin xóa được', anchor: 'canDelete', source: `src/candidate.ts:5-7@${w.sha}`, section: 'Quyền' })))
  assert.deepEqual(r.added, ['K-candidate-1', 'K-candidate-2']); assert.equal(r.rejected.length, 0)
  assert.match(r.text, /thêm 2 mục/)
  const text = fs.readFileSync(pageFile(w), 'utf8')
  assert.match(text, /## Quyền\n- K-candidate-2 \| Chỉ admin xóa được/)
  assert.match(fs.readFileSync(path.join(w.root, 'ff-wiki/index.md'), 'utf8'), /candidate\.md.*2 mục[\s\S]*src\/candidate\.ts \| candidate \| K-candidate-1/)
  assert.ok(fs.existsSync(path.join(w.root, '.ff/knowledge/index.json')))
  const again = await applyProposal(w.root, w.config, prop(add(w.sha)))
  assert.equal(again.added.length, 0); assert.equal(again.skipped.length, 1)
  // bỏ mục rồi thêm mới: mã không dùng lại
  await applyProposal(w.root, w.config, prop({ op: 'retire', id: 'K-candidate-2', reason: 'gỡ' }))
  const n = await applyProposal(w.root, w.config, prop(add(w.sha, { statement: 'Khác', anchor: 'canDelete', source: `src/candidate.ts:5-7@${w.sha}` })))
  assert.deepEqual(n.added, ['K-candidate-3'])
  assert.deepEqual((await applyProposal(w.root, w.config, prop({ op: 'update', id: 'K-candidate-2', statement: 'x' }))).rejected.map(r => r.reason), ['mục đã bị bỏ'])
})

test('apply: rejects wrong line, missing anchor, wrong sha, bad file, secrets, id from proposal', async t => {
  const w = setup(t)
  const cases = [
    [add(w.sha, { source: `src/candidate.ts:50-60@${w.sha}` }), /ngoài file/],
    [add(w.sha, { anchor: 'canDelete' }), /không chứa anchor/],
    [add(w.sha, { anchor: '' }), /thiếu anchor/],
    [add(w.sha, { source: 'src/candidate.ts:1-2@deadbeef0' }), /sha deadbeef0 không có/],
    [add(w.sha, { source: `src/nope.ts:1-2@${w.sha}` }), /không tồn tại/],
    [add(w.sha, { source: `.env:1@${w.sha}`, anchor: 'TOKEN' }), /secret/],
    [add(w.sha, { repo: 'api' }), /repo không có/],
    [add(w.sha, { statement: 'password = hunter2xyz' }), /giống secret/],
    [add(w.sha, { statement: 'khóa AKIAABCDEFGHIJKLMNOP dùng' }), /giống secret/],
    [add(w.sha, { id: 'K-candidate-9' }), /mã do ff cấp/],
    [add(w.sha, { type: 'người', source: 'người' }), /U-xx thẻ/],
    [add(w.sha, { section: 'Không có' }), /phần không hợp lệ/],
  ]
  const r = await applyProposal(w.root, w.config, prop(...cases.map(c => c[0])))
  assert.equal(r.added.length, 0)
  assert.equal(r.rejected.length, cases.length)
  cases.forEach(([, re], i) => assert.match(r.rejected[i].reason, re, String(i)))
  assert.ok(!fs.existsSync(pageFile(w)))
  const log = fs.readFileSync(path.join(w.root, '.ff/knowledge/wiki-log.jsonl'), 'utf8')
  assert.match(log, /không chứa anchor/)
  await assert.rejects(applyProposal(w.root, w.config, { version: 2 }), /version/)
})

test('apply: người entries need U-xx in the card ledger', async t => {
  const w = setup(t)
  fs.mkdirSync(path.join(w.root, 'trellocards/123-x'), { recursive: true })
  fs.writeFileSync(path.join(w.root, 'trellocards/123-x/01b-ledger.md'), '| Mã | Câu hỏi | Đáp án | Ngày |\n|---|---|---|---|\n| U-03 | Giữ lọc? | Có | 2026-10-20 |\n')
  const human = (src, extra = {}) => ({ op: 'add', section: 'Quyết định đã chốt', statement: 'Giữ bộ lọc khi reload', type: 'người', source: src, repo: 'web', scope: 'filters', decisionKey: 'reload', value: 'persist', ...extra })
  const r = await applyProposal(w.root, w.config, prop(human('U-03 thẻ #123'), human('U-09 thẻ #123'), human('U-03 thẻ #999')))
  assert.deepEqual(r.added, ['K-candidate-1'])
  assert.match(r.rejected[0].reason, /U-09 không có/); assert.match(r.rejected[1].reason, /không thấy thẻ/)
})

test('hand edit locks entry; proposals turn into suggestions; undo restores', async t => {
  const w = setup(t)
  await applyProposal(w.root, w.config, prop(add(w.sha), add(w.sha, { statement: 'Hai', anchor: 'canDelete', source: `src/candidate.ts:5-7@${w.sha}` })))
  const before = fs.readFileSync(pageFile(w), 'utf8')
  fs.writeFileSync(pageFile(w), before.replace('Email ứng viên phải hợp lệ', 'Email ứng viên phải hợp lệ và duy nhất'))
  const raw = readWiki(w.root, w.config)
  assert.equal(raw.pages.get('candidate').entries.find(e => e.id === 'K-candidate-1').locked, true)
  assert.equal(raw.pages.get('candidate').entries.find(e => e.id === 'K-candidate-2').locked, false)
  const r = await applyProposal(w.root, w.config, prop(
    { op: 'update', id: 'K-candidate-1', statement: 'Máy sửa lại', source: `src/candidate.ts:1-2@${w.sha}`, anchor: 'validateEmail' },
    { op: 'retire', id: 'K-candidate-1', reason: 'không còn' },
    { op: 'update', id: 'K-candidate-2', statement: 'Hai (sửa)' }))
  assert.deepEqual(r.updated, ['K-candidate-2']); assert.equal(r.suggested.length, 2); assert.equal(r.retired.length, 0)
  const text = fs.readFileSync(pageFile(w), 'utf8')
  assert.match(text, /K-candidate-1 \| Email ứng viên phải hợp lệ và duy nhất .*khóa-người/)
  assert.match(text, /## Câu hỏi mở\n- K-candidate-3 \| Đề xuất sửa K-candidate-1: Máy sửa lại/)
  assert.match(text, /Đề xuất bỏ K-candidate-1: không còn/)
  assert.match(r.text, /2 đề xuất cho mục khóa-người/)
  // lặp lại: không nhân đôi đề xuất
  const r2 = await applyProposal(w.root, w.config, prop({ op: 'retire', id: 'K-candidate-1', reason: 'không còn' }))
  assert.equal(r2.suggested.length, 0)
  // undo về bản trước lần áp dụng gần nhất
  const u = await undoPage(w.root, w.config, 'candidate')
  assert.equal(u.entries, 2)
  assert.ok(fs.readdirSync(path.join(w.root, '.ff/knowledge/history/candidate')).length >= 1)
  assert.match(fs.readFileSync(pageFile(w), 'utf8'), /Hai(?! \(sửa\))/)
  await assert.rejects(undoPage(w.root, w.config, 'nope'), /không có lịch sử/)
})

test('undo of a freshly created page removes it; loose bullets and human-added ids are adopted', async t => {
  const w = setup(t)
  await applyProposal(w.root, w.config, prop(add(w.sha)))
  assert.deepEqual((await undoPage(w.root, w.config, 'candidate')).removed, true)
  assert.ok(!fs.existsSync(pageFile(w)))
  fs.mkdirSync(path.join(w.root, 'ff-wiki'), { recursive: true })
  fs.writeFileSync(pageFile(w), '# Ứng viên\n\n## Quy tắc\n- Ứng viên dưới 18 tuổi bị từ chối\n- K-candidate-1 | Cái cũ | nguồn: người | loại: người\n- K-candidate-1 | Trùng mã | nguồn: người | loại: người\n')
  const s = await syncWiki(w.root, w.config)
  assert.equal(s.adopted, 2)
  const es = wikiEntries(w.root, w.config)
  assert.deepEqual(es.map(e => e.id).sort(), ['K-candidate-1', 'K-candidate-2', 'K-candidate-3'])
  assert.ok(es.every(e => e.locked && e.type === 'người'))
  const n = await applyProposal(w.root, w.config, prop(add(w.sha)))
  assert.deepEqual(n.added, ['K-candidate-4'])
  // người xóa mục → mã không dùng lại, máy không sửa mục đã xóa
  fs.writeFileSync(pageFile(w), fs.readFileSync(pageFile(w), 'utf8').split('\n').filter(l => !l.startsWith('- K-candidate-4')).join('\n'))
  const m = await applyProposal(w.root, w.config, prop({ op: 'update', id: 'K-candidate-4', statement: 'lại' }, add(w.sha, { statement: 'Mới', anchor: 'canDelete', source: `src/candidate.ts:5-7@${w.sha}` })))
  assert.match(m.rejected[0].reason, /người đã xóa/); assert.deepEqual(m.added, ['K-candidate-5'])
})

test('markStale flags entries citing changed files; update with new citation clears it', async t => {
  const w = setup(t)
  await applyProposal(w.root, w.config, prop(add(w.sha), add(w.sha, { statement: 'Hai', anchor: 'canDelete', source: `src/candidate.ts:5-7@${w.sha}` }), { ...add(w.sha), type: 'thẻ #12', statement: 'Ba', anchor: 'validateEmail', source: `src/candidate.ts:1-2@${w.sha}` }))
  const none = await markStale(w.root, w.config, 'web', ['src/other.ts'], 'abc')
  assert.deepEqual(none.marked, [])
  const r = await markStale(w.root, w.config, 'web', ['./src/candidate.ts'], 'f00dbabe')
  assert.deepEqual(r.marked, ['K-candidate-1', 'K-candidate-2', 'K-candidate-3'])
  assert.equal(wikiStatus(w.root, w.config).stale, 3)
  assert.match(fs.readFileSync(pageFile(w), 'utf8'), /cần kiểm lại: f00dbabe/)
  assert.equal((await markStale(w.root, w.config, 'web', ['src/candidate.ts'], 'x')).marked.length, 0)
  assert.equal((await markStale(w.root, w.config, 'api', ['src/candidate.ts'], 'x')).marked.length, 0)
  const u = await applyProposal(w.root, w.config, prop({ op: 'update', id: 'K-candidate-1', source: `src/candidate.ts:1-2@${w.sha}`, anchor: 'validateEmail' }))
  assert.deepEqual(u.updated, ['K-candidate-1'])
  assert.equal(wikiStatus(w.root, w.config).stale, 2)
  const f = await applyProposal(w.root, w.config, prop({ op: 'flag', id: 'K-candidate-2', reason: 'code đã đổi hành vi' }))
  assert.deepEqual(f.flagged, ['K-candidate-2'])
  assert.equal(wikiStatus(w.root, w.config).review, 1)
})

test('recall: file/symbol hits before keywords; diacritics-insensitive; CLI', async t => {
  const w = setup(t)
  await applyProposal(w.root, w.config, prop(
    add(w.sha, { statement: 'Quyền xóa chỉ dành cho quản trị viên', anchor: 'canDelete', source: `src/candidate.ts:5-7@${w.sha}` }),
    add(w.sha, { statement: 'Ứng viên bị từ chối không được gửi SMS', anchor: 'validateEmail', section: 'Trạng thái và luồng' }),
    { op: 'add', section: 'Dữ liệu', statement: 'Chiến dịch SMS lưu số điện thoại', type: 'code', repo: 'web', source: `src/candidate.ts:1-2@${w.sha}`, anchor: 'validate' }))
  const byFile = recall(w.root, w.config, { files: ['web/src/candidate.ts'], query: 'sms' })
  assert.equal(byFile.length, 3); assert.ok(byFile.every(r => r.why.includes('file')))
  const sym = recall(w.root, w.config, { symbols: ['CANDELETE'], query: 'sms' })
  assert.equal(sym[0].id, 'K-candidate-1'); assert.deepEqual(sym[0].why, ['symbol']); assert.ok(sym.slice(1).every(r => r.why[0] === 'keyword'))
  const kw = recall(w.root, w.config, { query: 'Ung vien tu choi' })
  assert.equal(kw[0].id, 'K-candidate-2'); assert.deepEqual(kw[0].why, ['keyword'])
  assert.equal(recall(w.root, w.config, { query: 'quan tri vien' })[0].id, 'K-candidate-1')
  assert.equal(recall(w.root, w.config, { query: 'chiến dịch', limit: 1 }).length, 1)
  assert.equal(recall(w.root, w.config, { query: 'zzz' }).length, 0)
  assert.equal(fold('Đặng Quyền'), 'dang quyen')
  // chỉ mục tự dựng lại khi người sửa tay
  fs.writeFileSync(pageFile(w), fs.readFileSync(pageFile(w), 'utf8').replace('quản trị viên', 'siêu quản lý'))
  assert.equal(recall(w.root, w.config, { query: 'sieu quan ly' })[0].id, 'K-candidate-1')
  assert.equal(recall(w.root, w.config, { query: 'sieu quan ly' })[0].locked, true)
  await markStale(w.root, w.config, 'web', ['src/candidate.ts'], 'new')
  const c = capture(w.root)
  assert.equal(await main(['recall', '--files', 'src/candidate.ts', '--json', '--limit', '2'], c.ctx), 0)
  const rows = JSON.parse(c.buf.out); assert.equal(rows.length, 2); assert.ok(rows[0].stale)
  const t2 = capture(w.root)
  assert.equal(await main(['recall', '--symbols', 'candelete'], t2.ctx), 0)
  assert.match(t2.buf.out, /DỮ LIỆU[\s\S]*K-candidate-1 \[code\].*khóa-người.*CẦN KIỂM LẠI/)
  assert.equal(await main(['recall'], capture(w.root).ctx), 1)
})

test('recall --card derives files from design/plan', async t => {
  const w = setup(t)
  await applyProposal(w.root, w.config, prop(add(w.sha)))
  fs.mkdirSync(path.join(w.root, 'trellocards/7-x'), { recursive: true })
  fs.writeFileSync(path.join(w.root, 'trellocards/7-x/03-design.md'), 'Sửa `web/src/candidate.ts:12` và ghi chú https://x.io/a.js\n')
  assert.deepEqual(cardRecallFiles(w.root, w.config, '7'), ['web/src/candidate.ts'])
  const c = capture(w.root)
  assert.equal(await main(['recall', '--card', '7', '--json'], c.ctx), 0)
  assert.equal(JSON.parse(c.buf.out)[0].id, 'K-candidate-1')
  assert.equal(await main(['recall', '--card', '99'], capture(w.root).ctx), 1)
})

test('knowledge CLI: status, undo, apply, reindex', async t => {
  const w = setup(t)
  const file = path.join(w.root, 'p.json')
  fs.writeFileSync(file, JSON.stringify(prop(add(w.sha), add(w.sha, { anchor: 'nope' }))))
  let c = capture(w.root)
  assert.equal(await main(['knowledge', 'apply', 'p.json'], c.ctx), 0)
  assert.match(c.buf.out, /thêm 1 mục.*1 bị loại[\s\S]*không chứa anchor/)
  c = capture(w.root); assert.equal(await main(['knowledge', 'status', '--json'], c.ctx), 0)
  const s = JSON.parse(c.buf.out); assert.equal(s.entries, 1); assert.equal(s.pages[0].domain, 'candidate'); assert.equal(s.stale, 0); assert.ok(s.lastUpdate)
  c = capture(w.root); assert.equal(await main(['knowledge', 'status'], c.ctx), 0); assert.match(c.buf.out, /1 trang, 1 mục, 0 cần kiểm lại/)
  c = capture(w.root); assert.equal(await main(['knowledge', 'reindex'], c.ctx), 0)
  c = capture(w.root); assert.equal(await main(['knowledge', 'undo', 'candidate'], c.ctx), 0); assert.ok(!fs.existsSync(pageFile(w)))
  c = capture(w.root); assert.equal(await main(['knowledge', 'undo', 'candidate'], c.ctx), 1)
  assert.equal(await main(['knowledge', 'bogus'], capture(w.root).ctx), 1)
})

test('trace-check accepts existing non-stale K ids as sources', async t => {
  const w = setup(t)
  await applyProposal(w.root, w.config, prop(add(w.sha), add(w.sha, { statement: 'Hai', anchor: 'canDelete', source: `src/candidate.ts:5-7@${w.sha}` })))
  await markStale(w.root, w.config, 'web', [], '')
  await markStale(w.root, w.config, 'web', ['src/candidate.ts'], 'n1')
  await applyProposal(w.root, w.config, prop({ op: 'update', id: 'K-candidate-1', source: `src/candidate.ts:1-2@${w.sha}`, anchor: 'validateEmail' }))
  const dir = path.join(w.root, 'trellocards/5-x'); fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '01-dossier.md'), '# Thẻ 5\n## Mô tả\nLọc ứng viên.\n')
  fs.writeFileSync(path.join(dir, '01b-ledger.md'), '| Mã | Trích nguyên văn | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Lọc ứng viên. | Mô tả | |\n')
  const brief = rows => `# Brief\n| # | Mục | Nguồn |\n|---|---|---|\n| 1 | Lọc | D-01 |\n${rows}`
  const run = rows => { fs.writeFileSync(path.join(dir, 'brief.md'), brief(rows)); return traceCheck(dir, { knowledge: knowledgeIds(w.root, w.config) }) }
  const ok = run('| 2 | Email hợp lệ | K-candidate-1 |\n')
  assert.deepEqual(ok.errors, []); assert.equal(ok.counts.K, 1)
  assert.match(run('| 2 | x | K-candidate-9 |\n').errors.join(), /K-candidate-9 không có trong wiki/)
  assert.match(run('| 2 | x | K-candidate-2 |\n').errors.join(), /K-candidate-2 đang "cần kiểm lại"/)
  assert.match(traceCheck(dir).errors.join(), /không có trong wiki/)
  const c = capture(w.root)
  fs.writeFileSync(path.join(dir, 'brief.md'), brief('| 2 | Email | K-candidate-1 |\n'))
  assert.equal(await main(['trace-check', '5'], c.ctx), 0); assert.match(c.buf.out, /1 mã K/)
})

test('decide: wiki người entry serves as prediction / authoritative precedent; hard rules still escalate', () => {
  const request = { cardId: 'a', project: 'p', repo: 'web', businessScope: 'filters', policyVersion: 'v', decisionKey: 'reload', class: 'default-value', question: 'Giữ khi reload?', options: ['Persist', 'Page-only'] }
  const entry = (extra = {}) => ({ id: 'K-filters-1', type: 'người', repo: 'web', scope: 'filters', decisionKey: 'reload', value: 'persist', source: 'người', locked: true, stale: '', review: '', ...extra })
  const r = decide({ request, wiki: [entry()] })
  assert.equal(r.verdict, 'proceed'); assert.equal(r.default, 'persist'); assert.equal(r.evidence[0].id, 'K-filters-1'); assert.equal(r.prediction, 'persist')
  assert.equal(decide({ request }).verdict, 'escalate')
  // máy ghi từ U-xx, chưa khóa → chỉ dự đoán
  const soft = decide({ request, wiki: [entry({ source: 'U-03 thẻ #1', locked: false })] })
  assert.equal(soft.verdict, 'escalate'); assert.equal(soft.prediction, 'persist')
  for (const bad of [{ repo: 'api' }, { scope: 'other' }, { decisionKey: 'x' }, { type: 'code' }, { review: 'xem' }, { value: 'unknown' }]) {
    const x = decide({ request, wiki: [entry(bad)] }); assert.equal(x.verdict, 'escalate', JSON.stringify(bad)); assert.equal(x.prediction, null)
  }
  assert.equal(decide({ request, wiki: [entry(), entry({ id: 'K-filters-2', value: 'page-only' })] }).verdict, 'escalate')
  // giữ luật cứng
  assert.equal(decide({ request: { ...request, class: 'permission' }, wiki: [entry()] }).verdict, 'escalate')
  assert.equal(decide({ request: { ...request, question: 'đổi schema?' }, wiki: [entry()] }).verdict, 'escalate')
  assert.equal(decide({ request: { ...request, gate: 'GATE_A' }, wiki: [entry()] }).verdict, 'escalate')
  assert.equal(decide({ request, wiki: [entry()], policy: { high_risk: [{ keywords: ['reload'] }] } }).verdict, 'escalate')
  // mâu thuẫn với tiền lệ người
  const rows = Array.from({ length: 3 }, (_, i) => ({ ...request, decisionId: `d${i}`, normalizedValue: 'page-only', provenance: { source: 'cli', originId: `o${i}` } }))
  const c = decide({ records: rows, request, wiki: [entry()] })
  assert.equal(c.verdict, 'escalate'); assert.equal(c.prediction, null)
  assert.equal(decide({ records: rows, request, wiki: [entry({ value: 'page-only' })] }).verdict, 'proceed')
})

test('doctor check and schema accept knowledge.dir; dir under .ff rejected', async t => {
  const { wikiDirCheck } = await import('../scripts/lib/wiki.mjs')
  const w = setup(t)
  assert.equal(wikiDirCheck(w.root, w.config).ok, true)
  assert.equal(wikiDirCheck(w.root, { ...w.config, knowledge: { dir: '.ff/wiki' } }).ok, false)
  assert.equal(wikiDirCheck(w.root, { ...w.config, knowledge: { dir: '../x' } }).ok, false)
  const { validate } = await import('../scripts/lib/schema.mjs')
  const cfg = baseConfig()
  assert.deepEqual(validate({ ...cfg, knowledge: { dir: 'docs/wiki' } }), [])
  assert.notDeepEqual(validate({ ...cfg, knowledge: { dir: '' } }), [])
  fs.mkdirSync(path.join(w.root, 'ff-wiki')); fs.writeFileSync(path.join(w.root, 'ff-wiki/Bad Name.md'), '# x')
  assert.equal(wikiDirCheck(w.root, w.config).ok, false)
})
