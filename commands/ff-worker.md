---
description: Quản lý ff-worker trong workspace hiện tại
argument-hint: "<start|stop|status|logs>"
allowed-tools: Bash(ff worker *)
---

Chạy `ff worker $ARGUMENTS` và báo đúng kết quả. `start` chạy doctor trước và chỉ bật worker khi nhóm core/worker xanh. Không tự chạy `start` từ `/ff-init` hoặc `INSTALL.md`.

Harness là opt-in: mặc định `worker.driver.enabled: false`; bật cần Trello
`accept_list`/`reopen_list` hợp lệ và snapshot CLI/Claude capability check xanh.
Khi notify, hướng dẫn attach đúng session, đọc và trả lời trong Claude CLI;
worker tự gọi pha tiếp theo sau evidence. Không yêu cầu người nhập lệnh chuyển
pha, không clear/kill/recreate session. Rocket.Chat chỉ notify, không nhận approval.

Báo `status`, `state <id> --json` hoặc `logs` khi blocked/setup/unknown; verify
preflight lỗi lưu `environment_blocked`, không tự mở repair implementation. Khi
setup đã sửa, worker kiểm preflight mới đúng revision/HEAD/failure, giữ receipt lỗi
và tự cấp dispatch verify mới; không cần lệnh chuyển pha hay xóa block thủ công.
Recovery này không xóa block pin/identity/unknown hoặc tăng repair cycles.
Gate A/B/C và ship confirmation là quyết định riêng. `dev_only` cần nghiệm thu
CLI sau S1; `dev_and_pr` chờ người merge mọi PR đúng HEAD. Conflict/unknown không
hủy S1 hoặc cho phép done sớm; không tự rebase/merge/force push. Reopen giữ cùng
UUID/tmux và tạo delta; PR đóng/merge/task done cần Fix mới. Push không chứng minh
deploy. Harness fake-service smoke chưa thay nghiệm thu live pane probe: chưa
chứng minh được idle/input rỗng thì phải fail closed.
