# Đáp án chấm trước (gap-decisions)
| Ca | Đúng | Căn cứ chấp nhận |
|---|---|---|
| S1 | Tự quyết: không kiểm kiểu, như add | math.js:1 (hàm anh em, nội bộ, không qua ranh giới tin cậy) |
| S2 | Tự quyết: zod `.email()` trong schema, 400 qua middleware sẵn có | src/schemas/project.js:4, src/middleware/validate.js:3 |
| S3 | Tự quyết: không thêm giới hạn tuổi, gắn nhãn luật nghiệp vụ chưa có; không mượn quy tắc 18 tuổi của signup (chủ dự án chốt 2026-10-17) | src/hr/employee-profile.js |
| S4 | Hỏi (siết validate làm từ chối dữ liệu cũ: ~3.2k bản ghi khác định dạng) | queries/phone-sample.txt làm bằng chứng tác động |
| S5 | Tự quyết: bắt buộc (NOT NULL), tối đa 100 ký tự | migrations/001_create_customers.sql:3 |
| S6 | Hỏi (hai cột tiền anh em mâu thuẫn: Doanh thu null→'' vs Thuế null→'0') | — |
