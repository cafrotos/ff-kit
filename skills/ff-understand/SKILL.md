---
name: ff-understand
description: Dùng khi bắt đầu làm thẻ (user nhắc số thẻ, dossier, "làm thẻ X", yêu cầu feature/sửa bug theo thẻ) mà thẻ CHƯA có Brief được duyệt hoặc chưa có design qua Gate B; hoặc "reopen thẻ X" (mở lại thẻ đã ship). Ra Brief + design; không code. Brief + design đã duyệt thì dùng ff-build.
argument-hint: "[số thẻ | slug | 'reopen <số thẻ>']"
arguments: [card]
allowed-tools: Read, Write, Edit, Grep, Glob, Agent, Bash(ff cfg get *), Bash(ff state *), Bash(ff sync *), Bash(ff trace-check *), Bash(ff design-check *), Bash(ff ac-matrix *), Bash(ff mcp-auth *), Bash(ff copy *), Bash(ff verify-up *), Bash(ff verify-down *), Bash(ff db-query *), Bash(ff gate-auto *), Bash(ff reopen *)
---

Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/rules.md` trước mọi việc. Phiên mở lại giữa chừng thì đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/references/resume.md`.

# ff-understand

Yêu cầu → **Brief** (user duyệt ở Gate A) → **design** (Gate B có điều kiện) → bàn giao `ff-build`.
Mục tiêu: hiểu sai lộ ra sớm, rẻ (user đọc ~2 phút), không đợi nghiệm thu.

## Điểm vào
- Thẻ: đã có `<cards_dir>/<id>-<slug>/01-dossier.md`.
- Yêu cầu tự do: chuẩn hóa thành `<cards_dir>/<id|slug>/01-dossier.md` theo `${CLAUDE_PLUGIN_ROOT}/templates/dossier.md` (Mô tả, Checklist, `## Branch`). Thiếu id/slug/branch → hỏi user 1 lượt; branch luôn lấy từ dossier, không tự đặt.
- "reopen thẻ X" → làm theo `references/reopen.md`, bỏ qua phần còn lại của file này.

## P0 — Trạng thái (làm trước tiên)
```bash
ff sync --check
ff state <id> --json
```
- `sync --check` báo lỗi → dừng, báo nguyên văn lỗi, không force/stash.
- Đọc `activeRevision` (null hoặc `rev-N`) và `activeDir` (đường dẫn tương đối workspace) từ JSON. Dossier và ledger cấp thẻ vẫn ở thư mục thẻ; Brief/Gate A gốc là `brief.md`, Gate A revision là `<activeDir>/delta.md`; spec/design/report lấy trong `activeDir`.
- Chỉ bản ghi Gate và hash là nguồn duyệt. Gate A cần `approved`; Gate B cần `approved` hoặc `auto_passed`. `pending`/`stale` → làm tiếp phần chưa hợp lệ ở `/ff-understand`; không dùng marker trong tài liệu để định tuyến.
- Gate A/B hiện tại hợp lệ → báo "Gọi `/ff-kit:ff-build <id>`", không làm lại. Có Brief/delta chờ duyệt → Gate A; Gate A hợp lệ, thiếu design → P2.

## Cỡ task (đếm từ dossier, trước khi đọc code)
Nhỏ / Vừa / Lớn theo `rules.md` mục 7. **Lớn** → `references/big-task.md` (Brief thẻ → cụm → slice). Nhỏ: Brief + design gộp 1 trang, bỏ P1b trừ khi có dòng MỚI.

## P1 — Hiểu yêu cầu → Brief
Chi tiết + khuôn: `references/brief.md`. Thứ tự:
0. **Lập `01b-ledger.md` trước khi đọc code** (khuôn ở `references/brief.md`): mỗi dòng/câu dossier một mã `D-xx`, cột Ghi chú gắn loại `sự kiện` / `giả thuyết` / `giải pháp` / `quyết định` / `bỏ: <lý do>`.
1. Đọc **toàn bộ** dossier, lọc comment bookkeeping (sync sheet, ngày đồng bộ) — chỉ comment quyết định thật mới dùng.
2. Gắn **một** nhãn Fix / Nâng cấp / Mới cho **từng mục** dossier; viết cặp Trước→Sau; trả lời bảy câu hỏi.
   - *Với mục Fix bug*: Áp dụng Khung chẩn đoán lỗi (Triệu chứng Symptom theo role/dữ liệu, nếu nguyên nhân chưa rõ, cây giả thuyết cạnh tranh và phép thử phản chứng trước khi kết luận; bug Nhỏ đã tái hiện và có nguyên nhân trực tiếp thì ghi bằng chứng + test hồi quy, không dựng giả thuyết cho đủ, Khoanh vùng Là / Không là, bảng kiểm, nguyên nhân gốc dừng ở quy trình).
3. Khảo sát code theo **Tam giác đạc** (Code qua Codegraph - DB qua `project_docs.verification_queries_dir` - Runtime UI; đối chiếu config tại `project_docs.roles_file`).
4. Chuẩn bị quan sát khi cần: đọc `workspace.worktrees_dir`, `e2e.apps` và health URL từ config; `ff copy <id>` rồi `ff verify-up <id> <app>`. Xác nhận health và lock đúng thẻ trước khi giao `ff-observer` theo `briefs/observe.md`. DB chỉ đọc qua `ff db-query` theo query đã cấu hình. Không sửa code sản phẩm, không tự chạy migration hay thay service. Health fail → giữ lock, dọn bằng `ff verify-down <id>` trước khi bàn giao; không force-release lock khác. Không gọi Playwright trực tiếp.
5. Diễn tập 5–8 tình huống role × thao tác trên giấy.
6. Viết `brief.md` trang 1 (≤1 trang) + phụ lục `brief-chi-tiet.md` nếu cần.

## P1b — Phá Brief (bỏ qua với task Nhỏ không có dòng MỚI)
Spawn `ff-brief-adversary` (sonnet) theo `briefs/adversary.md`; nhận ledger + dossier + Brief theo `references/doubt.md` (không nhận kết luận người viết). Tự đối chiếu từng lỗi nó nêu với code rồi sửa Brief; phân loại phát hiện theo `doubt.md`; không tin báo cáo mù.

## Gate A (bắt buộc)
- Lượt `Q<n>`: câu cần chọn trước (≤4 câu/lượt, trả lời ghi vào ledger thành `U-xx`). Dừng hỏi khi đoán được phản ứng của người duyệt với ba câu kế tiếp. Ba lượt `Q` liền mà vẫn không đoán được: nói thẳng dossier thiếu gì (ai dùng, vì sao, thế nào là xong).
- Trước khi trình: `ff trace-check <id>` phải xanh; giao `ff-gate-reader` đọc phần chính. Trả `THIẾU:` thì viết lại, tối đa **2 vòng**, sau đó trình kèm ghi chú phần còn khó hiểu.
- Lượt duyệt riêng: `AskUserQuestion` header `GATE_A`, câu hỏi bắt đầu `[#<id>]` (revision: `[#<id>] [rev-N]`; cụm có thể thêm `[task-N]`), lựa chọn `Duyệt` / `Cần sửa`. Chỉ `Duyệt` mới là duyệt; hook ghi bản ghi Gate + hash. Không tự ghi marker duyệt, không sửa Brief sau khi đã duyệt.

## P2 — Design
Chi tiết: `references/design.md`. Sinh spec/AC từ Brief (mỗi AC có cột **Nguồn**), `03-design.md` gồm:
- Phần 0 hợp đồng: Type/DTO/API/UI/ngân sách request.
- **Mục 0.5 DB Verification Contract**: câu SQL SELECT kiểm chứng trạng thái DB sau mỗi thao tác (tham khảo `project_docs.verification_queries_dir`).
- Phương án có sẵn: các dòng ledger loại `giải pháp`, mỗi phương án nêu nguyên nhân gốc nó xử lý hoặc nhãn "chữa triệu chứng".
- Cụm/slice theo chủ file.
Chạy:
```bash
ff design-check <id> [task-N]
ff trace-check <id>
```
Spawn `ff-design-reviewer` (sonnet, `briefs/design-review.md`); tự đối chiếu rồi sửa.

## Gate B
Tự chạy tiếp. **Chỉ dừng** khi: hợp đồng có dòng MỚI (bảng đối chiếu) · lệch precedent · còn "Cần bạn chọn" chưa xử lý. Nếu dừng, trình riêng bằng `AskUserQuestion` header `GATE_B` (câu hỏi bắt đầu `[#<id>]` (revision: `[#<id>] [rev-N]`; cụm có thể thêm `[task-N]`)). Không có điều kiện dừng thì ghi metadata `gate_b` gồm ba boolean `false` theo `references/design.md`, rồi chạy `ff gate-auto <id> --reason "<căn cứ theo hợp đồng/precedent>"`; CLI tạo Gate B `auto_passed` ràng buộc hash Gate A, design, spec, ledger và dossier hiện tại. Đọc lại state để xác nhận. Auto pass không phải user duyệt; marker trong design chỉ để hiển thị, không thay bản ghi.

## Ranh giới dừng hỏi
Chỉ dừng khi đúng 1 trong 4: (1) không đảo ngược/tốn kém khi sai (migration, đổi mô hình, xóa dữ liệu); (2) thêm hành vi dossier không xin; (3) hai cách hiểu → mô hình dữ liệu khác; (4) quyền/role ảnh hưởng ai thấy gì. Trong 4 ranh giới này, dù đoán được câu trả lời cũng dừng hỏi bằng `AskUserQuestion`. Còn lại: tự quyết, ghi "Cần bạn chọn" kèm mặc định, chạy tiếp.

## Bàn giao
Design qua Gate B → in đúng dòng: **"Bàn giao: gọi `/ff-kit:ff-build <id>`"**. Không tự code. Nếu đã bật môi trường quan sát, chạy `ff verify-down <id>` và xác nhận cleanup trước bàn giao. Task Nhỏ vẫn cần Gate C ở `/ff-verify`.
