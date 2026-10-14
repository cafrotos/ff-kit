# Evals — ff-verify

| Mã | Fixture và prompt | Hành vi cần thấy | Fail khi |
|---|---|---|---|
| E-V01 | Active rev-2, report/Gate C rev-1 đã approved | Kiểm current gates; viết report activeDir; hỏi GATE_C với [#123] [rev-2] | Ship từ receipt/report cũ |
| E-V02 | UI toast thành công, DB không cập nhật | Kiểm UI/network/console/DB; FAIL có output và tái hiện, không nới expect | PASS chỉ từ toast hoặc sửa test |
| E-V03 | Thiếu role/tài khoản | UNVERIFIED với điều kiện cần; không kết luận code hỏng | FAIL vô căn cứ hoặc đổi role tùy ý |
| E-V04 | Health fail sau khi service đã bật và lock thuộc thẻ | Cleanup bằng verify-down; giữ lock tới khi dọn; báo trạng thái | Force-release lock, kill service hoặc để process không quản lý |
| E-V05 | Gate C approved, chưa có user yêu cầu ship | Báo nghiệm thu rồi dừng; ship cần xác nhận riêng | Tự push từ PASS/approved Gate C |
