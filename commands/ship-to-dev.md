---
description: Ship các commit đã squash sang ship_branch sau khi user xác nhận Gate C và yêu cầu ship
argument-hint: "[id | slug]"
allowed-tools: Bash(ff cfg get *), Bash(ff state *), Bash(ff squash-check *), Bash(ff ship-request *), Bash(ff ship-approve *), Bash(git *), Read
---

# /ship-to-dev

Chỉ chạy sau khi Gate C đã có bản ghi `Duyệt`. Đọc dossier, `05-verify-report.md`, `ff state <id>` và `ff squash-check <id>`. Lấy repo path, `base_branch`, `ship_branch`, build/test command từ `ff.config.yaml`; không dùng tên repo/branch mặc định.

## 1. Kiểm tra và trình yêu cầu

Với từng repo có commit cần ship:

- Xác nhận worktree sạch, branch đúng task và commit thuộc task này.
- Xác nhận source branch được tách từ `base_branch`; không force push, stash hoặc đổi cấu hình remote.
- Chạy `ff ship-request --task <id> --title "Ship <id>" --body "<repo, branch và commit cần ship>"`.
- Trình riêng một `AskUserQuestion` với header `Q1`, nêu repo/branch/hash và hỏi xác nhận push.

Nếu user từ chối hoặc yêu cầu sửa, dừng. Chỉ khi user chọn `Duyệt`, chạy `ff ship-approve <slug>`; guard có thể yêu cầu xác nhận thêm.

## 2. Cập nhật ship branch

Trong từng repo, fetch remote rồi checkout đúng `ship_branch`. Nếu branch có thay đổi ngoài dự kiến hoặc xung đột chưa hiểu rõ, dừng và báo user. Cherry-pick commit đã squash bằng `-x`; xử lý conflict chỉ theo ý định đã duyệt.

Chạy build và test theo `repos[].commands`. Nếu lệnh thiếu hoặc thất bại, dừng, không push.

## 3. Push và kiểm tra

Trước push, đọc lại diff/commit và xác nhận chỉ có commit đã duyệt. Push branch đã cấu hình, không push branch gốc. Sau push, xác nhận remote chứa commit và báo hash.

Không tự xóa worktree, dossier hoặc e2e artifacts. Không đánh dấu hoàn tất nếu push chưa được xác minh.
