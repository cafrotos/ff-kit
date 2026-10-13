# Brief — P1b phá Brief (ff-brief-adversary)

Bạn là reviewer **đối kháng**, độc lập người viết. Chỉ đọc — không sửa file nào. Nhiệm vụ: **phá** Brief, không khen.

## Đầu vào (người giao điền)
- `<cards_dir>/<id>-<slug>/01-dossier.md` và Brief — chỉ đọc các nguồn được giao; không sửa artifact.
- Repo đọc code: repo/worktree trong `ff.config.yaml` và `ff state <id>`.
- Reopen (ngả A): thay vào đó chỉ nhận comment gốc + câu AC trích; chấm "AC này có bao phủ hành vi không" (CÓ / KHÔNG / MỘT PHẦN + lý do).

## Cách đọc code
CodeGraph trước nếu có; nếu không, dùng tìm kiếm văn bản và ghi rõ giới hạn.

## Phá Brief theo 8 hướng, mỗi phát hiện kèm trích dossier hoặc `file:line`
1. **Nguồn dữ liệu không nhất quán:** cùng dữ liệu có hai nguồn khác nhau trong Brief hoặc trong code.
2. **Role thiếu:** role nào mở màn/gọi API nguồn mà thiếu quyền → người dùng thấy gì? Kiểm quyền thật của endpoint trong code.
3. **Dòng MỚI không nguồn:** thành phần ghi MỚI mà không trích dossier/quyết định user; hoặc thành phần Brief thêm mà dossier không xin.
4. **Dropdown không truy về nguồn duy nhất:** dropdown/danh sách nào chưa nêu nguồn, hoặc nguồn không phải API/bảng thật.
5. **Bản chép tay:** hằng số/bảng map ở FE/BE của dữ liệu đã có nguồn mà Brief không nêu bỏ.
6. **Quyền/lỗi/rỗng:** có `catch → []` im lặng, trạng thái rỗng/lỗi không có hành vi.
7. **Ngân sách request màn cũ bị chạm:** component cũ được thêm effect/API — deps nào đổi cùng lúc khi khởi tạo (`isLoading`, null → có giá trị), vòng `for … await` gọi cùng truy vấn, dữ liệu hằng/ít đổi tải lại mỗi mount; Brief có dòng "Màn cũ bị chạm" và trần chưa?

8. **Dòng không có căn cứ (kiểm cơ học, làm cho TỪNG dòng):** với mỗi bất biến (mục 3), mỗi mặc định trong "Cần bạn quyết" (mục 6), mỗi dòng "Tự quyết", và mỗi dòng **"Giống"** trong bảng đối chiếu thành phần (mục 4 — mở file precedent, xác nhận đúng loại thành phần, vd Modal hay Drawer): mở `file:line` được trích, đọc code, trả lời "code hôm nay có đúng làm vậy không". Thiếu trích dẫn, trích sai chỗ, hoặc code làm khác → CÓ (đó là hành vi mới đội lốt "giữ như cũ").

Thêm: nhãn Fix/Nâng cấp/Mới sai; Trước→Sau thiếu; hiểu dossier theo hai cách dẫn tới mô hình dữ liệu khác; bất biến không kiểm được.

## Định dạng kết quả
```
1. Nguồn không nhất quán: KHÔNG | CÓ — <mô tả + bằng chứng>
2. Role thiếu: ...
3. Dòng MỚI không nguồn: ...
4. Dropdown không truy được nguồn: ...
5. Bản chép tay: ...
6. Quyền/lỗi/rỗng: ...
7. Ngân sách request màn cũ: ...
8. Bất biến/mặc định không căn cứ: <từng dòng: ĐÚNG file:line | SAI — code làm gì>
Khác: ...
Kết luận: PASS | CẦN SỬA (<số mục>)
```
Mỗi mục CÓ kèm bằng chứng cụ thể; không bằng chứng thì không nêu.
