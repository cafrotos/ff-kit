# Ship sau khi user xác nhận

Verify PASS không đồng nghĩa với đồng ý ship. Chỉ gọi `/ship-to-dev` sau khi Gate C của `activeRevision` hợp lệ với report trong `activeDir` và user yêu cầu ship.

1. Dừng môi trường kiểm thử bằng `ff verify-down <id>` nếu đang chạy.
2. Push dùng lại đúng commit đã test (`ff-test/<id>`) nếu `origin/<ship_branch>` chưa đổi; nếu đã tiến, `ff ship` cherry-pick lại rồi chạy build + test, conflict hoặc đỏ thì chặn `needs_human`. Không cherry-pick tay.
3. Tiếp tục theo `commands/ship-to-dev.md`; cấu hình và `ff state` là nguồn repo/nhánh/commit. Trình ship approval riêng, sau đó chạy `ff ship <id>`.
4. CLI kiểm receipts và approvals, thực hiện checkpoints, rồi trả hashes/checks/PR. Đọc kết quả và báo việc đã xác minh; không thực hiện Git ship commands tách rời.

Không hardcode tên repo, branch, remote, lệnh build/test hay thư mục task. Lấy chúng từ `ff.config.yaml` và `ff state`.
