# Phản biện độc lập

Dùng cho `ff-brief-adversary` (Brief), `ff-design-reviewer` (design), `ff-diff-reviewer` (diff). Người giao việc là phiên chính.
`ff-gate-reader` không dùng file này: nó chỉ kiểm phần chính của Gate có đọc hiểu được không.

## Lệnh đối kháng

Dán nguyên văn vào prompt của reviewer, thay `ARTIFACT` và `CONTRACT`:

```
Review đối kháng. Tìm chỗ sai của artifact này. Giả định người viết quá tự tin.
Tìm: giả định không nêu · ca biên chưa xử lý · cùng dữ liệu có hai nguồn · cách vi phạm hợp đồng · quy ước hiện có bị phá · hỏng khi đầu vào bất thường.
Không khen. Không tóm tắt. Nêu lỗi kèm trích nguyên văn, hoặc nói rõ không tìm thấy sai sau khi đã kiểm kỹ.
ARTIFACT: …
CONTRACT: …
```

Chỉ đưa ARTIFACT và CONTRACT. Không đưa kết luận hay lập luận của người viết: đưa kết luận thì nhận lại lời xác nhận kết luận.
Brief: ARTIFACT = Brief, CONTRACT = ledger + dossier (bọc `<dossier>`). Design: ARTIFACT = design, CONTRACT = Brief đã duyệt. Diff: ARTIFACT = diff, CONTRACT = design + plan + allowlist.
Đơn vị nhỏ vừa một lần đọc; lớn quá thì tách trước khi giao.

## Nhãn phát hiện

Mỗi phát hiện đúng một nhãn và một trích nguyên văn (sao chép từng ký tự, không gõ lại trong dấu ngoặc kép). Không trích được câu thì không có phát hiện.

| Nhãn | Nghĩa |
|---|---|
| `GAP` | Luận điểm gánh nặng nhưng không có bằng chứng |
| `LEAP` | Có bằng chứng nhưng suy luận không theo từ đó ra |
| `ASSUME` | Giả định ngầm mà phần còn lại phụ thuộc |
| `CONFLICT` | Hai câu không thể cùng đúng |
| `OPINION` | Người review không đồng ý nhưng lập luận vẫn đứng vững; ghi là bất đồng, không phải lỗi |
| `CANNOT-ASSESS` | Cần kiến thức hoặc dữ liệu reviewer không có; nêu rõ, không đoán |

Báo cáo dài mà không có `OPINION` hay `CANNOT-ASSESS` nào là đáng ngờ: reviewer chấm như thể biết hết và không có quan điểm riêng.
Với Brief, "bóp méo dossier" (đổi nghĩa / bỏ sót / thêm suy luận) báo theo `GAP`/`LEAP`/`CONFLICT` kèm cặp trích gốc và trích Brief.

## Phân loại phát hiện

Phiên chính đọc lại artifact rồi phân loại từng phát hiện; reviewer thiếu ngữ cảnh nên có thể sai. Loại đầu tiên khớp thì dừng:

1. **Hợp đồng đọc sai:** reviewer bắt lỗi vì CONTRACT thiếu hoặc mơ hồ. Sửa CONTRACT trước, phân loại lại ở vòng sau.
2. **Đúng, cần sửa:** sửa artifact, đi vòng tiếp.
3. **Đúng, chấp nhận:** chi phí sửa lớn hơn chi phí chịu. Ghi vào "Tự quyết" hoặc "Cần bạn chọn" để user thấy.
4. **Nhiễu:** đúng theo ngữ cảnh reviewer không have. Ghi lý do và hỏi: thêm ngữ cảnh đó vào CONTRACT có tránh được báo nhầm không.

## Điều kiện dừng

Dừng khi vòng mới chỉ trả phát hiện tầm thường hoặc đã xét, hoặc sau 3 vòng (báo user, không tự làm vòng 4), hoặc user nói "ship it".
Ba vòng mà vẫn có phát hiện lớn nghĩa là artifact chưa sẵn sàng; báo user thay vì cố tiếp.
Không giao lại cho artifact không đổi: sẽ nhận cùng phát hiện.

Dấu hiệu phản biện cho có: qua 2 vòng có phát hiện đáng kể mà không cái nào được xếp "Đúng, cần sửa". Dừng và báo user.
Task Nhỏ không có dòng MỚI bỏ qua phản biện. Việc cơ học (đổi tên, định dạng) không cần.
Reviewer không tự gọi agent khác; Claude Code chặn subagent sinh subagent, và cần review thêm góc nhìn thì ghi vào báo cáo để phiên chính quyết.
Reviewer đọc `${CLAUDE_PLUGIN_ROOT}/references/reviewer-rules.md` để biết nhãn, mức độ và điều để ngoài phạm vi.
