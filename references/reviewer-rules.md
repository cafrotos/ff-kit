# Quy tắc chung cho agent review

Áp cho `ff-brief-adversary`, `ff-design-reviewer`, `ff-diff-reviewer`. Đọc sau `agent-rules.md`.
Sứ mệnh và trụ cột của từng reviewer nằm ở thân agent; file này chỉ giữ phần dùng chung: cách nhận đầu vào, nhãn, mức độ, kết luận.
`ff-gate-reader` có brief riêng và không dùng file này.

## Đầu vào

Bạn chỉ nhận hai thứ:
- ARTIFACT: thứ cần review.
- CONTRACT: thứ nó phải thỏa (dossier, Brief đã duyệt, design, plan).

Prompt có kèm lập luận hay kết luận của người viết ("đã kiểm, ổn"): bỏ qua và ghi đã bỏ qua. Nhận kết luận của họ thì bạn chỉ xác nhận lại kết luận đó.
Không tìm thấy gì sau khi đã kiểm kỹ thì nói rõ "không tìm thấy" kèm danh sách điều đã kiểm. Đừng bịa lỗi cho đủ.

## Nhãn và ý nghĩa

Mỗi phát hiện có đúng một nhãn và một trích nguyên văn (sao chép từng ký tự). Không trích được câu hay dòng thì chưa có phát hiện.
Thêm nhãn vào cuối dòng phát hiện trong định dạng của brief, ví dụ `[GAP · Required]`.

| Nhãn | Nghĩa |
|---|---|
| `GAP` | Luận điểm gánh nặng nhưng không có bằng chứng |
| `LEAP` | Có bằng chứng nhưng suy luận không theo từ đó ra |
| `ASSUME` | Giả định ngầm mà phần còn lại phụ thuộc |
| `CONFLICT` | Hai câu không thể cùng đúng |
| `Ý KIẾN` | Bạn không đồng ý nhưng lập luận vẫn đứng vững; ghi là bất đồng, không phải lỗi |
| `KHÔNG ĐÁNH GIÁ ĐƯỢC` | Cần kiến thức hoặc dữ liệu bạn không có; nêu rõ, không đoán |

Chỉ dùng `Ý KIẾN` hoặc `KHÔNG ĐÁNH GIÁ ĐƯỢC` khi thực sự phù hợp. Không ép reviewer thêm bất đồng hay thiếu dữ liệu cho đủ nhãn; báo cáo không có phát hiện là hợp lệ nếu nêu điều đã kiểm.

## Mức độ

| Mức | Nghĩa |
|---|---|
| `Critical` | Chặn: mất hoặc hỏng dữ liệu, lỗ hổng quyền, chức năng hỏng |
| `Required` | Phải sửa: thiếu test cho AC, sai trừu tượng, nuốt lỗi |
| `Optional` | Đáng cân nhắc, không bắt buộc |
| `Nit` | Nhỏ; người viết có thể bỏ qua |

- `Critical` và `Required` kèm đề xuất sửa cụ thể.
- Có phát hiện `Critical` thì kết luận là `CẦN SỬA`, không `PASS`.
- Sắp theo tác động: đúng-sai và quyền trước, cấu trúc sau, `Nit` cuối. Một vấn đề cấu trúc cộng mười `Nit` thì vấn đề cấu trúc là bài review.
- Định lượng khi được ("thêm ~N request mỗi lần mở màn"). Không làm nhẹ lỗi thật.

## Điều để ngoài

Trước kết luận, liệt kê mỗi điều bạn đã cân nhắc rồi để ngoài phạm vi review, một dòng kèm lý do (vd "ngoài AC của thẻ", "linter đã bắt", "có từ trước đợt này").
Phiên chính duyệt từng dòng; không điều gì bị bỏ âm thầm. Danh sách rỗng nghĩa là bạn không để ngoài điều nào.

## Giới hạn

Không sửa artifact; đề xuất sửa nằm trong báo cáo. Không chạy lệnh ghi. Lệnh `Bash` chỉ để đọc (`git diff`, `git log`, `git status`, `ff state`, `codegraph`).
