---
name: ff-understand
description: Dùng khi cần hiểu yêu cầu, tạo Brief hoặc design cho một task nhưng chưa có Gate tương ứng được duyệt. Hỗ trợ dossier trong workspace và yêu cầu tự do.
argument-hint: "[id | slug | reopen <id>]"
allowed-tools: Read, Grep, Glob, Bash(ff cfg get *), Bash(ff state *), Bash(ff sync *), Bash(ff trace-check *), Bash(ff design-check *), Bash(ff ac-matrix *)
---

Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/rules.md` trước khi làm.

# ff-understand

Yêu cầu → ledger → Brief (Gate A) → design (Gate B khi cần) → bàn giao `/ff-build`.
Không sửa code sản phẩm trong skill này.

## P0 — Xác định task

1. Tìm `ff.config.yaml` qua `ff cfg get workspace.cards_dir` và đọc dossier `<cards_dir>/<id>-<slug>/01-dossier.md`.
2. Nếu user đưa yêu cầu tự do, tạo thư mục dossier theo `templates/dossier.md`. Nếu thiếu id hoặc branch và việc đó ảnh hưởng cách làm, hỏi user.
3. Chạy `ff sync --check`, sau đó `ff state <id>`. Nếu Gate A/B đã hợp lệ theo bản ghi và hash, chuyển sang bước tiếp theo thay vì làm lại.
4. Nếu là reopen, theo `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/references/reopen.md`.

## P1 — Ledger và Brief

Đọc toàn bộ dossier trước khi đọc code. Tạo `01b-ledger.md`: mỗi yêu cầu hoặc quyết định có mã `D-xx`/`U-xx` và trích nguyên văn nguồn. Bỏ qua comment chỉ đồng bộ dữ liệu.

Theo `references/brief.md`: phân loại từng yêu cầu, ghi Trước → Sau, trả lời câu hỏi cần thiết, khảo sát repo theo cấu hình và dẫn nguồn `file:line`. Với bug, ghi triệu chứng, các giả thuyết cạnh tranh và phép thử loại trừ trước khi kết luận. Lấy repo, role, lệnh và URL từ `ff.config.yaml` bằng `ff cfg get`.

Task lớn thì đọc `references/big-task.md`. Khi cần quan sát app, giao `ff-observer` theo `briefs/observe.md`; không tự đoán kết quả runtime.

### Câu hỏi và Gate A

Hỏi quyết định nghiệp vụ trước Gate, tối đa 4 câu mỗi lượt; dùng `AskUserQuestion` với header `Q<n>`, ghi câu hỏi và câu trả lời vào ledger thành `U-xx`. Sau khi hết câu cần chọn, trình riêng Gate A bằng `AskUserQuestion`, header `GATE_A`, câu hỏi bắt đầu `[#<id>]`, hai lựa chọn `Duyệt` và `Cần sửa`.

Trước khi trình, chạy `ff trace-check <id>` và giao `ff-gate-reader` đọc phần chính của Brief. Chỉ câu trả lời đúng `Duyệt` mới được ghi nhận là duyệt; hook ghi bản ghi Gate và hash. Không tự ghi marker duyệt hoặc sửa artifact sau khi đã duyệt.

## P2 — Design và Gate B

Theo `references/design.md`: mọi yêu cầu/AC có nguồn `D-xx` hoặc `U-xx`; tham chiếu code ghi `file:line`; kiểm tra design bằng `ff design-check <id>` và `ff trace-check <id>`.

Gate B chỉ cần user duyệt khi có hành vi mới, lệch precedent hoặc còn quyết định ảnh hưởng kết quả. Câu hỏi lựa chọn dùng `Q<n>` trước; Gate B là lượt riêng `GATE_B`. Nếu không có thay đổi cần duyệt, ghi trạng thái tự qua theo khuôn tài liệu và để `ff state` xác nhận.

## Bàn giao

Khi Brief và design sẵn sàng, nêu trạng thái Gate theo `ff state` rồi hướng dẫn gọi `/ff-build <id>`. Không tự code.
