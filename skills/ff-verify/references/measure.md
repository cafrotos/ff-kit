# Đo bằng chứng khi verify

Chỉ ghi kết quả quan sát được trong môi trường đã bật theo `ff verify-up`. Không đổi cấu hình runtime để làm test xanh nếu thay đổi đó làm môi trường khác với cấu hình đã duyệt.

## Mỗi AC

- Nêu điều kiện, role test và dữ liệu đã chuẩn bị.
- Ghi thao tác UI và kết quả hiển thị; đính kèm ảnh khi hữu ích.
- Kiểm network request/response có liên quan và console/runtime error.
- Kiểm DB chỉ khi có query read-only đã được dự án cấu hình. Ghi `chưa đo` khi thiếu quyền hoặc query.
- Ghi phiên bản/build, thời điểm và môi trường từ nguồn có thể xác minh.

Không suy ra thành công từ việc trang mở được. Mỗi kết luận PASS phải gắn với AC và bằng chứng cụ thể; điều kiện không chạy được là `UNVERIFIED`, kèm lý do và bước còn thiếu.

## Lưu lượng và hồi quy

Khi yêu cầu liên quan hiệu năng/request, so sánh số request trước/sau trên cùng đường đi và cùng điều kiện. Tách request nền khỏi hành vi đang kiểm; ghi endpoint, số lần gọi và bằng chứng. Không bật query logging, thay `NODE_ENV`, sửa dữ liệu hoặc chạy migration chỉ để thu thập bằng chứng nếu chưa được cấu hình/duyệt.

Neighborhood Sweep: kiểm tra các thao tác liền kề có nguy cơ bị ảnh hưởng, trạng thái loading/empty/error, quyền truy cập và nội dung/i18n phù hợp với AC. Báo riêng phát hiện ngoài phạm vi, không tự mở rộng implementation.
