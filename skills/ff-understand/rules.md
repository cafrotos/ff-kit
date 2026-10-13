# Quy tắc chung ff-kit

## Phạm vi và nguồn

- Workspace gốc là bản tham chiếu; sửa code trong worktree do `ff copy <id>` tạo.
- Mọi giá trị lấy từ `ff.config.yaml` qua `ff cfg get`; không giả định tên repo, branch, package manager, port hay đường dẫn.
- Dossier là nguồn yêu cầu. Ledger giữ nguyên trích dẫn và nguồn; không thêm yêu cầu không có căn cứ.
- `.ff.env` và các file secret không được đọc, in hoặc chép. Dùng `ff doctor` để biết key có/thiếu.
- `.ff/` là dữ liệu runtime của ff-kit; không sửa trực tiếp.

## Cách làm

- Bằng chứng gồm `file:line`, output lệnh, trạng thái Gate hoặc kết quả quan sát thật. Ghi rõ điều chưa xác minh.
- Khi nhiều cách hiểu dẫn tới khác biệt nghiệp vụ, hỏi bằng `AskUserQuestion`; việc thường ngày tự quyết và ghi giả định.
- Mỗi lượt hỏi có tối đa 4 câu, 2–4 lựa chọn mỗi câu. Câu hỏi quyết định dùng `Q<n>`; Gate dùng `GATE_A`, `GATE_B`, `GATE_C` ở lượt riêng.
- Gate phải có câu hỏi bắt đầu `[#<id>]`, lựa chọn `Duyệt` và `Cần sửa`. Chỉ lựa chọn `Duyệt` mới là phê duyệt.
- Không tự sửa Brief, design, verify report hoặc test đã khóa sau khi Gate/hash không còn khớp. Nêu sai lệch và đề xuất bước tiếp theo.

## Điểm vào theo trạng thái

| Trạng thái | Skill tiếp theo |
|---|---|
| Chưa có Brief hoặc Gate A chưa hợp lệ | `/ff-understand` |
| Gate A hợp lệ, design cần tạo hoặc cập nhật | `/ff-understand` |
| Gate A/B hợp lệ, chưa squash | `/ff-build` |
| Đã squash, cần nghiệm thu | `/ff-verify` |

Trước khi tiếp tục, chạy `ff state <id>` và đọc file thật. `ff state` cùng hash Gate là nguồn xác nhận; marker hiển thị không thay thế bản ghi.

## Khi cần dừng để hỏi

Dừng khi quyết định không đảo ngược, đổi dữ liệu/mô hình, thêm hành vi ngoài yêu cầu, có hai cách hiểu làm thay đổi kết quả, hoặc quyền truy cập ảnh hưởng người dùng. Trình lựa chọn cùng hậu quả dễ thấy qua `AskUserQuestion`.
