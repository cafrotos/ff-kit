# Phục hồi phiên

Dùng khi phiên mở lại giữa chừng: worker khởi động lại, tmux session chết, hoặc user quay lại thẻ sau một thời gian.
File, không phải hội thoại, giữ trạng thái.

## Phục hồi phiên

1. Đọc theo thứ tự, file nào có thì đọc: dossier, `01b-ledger.md`, `brief.md`, `03-design.md`, `04-plan.md`, `05-verify-report.md`.
2. Chạy `ff state <id>`. Có bản copy thì chạy `git status` trong đó.
3. Nêu 2–3 dòng: đang ở pha nào, việc dở, đang chờ gì. Ví dụ: "Brief đã duyệt, design còn thiếu hợp đồng API; đang chờ bạn chọn Q2."
4. Gate đã `Duyệt` theo bản ghi Gate và hash thì giữ nguyên. Không suy ra "đã duyệt" từ hội thoại cũ; chỉ bản ghi Gate có giá trị.
5. Chạy lại lệnh kiểm khi kết quả cũ không được ghi lại, khi code đã đổi, hoặc khi bước sau phụ thuộc vào nó.
6. Tiếp tục từ pha mà `ff state` chỉ ra. Không chạy lại pha trước và không hỏi lại user điều file đã trả lời.
7. Phát hiện bằng chứng làm một Gate đã qua không còn đúng (dossier đổi, hash lệch): nói thẳng và trình lại Gate đó.

Trước khi rời một phiên chủ động, ghi vào file của thẻ: phạm vi và quyết định đã chốt, việc đang làm và việc kế tiếp, file đã đổi và trạng thái cây làm việc, lệnh kiểm và kết quả, câu hỏi còn mở và việc chờ duyệt.
