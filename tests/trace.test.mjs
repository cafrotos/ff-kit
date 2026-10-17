import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { traceCheck, parseTables } from '../scripts/lib/trace.mjs'
import { findCardDir } from '../scripts/lib/cards.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

const CARD = 'trellocards/123-loc-ung-vien'
const DOSSIER = `# Thẻ 123: Lọc ứng viên
## Mô tả
Cho phép lọc ứng viên theo trạng thái.
## Checklist
- [ ] Thêm bộ lọc trạng thái ở màn danh sách ứng viên
- [ ] Giữ bộ lọc khi chuyển trang
## Comments
- 🔄 Sync từ sheet row 77
`
const LEDGER = `# Ledger thẻ 123
| Mã | Trích nguyên văn | Vị trí | Ghi chú |
|---|---|---|---|
| D-01 | Cho phép lọc ứng viên theo trạng thái. | Mô tả | |
| D-02 | Thêm bộ lọc trạng thái ở màn danh sách ứng viên | Checklist #1 | |
| D-03 | Giữ bộ lọc khi chuyển trang | Checklist #2 | |
| D-04 | 🔄 Sync từ sheet row 77 | Comment 1 | bỏ: bookkeeping |

| Mã | Câu hỏi | Đáp án | Ngày |
|---|---|---|---|
| U-01 | Lọc nhiều trạng thái cùng lúc? | Có | 2026-10-13 |
`
const BRIEF = `> Trạng thái: CHỜ DUYỆT
# Brief 123
| # | Mục | Nguồn |
|---|---|---|
| 1 | Bộ lọc trạng thái | D-01, D-02 |
| 2 | Chọn nhiều trạng thái | U-01 |

## Ngoài phạm vi
- D-03: để thẻ sau
`

function card(t, files = {}) {
  const base = { [`${CARD}/01-dossier.md`]: DOSSIER, [`${CARD}/01b-ledger.md`]: LEDGER, [`${CARD}/brief.md`]: BRIEF }
  const merged = { ...base, ...files }
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k]
  const ws = makeWorkspace({ files: merged })
  t.after(ws.cleanup)
  return { root: ws.root, dir: path.join(ws.root, CARD) }
}

test('bộ thẻ đúng → xanh', (t) => {
  const r = traceCheck(card(t).dir)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.counts, { D: 4, U: 1 })
})

test('D-xx không được phủ và không nằm Ngoài phạm vi → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/brief.md`]: BRIEF.replace('- D-03: để thẻ sau\n', '') }).dir)
  assert.match(r.errors.join('\n'), /D-03 chưa được dòng nào phủ/)
})

test('dòng bảng thiếu nguồn → đỏ kèm file:dòng', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/brief.md`]: BRIEF.replace('| U-01 |', '| |') }).dir)
  assert.match(r.errors.join('\n'), /brief\.md:6 dòng thiếu nguồn/)
})

test('mã không có trong ledger → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/brief.md`]: BRIEF.replace('U-01 |', 'D-09 |') }).dir)
  assert.match(r.errors.join('\n'), /D-09 không có trong ledger/)
})

test('trích ledger lệch nguyên văn dossier → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/01b-ledger.md`]: LEDGER.replace('màn danh sách ứng viên', 'màn ứng viên') }).dir)
  assert.match(r.errors.join('\n'), /D-02: trích không khớp nguyên 1 dòng hoặc 1 câu/)
})

test('trace NFD/CRLF/BOM vẫn xanh', (t) => {
  const r = traceCheck(card(t, {
    [`${CARD}/01-dossier.md`]: DOSSIER.normalize('NFD').replace(/\n/g, '\r\n'),
    [`${CARD}/brief.md`]: '\uFEFF' + BRIEF.replace(/\n/g, '\r\n'),
  }).dir)
  assert.deepEqual(r.errors, [])
})

test('thiếu ledger → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/01b-ledger.md`]: null }).dir)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /thiếu 01b-ledger\.md/)
})

test('bảng không có cột Nguồn: dưới Phụ lục thì bỏ qua; ô có \\| vẫn khớp', (t) => {
  const r = traceCheck(card(t, {
    [`${CARD}/01-dossier.md`]: DOSSIER + '- Lọc theo A | B\n',
    [`${CARD}/01b-ledger.md`]: LEDGER.replace('| D-04 |', '| D-05 | Lọc theo A \\| B | Comment 2 | bỏ: trùng D-01 |\n| D-04 |'),
    [`${CARD}/brief.md`]: BRIEF + '\n## Phụ lục\n| a | b |\n|---|---|\n| 1 | 2 |\n',
  }).dir)
  assert.deepEqual(r.errors, [])
})

test('bảng không có cột Nguồn ngoài Phụ lục → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/brief.md`]: BRIEF.replace('## Ngoài phạm vi', '| tất cả | ghi chú |\n|---|---|\n| x | y |\n\n## Ngoài phạm vi') }).dir)
  assert.match(r.errors.join('\n'), /bảng không có cột Nguồn/)
})

test('trích rỗng hoặc mẩu ngắn → đỏ', (t) => {
  const empty = traceCheck(card(t, { [`${CARD}/01b-ledger.md`]: LEDGER.replace('| D-01 | Cho phép lọc ứng viên theo trạng thái. |', '| D-01 |  |') }).dir)
  assert.match(empty.errors.join('\n'), /D-01: trích rỗng/)
  const frag = traceCheck(card(t, { [`${CARD}/01b-ledger.md`]: LEDGER.replace('| D-01 | Cho phép lọc ứng viên theo trạng thái. |', '| D-01 | lọc ứng viên |') }).dir)
  assert.match(frag.errors.join('\n'), /D-01: trích không khớp nguyên 1 dòng hoặc 1 câu/)
})

test('dòng Checklist không có trong ledger → đỏ (bỏ sót)', (t) => {
  const r = traceCheck(card(t, {
    [`${CARD}/01b-ledger.md`]: LEDGER.replace(/\| D-03 \|.*\n/, ''),
    [`${CARD}/brief.md`]: BRIEF.replace('- D-03: để thẻ sau\n', ''),
  }).dir)
  assert.match(r.errors.join('\n'), /01-dossier\.md:\d+ chưa có trong ledger: "Giữ bộ lọc khi chuyển trang"/)
})

test('mục con (### Scope) thuộc mục cha và vẫn phải có trong ledger', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/01-dossier.md`]: DOSSIER.replace('## Checklist', '### Scope\n- Chỉ áp dụng màn danh sách\n\n## Checklist') }).dir)
  assert.match(r.errors.join('\n'), /chưa có trong ledger: "Chỉ áp dụng màn danh sách"/)
})

test('bỏ: chỉ hợp lệ cho dòng trong Comments', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/01b-ledger.md`]: LEDGER.replace('| Checklist #2 | |', '| Checklist #2 | bỏ: không làm |') }).dir)
  assert.match(r.errors.join('\n'), /D-03: "bỏ:" chỉ dùng cho dòng trong mục Comments/)
})

test('ledger có loại (sự kiện/giả thuyết/giải pháp/quyết định/bỏ) vẫn xanh', (t) => {
  const r = traceCheck(card(t, {
    [`${CARD}/01-dossier.md`]: `# Thẻ 123: Lọc ứng viên
## Mô tả
Danh sách ứng viên mất bộ lọc khi chuyển trang.
Chắc do state bị reset trong component danh sách.
Cần lưu bộ lọc vào URL.
## Checklist
- [ ] Giữ bộ lọc khi chuyển trang
## Comments
- 🔄 Sync từ sheet row 77
`,
    [`${CARD}/01b-ledger.md`]: `# Ledger thẻ 123
| Mã | Trích nguyên văn | Vị trí | Ghi chú |
|---|---|---|---|
| D-01 | Danh sách ứng viên mất bộ lọc khi chuyển trang. | Mô tả | sự kiện |
| D-02 | Chắc do state bị reset trong component danh sách. | Mô tả | giả thuyết |
| D-03 | Cần lưu bộ lọc vào URL. | Mô tả | giải pháp |
| D-04 | Giữ bộ lọc khi chuyển trang | Checklist #1 | quyết định |
| D-05 | 🔄 Sync từ sheet row 77 | Comment 1 | bỏ: bookkeeping |

| Mã | Câu hỏi | Đáp án | Ngày |
|---|---|---|---|
| U-01 | Giữ bộ lọc khi tải lại trang? | Có | 2026-10-13 |

## Ngoài phạm vi
- D-05
`,
    [`${CARD}/brief.md`]: `> Trạng thái: CHỜ DUYỆT
# Brief 123
| # | Mục | Nguồn |
|---|---|---|
| 1 | Bộ lọc trạng thái | D-01, D-02, D-03 |
| 2 | Giữ bộ lọc | D-04, U-01 |

## Ngoài phạm vi
- D-05
`,
  }).dir)
  assert.deepEqual(r.errors, [])
})

test('design ở thư mục task con được tính', (t) => {
  const r = traceCheck(card(t, {
    [`${CARD}/brief.md`]: BRIEF.replace('- D-03: để thẻ sau\n', ''),
    [`${CARD}/task-1/03-design.md`]: '| Thành phần | Nguồn |\n|---|---|\n| Giữ filter qua URL | D-03 |\n',
  }).dir)
  assert.deepEqual(r.errors, [])
})

test('parseTables trả số dòng 1-based và biết bảng nằm dưới Phụ lục', () => {
  const [tb, ap] = parseTables('x\n| a | b |\n|---|---|\n| 1 | 2 |\n## Phụ lục\n### Chi tiết\n| c |\n|---|\n| 3 |\n')
  assert.deepEqual(tb.header, ['a', 'b'])
  assert.deepEqual(tb.rows, [{ cells: ['1', '2'], line: 4 }])
  assert.equal(tb.inAppendix, false)
  assert.equal(ap.inAppendix, true)
})

test('findCardDir: không thấy, trùng, id sai', (t) => {
  const { root } = card(t, { 'trellocards/123-khac/01-dossier.md': 'x' })
  const config = loadConfig(root).config
  assert.match(findCardDir(root, config, '999').error, /không thấy/)
  assert.match(findCardDir(root, config, '123').error, /nhiều thư mục/)
  assert.match(findCardDir(root, config, '1/2').error, /không hợp lệ/)
})

test('CLI: xanh exit 0, đỏ exit 1, không thấy thẻ exit 2', async (t) => {
  const { root } = card(t)
  const ok = capture(root)
  assert.equal(await main(['trace-check', '123'], ok.ctx), 0)
  assert.match(ok.buf.out, /trace-check: xanh/)
  fs.writeFileSync(path.join(root, CARD, 'brief.md'), BRIEF.replace('- D-03: để thẻ sau\n', ''))
  const red = capture(root)
  assert.equal(await main(['trace-check', '123'], red.ctx), 1)
  assert.match(red.buf.out, /D-03/)
  assert.equal(await main(['trace-check', '999'], capture(root).ctx), 2)
})

test('"bỏ:" is accepted for the Tiêu đề section (non-ASCII trailing letter)', t => {
  const dossier = DOSSIER.replace('## Mô tả', '## Tiêu đề\nLọc ứng viên theo trạng thái\n## Mô tả')
  const ledger = LEDGER.replace('| D-04 |', '| D-05 | Lọc ứng viên theo trạng thái | Tiêu đề | bỏ: Tiêu đề |\n| D-04 |')
  const r = traceCheck(card(t, { [`${CARD}/01-dossier.md`]: dossier, [`${CARD}/01b-ledger.md`]: ledger }).dir)
  assert.deepEqual(r.errors, [])
})

test('CLI: file:line cited in the Brief must exist (file and line range)', async (t) => {
  const { root } = card(t, { 'web/src/math.js': 'export const add = (a, b) => a + b\nexport const sub = (a, b) => a - b\n' })
  const cite = (ref) => fs.writeFileSync(path.join(root, CARD, 'brief.md'), BRIEF.replace('## Ngoài phạm vi', `## Tự quyết\n- Theo hàm anh em (\`${ref}\`).\n\n## Ngoài phạm vi`))
  cite('src/math.js:2')
  const ok = capture(root)
  assert.equal(await main(['trace-check', '123'], ok.ctx), 0, ok.buf.out)
  cite('src/math.js:7')
  const line = capture(root)
  assert.equal(await main(['trace-check', '123'], line.ctx), 1)
  assert.match(line.buf.out, /brief\.md.*src\/math\.js:7.*dòng ngoài file/)
  cite('src/missing.js:1')
  const file = capture(root)
  assert.equal(await main(['trace-check', '123'], file.ctx), 1)
  assert.match(file.buf.out, /src\/missing\.js:1.*file không tồn tại/)
})
