# Ship sau khi user xác nhận

Verify PASS không đồng nghĩa với đồng ý ship. Chỉ gọi `/ship-to-dev` sau khi Gate C của `activeRevision` hợp lệ với report trong `activeDir` và user yêu cầu ship.

1. Dừng môi trường kiểm thử bằng `ff verify-down <id>` nếu đang chạy.
2. Đọc `commands/ship-to-dev.md` trong plugin. Xác nhận repo, source branch, `base_branch`, `ship_branch`, commit và worktree bằng `ff state <id> --json`, `ff squash-check` cùng cấu hình.
3. Trình packet ship qua `ff present` theo `${CLAUDE_PLUGIN_ROOT}/references/human-output.md`: phạm vi đã nghiệm thu, đích, checks, giới hạn và trạng thái chờ push. `ff ship-request` là thông báo tùy chọn; worker vắng không chặn xác nhận ở CLI. Trình riêng yêu cầu xác nhận có tên repo, branch và hash. Nếu user từ chối, dừng.
4. Chỉ sau khi user chọn `Duyệt`, thực hiện cơ chế `ff ship-approve <slug>` (full slug lấy từ state) nếu guard yêu cầu. Fetch và tích hợp commit đã duyệt vào `ship_branch` theo command; chạy build/test cấu hình trước push. Có thay đổi bất ngờ, conflict chưa hiểu hoặc kiểm tra lỗi thì dừng, giữ nguyên worktree và báo trạng thái.
5. Sau push, xác minh remote chứa commit đã duyệt. Trình packet ship cập nhật, chỉ báo đã ship khi đã xác minh remote; nêu hash, repo, đích và checks thực tế; không tự xóa worktree, dossier hoặc test artifacts.

Không hardcode tên repo, branch, remote, lệnh build/test hay thư mục task. Lấy chúng từ `ff.config.yaml` và `ff state`.
