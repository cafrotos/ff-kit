# Dò nguồn cấu hình

Đi từ workspace root. Đọc `CLAUDE.md`, `AGENTS.md`, README, manifests, CI và file cấu hình không bí mật. Tìm repo con bằng `git -C <path> rev-parse --show-toplevel`; bỏ qua `node_modules`, build output và `.git` khi dò.

## Repo và lệnh

Với mỗi repo, ghi tên, đường dẫn tương đối, branch hiện tại, branch gốc/ship khi có bằng chứng, package manager và các lệnh install/lint/typecheck/build/test/migrate. Ưu tiên scripts trong package manifest/Makefile/CI; không chạy lệnh để đoán tác dụng.

## E2E app và xác thực

- Dò port từ script `dev`/`start`, file config app và CI. Chỉ thêm URL có căn cứ; đánh dấu câu trả lời user nếu chưa xác minh.
- Nếu auth dùng JWT, tìm nơi ký token và xác nhận algorithm, payload, key secret theo tên, expiry; tìm frontend nơi token được nhận và lưu (`query`, `local_storage`, `cookie`), cùng endpoint xác minh user. Ghi `file:line`; không mở secret file.
- Nếu form login, ghi URL login và key names `E2E_USER`/`E2E_PASSWORD`; không đọc `.ff.env`.
- Health URL phải có bằng chứng từ health route hoặc cấu hình service.

## Safety

Không đọc secret values, database values, `.ff.env`, storage-state hoặc token. Không tự tạo port, branch, role, user, endpoint hay lệnh. Mỗi trường đề xuất phải có `source`; thiếu nguồn thì hỏi user.
