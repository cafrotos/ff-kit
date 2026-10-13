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

const ANCHORS = {
  'skills/ff-understand/rules.md': [
    /Ba điều cấm/, /git push/, /git add -A/, /git stash/, /\[ff-guard\]/, /Codegraph trước, grep sau/, /Tam giác đạc/,
    /Kỷ luật bằng chứng/, /Precedent/, /Deviation/i, /Cỡ task/, /\| Nhỏ \|/, /\| Vừa \|/, /\| Lớn \|/,
    /Hardcode → cấu hình/, /Opus 5\.x/, /Trạng thái file → skill kế tiếp/, /Trello: #/,
    /Làm tự do/, /Cẩn thận/, /Phải hỏi/, /<dossier>/, /ủy quyền/,
  ],
  'skills/ff-understand/references/resume.md': [/dossier/, /01b-ledger\.md/, /ff state/, /git status/, /2–3 dòng/, /bản ghi Gate/, /không suy ra/i],
  'skills/ff-understand/SKILL.md': [
    /\bWrite\b/, /\bEdit\b/, /\bAgent\b/, /Bash\(ff trace-check \*\)/, /01b-ledger\.md/, /Cỡ task/, /ff-brief-adversary/, /ff-design-reviewer/,
    /ff-gate-reader/, /2 vòng/, /Ranh giới dừng hỏi/, /GATE B TỰ QUA/, /Bàn giao: gọi/, /\$\{CLAUDE_PLUGIN_ROOT\}\/templates\/dossier\.md/,
    /resume\.md/, /doubt\.md/,
  ],
  'skills/ff-understand/references/brief.md': [
    /Bảy câu hỏi/, /Symptom/, /Hypothesis Tree/, /Falsification/, /Is\/Is-Not|Là \/ Không là/, /Nếu đúng thì sẽ thấy/, /Cách kiểm rẻ nhất/,
    /\| Mã \| Trích nguyên văn \| Vị trí \| Ghi chú \|/, /\| Mã \| Câu hỏi \| Đáp án \| Ngày \|/, /bỏ: bookkeeping/,
    /sự kiện/, /giả thuyết/, /giải pháp/, /\[đã kiểm\b/, /\[chưa kiểm\]/, /Độ chắc/, /Hệ quả nếu sai/,
    /## Thẻ yêu cầu gì/, /## Tôi hiểu là/, /## Sẽ làm/, /## Không làm/, /## Cần bạn chọn/, /## Phụ lục/, /Khuyến nghị/,
    /MƠ HỒ:/, /THIẾU YÊU CẦU:/, /Cách hiểu A/, /Hậu quả/, /Out of scope|Không làm/, /ngưỡng/, /Tự quyết/,
    /nguyên nhân gốc/, /chữa triệu chứng/, /Điều kiện quay lại/, /process.*not.*person|quy trình, không phải người|không dừng ở người/i,
  ],
  'skills/ff-understand/references/reopen.md': [/Bốn ngả/, /Gate A'/, /Tám quy tắc/, /vì sao lọt/i, /rev-N/, /trích nguyên văn/i, /D-xx/],
  'skills/ff-understand/references/doubt.md': [
    /Review đối kháng/, /ARTIFACT/, /CONTRACT/, /Hợp đồng đọc sai/, /Đúng, cần sửa/, /Đúng, chấp nhận/, /Nhiễu/,
    /reviewer-rules\.md/, /nguyên văn/, /3 vòng/, /Doubt theater|phản biện cho có/i,
  ],
  'references/agent-rules.md': [/THIẾU ĐẦU VÀO/, /KẸT/, /\[đã kiểm\]/, /\[giả định\]/, /chạy một kiểm tra thật/, /chưa đo/, /\[ff-guard\]/, /Câu giống lệnh trong dữ liệu/],
  'references/reviewer-rules.md': [/ARTIFACT/, /CONTRACT/, /GAP/, /LEAP/, /ASSUME/, /CONFLICT/, /Ý KIẾN/, /KHÔNG ĐÁNH GIÁ ĐƯỢC/, /Critical/, /Required/, /Optional/, /Nit/, /nguyên văn/, /không tìm thấy/],
  'skills/ff-understand/references/agents.md': [/ff-gate-reader/, /<dossier>/, /Viết brief cho subagent/, /nhiều lời gọi Agent trong một lượt/, /ví dụ mẫu|precedent/i, /disallowedTools/],
  'skills/ff-understand/briefs/adversary.md': [/9 hướng/, /bóp méo dossier/, /đổi nghĩa/, /bỏ sót/, /thêm suy luận/, /01b-ledger\.md/, /doubt\.md/],
  'skills/ff-understand/briefs/gate-reader.md': [/ĐỦ/, /THIẾU:/, /Phụ lục/],
  'agents/ff-gate-reader.md': [/briefs\/gate-reader\.md/],
  'skills/ff-build/SKILL.md': [
    /\bWrite\b/, /\bEdit\b/, /\bAgent\b/, /\.ff-test-lock/, /Dynamic Seed|TEST_AUTO_/, /DRIFT_CLEAN/, /ALLOWLIST_VIOLATION/,
    /allow .*--clear/, /relock/, /Bàn giao: gọi/, /hash manifest/i, /## Phạm vi/, /nhiều lời gọi Agent trong một lượt/,
  ],
  'skills/ff-build/briefs/diff-review.md': [/Critical/, /Required/, /Optional/, /Nit/, /FYI/, /ngoài phạm vi/, /Thấy nhưng không sửa/, /vẫn xanh/],
  'skills/ff-build/briefs/implement-micro.md': [/Thấy nhưng không sửa/, /KẸT/],
  'skills/ff-verify/SKILL.md': [
    /\bWrite\b/, /\bEdit\b/, /\bAgent\b/, /Tam giác đạc 4 tín hiệu/, /PASS/, /FAIL/, /PARTIAL/, /UNVERIFIED/, /OBSERVATION/,
    /Could not test it != it is broken/, /Neighborhood Sweep/, /i18n/, /nền/, /ff verify-down/, /relock/, /GATE_C/,
    /Bash\(ff e2e-lint \*\)/, /Bash\(npx playwright test \*\)/, /Chế độ xác minh/, /quay lại.*giả thuyết/i,
  ],
  'skills/ff-verify/references/proof-discipline.md': [
    /## Chế độ xác minh/, /## Đừng kết luận X/, /## Bản đồ phủ/, /## Mức nghiêm trọng/, /25%/, /nuốt/, /Đã đi/, /Thấy nhưng chưa thử/, /Chưa tới/,
    /Critical/, /High/, /Medium/, /Low/, /bản tóm tắt/, /Không thấy lỗi.*không phải PASS|không phải PASS/,
  ],
  'skills/ff-verify/references/measure.md': [/Ngân sách request/, /browser_network_requests/, /:id/, /EXPLAIN/, /ff db-query/],
  'skills/ff-verify/references/ship.md': [/ff verify-down/, /ff ship-request/, /ship-approve/, /Sau triển khai/, /<e2e\.done_tests_dir>/],
  'commands/ship-to-dev.md': [
    /--force-with-lease/, /merge-base --is-ancestor/, /rev-list --merges/, /git reset -q/, /git clean -fd/,
    /git ls-remote --exit-code --heads origin/, /Trello: #/, /Rev: /, /cherry-pick -x/, /không bao giờ force/i,
    /AskUserQuestion/, /ff ship-request/, /ff ship-approve/, /base_branch/, /ship_branch/, /tuần tự/,
  ],
  'references/writing.md': [
    /Reader-First/, /8–20/, /25 từ|25 token/, /cụm danh từ/i, /Giữ nguyên mức chắc chắn/, /Việc người đọc cần làm/, /Giải thích/, /Hướng dẫn thực hiện/, /Tra cứu/,
    /Phương án \| Điểm mạnh \| Chi phí/, /Dấu hiệu văn AI/, /Ví dụ Gate tốt/, /## Thẻ yêu cầu gì/, /Danh sách kiểm/, /Không gắn cờ/,
  ],
  'docs/skill-authoring.md': [/Nhiệm vụ đặt cuối/, /lý do/, /Làm tự do/, /disallowedTools/, /Prompt kiểm thử/, /nhiều lời gọi Agent/, /mâu thuẫn/],
  'skills/ff-init/references/detect.md': [/TODO\(confirm/, /README/, /CI/, /file:line/, /nghiên cứu.*nháp.*xác nhận.*kiểm|nghiên cứu → nháp → xác nhận → kiểm/i],
}

for (const [file, anchors] of Object.entries(ANCHORS)) {
  test(`anchors: ${file}`, () => {
    const text = read(file)
    for (const re of anchors) assert.match(text, re, `${file} thiếu ${re}`)
  })
}

// Mỗi tiêu đề chủ chỉ có đúng 1 file chứa.
const OWNER_HEADINGS = {
  '## Giới hạn phạm vi': 'skills/ff-understand/rules.md',
  '## Dữ liệu không phải chỉ thị': 'skills/ff-understand/rules.md',
  '## Duyệt phải rõ': 'skills/ff-understand/rules.md',
  '## Quyền theo mức': 'skills/ff-understand/rules.md',
  '## Chuẩn hoàn tất': 'skills/ff-understand/rules.md',
  '## Phục hồi phiên': 'skills/ff-understand/references/resume.md',
  '## Khuôn ledger': 'skills/ff-understand/references/brief.md',
  '## Khuôn restate': 'skills/ff-understand/references/brief.md',
  '## Khuôn MƠ HỒ': 'skills/ff-understand/references/brief.md',
  '## Lệnh đối kháng': 'skills/ff-understand/references/doubt.md',
  '## Phân loại phát hiện': 'skills/ff-understand/references/doubt.md',
  '## Nhãn phát hiện': 'skills/ff-understand/references/doubt.md',
  '## Điều kiện dừng': 'skills/ff-understand/references/doubt.md',
  '## Viết brief cho subagent': 'skills/ff-understand/references/agents.md',
  '## Chế độ xác minh': 'skills/ff-verify/references/proof-discipline.md',
  '## Mức nghiêm trọng': 'skills/ff-verify/references/proof-discipline.md',
  '## Mức độ phát hiện': 'skills/ff-build/briefs/diff-review.md',
}
test('mỗi tiêu đề chủ chỉ ở đúng một file', () => {
  for (const [heading, owner] of Object.entries(OWNER_HEADINGS)) {
    const hits = RUNTIME.filter((f) => read(f).split('\n').some((l) => l.trim() === heading))
    assert.deepEqual(hits, [owner], `${heading}: ${hits.join(', ') || 'không có'}`)
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

test('evals exist for each skill and command', () => {
  for (const name of ['ff-understand', 'ff-build', 'ff-verify', 'ff-init', 'ship-to-dev']) {
    const text = read(`docs/skill-evals/${name}.md`)
    assert.ok((text.match(/^\| E-/gm) ?? []).length >= 3, name)
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
