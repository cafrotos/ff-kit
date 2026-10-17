# Brief sửa bug (BUG-FIX MODE)

Dùng khi B0 chọn BUG-FIX MODE. Trang 1 ≤1 trang, mọi bảng có cột `Nguồn` (`D-xx`/`B-xx`/`U-xx`). Chẩn đoán theo "Khung chẩn đoán lỗi" trong `brief.md`.

```markdown
# Brief sửa bug – thẻ <id>
## Bối cảnh
Việc đã làm: <repo@branch>, <n> commit, <vào ship … / vào base … ngày … | chưa merge>. Nhánh làm tiếp (bảng `recon.md`): <sửa tiếp branch feature | tạo lại branch từ base_branch + cherry-pick commit của thẻ | branch mới từ base_branch>; không bao giờ từ ship_branch.
## Bug
| Mã | Bước tái hiện | Actual | Expect | Người báo/ngày | Nguồn |
|---|---|---|---|---|---|
## Nguyên nhân gốc và hướng sửa
| Bug | Giả thuyết nguyên nhân (file:line, độ chắc) | Cách kiểm | Hướng sửa tối thiểu | Test hồi quy khóa bug | Nguồn |
|---|---|---|---|---|---|
## Phạm vi
Chỉ sửa trên code hiện có. Không viết lại tính năng. Ngoài phạm vi: …
## Cần bạn chọn
(bug mơ hồ luật nghiệp vụ; trống nếu không có)
```
Mỗi mục mở của dossier ("Cần làm rõ", câu hỏi mở) được xếp đúng một loại, ghi trong ledger:
1. Đã trả lời bởi việc đã làm (commit/code) → ghi trong Brief là hành vi hiện có kèm sha; không thành câu hỏi.
2. Không bug nào phụ thuộc → mục Ngoài phạm vi; không thành câu hỏi.
3. Có bug phụ thuộc và expect còn mơ hồ → câu hỏi, mỗi câu bắt buộc có trường `Bug phụ thuộc: B-xx`.

Câu không điền được `Bug phụ thuộc` thì không phải câu hỏi của Brief sửa bug.
