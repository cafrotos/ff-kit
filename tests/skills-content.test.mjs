import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const mdFiles = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name)
  return e.isDirectory() ? mdFiles(p) : p.endsWith('.md') ? [p] : []
})
const RUNTIME = ['skills', 'agents', 'commands', 'references'].flatMap(mdFiles)

// Assert shared contracts at their owner, rather than requiring every consumer to
// repeat exact wording. Templates are checked separately against CLI parsers.
test('review classification has one owner and consumers link to it', () => {
  const owner = 'references/reviewer-rules.md'
  for (const heading of ['## Nhãn và ý nghĩa', '## Mức độ']) {
    assert.deepEqual(RUNTIME.filter((f) => read(f).split('\n').includes(heading)), [owner])
  }
  assert.doesNotMatch(read('skills/ff-understand/references/doubt.md'), /\| `(?:GAP|LEAP|OPINION)` \|/)
  assert.match(read('skills/ff-understand/references/doubt.md'), /references\/reviewer-rules\.md/)
  assert.doesNotMatch(read(owner), /không có.*(?:Ý KIẾN|OPINION).*đáng ngờ/i)
})

test('routing and downstream artifacts use active state, never approval markers', () => {
  for (const phase of ['ff-understand', 'ff-build', 'ff-verify']) {
    const s = read(`skills/${phase}/SKILL.md`)
    assert.match(s, /ff state <id> --json/, phase)
    assert.match(s, /activeDir/, phase)
    assert.match(s, /activeRevision/, phase)
    assert.match(s, /pending.*stale|stale.*pending/s, phase)
  }
  const understand = read('skills/ff-understand/SKILL.md')
  assert.doesNotMatch(understand, /trong 10 dòng đầu|Không tự code, không `ff copy`/)
  assert.match(understand, /ff gate-auto <id> --reason/)
  assert.match(read('skills/ff-understand/references/design.md'), /ff gate-auto/)
  assert.match(read('skills/ff-understand/rules.md'), /auto_passed/)
})

test('reopen uses real CLI, current delta Gate A and all three revision gates', () => {
  const reopen = read('skills/ff-understand/references/reopen.md')
  assert.match(reopen, /ff reopen <id> --reason/)
  assert.match(reopen, /GATE_A/)
  assert.match(reopen, /GATE_B/)
  assert.match(reopen, /GATE_C/)
  assert.match(reopen, /\[#<id>\] \[rev-N\]/)
  assert.doesNotMatch(reopen, /không tồn tại|Gate A'|Gate A′|không qua Gate A|Gate A là gate duy nhất/)
  assert.match(reopen, /delta\.md/)
  assert.match(read('skills/ff-verify/SKILL.md'), /activeDir.*05-verify-report\.md/)
})

test('understand may prepare a configured observation environment and cleans it up', () => {
  const understand = read('skills/ff-understand/SKILL.md')
  for (const command of ['copy', 'verify-up', 'verify-down', 'db-query']) {
    assert.ok(understand.split('---')[1].includes(`Bash(ff ${command} *)`))
    assert.match(understand, new RegExp(`ff ${command}`))
  }
  assert.match(understand, /không sửa code sản phẩm/i)
  assert.match(understand, /health.*lock|lock.*health/s)
})

test('gate-tools use full slug rather than IDs', () => {
  const docs = [...mdFiles('skills'), ...mdFiles('agents'), ...mdFiles('references')]
  for (const file of docs) {
    assert.doesNotMatch(read(file), /ff (?:allow|relock|lock-tests|probe-slice|ship-approve) <id>/, file)
  }
  assert.match(read('skills/ff-build/SKILL.md'), /ff allow <slug>/)
  assert.match(read('skills/ff-build/SKILL.md'), /ff lock-tests <slug>/)
})

test('small tasks scale diagnosis but keep verification Gate C', () => {
  assert.match(read('skills/ff-understand/rules.md'), /Nhỏ.*Gate C/)
  assert.match(read('skills/ff-understand/SKILL.md'), /chưa rõ.*giả thuyết|giả thuyết.*chưa rõ/s)
  assert.doesNotMatch(read('skills/ff-understand/SKILL.md'), /Hypothesis Tree ≥2/)
})

test('test writer has explicit secret boundaries and honest static checks', () => {
  const brief = read('skills/ff-build/briefs/test-writer.md')
  assert.match(brief, /Không đọc.*\.auth.*token/)
  assert.doesNotMatch(brief, /Chỉ đọc:.*\.auth/)
  for (const f of ['agents/ff-test-writer.md', 'skills/ff-build/briefs/test-writer.md']) {
    assert.match(read(f), /type-check/)
    assert.match(read(f), /không.*PASS.*hành vi|không.*hành vi.*PASS/i)
  }
})

test('prompt đối kháng chỉ nằm trong doubt.md', () => {
  const hits = RUNTIME.filter((f) => /Review đối kháng\./.test(read(f)))
  assert.deepEqual(hits, ['skills/ff-understand/references/doubt.md'])
})

test('rules.md gọn (nạp ở mọi skill)', () => {
  assert.ok(read('skills/ff-understand/rules.md').split('\n').length <= 150)
})

test('no workspace-specific or stale tool names in plugin content', () => {
  const banned = /tiniweb|trellisflow|oe-hrm|system-service|\/Users\/[^\s`]+|\/home\/[^\s`]+|origin\/(?:prod|dev)|ff_ask_user|ff_submit_gate|ff_notify|ff_request_ship|ff\.sh|\bTypeORM\b|\bNestJS\b|\bMobX\b|\bCASL\b|thẻ Trello/i
  for (const f of RUNTIME) assert.doesNotMatch(read(f), banned, f)
})

test('no hardcoded workspace layout in skills', () => {
  const hard = /\be2e\/tests\b|\bworktrees\/<|<repo-name>|_project\/|\byarn\b|mcp-auth <email>|\.claude\/skills\//
  for (const f of mdFiles('skills')) assert.doesNotMatch(read(f), hard, f)
})

test('no shouting tone', () => {
  const tone = /CẤM|Tuyệt đối|TUYỆT ĐỐI|BẮT BUỘC|⚠️/
  for (const f of RUNTIME) assert.doesNotMatch(read(f), tone, f)
})

test('skills that write artifacts grant Write/Edit/Agent; none grants protected commands', () => {
  for (const f of ['skills/ff-understand/SKILL.md', 'skills/ff-build/SKILL.md', 'skills/ff-verify/SKILL.md']) {
    const header = read(f).split('---')[1]
    for (const tool of ['Write', 'Edit', 'Agent']) assert.match(header, new RegExp(`allowed-tools:.*\\b${tool}\\b`), `${f} thiếu ${tool}`)
    assert.doesNotMatch(header, /Bash\(ff \*\)|ff ship-approve|ff relock/, f)
  }
  const buildTools = read('skills/ff-build/SKILL.md').split('---')[1].match(/^allowed-tools:.*$/m)?.[0] ?? ''
  assert.match(buildTools, /(?:^|,)\s*Bash\s*(?:,|$)/, 'ff-build cần chạy command đã cấu hình')
})

test('reviewers cannot write files', () => {
  for (const f of ['agents/ff-brief-adversary.md', 'agents/ff-design-reviewer.md', 'agents/ff-diff-reviewer.md']) {
    assert.match(read(f), /^disallowedTools:.*Write.*Edit/m, f)
  }
})

test('worker resume prompt follows resume protocol and stays on one line per message', () => {
  const src = read('ff-worker/src/core/worker.mjs')
  assert.match(src, /\/ff-kit:ff-understand/)
  assert.match(src, /01b-ledger\.md/)
  assert.match(src, /ff state/)
  assert.match(src, /không hỏi lại/)
  assert.doesNotMatch(src, /\]\.filter\(Boolean\)\.join\('\\n'\)/)
})

test('hook Stop is registered', () => {
  assert.match(read('hooks/hooks.json'), /"Stop"/)
})

test('NOTICE names both reference repos', () => {
  const n = read('NOTICE')
  assert.match(n, /tronghieu\/agent-skills/)
  assert.match(n, /addyosmani\/agent-skills/)
})

test('ledger example in brief.md parses cleanly and keeps classification in Ghi chú', async () => {
  const { parseLedger } = await import('../scripts/lib/trace.mjs')
  const block = read('skills/ff-understand/references/brief.md').match(/```markdown\n(# Ledger[\s\S]*?)```/)
  assert.ok(block, 'brief.md thiếu khối ví dụ ledger')
  const parsed = parseLedger(block[1])
  assert.ok(parsed.D.size >= 4 && parsed.U.size >= 1 && parsed.errors.length === 0)
  const notes = [...parsed.D.values()].map((d) => d.note)
  for (const kind of ['sự kiện', 'giả thuyết', 'giải pháp']) assert.ok(notes.includes(kind), `thiếu loại ${kind}`)
})

test('evals exist for each skill, command, and agent', () => {
  for (const name of ['ff-understand', 'ff-build', 'ff-verify', 'ff-init', 'ship-to-dev']) {
    const text = read(`docs/skill-evals/${name}.md`)
    assert.ok((text.match(/^\| E-/gm) ?? []).length >= 3, name)
  }
  const agents = read('docs/skill-evals/agents.md')
  assert.ok((agents.match(/^\| E-A\d+ \|/gm) ?? []).length >= 10, 'cần 10 ca eval agent')
  for (const name of fs.readdirSync(path.join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))) {
    assert.match(agents, new RegExp(`\\| ${name} \\|`), name)
  }
})

test('agents read the shared rules; reviewers also read reviewer rules', () => {
  const agents = fs.readdirSync(path.join(root, 'agents')).filter((f) => f.endsWith('.md'))
  assert.equal(agents.length, 10)
  for (const f of agents) {
    const text = read(`agents/${f}`)
    if (f !== 'ff-gate-reader.md') assert.match(text, /references\/agent-rules\.md/, f)
    if (['ff-brief-adversary.md', 'ff-design-reviewer.md', 'ff-diff-reviewer.md'].includes(f)) assert.match(text, /references\/reviewer-rules\.md/, f)
    assert.match(text, /^maxTurns:\s*\d+/m, f)
  }
})

test('Sonnet agents use the agreed persona sections', () => {
  const agents = fs.readdirSync(path.join(root, 'agents')).filter((f) => f.endsWith('.md'))
  for (const f of agents) {
    const text = read(`agents/${f}`)
    if (!/^model:\s*sonnet$/m.test(text)) continue
    for (const heading of ['## Sứ mệnh', '## Cách nghĩ', '## Điều dễ làm bạn đi sai hướng']) assert.match(text, new RegExp(`^${heading}`, 'm'), f)
  }
})

test('agent routing table does not duplicate model or effort metadata', () => {
  const table = read('skills/ff-understand/references/agents.md').split('## Viết brief cho subagent')[0]
  const rows = table.split('\n').filter((line) => /^\| `ff-[^`]+` \|/.test(line))
  const columns = (table.match(/^\|([^\n]+)\|$/m)?.[1] ?? '').split('|').map((column) => column.trim())
  assert.deepEqual(columns, ['Agent', 'Skill/điểm gọi', 'Brief'])
  assert.equal(rows.length, 10, 'bảng định tuyến phải có đủ 10 agent')
  for (const row of rows) assert.equal(row.split('|').length - 2, 3, row)
  for (const file of fs.readdirSync(path.join(root, 'agents')).filter((name) => name.endsWith('.md'))) {
    const agent = file.replace(/\.md$/, '')
    assert.ok(rows.some((row) => row.includes(`\`${agent}\``)), `thiếu tuyến cho ${agent}`)
  }
  assert.doesNotMatch(table, /^\|[^\n]*\b(?:model|effort|Ranh giới chính)\b[^\n]*\|/im)
})

test('briefs do not repeat agent persona openings', () => {
  const briefs = mdFiles('skills').filter((f) => /\/briefs\//.test(f))
  const personaOpening = /^Bạn (?:là|đóng vai|review\b|viết\b|code\b|verify\b|thực hiện\b|quan sát\b)/m
  for (const f of briefs) {
    const preamble = read(f).split(/^## /m, 1)[0].split('\n').slice(1).join('\n')
    assert.doesNotMatch(preamble, personaOpening, f)
  }
})

test('ship instructions keep separate permission and avoid destructive legacy snippets', () => {
  const command = read('commands/ship-to-dev.md')
  const reference = read('skills/ff-verify/references/ship.md')
  assert.match(command, /ff ship-request/)
  assert.match(command, /AskUserQuestion/)
  assert.match(command, /ff ship-approve <slug>/)
  assert.doesNotMatch(command, /--force-with-lease|git reset -q|git clean -fd/)
  assert.match(reference, /user yêu cầu ship/)
  assert.match(reference, /activeRevision/)
  assert.match(reference, /activeDir/)
})
