---
description: Ship các commit đã squash sang ship_branch sau khi user xác nhận Gate C và yêu cầu ship
argument-hint: "[id | slug]"
allowed-tools: Bash(ff present *), Bash(ff cfg get *), Bash(ff state *), Bash(ff squash-check *), Bash(ff ship-request *), Bash(ff ship-approve *), Bash(git *), Read, Write, Edit
---

# /ship-to-dev

Chạy `ff state <id> --json`; lấy `activeDir`, `activeRevision`, `slug` và `testLock`. Chỉ chạy sau khi Gate C hiện tại là `approved` theo bản ghi/hash. Đọc dossier, `<activeDir>/05-verify-report.md` và `ff squash-check <id>`; không dùng report hoặc Gate C revision cũ. Lấy repo path, `base_branch`, `ship_branch`, build/test command từ `ff.config.yaml`; không dùng tên repo/branch mặc định.

## 1. Kiểm tra và trình yêu cầu

Đọc `${CLAUDE_PLUGIN_ROOT}/references/human-output.md`. Tạo packet `phase: ship` từ spec/design/report hiện tại: phạm vi Gate C đã chấp nhận, đích repo/remote/branch/hash, checks đã chạy và giới hạn. Chạy `ff present <id> --file <activeDir>/human-output.json` rồi in bản render trong chat; trước push, `nextAction` nêu đang chờ xác nhận ship riêng, không báo đã ship.

Với từng repo có commit cần ship:

- Xác nhận worktree sạch, branch đúng task và commit thuộc task này.
- `ff.localOnly=true` nghĩa là bản copy không có upstream và không được ship. Kiểm `origin` đúng remote thật; `ff-local` chỉ là nguồn lịch sử từ bản gương, không phải đích push.
- Xác nhận source branch được tách từ `base_branch`; không force push, stash hoặc đổi cấu hình remote.
- Nếu cần thông báo riêng, chạy `ff ship-request --task <id> --title "Ship <id>" --body "<repo, branch và commit cần ship>"`. Worker không chạy/gửi thất bại không chặn lượt xác nhận CLI; thông báo chỉ tùy chọn, không cấp quyền. Timeout là giao chưa rõ, không thử lại mù.
- Trình riêng một `AskUserQuestion` với header `Q1`, nêu repo/branch/hash và hỏi xác nhận push.

Nếu user từ chối hoặc yêu cầu sửa, dừng. Chỉ khi user chọn `Duyệt`, chạy `ff ship-approve <slug>`; guard có thể yêu cầu xác nhận thêm.

## 2. Cập nhật ship branch

Trong từng repo, fetch remote rồi checkout đúng `ship_branch`. Nếu branch có thay đổi ngoài dự kiến hoặc xung đột chưa hiểu rõ, dừng và báo user. Cherry-pick commit đã squash bằng `-x`; xử lý conflict chỉ theo ý định đã duyệt.

Chạy build và test theo `repos[].commands`. Nếu lệnh thiếu hoặc thất bại, dừng, không push. Revision giữ nguyên commit đã ship; chỉ chọn/squash commit trong khoảng `revision.json.bases[repo.name]..HEAD` của bản copy hiện tại, trailer `Trello: #<id>` và `Rev: N`. Snapshot base do `ff reopen`/`ff copy` lưu; thiếu hoặc không còn là ancestor của HEAD thì dừng, không tự lấy base_branch thay thế.

## 3. Push và kiểm tra

Trước push, đọc lại diff/commit và xác nhận chỉ có commit đã duyệt. Push branch đã cấu hình, không push branch gốc. Sau push, xác nhận remote chứa commit và báo hash. Cập nhật packet ship với kết quả push đã xác minh, đích/hash, checks thực tế và giới hạn còn lại; chạy lại `ff present` và in bản render. Push lỗi hoặc chưa xác minh thì nêu trạng thái đó, không báo đã ship.

Sau khi push đã được xác minh và cây sạch, chuyển bản copy về đúng nhánh task lấy từ dossier bằng `git switch <task-branch>`. Không để bản copy ở ship_branch khi bàn giao hoặc reopen; `ff reopen` kiểm nhánh task trước khi lưu baseline revision. Nếu switch thất bại, báo rõ nhánh hiện tại để user xử lý, không đánh dấu bước phục hồi nhánh là đã xong.

Không tự xóa worktree, dossier hoặc e2e artifacts. Không đánh dấu hoàn tất nếu push chưa được xác minh.
