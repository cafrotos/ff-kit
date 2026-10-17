# Đánh giá workflow skill

Các bảng là kịch bản đánh giá thủ công/model, chưa phải kết quả đã chạy. Cho model dùng bản plugin đang kiểm, workspace tạm và config có `cards_dir: cases`, `worktrees_dir: sandboxes`, `e2e.dir: qa`, `e2e.tests_dir: qa/specs`. Dùng service giả hoặc app thử nghiệm, không dùng dữ liệu sản phẩm.

Mỗi ca: ghi prompt + fixture ban đầu, transcript tool, state trước/sau, artifact/diff và kết luận pass/fail kèm lý do. Reset workspace giữa các ca. Chấm đúng artifact và ranh giới quyền; không chấm keyword. Chỉ coi PASS hành vi khi có bằng chứng chạy thật. Phân biệt lỗi skill, runtime, hợp đồng thiếu và giới hạn môi trường. Không công bố token trong bằng chứng.

Test tự động nội dung/template xác minh các contract cơ học; các scenario dưới đây cần replay khi đánh giá model/agent. Không ghi "đã chạy" chỉ vì bảng tồn tại.

## Replay kết quả cho người dùng (operating/ship/reopen)

Các ca bổ sung dưới đây chưa chạy với Claude. Baseline review độc lập đã thấy thiếu bản tổng hợp riêng và thiếu tổng quan toàn chức năng ở thẻ lớn; test nội dung chỉ chứng minh recipe/schema/tuyến gọi được khai báo, không chứng minh model viết đúng hoặc người đọc hiểu. Không giả lập PASS semantic bằng đếm keyword.

Mỗi replay thu artifact hiện tại, packet JSON, stdout `ff present`, văn bản Claude chat và thông báo qua transport giả; không gửi live message. So identity/revision/scope, từng câu hỏi và lựa chọn giữa các bản. Đọc bản render như người mới trước khi mở nguồn; restate mục đích, AS-IS/TO-BE, ảnh hưởng, giới hạn và quyết định theo pha. Sau đó đối chiếu từng khẳng định với nguồn để chấm tính trung thực, phân biệt nhận xét dossier và hiện trạng đã kiểm. Một bản đủ tiêu đề nhưng người đọc phải đoán vẫn fail.

Chấm riêng: (1) độ hiểu chỉ từ bản trình, (2) trung thực với nguồn/evidence, (3) bảo toàn câu hỏi/lựa chọn và identity qua các surface, (4) giữ Gate/ship permission. Ghi đoạn gây hiểu lệch và kết quả restate, không chỉ ghi điểm tổng. Các ca này chỉ bao phủ operating/ship/reopen; không thêm discovery/init hoặc inbound replies.

## Định dạng fixture (một định dạng cho mọi suite; SRS EVO-01, R9)

```
fixtures/<suite>/
  expected.md   bảng đáp án chấm trước: | Ca | Đúng | Sai nếu |   (ca cũ có thể thêm cột căn cứ)
  results.md    bảng so cặp: | Ca | A (hiện tại) | B (vá) | Nhãn |   (kết quả cũ giữ nguyên, bảng chuẩn ghi ở cuối)
  <ca>/dossier.md     đầu vào dossier (thẻ hoặc tình huống)
  <ca>/git-facts.md   sự kiện git/repo (nhánh, commit, sha) nếu ca cần; hoặc thư mục repo/
  <ca>/prompt.md      lời nhắc/tình huống cụ thể giao agent (nếu có)
  common.md           ngữ cảnh chung của suite (nếu có)
```

Nhãn, mỗi ca đúng một: `sửa được` (B đúng, A sai; "sửa được một phần" ghi vào cột kết quả, nhãn vẫn là `sửa được` nếu không có ca tệ đi) · `không đổi` · `tệ đi` (A đúng, B sai) · `nhiễu` (lệch giữa các lần lặp cùng bản). `—` = chưa chạy. Phát hành khi ≥ 1 `sửa được` và 0 `tệ đi`.

Fixture sinh từ thẻ thật nằm ở workspace (`.ff/evals/fixtures/`, cùng định dạng, có `case.json`) và chạy bằng `ff eval run`; không chép dữ liệu dự án vào đây.

