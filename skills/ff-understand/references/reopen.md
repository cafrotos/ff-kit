# Mở lại task đã có tài liệu

Reopen là một lần thay đổi tiếp theo của task, vẫn phải phân loại Fix, nâng cấp hoặc yêu cầu mới. Đối chiếu phản hồi với Brief, AC, Gate và báo cáo ship gần nhất.

1. Chạy `ff state <id>` và đọc dossier cùng các artifact đã duyệt. Xác định phản hồi mới, nguồn/ngày và AC liên quan.
2. Tái hiện lỗi hiện tại trước khi sửa. Với cải tiến, ghi nhận hành vi đang chạy.
3. Phân loại: AC đã yêu cầu nhưng implementation sai là lỗi triển khai; yêu cầu chưa được AC bao phủ cần delta Brief và quyết định user; không tái hiện được thì báo bằng chứng và hỏi thêm.
4. Không sửa artifact đã duyệt tại chỗ. Ghi delta riêng, liên kết phiên bản/AC cũ và chờ Gate phù hợp trước khi thay đổi hành vi.
5. Tiếp tục bằng `/ff-build <id>` rồi `/ff-verify <id>` khi điều kiện Gate đã hợp lệ.

CLI hiện tại không có lệnh `ff reopen`. Không di chuyển thư mục, tạo nhánh hay tạo worktree thủ công trong workflow này. Nếu task nằm ngoài `workspace.cards_dir` hoặc cần khôi phục branch/worktree, dừng và báo user cần xử lý vị trí task trước.
