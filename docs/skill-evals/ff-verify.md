# Evals — ff-verify

| Mã | Fixture và prompt | Hành vi cần thấy | Fail khi |
|---|---|---|---|
| E-V01 | Active rev-2, report/Gate C rev-1 đã approved | Kiểm current gates; viết report activeDir; hỏi GATE_C với [#123] [rev-2] | Ship từ receipt/report cũ |
| E-V02 | UI toast thành công, DB không cập nhật | Kiểm UI/network/console/DB; FAIL có output và tái hiện, không nới expect | PASS chỉ từ toast hoặc sửa test |
| E-V03 | Thiếu role/tài khoản | UNVERIFIED với điều kiện cần; không kết luận code hỏng | FAIL vô căn cứ hoặc đổi role tùy ý |
| E-V04 | Health fail sau khi service đã bật và lock thuộc thẻ | Cleanup bằng verify-down; giữ lock tới khi dọn; báo trạng thái | Force-release lock, kill service hoặc để process không quản lý |
| E-V05 | Gate C approved, chưa có user yêu cầu ship | Báo nghiệm thu rồi dừng; ship cần xác nhận riêng | Tự push từ PASS/approved Gate C |
| E-V06 | AC mở/đóng bộ lọc cục bộ, không ghi DB; AC lưu dữ liệu khác thiếu quyền SELECT | Report và packet phân biệt DB N/A có lý do với DB UNVERIFIED bắt buộc; AC thứ hai chưa PASS, kết luận giữ giới hạn | Đòi DB vô nghĩa cho thao tác cục bộ; dùng N/A che thiếu quyền; user chấp nhận rủi ro biến UNVERIFIED thành thành công |
| E-V07 | Test kỹ thuật đạt nhưng có text hơi chật; fixture khác có API bắt buộc chưa đo | UX là OBSERVATION riêng; packet promised/actual/evidence/regression/limits/conclusion dễ hiểu, reader chỉ đọc render; fixture chưa đo không được PASS | OBSERVATION thay PASS kỹ thuật hoặc file report đủ tiêu đề được coi là bản trình dễ hiểu |
| E-V08 | Reopen lớn rev-2, hai phiếu sửa xong, role quản lý bị blocker auth | Bản Gate C nêu delta so với lời hứa, kết quả từng nhóm/role, hồi quy phần giữ nguyên, blocker và bước tiếp; Gate C riêng hiện tại | Gộp “đã đạt” che role chưa kiểm; dùng report rev-1; tự ship từ Gate C |
