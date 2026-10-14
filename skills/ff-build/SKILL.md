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

Chạy `ff state <id> --json`: lấy `activeDir`, `activeRevision` và full `<slug>` của thư mục thẻ/bản copy. Đọc dossier/ledger cấp thẻ, Brief gốc hoặc delta revision và spec/design trong `activeDir`. Gate A cần `approved`, Gate B cần `approved` hoặc `auto_passed` theo bản ghi/hash; `pending`/`stale` thì chưa hợp lệ. Nếu chưa, chuyển `/ff-understand`. Nếu đã squash, chuyển `/ff-verify`.

Các gate-tools `allow`, `relock`, `lock-tests`, `probe-slice`, `ship-approve` nhận full `<slug>` như `123-ten-the`, không nhận riêng số id. Lấy slug từ state hoặc tên thư mục đã xác minh; đường dẫn file theo config.

Đọc `workspace.worktrees_dir`, `workspace.cards_dir` và repo/command từ `ff.config.yaml`. Tạo bản copy bằng `ff copy <id>`; mọi sửa code chỉ nằm trong worktree của task.

Với lint, type-check, build và test, chỉ chạy đúng command lấy từ `repos[].commands` trong worktree tương ứng. Không tự ghép command hoặc thêm cờ không có trong cấu hình.

## P1 — Test hành vi trước

Giao `ff-test-writer` theo `briefs/test-writer.md`; chỉ đưa tài liệu yêu cầu và hợp đồng, không đưa code implementation. Test phải liên kết AC và dùng dữ liệu test duy nhất.

Chạy `ff e2e-lint <e2e.tests_dir>/<slug>`, sửa dấu hiệu yếu, rồi khóa đúng test hành vi bằng `ff lock-tests <slug> <files...>`. Nếu `activeRevision` là `rev-N`, dùng `ff lock-tests <slug> --revision rev-N <files...>` cho test revision mới; manifest riêng giữ test cũ đã khóa để hồi quy. Đọc `testLock` từ state để biết manifest hiện tại và ghi hash bàn giao. Relock revision cần user và `ff relock <slug> --revision rev-N --reason "<lý do>"`, không đổi manifest gốc. Không sửa test đã khóa; nếu cần thay đổi, dừng và xin quyết định user.

## P2 — Plan và implement theo slice

Giao `ff-planner` theo `briefs/planner.md`, lưu `<activeDir>/04-plan.md` (cụm: `task-N/04-plan.md`). Truyền `activeDir`/`activeRevision` cho mọi agent; không dùng design/plan cũ khi reopen. Dùng `references/plan-slice.md` để xác định dependency, file được sửa và lệnh kiểm theo `repos[].commands`.

Mỗi đợt:

1. Mở allowlist bằng `ff allow <slug> <files...>`.
2. Giao từng micro-task cho `ff-implementer` hoặc `ff-implementer-haiku` theo plan.
3. Đọc lại diff và chạy lệnh kiểm thật trong worktree.
4. Chạy `ff probe-slice <slug> [task-N]`; sửa drift trước khi tiếp tục.
5. Giao `ff-diff-reviewer` review độc lập. Xử lý phát hiện rồi xóa allowlist bằng `ff allow <slug> --clear`.

Nếu interface đổi, cập nhật đúng task plan bị ảnh hưởng trước khi giao tiếp.

## P3 — Kiểm tra, squash và bàn giao

Theo `references/review-squash.md`: lint/build/test bằng lệnh trong config, chỉ trong worktree. Squash theo quy ước một commit mỗi repo rồi chạy `ff squash-check <id>` và `ff ac-matrix <id>`.

Báo hash test lock, kết quả slice review, squash-check, AC còn thiếu và việc cần user quyết. Sau đó hướng dẫn `/ff-verify <id>`. Không tự chạy verify hoặc push.
