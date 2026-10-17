# card-recon — A = 0.2.2 (2e53e68), B = 0.2.3 (f97582e/bd06b4c), Sonnet effort low, 1 lần/ca, 2026-10-19

Chạy giả lập bằng subagent trong phiên Claude (đọc skill theo ref, git/ff state lấy từ git-facts.md, câu hỏi ghi ra questions.md). Không chạy hook/CLI/Gate thật.

| Ca | Đáp án | A (0.2.2) | B (0.2.3) | Nhãn |
|---|---|---|---|---|
| S1 bug + việc đã merge | BUG-FIX MODE | ❌ Brief delta thường, không trinh sát; hỏi thêm "giữ lọc khi tải lại/chia sẻ link" (mở rộng phạm vi) | ✅ BUG-FIX MODE, khuôn sửa bug, ledger `## Trinh sát thẻ`; ⚠ đề xuất cắt nhánh từ dev, đáp án ghi base_branch | sửa được |
| S2 bug, chưa làm gì | Luồng thường, bug là đầu vào | ✅ | ✅ (thêm mục "Bug (đầu vào bắt buộc)", ledger ghi chế độ) | không đổi |
| S3 không bug | Luồng thường | ✅ không câu hỏi | ✅ không câu hỏi | không đổi |
| S4 (dựng từ thẻ 136) bug + việc chưa merge | BUG-FIX MODE, không hỏi #1 (đã có trong commit) và #3 (ngoài bug) | ❌ Brief tính năng cỡ Vừa, hỏi cả 4 câu "Cần làm rõ" | ⚠ BUG-FIX MODE đúng, nguyên nhân gốc lấy đúng từ commit; ❌ vẫn hỏi #1 (dù tự ghi "như code hiện tại"), #2, #3 (dù tự khuyến nghị "ngoài phạm vi") | sửa được |

## Lỗi thật
1. S4-B tái hiện đúng lỗi thẻ 136: BUG-FIX MODE vẫn đưa mọi mục "Cần làm rõ" của dossier vào "Cần bạn chọn", kể cả mục đã có câu trả lời trong commit của việc đã làm và mục không liên quan bug. `brief-bugfix.md` không có luật lọc câu hỏi; `recon.md:44` chỉ nói khi nào phải hỏi, không nói khi nào không hỏi.
2. S1-B: chọn nhánh gốc là `dev` thay vì `base_branch`; cần chủ dự án chốt đáp án (nhánh cũ đã merge vào dev nhưng chưa vào main).

# Bản vá (working tree sau 0.2.4: luật nhánh theo base_branch + lọc câu hỏi BUG-FIX), Sonnet effort low, 1 lần/ca, 2026-10-19

Đáp án S1 đã sửa (sửa tiếp branch feature, không tách từ dev); thêm S5.

| Ca | Đáp án | 0.2.3 | Bản vá | Nhãn |
|---|---|---|---|---|
| S1 | BUG-FIX, sửa tiếp `feature/777-order-filter` | ❌ đề xuất cắt từ dev | ✅ sửa tiếp branch feature, không câu hỏi | sửa được |
| S2 | Luồng thường, bug đầu vào | ✅ | ✅ branch mới từ main | không đổi |
| S3 | Luồng thường | ✅ | ✅ không câu hỏi | không đổi |
| S4 | BUG-FIX, không hỏi #1/#3 | ❌ hỏi #1, #2, #3 | ✅ chỉ 1 câu (phạm vi dropdown, `Bug phụ thuộc: B-03`); ghi rõ không hỏi D-02 (đã có commit), D-03/D-04 (ngoài phạm vi); sửa tiếp branch feature | sửa được |
| S5 | BUG-FIX, tạo lại branch từ main + cherry-pick | (chưa chạy) | ✅ đúng | — |

Kết luận: 2 sửa được, 0 tệ đi → đạt luật §14.1. Chưa đo nhiễu (1 lần/ca).
