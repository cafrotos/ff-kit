# Reopen — xử lý delta của thẻ đã ship

Reopen là trạng thái của thẻ, không phải loại yêu cầu thứ tư. Giữ hợp đồng đã duyệt để đối chiếu; chỉ xử lý phần chênh và vẫn gắn nhãn Fix / Nâng cấp / Mới.

## Kích hoạt và trạng thái

Chỉ mở revision khi user yêu cầu reopen. Chạy `ff reopen <id> --reason "<yêu cầu và nguồn comment>"`, rồi `ff state <id> --json`. CLI tạo revision kế tiếp `rev-N/` cùng `revision.json`, `delta.md`, `02-spec.md`, `03-design.md`, `05-verify-report.md`; nó giữ receipt các lần trước. Những file mới chỉ là placeholder, phải điền delta/AC/spec/design/report có bằng chứng trước khi xin Gate; sự tồn tại của file không cấp quyền. Lấy `activeRevision` và `activeDir` từ state, không tự chọn số revision, không di chuyển thư mục thủ công.

Dossier và ledger vẫn ở cấp thẻ. Thêm comment nghiệp vụ mới vào ledger bằng mã `D-xx` mới, trích nguyên văn tác giả/ngày; lọc bookkeeping. Không tự thay mốc git từ ngày comment: xác minh hash lần ship gần nhất và branch qua state, design lịch sử và remote theo cấu hình. Chưa xác định được mốc thì ghi giới hạn, không tạo bản copy từ nhánh đoán.
Thẻ lớn vẫn dùng `task-N/` và `00-subtasks.md` trong revision; gọi là cụm trong văn bản nghiệp vụ. Mỗi phiếu ghi `task-N/AC-xx` liên quan.

## Các bước

| Bước | Việc | Sản phẩm |
|---|---|---|
| R0 | Reopen bằng CLI, đọc state hiện tại và nguồn comment mới | `activeDir` và danh sách nguồn |
| R1 | Chuẩn hóa phiếu: nguồn, nhãn, AC cũ, role/dữ liệu, bước tái hiện, kỳ vọng | danh sách phiếu |
| R2 | Tái hiện trên code hiện tại; cải tiến thì quan sát hiện trạng. Phiên chính chuẩn bị `ff copy`/`ff verify-up` từ config, giao `ff-observer` rồi cleanup `ff verify-down` | ảnh và mô tả |
| R3 | Tìm nguyên nhân, phân ngả; ghi vì sao lọt: spec thiếu / AC chấp nhận / test thiếu / test lỏng / chưa đo | bằng chứng và phân ngả |
| R4 | Viết delta ≤1 trang; phản biện khi thiếu/sửa hợp đồng hoặc có yêu cầu mới. Trình Gate A hiện tại | `<activeDir>/delta.md` |
| R5 | Sinh spec/design hiện tại, kiểm trace/design, review; Gate B có receipt hợp lệ trước build | `<activeDir>/02-spec.md`, `03-design.md` |
| R6 | Build test tái hiện trước, khóa test, bộ hồi quy và 1–2 slice đúng file phiếu | `/ff-kit:ff-build <id>` |
| R7 | Verify test tái hiện + hồi quy, đo request; report từng phiếu và Gate C mới | `<activeDir>/05-verify-report.md` |
| R8 | Ship sau Gate C hiện tại và user xác nhận ship riêng | `/ff-kit:ship-to-dev` |

`ff-understand` làm R0–R5. Không dùng report hoặc Gate C cũ để hoàn tất lần reopen.

## Bốn ngả

| Ngả | Bằng chứng | Cách xử lý |
|---|---|---|
| A. Lỗi triển khai | AC đã duyệt bao phủ hành vi nhưng code làm khác | giữ nội dung spec cũ trong spec revision; sửa code + test tái hiện sau Gate A/B hiện tại |
| B. Spec/Brief thiếu hoặc sai | Không AC nào bao phủ, hoặc AC chấp nhận hành vi bị báo | delta sửa/thêm AC, đánh dấu revision và nguồn |
| C. Yêu cầu mới / cải tiến | Code đúng spec nhưng cần hành vi khác | nguồn comment + user duyệt phạm vi mới qua delta |
| D. Không tái hiện / hiểu khác | Chưa có bằng chứng lỗi trên code hiện tại | ghi bước đã thử, hỏi user dữ kiện; không sửa theo phỏng đoán |

## Tám quy tắc

1. Không sửa artifact hay receipt lịch sử tại chỗ; sửa trong `activeDir`. AC mới/sửa có nhãn revision, quyết định mới ghi ngày và nguồn.
2. Tái hiện trước khi sửa. Bug Nhỏ nguyên nhân rõ có thể ghi bằng chứng trực tiếp; nguyên nhân chưa rõ thì thử các giả thuyết cạnh tranh.
3. Gom phiếu theo nguyên nhân gốc, không vá mỗi triệu chứng riêng.
4. Nếu mô hình đích sai thì nêu rõ ở delta để user quyết trước khi code.
5. Không refactor hoặc sửa ngoài phiếu. Mỗi hunk phải truy về một phiếu/AC; không truy được thì báo thừa.
6. Mỗi phiếu có cột "Vì sao lọt"; thiếu dữ kiện ghi chưa biết và cách kiểm.
7. Mọi revision đều cần Gate A cho delta, Gate B cho design và Gate C cho report hiện tại, kể cả ngả A và task Nhỏ. Header giữ `GATE_A`, `GATE_B`, `GATE_C`; câu hỏi `[#<id>] [rev-N]`, cụm có thể thêm `[task-N]`. Không tự đổi header theo revision.
8. Chống xếp sai ngả A: phải trích nguyên văn AC cũ kèm `task-N/AC-xx`. Không trích được hoặc AC đã chấp nhận hành vi bị báo → B. Reviewer độc lập chỉ nhận comment + AC, báo CÓ / KHÔNG / MỘT PHẦN; bất đồng cần giải quyết trước build. Báo cáo cuối liệt kê các phiếu A với câu AC và kết quả thực tế.

## Khuôn delta

```markdown
# Delta — <id> [rev-N]
> Trạng thái: CHỜ DUYỆT

| Phiếu | Nguồn | Ngả | AC cũ (+ trích nếu A) | Tái hiện | Nguyên nhân (file:line) | Xử lý + file | Vì sao lọt | Cần bạn chọn |
|---|---|---|---|---|---|---|---|---|
| P-01 | D-06 | A | AC-01: giữ bộ lọc khi chuyển trang | role và bước | nguồn đã kiểm | phạm vi đề xuất | test chưa phủ | không |
```

Gate A phê duyệt `delta.md` hiện tại bằng receipt/hash; marker chỉ hiển thị. Sau user duyệt, không sửa delta tại chỗ. Gate B tự qua chỉ qua `ff gate-auto <id> [--task task-N] --reason "<căn cứ>"` khi metadata `gate_b` và checks đáp ứng `references/design.md`.

## Cỡ và git

Nhỏ (1–3 phiếu, ≤5 file): delta 1 trang, 1 slice; Gate B có thể `auto_passed`, Gate C vẫn trình user. Nhiều phiếu: gom cụm theo nguồn dữ liệu/chủ file, tích hợp và hồi quy cuối thẻ.
Giữ branch tại `## Branch` của dossier. Không merge vào `base_branch`; không squash lại commit đã ship. Phiên ship xác minh mốc remote và gom commit revision theo command; commit có trailer `Trello: #<id>` và `Rev: N`. Không tự push, xóa worktree hoặc chuyển dossier/test artifacts.
