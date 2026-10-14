# Brief — Review design (ff-understand P2)

Làm theo `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/references/doubt.md` (prompt, nhãn, trích).

Review design của một task độc lập với người viết. Chỉ đọc — không sửa file nào.

## Đầu vào (người giao việc điền)
- activeDir `<đường dẫn từ ff state --json>` · activeRevision `<null | rev-N>`; Brief gốc hoặc delta hiện tại, spec/design/plan lấy trong activeDir.
- Brief/delta đã duyệt: `<activeDir>/[task-N/]<brief.md hoặc delta.md>` và spec/AC `02-spec.md` (nếu có; AC sinh từ Brief)
- Design: `<activeDir>/[task-N/]03-design.md`
- Repo/worktree: lấy từ cấu hình (`ff cfg get repos`) và `ff state <id>`

## Cách đọc code
CodeGraph trước nếu có; nếu không, dùng tìm kiếm văn bản và ghi rõ giới hạn.

## Kiểm 6 việc, mỗi phát hiện kèm `file:line`
1. **Identifier có thật không** — mọi field/store/endpoint/`file:line` trong mục "Mapping AC". Tên đoán sai là lỗi hay gặp nhất. Đọc đúng dòng được trích.
2. **Đúng-đủ so với spec** — AC nào chưa được map; chức năng ở gạch "Ảnh hưởng" của spec chưa có dòng hồi quy ở mục "Cách kiểm tra tay".
3. **Mỗi thành phần design có cột `Nguồn`** — YC/AC/map/deviation phải trỏ `D-xx`/`U-xx`; thiếu nguồn = phát hiện.
4. **Mỗi phương án sửa nêu nguyên nhân gốc** — phương án chỉ chữa triệu chứng phải có nhãn "chữa triệu chứng" và đi kèm phương án xử lý nguyên nhân.
5. **Lệch precedent vô cớ** — so với Bảng Precedent (2-3 màn tương tự + quy ước app: API client, hằng số, phân quyền). Lệch mà Deviation Register không có dòng, hoặc cột "vì sao đáng lệch" không thuyết phục.
6. **Overengineering** — abstraction, config, field, env không AC nào cần.

## Định dạng kết quả
```
1. Identifier: OK | SAI — <tên ghi trong design> → <tên thật, file:line>
2. Đủ so với spec: OK | THIẾU — <AC/hồi quy thiếu>
3. Cột Nguồn: OK | THIẾU — <dòng thiếu nguồn>
4. Nguyên nhân gốc: OK | CHỈ CHỮA TRIỆU CHỨNG — <phương án>
5. Precedent: OK | LỆCH — <chỗ lệch, precedent làm thế nào>
6. Overengineering: KHÔNG | CÓ — <thứ thừa>
Kết luận: PASS | CẦN SỬA (<số mục>)
```
