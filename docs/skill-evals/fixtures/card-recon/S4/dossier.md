## Mô tả
Cho phép cấu hình máy nhánh tổng đài (extension) cho nhân viên tuyển dụng để gọi điện ứng viên từ hệ thống.
## Cần làm rõ
1. Ai được tạo/sửa/gán extension cho nhân viên?
2. Một nhân viên có tối đa mấy extension?
3. Nhân viên nghỉ việc thì extension xử lý thế nào?
## 🌿 Branch
feature/888-ext-setup (repo: web, api)
## Comments
- Tester Hoa, 2026-10-18: Bug 1. Vào Hệ thống > Máy nhánh > Thêm mới, mở dropdown Nhân viên. Actual: chờ ~8 giây mới hiện danh sách. Expect: dưới 1 giây.
- Tester Hoa, 2026-10-18: Bug 2. Tạo extension 1001 cho NV A, rồi tạo tiếp 1001 cho NV B. Actual: lỗi 500. Expect: báo "Máy nhánh đã tồn tại".
- Tester Hoa, 2026-10-18: Bug 3. Dropdown Nhân viên chỉ hiện NV phòng Chăm sóc khách hàng, không thấy NV tuyển dụng. Expect: hiện cả NV tuyển dụng.
