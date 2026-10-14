# Đánh giá workflow skill

Các bảng là kịch bản đánh giá thủ công/model, chưa phải kết quả đã chạy. Cho model dùng bản plugin đang kiểm, workspace tạm và config có `cards_dir: cases`, `worktrees_dir: sandboxes`, `e2e.dir: qa`, `e2e.tests_dir: qa/specs`. Dùng service giả hoặc app thử nghiệm, không dùng dữ liệu sản phẩm.

Mỗi ca: ghi prompt + fixture ban đầu, transcript tool, state trước/sau, artifact/diff và kết luận pass/fail kèm lý do. Reset workspace giữa các ca. Chấm đúng artifact và ranh giới quyền; không chấm keyword. Chỉ coi PASS hành vi khi có bằng chứng chạy thật. Phân biệt lỗi skill, runtime, hợp đồng thiếu và giới hạn môi trường. Không công bố token trong bằng chứng.

Test tự động nội dung/template xác minh các contract cơ học; các scenario dưới đây cần replay khi đánh giá model/agent. Không ghi "đã chạy" chỉ vì bảng tồn tại.
