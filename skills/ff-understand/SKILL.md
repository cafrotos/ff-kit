---
name: ff-understand
description: Dùng khi bắt đầu làm thẻ (user nhắc số thẻ, dossier, "làm thẻ X", yêu cầu feature/sửa bug theo thẻ) mà thẻ CHƯA có Brief được duyệt hoặc chưa có design qua Gate B; hoặc "reopen thẻ X" (mở lại thẻ đã ship). Ra Brief + design; không code. Brief + design đã duyệt thì dùng ff-build.
argument-hint: "[số thẻ | slug | 'reopen <số thẻ>']"
arguments: [card]
allowed-tools: Bash(ff decide *), Bash(ff stage *), Bash(sha256sum *), Bash(git rev-parse *), Bash(ff present *), Read, Write, Edit, Grep, Glob, Agent, Bash(ff cfg get *), Bash(ff state *), Bash(ff sync *), Bash(ff trace-check *), Bash(ff design-check *), Bash(ff ac-matrix *), Bash(ff mcp-auth *), Bash(ff copy *), Bash(ff verify-up *), Bash(ff verify-down *), Bash(ff db-query *), Bash(ff gate-auto *), Bash(ff reopen *)
---

Mọi câu hỏi cho người dùng phải dùng `AskUserQuestion`; không bao giờ kết thúc lượt bằng câu hỏi dạng văn bản thường (worker không nhận ra và phiên sẽ treo).

Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/rules.md` trước mọi việc. Phiên mở lại giữa chừng thì đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/references/resume.md`.

# ff-understand

Yêu cầu → **Brief** (user duyệt ở Gate A) → **design** (Gate B có điều kiện) → bàn giao `ff-build`.
Mục tiêu: hiểu sai lộ ra sớm, rẻ (user đọc ~2 phút), không đợi nghiệm thu.

## Điểm vào
- Thẻ: đã có `<cards_dir>/<id>-<slug>/01-dossier.md`.
- Yêu cầu tự do: chuẩn hóa thành `<cards_dir>/<id|slug>/01-dossier.md` theo `${CLAUDE_PLUGIN_ROOT}/templates/dossier.md` (Mô tả, Checklist, `## Branch`). Thiếu id/slug/branch → hỏi user 1 lượt; branch luôn lấy từ dossier, không tự đặt.
- "reopen thẻ X" → làm theo `references/reopen.md`, bỏ qua phần còn lại của file này.

## P0 — Trạng thái (làm trước tiên)
Đọc `${CLAUDE_PLUGIN_ROOT}/references/stage-protocol.md`, chạy `ff stage context <id> --json`; có pending understand thì `ff stage begin <id> --dispatch <dispatchId>` trước làm việc. Không có dispatch thì giữ cách dùng thủ công. Worker điều phối pha kế tiếp sau finish.

```bash
ff sync --check
ff state <id> --json
```
- `sync --check` báo lỗi → dừng, báo nguyên văn lỗi, không force/stash.
- Đọc `activeRevision` (null hoặc `rev-N`) và `activeDir` (đường dẫn tương đối workspace) từ JSON. Dossier và ledger cấp thẻ vẫn ở thư mục thẻ; Brief/Gate A gốc là `brief.md`, Gate A revision là `<activeDir>/delta.md`; spec/design/report lấy trong `activeDir`.
- Chỉ bản ghi Gate và hash là nguồn duyệt. Gate A cần `approved`; Gate B cần `approved` hoặc `auto_passed`. `pending`/`stale` → làm tiếp phần chưa hợp lệ ở `/ff-understand`; không dùng marker trong tài liệu để định tuyến.
- Gate A/B hiện tại hợp lệ → hoàn tất receipt understand nếu có dispatch theo mục Bàn giao, rồi báo "Gọi `/ff-kit:ff-build <id>`", không làm lại. Có Brief/delta chờ duyệt → Gate A; Gate A hợp lệ, thiếu design → P2.

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

## Kết quả cho người dùng

Đọc `${CLAUDE_PLUGIN_ROOT}/references/human-output.md`; Brief/spec/design vẫn là hợp đồng cho agent. Hoàn thiện Brief rồi tạo packet `phase: understand`, chạy `ff present <id> --file <activeDir>/human-output.json --gate GATE_A` và in văn bản render trong chat. Giải thích chức năng, AS-IS, yêu cầu, TO-BE, ảnh hưởng, ví dụ nghiệm thu và điều chưa chắc trước các quyết định.

## Gate A (bắt buộc)
- Lượt `Q<n>`: câu cần chọn trước (≤4 câu/lượt, trả lời ghi vào ledger thành `U-xx`). Khi định bỏ Q mềm vì đoán được phản ứng: tạo packet hiện hành có decisionContext {repo,businessScope,decisionKey,class,normalizedOptions} (map label → value), chạy `ff decide <id> --class <class> --decision-key <key> --repo <repo> --question <text> --options "a|b"`. Xem `${CLAUDE_PLUGIN_ROOT}/references/decision-classes.md`. Chỉ verdict proceed mới bỏ Q: ghi ledger nguồn precedent và evidence; escalate thì hỏi người. Không thêm decisionContext vào AskUserQuestion. Ba lượt `Q` liền mà vẫn không đoán được: nói thẳng dossier thiếu gì (ai dùng, vì sao, thế nào là xong).
- Trước khi trình: `ff trace-check <id>` phải xanh; giao một `ff-gate-reader` mới chỉ văn bản render của `present` và pha `understand` theo `briefs/gate-reader.md`. Trả `THIẾU:` thì viết lại, tối đa **2 vòng**, sau đó trình kèm ghi chú phần còn khó hiểu.
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
Sau checks/review, tạo packet `phase: design` theo recipe chung và in kết quả `ff present <id> --file <activeDir>/human-output.json` để giải thích hiện thực, khác biệt và ảnh hưởng. Giao reader mới đọc bản render pha `design`. Nếu cần hỏi Gate B, chạy lại với `--gate GATE_B` trước lượt duyệt riêng.

Tự chạy tiếp. **Chỉ dừng** khi: hợp đồng có dòng MỚI (bảng đối chiếu) · lệch precedent · còn "Cần bạn chọn" chưa xử lý. Nếu dừng, trình riêng bằng `AskUserQuestion` header `GATE_B` (câu hỏi bắt đầu `[#<id>]` (revision: `[#<id>] [rev-N]`; cụm có thể thêm `[task-N]`)). Không có điều kiện dừng thì ghi metadata `gate_b` gồm ba boolean `false` theo `references/design.md`, rồi chạy `ff gate-auto <id> --reason "<căn cứ theo hợp đồng/precedent>"`; CLI tạo Gate B `auto_passed` ràng buộc hash Gate A, design, spec, ledger và dossier hiện tại. Đọc lại state để xác nhận. Auto pass không phải user duyệt; marker trong design chỉ để hiển thị, không thay bản ghi.

## Ranh giới dừng hỏi
Chỉ dừng khi đúng 1 trong 4: (1) không đảo ngược/tốn kém khi sai (migration, đổi mô hình, xóa dữ liệu) hoặc làm dữ liệu/thao tác đang có bị từ chối, chặn, ghi đè; (2) thêm hành vi dossier không xin; (3) hai cách hiểu → mô hình dữ liệu khác; (4) quyền/role ảnh hưởng ai thấy gì. Trong 4 ranh giới này, dù đoán được câu trả lời cũng dừng hỏi bằng `AskUserQuestion`. Câu mềm định bỏ vì đoán được phải qua ff decide như trên; thiếu tiền lệ thì hỏi người. Khoảng trống dossier không nói: theo khuôn THIẾU YÊU CẦU trong `references/brief.md` (căn cứ code thay cho ff decide).

## Bàn giao
Nếu đã begin dispatch, lưu evidence theo protocol và gọi `ff stage finish <id> --dispatch <dispatchId> --outcome pass --evidence <file>` chỉ khi `readyForBuild` hiện tại true. Khi lỗi/kẹt, finish `implementation_failed`/`environment_blocked`/`needs_human` kèm chẩn đoán thật. Worker gọi pha tiếp theo, không tự gọi build. Nếu finish `needs_human`/`environment_blocked`/`implementation_failed` rồi user xử lý nguyên nhân ngay trong phiên này: chạy lại các check của pha và ghi finish thay thế `ff stage finish <id> --dispatch <đúng dispatchId cũ> --outcome pass --evidence <file>` (chỉ thay được receipt lỗi, không thay được pass); tuyệt đối không tự chạy `ff worker resolve` — đó là lệnh của user.

Design qua Gate B → in đúng dòng: **"Bàn giao: gọi `/ff-kit:ff-build <id>`"**. Không tự code. Nếu đã bật môi trường quan sát, chạy `ff verify-down <id>` và xác nhận cleanup trước bàn giao. Task Nhỏ vẫn cần Gate C ở `/ff-verify`.
