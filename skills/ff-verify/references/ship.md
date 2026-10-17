# Ship

Verify PASS không đồng nghĩa với đồng ý ship. Chỉ gọi `/ship-to-dev` sau khi Gate C của `activeRevision` hợp lệ với report trong `activeDir`: `auto_passed` (qua `ff gate-auto --gate GATE_C`) hoặc `approved` bởi user và user yêu cầu ship.

**Đường tự động** (Gate C `auto_passed`): pha ship (worker dispatch, hoặc user chạy `/ship-to-dev`) chạy `ff ship-approve <slug> --auto` rồi `ff ship <id>`, không hỏi user. Verify không tự gọi ship. Conflict/build đỏ → `needs_human`, dừng. CLI thông báo user sau ship. **Đường người** (Gate C `approved`): xác nhận ship riêng như dưới, không dùng `--auto`.

1. Dừng môi trường kiểm thử bằng `ff verify-down <id>` nếu đang chạy.
2. Push dùng lại đúng commit đã test (`ff-test/<id>`) nếu `origin/<ship_branch>` chưa đổi; nếu đã tiến, `ff ship` cherry-pick lại rồi chạy build + test, conflict hoặc đỏ thì chặn `needs_human`. Không cherry-pick tay.
3. Tiếp tục theo `commands/ship-to-dev.md`; cấu hình và `ff state` là nguồn repo/nhánh/commit. Trình ship approval riêng, sau đó chạy `ff ship <id>`.
4. CLI kiểm receipts và approvals, thực hiện checkpoints, rồi trả hashes/checks/PR. Đọc kết quả và báo việc đã xác minh; không thực hiện Git ship commands tách rời.

Không hardcode tên repo, branch, remote, lệnh build/test hay thư mục task. Lấy chúng từ `ff.config.yaml` và `ff state`.

**Điều kiện và lỗi:** `ff ship` bị chặn thì stderr liệt kê MỌI điều kiện còn thiếu, mỗi dòng `[mã] cách sửa`; báo nguyên các dòng đó cho user, không tự đoán. Driver bật: cần receipt build + verify. Driver tắt (worker legacy hoặc thẻ làm tay, không có dispatch): bằng chứng tương đương là Gate C của revision hiện tại + bản ghi `ff ship-test` khớp SHA + test lock nguyên vẹn. Mỗi repo phải có `commands.build` và `commands.test` trong `ff.config.yaml` (ship chạy chúng trên commit sắp push).

**Push kết quả đã test từ checkout `<slug>.test/`:** user chạy `ff ship-approve <slug>.test` (luôn hỏi; cần ship-test khớp SHA) để guard cho phép push từ đó. Đường khuyến nghị vẫn là `ff ship <id>`. Chưa có lệnh này chạy xong thì không được báo "đang chờ" như thể đã push.

