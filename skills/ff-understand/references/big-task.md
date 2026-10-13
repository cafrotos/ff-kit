# Thẻ lớn: Brief thẻ → cụm → slice

Lớn = >6 mục dossier **hoặc** >5 quyết định chốt. Một thẻ = một lần hiểu, nhiều lần build.

| Cấp | Đơn vị | Làm gì | User đọc |
|---|---|---|---|
| Thẻ | 1 **Brief thẻ** | Bảng nguồn dữ liệu duy nhất, bất biến toàn thẻ, ngân sách request, "Cần bạn chọn", **thứ tự cụm theo phụ thuộc dữ liệu** | Gate A — 1 lần |
| Cụm (thay "subtask") | Phần có ranh giới nghiệp vụ/dữ liệu rõ, chia theo nguồn dữ liệu + quyền sở hữu file | Brief con ≤1 trang, **chỉ ghi phần khác** so với Brief thẻ; design + slice riêng | Chỉ khi có "Cần bạn chọn" |
| Slice/đợt | Nhóm file không giẫm nhau | `ff-build` lo | Không |

## Cách làm
1. P1 như `references/brief.md` nhưng cho cả thẻ. **Trang 1 Brief thẻ chỉ có:** "Cần bạn chọn" (tối đa 5, xếp theo rủi ro) + bảng nguồn dữ liệu. Phần còn lại → `brief-chi-tiet.md` (không bắt buộc đọc); quyết định rủi ro thấp ghi mặc định + cờ "tự chọn" trong phụ lục.
2. Chia cụm theo **nguồn dữ liệu + chủ file**. Thứ tự cụm do bảng nguồn dữ liệu quyết (nguồn mà cấu hình khác tham chiếu thì đứng sớm). Ví dụ 123 (minh họa; thứ tự thật do Brief thẻ chốt): mẫu HĐ + loại HĐ · nội dung email · CC mail · người phỏng vấn · kho mẫu CRUD.
3. Mỗi cụm: `<cards_dir>/<slug>/cum-N/brief.md` (≤1 trang, chỉ phần khác) + `03-design.md` + slice riêng (theo `references/design.md`). Cụm chạy P1b chỉ khi có dòng MỚI.
4. Gate A một lần cho Brief thẻ. Gate B từng cụm chỉ khi có điều kiện dừng (SKILL.md).
5. **Cụm mâu thuẫn với Brief thẻ:** dừng, đề xuất sửa Brief thẻ cho user quyết; không tự đổi.

## Ledger cấp thẻ
Brief thẻ có `01b-ledger.md` riêng (toàn thẻ); mỗi cụm có ledger con chỉ ghi dòng cụm đó. Mã `D-xx` dùng lại từ ledger thẻ (tránh trùng mã giữa cụm). Cộm/slice trỏ `D-xx` và AC — micro-task không truy về `D-xx`/AC nào là ngoài phạm vi.

## File trạng thái thẻ
`<cards_dir>/<slug>/00-cum.md` (thay `00-subtasks.md`). Bảng:

| Cụm | Thứ tự | Phụ thuộc | Trạng thái (hiểu / design / build / verify) | Hash khóa test |
|---|---|---|---|---|

Ghi `Gate A: ĐÃ DUYỆT <ngày>` ở đầu file.

## Hệ quả cho các skill sau (ghi để bàn giao)
- E2e hai lớp: mỗi cụm có test hành vi viết trước và chạy ngay khi cụm xong; cuối thẻ một lượt tích hợp (toàn bộ test cụm + bất biến toàn thẻ + ma trận role + đếm request + ảnh).
- Git: commit checkpoint theo cụm; squash 1 lần khi ship.
