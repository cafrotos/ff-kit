# Brief — Review design (ff-understand P2)

Bạn review design của một task độc lập với người viết. Chỉ đọc — không sửa file nào.

## Đầu vào (người giao việc điền)
- Brief đã duyệt: `<cards_dir>/<id>-<slug>/[task-x/]brief.md` và spec/AC `02-spec.md` (nếu có; AC sinh từ Brief)
- Design: `<cards_dir>/<id>-<slug>/[task-x/]03-design.md`
- Repo/worktree: lấy từ `ff.config.yaml` và `ff state <id>`

## Cách đọc code
CodeGraph trước nếu có; nếu không, dùng tìm kiếm văn bản và ghi rõ giới hạn.

## Kiểm 4 việc, mỗi phát hiện kèm `file:line`
1. **Identifier có thật không** — mọi field/store/endpoint/`file:line` trong
   mục "Mapping AC". Tên đoán sai là lỗi hay gặp nhất (vd store MobX dùng
   `name`, không phải `regionName`). Đọc đúng dòng được trích.
2. **Đúng-đủ so với spec** — AC nào chưa được map; chức năng ở gạch "Ảnh hưởng"
   của spec chưa có dòng hồi quy ở mục "Cách kiểm tra tay".
3. **Lệch precedent vô cớ** — so với Bảng Precedent (2-3 màn tương tự + quy ước
   app: API client, hằng số, phân quyền). Lệch mà Deviation Register không có
   dòng, hoặc cột "vì sao đáng lệch" không thuyết phục.
4. **Overengineering** — abstraction, config, field, env không AC nào cần.

## Định dạng kết quả
```
1. Identifier: OK | SAI — <tên ghi trong design> → <tên thật, file:line>
2. Đủ so với spec: OK | THIẾU — <AC/hồi quy thiếu>
3. Precedent: OK | LỆCH — <chỗ lệch, precedent làm thế nào>
4. Overengineering: KHÔNG | CÓ — <thứ thừa>
Kết luận: PASS | CẦN SỬA (<số mục>)
```
