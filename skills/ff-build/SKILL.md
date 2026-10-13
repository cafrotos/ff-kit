---
name: ff-build
description: Dùng để triển khai task sau khi Brief và design đã qua Gate A/B; tạo test hành vi, lập plan, code trong worktree, review và squash.
argument-hint: "[id | slug]"
allowed-tools: Read, Edit, Write, Grep, Glob, Agent, Bash, Bash(ff cfg get *), Bash(ff state *), Bash(ff copy *), Bash(ff e2e-lint *), Bash(ff lock-tests *), Bash(ff allow *), Bash(ff probe-slice *), Bash(ff ac-matrix *), Bash(ff squash-check *)
---

Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/rules.md` trước khi làm.

# ff-build

Brief và design đã duyệt → test hành vi khóa → plan → implement theo đợt → review → squash → bàn giao `/ff-verify`.

## P0 — Trạng thái và điều kiện vào

Chạy `ff state <id>` và đọc dossier, Brief, design. Gate A và Gate B phải hợp lệ theo bản ghi/hash. Nếu chưa, chuyển `/ff-understand`. Nếu đã squash, chuyển `/ff-verify`.

Đọc `workspace.worktrees_dir`, `workspace.cards_dir` và repo/command từ `ff.config.yaml`. Tạo bản copy bằng `ff copy <id>`; mọi sửa code chỉ nằm trong worktree của task.

Với lint, type-check, build và test, chỉ chạy đúng command lấy từ `repos[].commands` trong worktree tương ứng. Không tự ghép command hoặc thêm cờ không có trong cấu hình.

## P1 — Test hành vi trước

Giao `ff-test-writer` theo `briefs/test-writer.md`; chỉ đưa tài liệu yêu cầu và hợp đồng, không đưa code implementation. Test phải liên kết AC và dùng dữ liệu test duy nhất.

Chạy `ff e2e-lint <e2e.tests_dir>/<slug>`, sửa dấu hiệu yếu, rồi khóa đúng test hành vi bằng `ff lock-tests <id> <files...>`. Ghi hash manifest để đối chiếu khi bàn giao. Không sửa test đã khóa; nếu cần thay đổi, dừng và xin quyết định user.

## P2 — Plan và implement theo slice

Giao `ff-planner` theo `briefs/planner.md`, lưu plan trong thư mục task. Dùng `references/plan-slice.md` để xác định dependency, file được sửa và lệnh kiểm theo `repos[].commands`.

Mỗi đợt:

1. Mở allowlist bằng `ff allow <id> <files...>`.
2. Giao từng micro-task cho `ff-implementer` hoặc `ff-implementer-haiku` theo plan.
3. Đọc lại diff và chạy lệnh kiểm thật trong worktree.
4. Chạy `ff probe-slice <id> [task-N]`; sửa drift trước khi tiếp tục.
5. Giao `ff-diff-reviewer` review độc lập. Xử lý phát hiện rồi xóa allowlist bằng `ff allow <id> --clear`.

Nếu interface đổi, cập nhật đúng task plan bị ảnh hưởng trước khi giao tiếp.

## P3 — Kiểm tra, squash và bàn giao

Theo `references/review-squash.md`: lint/build/test bằng lệnh trong config, chỉ trong worktree. Squash theo quy ước một commit mỗi repo rồi chạy `ff squash-check <id>` và `ff ac-matrix <id>`.

Báo hash test lock, kết quả slice review, squash-check, AC còn thiếu và việc cần user quyết. Sau đó hướng dẫn `/ff-verify <id>`. Không tự chạy verify hoặc push.
