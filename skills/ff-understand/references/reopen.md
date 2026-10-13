# Reopen — mở lại task đã có tài liệu (nghiệm thu fail, comment báo bug/cải tiến)

Reopen là **trạng thái** của task, không phải loại thứ tư; mỗi phiếu vẫn gắn nhãn Fix / Nâng cấp / Mới. Có **hợp đồng cũ để đối chiếu** → chạy ở chế độ **delta**: không làm lại Brief, chỉ xử lý phần chênh.

## Kích hoạt
User chạy tay ("reopen thẻ X"); `01-dossier.md` có block comment mới, mỗi comment có ngày. **Phiếu** = comment có ngày **sau ngày ship của lần ship gần nhất** (thẻ nhiều task con: ngày muộn nhất trong mục 6 các `task-N/03-design.md`). Vẫn lọc comment bookkeeping như `references/brief.md` mục 1.
- **Mốc đã ship = `origin/<ship_branch>`** (không đọc hash từ mục 6 design). `/ff-kit:ship-to-dev` squash so với `origin/$B`, cùng mốc.
- Comment mới sau ship → thêm vào ledger thành `D-xx` mới, cột Ghi chú `sự kiện` kèm `reopen` (`sự kiện, reopen`).
- Thẻ nhiều task con: `rev-N/` ở cấp thẻ (`<cards_dir>/<slug>/rev-N/`); mỗi phiếu thêm cột **task/cụm** (`task-3/AC-12`); gom phiếu theo cụm (`big-task.md`); một nhánh, một commit rev/repo.

## Các bước
| Bước | Làm gì | Sản phẩm |
|---|---|---|
| R0 | `ff reopen` **không tồn tại** (xác minh ở Plan 2). Làm tay: `ff state <id>`, đưa thư mục về `<cards_dir>` nếu nằm trong `<cards_dir>/task-dones`, tạo `rev-N/`; bản copy từ `origin/<branch>` chỉ khi `ff copy` hỗ trợ, không thì dừng báo user. In ngày ship + số comment sau đó. Ghi rõ "chưa có lệnh `ff reopen`". | `rev-N/` |
| R1 | Chuẩn hóa comment mới thành **phiếu**: nguồn (tác giả, ngày), nhãn, **AC cũ liên quan** (`AC-xx` hoặc "không có AC"), bước tái hiện/role/dữ liệu, kỳ vọng | danh sách phiếu |
| R2 | **Tái hiện trên code hiện tại** trước khi sửa: `ff-observer` (`briefs/observe.md`). Cải tiến thì quan sát hiện trạng | ảnh + mô tả |
| R3 | Tìm nguyên nhân gốc (Codegraph) + **phân ngả**; mỗi phiếu ghi **"vì sao lọt"** (spec thiếu / AC chấp nhận hành vi đó / test thiếu / test lỏng / không đo) | cột nguyên nhân |
| R4 | **Delta Brief** ≤1 trang + P1b nếu có phiếu ngả B/C | `rev-N/delta.md` — **Gate A'** |
| R5 | Test tái hiện viết trước, khóa (fail trước, pass sau) + chọn **bộ hồi quy** (AC cũ liên quan; thẻ lớn: toàn bộ test thẻ khi hạ tầng cho phép) | bàn giao `ff-build` |
| R6 | Build 1–2 slice nhỏ; allowlist = đúng file của phiếu; diff review: **mỗi hunk truy về một phiếu**, không truy được = thừa | `ff-build` |
| R7 | Verify: test tái hiện pass + hồi quy + đếm request; báo cáo **theo từng phiếu** (trước/sau + ảnh) | `ff-verify` |
| R8 | Ship: 1 commit rev so với `origin/<branch>`, trailer `Trello: #<id>` + `Rev: N`; điền mục 6 design bằng hash rev N; chuyển thẻ lại `task-dones` khi user xác nhận | `/ff-kit:ship-to-dev` |

`ff-understand` chạy R0–R4 rồi bàn giao `/ff-kit:ff-build <id>` (R5–R6) và `/ff-kit:ff-verify <id>` (R7); R8 qua `/ff-kit:ship-to-dev`.

## Bốn ngả (R3; đối chiếu phiếu với spec đã duyệt)
| Ngả | Dấu hiệu | Cái gì sai | Xử lý |
|---|---|---|---|
| **A. Lỗi triển khai** | AC/Brief đã bao phủ hành vi nhưng code làm khác | code (+ test không bắt → cột "vì sao lọt") | sửa code + test tái hiện; **không đổi spec** |
| **B. Spec/Brief thiếu hoặc sai** | không AC nào bao phủ, hoặc chính AC chấp nhận hành vi đó (vd rủi ro quyền đã ghi rồi chấp nhận) | tài liệu | delta Brief sửa/thêm AC (đánh dấu `rev N`) → Gate A' → rồi mới sửa code |
| **C. Yêu cầu mới / cải tiến** | người báo muốn hành vi khác dù spec làm đúng | yêu cầu | coi như dòng MỚI/Nâng cấp: cần nguồn = comment + user duyệt; **mặc định KHÔNG làm** tới khi user xác nhận |
| **D. Không tái hiện / hiểu khác** | không tái hiện được trên code hiện tại | chưa rõ | hỏi lại người báo qua user, kèm bước đã thử; không sửa |

## Tám quy tắc bất di bất dịch
1. Spec/design đã duyệt **không sửa tại chỗ**. Đổi qua `rev-N/delta.md`; AC mới/sửa đánh dấu `rev N`; quyết định mới vào "Quyết định đã chốt" kèm ngày; user duyệt ở Gate A'. Không sửa spec/test cho khớp code.
2. **Tái hiện trước khi sửa.**
3. Gom theo **nguyên nhân gốc**, không vá từng triệu chứng (vd cùng gốc: nguồn danh sách loại/mẫu).
4. Phiếu cho thấy **Brief thẻ / mô hình đích sai** (ngả B cấp thẻ) → dừng, sửa Brief thẻ qua user **trước**, rồi mới sửa code.
5. Không refactor, không "tiện thể" sửa ngoài phiếu.
6. Cột "vì sao lọt" bắt buộc.
7. **Gate A':** phiếu ngả **A** → tự sửa rồi báo trong báo cáo, **không dừng**; ngả **B/C/D** → dừng chờ user duyệt delta. Đợt có cả hai: A chạy tiếp, B/C/D chờ.
8. **Chống lách ngả A** (ngả A không dừng nên có động cơ xếp nhầm B/C vào A):
   - Phiếu A **phải trích nguyên văn** câu AC (kèm `task-N/AC-xx`) bao phủ hành vi; không trích được → mặc định B.
   - Kết quả sau sửa phải là đúng câu AC đó; diff review kiểm mỗi hunk của phiếu A khớp câu trích. Hunk thêm hành vi ngoài câu trích → phiếu chuyển B, dừng.
   - AC trích ra chính là AC đã chấp nhận rủi ro/hành vi bị báo → B, không phải A.
   - P1b (`ff-brief-adversary`, context mới) chỉ nhận comment gốc + câu AC trích, chấm "có bao phủ không". Bất đồng → B.
   - Báo cáo cuối liệt kê riêng các phiếu A kèm câu trích.

## Delta Brief (≤1 trang) `rev-N/delta.md`
Đầu file: `> Trạng thái: CHỜ DUYỆT` (đổi thành `ĐÃ DUYỆT <ngày>` ở Gate A'). Mỗi phiếu một dòng:

| # | Nguồn (tác giả/ngày) | Ngả | AC liên quan (+trích nếu A) | Tái hiện | Nguyên nhân gốc (file:line) | Xử lý + file | Vì sao lọt | Cần bạn chọn |
|---|---|---|---|---|---|---|---|---|

Khuôn: vấn đề → cách xử lý → file đổi gì → kết quả.

## Cỡ
- **Nhỏ** (1–3 phiếu, ≤5 file): delta 1 trang, 1 slice; Gate A' là gate duy nhất.
- **Lớn** (nhiều phiếu): gom theo cụm → một đợt sửa mỗi cụm → một lượt tích hợp cuối.

## Git/ship
- Luôn tiếp tục trên nhánh ở `## Branch` của dossier; **không merge vào `base_branch`** (việc của admin); ship = cherry-pick sang `ship_branch` (`/ff-kit:ship-to-dev`).
- Bản copy từ `origin/<branch>`, không từ `base_branch`. Không squash lại commit đã ship: gom commit rev mới thành 1 commit so với `origin/<branch>` (`/ff-kit:ship-to-dev` tự squash khi nhánh đã có trên remote).
