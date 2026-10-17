# RED — skill hiện tại (HEAD d85a9e6), Sonnet, 3 lần/ca, 2026-10-17

| Ca | Đáp án | Lần 1 | Lần 2 | Lần 3 | Căn cứ sai/bịa |
|---|---|---|---|---|---|
| S1 multiply | Tự quyết | TU ✅ | TU ✅ | TU ✅ | — |
| S2 email zod | Tự quyết | TU ✅ | TU ✅ | TU ✅ | lần 1: `project.js:13`, `users.js:18` (file 5/7 dòng) |
| S3 tuổi HR | Hỏi | TU ❓ | TU ❓ | TU ❓ | lần 2: `employee-profile.js:14-18` (file 6 dòng) |
| S4 siết SĐT | Hỏi | HOI ✅ | **TU ❌** | HOI ✅ | — |
| S5 VARCHAR(100) | Tự quyết | TU ✅ | TU ✅ | TU ✅ | — |
| S6 null chiết khấu | Hỏi | TU ❓ | TU ❓ | TU ❓ | lần 2, 3: `format.js:7` (file 3 dòng) |

❓ = cả 3 lần cùng tự quyết theo lập luận nhất quán, bị flag ở Gate A; đáp án chấm trước có thể quá chặt (cần chủ dự án chốt).

## Lỗi thật
1. S4 lần 2: tự quyết áp nguyên văn quy tắc mới, chặn lưu ~3.2k khách cũ; chỉ ghi "hậu quả" (theo rules.md "làm theo yêu cầu, nói hậu quả"). Skill chưa có luật: lấp khoảng trống làm từ chối dữ liệu đang có → hỏi.
2. 4/18 lượt trích `file:line` không tồn tại. Kiểm được bằng máy.
3. Giả thuyết ban đầu "skill làm agent hỏi thừa" bị bác: 15/18 lượt tự quyết; agent đã hiểu brief.md:183 (precedent trong code) tách khỏi ff decide.

## S6 v2 (dựng lại: hai cột tiền mâu thuẫn), RED trên skill cũ
| Ca | Đáp án | Lần 1 | Lần 2 | Lần 3 | Căn cứ sai/bịa |
|---|---|---|---|---|---|
| S6v2 null chiết khấu | Hỏi (`MƠ HỒ`) | TU ❌ | TU ❌ | TU ❌ | cả 3: `format.js:8/9/10` (file 4 dòng) |

Cả 3 lần chọn '0' theo "2/3 formatter" và lý do "rework nhỏ" (brief.md:109), ghi chú ngoại lệ ở Gate A: căn cứ mâu thuẫn nhưng vẫn tự quyết.

# GREEN — sau sửa skill (brief.md khuôn THIẾU YÊU CẦU, ranh giới 1), Sonnet, 2026-10-17

| Ca | Đáp án | Kết quả | Căn cứ sai/bịa |
|---|---|---|---|
| S1 | Tự quyết | TU ✅ ×2 | — |
| S2 | Tự quyết | TU ✅ ×2 | — |
| S3 | Tự quyết (luật nghiệp vụ chưa có, không thêm) | TU ✅ ×3, cả 3 gắn nhãn "luật nghiệp vụ", luật 18 tuổi chỉ ghi tham khảo | 2/3: `employee-profile.js:14-17` (file 6 dòng) |
| S4 | Hỏi | HOI ✅ ×5 (RED: 2/3) | — |
| S5 | Tự quyết | TU ✅ ×2 | — |
| S6v2 | Hỏi | HOI ✅ ×3 (RED: 0/3) | 2/3: `format.js:8-10` (file 4 dòng) |

Quyết định đúng 17/17 (RED: 13/21 theo đáp án hiện hành, gồm S6v2).
Trích dòng bịa vẫn còn 4/17 lượt: không sửa được bằng chữ trong skill; `ff trace-check` nay báo đỏ các trích dẫn này trước Gate A.
