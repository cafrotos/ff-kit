---
name: ff-init
description: Khảo sát workspace và tạo hoặc cập nhật cấu hình ff-kit có nguồn, giữ lại lựa chọn đã có và báo các bước còn thiếu.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(ff cfg get *), Bash(ff doctor *), Bash(ff env-example *), Bash(git -C * rev-parse *)
---

# /ff-init

Thiết lập cấu hình ff-kit cho workspace hiện tại. Chỉ dùng bằng chứng đọc được từ repo hoặc câu trả lời của user. Không đọc `.ff.env`, không tự điền secret và không bật worker.

## Tiền điều kiện

- `CLAUDE.md` và thư mục e2e phải tồn tại. Nếu thiếu, hướng dẫn quay lại bước tương ứng trong `${CLAUDE_PLUGIN_ROOT}/INSTALL.md`.
- Đọc spec config và `${CLAUDE_PLUGIN_ROOT}/skills/ff-init/references/detect.md`.
- Nếu đã có config, giữ mọi trường và `source` hiện tại trừ phần user yêu cầu thay đổi. Không ghi đè `.ff.env`.

## Khảo sát và hỏi

Đọc `CLAUDE.md`, `AGENTS.md`, manifests, CI và repo con. Dò repo path, branch, lệnh, app URL/health check, e2e auth, DB và adapter. Mỗi phát hiện ghi `file:line`; khi thiếu hoặc có nhiều phương án, hỏi bằng `AskUserQuestion` với lựa chọn và hệ quả rõ.

Tạo config theo schema hiện tại. Mọi lá cấu hình phải có `source` (`file:line` hoặc `user`). Giữ thông tin nhạy cảm chỉ dưới dạng đường dẫn file/key name; không đọc giá trị.

## Ghi và kiểm

Ghi `ff.config.yaml` và `ff.config.lock.json` nhất hợp với nguồn; chạy `ff doctor --schema-only`. Chạy `ff env-example` để chỉ thêm key còn thiếu. Bổ sung luật secret và `.ff/` vào `CLAUDE.md`, mục `deny`/`ask` vào `.claude/settings.json` mà vẫn giữ mục có sẵn, và các đường dẫn runtime vào `.gitignore`.

Chạy đầy đủ `ff doctor`. Core đỏ thì báo lỗi và dừng; worker/e2e đỏ vì key thiếu thì tiếp tục, ghi rõ key cần và mục đích. Không gọi `/ff-worker start`.

## Báo cáo

Theo `references/report.md`: đã cấu hình và nguồn, thiếu key và nơi lấy, lỗi kèm cách sửa, bước tiếp theo. Nêu rõ user có thể dùng skill thủ công khi worker chưa cấu hình.
