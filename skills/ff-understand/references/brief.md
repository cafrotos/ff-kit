# Viết Brief từ yêu cầu

Brief chuyển dossier và trao đổi với user thành hành vi có thể duyệt, truy vết và kiểm chứng. Mọi kết luận phải có nguồn; không suy ra yêu cầu từ implementation.

## 1. Đọc nguồn và phân loại

Đọc toàn bộ dossier, comment có liên quan và tài liệu được tham chiếu. Bỏ qua ghi chú đồng bộ thuần túy; giữ quyết định/ràng buộc nghiệp vụ với nguyên văn, tác giả và ngày nếu có.

Phân loại từng yêu cầu: **Fix** (hành vi đã yêu cầu nhưng sai), **Nâng cấp** (đổi hành vi hiện có) hoặc **Mới**. Với Fix, ghi triệu chứng, bước tái hiện, dữ liệu/role liên quan, ít nhất hai giả thuyết và phép thử phân biệt. Với Nâng cấp/Mới, mô tả rõ hành vi trước và sau.

## 2. Khảo sát có căn cứ

Lấy repo, branch, lệnh và đường dẫn từ `ff.config.yaml` qua `ff cfg get`. Khảo sát implementation để xác định symbol, API, dữ liệu, permission, lỗi/rỗng và callers liên quan. Dùng CodeGraph trước khi grep nếu có. Ghi `file:line` cho mọi kết luận kỹ thuật; CodeGraph không khảisẵn thì ghi giới hạn.

Với mỗi mục, trả lời: nguồn dữ liệu duy nhất; consumers liên quan; precedent gần nhất; role/thao tác; số lần gọi hoặc cache; quyền và trạng thái lỗi/rỗng; bản sao dữ liệu/config có cần cập nhật. Chỉ dùng query đã được dự án cung cấp trong `project_docs.verification_queries_dir`; không tự tạo truy vấn thay đổi dữ liệu.

Khi cần quan sát runtime, giao `ff-observer` theo `briefs/observe.md`. Không tự bật dịch vụ hoặc chọn tài khoản/URL chưa được xác nhận.

## 3. Cấu trúc Brief

```markdown
> Trạng thái: CHỜ DUYỆT
# Brief <id> — <tên>
Cỡ: Nhỏ|Vừa|Lớn · Branch: <nguồn> · Repo: <tên cấu hình>

## Yêu cầu
| Mã | Nguồn | Nhãn | Trước | Sau |
|---|---|---|---|---|

## Quyết định và câu hỏi
<câu hỏi cần user quyết định; không biến giả định thành sự thật>

## AC
- AC-01: Given <điều kiện>, when <hành động>, then <kết quả quan sát được>.

## Phạm vi
- Trong phạm vi: ...
- Ngoài phạm vi: ...

## Nguồn kỹ thuật
- <kết luận> — `path:line`
```

Mỗi AC phải quan sát/kiểm được, nêu vai trò và trạng thái rỗng/lỗi nếu phù hợp. Giữ bất biến và hành vi ngoài phạm vi rõ ràng. Không đặt thông tin secret, token hay dữ liệu production vào Brief.

## 4. Gate A

Gom câu hỏi nghiệp vụ thành tối đa bốn câu mỗi lượt; ghi câu trả lời vào dossier/ledger làm nguồn. Sau khi không còn câu hỏi cần chọn, trình Gate A riêng theo `SKILL.md`. Chỉ lựa chọn `Duyệt` là duyệt. Sau duyệt, không sửa Brief tại chỗ; thay đổi cần delta và quyết định Gate mới.
