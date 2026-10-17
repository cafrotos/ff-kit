# Dò nguồn cấu hình

Đi từ workspace root. Đọc `CLAUDE.md`, `AGENTS.md`, README, manifests, CI và file cấu hình không bí mật. Tìm repo con bằng `git -C <path> rev-parse --show-toplevel`; bỏ qua `node_modules`, build output và `.git` khi dò.

## Repo và lệnh

Với mỗi repo, ghi tên, đường dẫn tương đối, branch hiện tại, branch gốc/ship khi có bằng chứng, package manager và các lệnh install/lint/typecheck/build/test/migrate. Ưu tiên scripts trong package manifest/Makefile/CI; không chạy lệnh để đoán tác dụng.

## E2E app và xác thực

- Dò port từ script `dev`/`start`, file config app và CI. Chỉ thêm URL có căn cứ; đánh dấu câu trả lời user nếu chưa xác minh.
- Nếu auth dùng JWT, tìm nơi ký token và xác nhận algorithm, payload, key secret theo tên, expiry; tìm frontend nơi token được nhận và lưu (`query`, `local_storage`, `cookie`), cùng endpoint xác minh user. Ghi `file:line`; không mở secret file.
- Nếu form login, ghi URL login và key names `E2E_USER`/`E2E_PASSWORD`; không đọc `.ff.env`.
- Health URL phải có bằng chứng từ health route hoặc cấu hình service.

## E2E services (ff tự bật/tắt app khi verify)

ff-kit tự khởi động và dừng service cho `ff verify-up` / `ff verify-down` theo khối `e2e.services`; không gọi script dev của dự án. Mỗi service: `name`, `repo` (tên trong `repos[]`), `cwd` (tương đối trong repo), `cmd` (lệnh chạy foreground), `port`, tùy chọn `prepare` (cài/build chạy một lần mỗi repo, tại gốc repo), `env_load` (file env export nếu có; process env thắng), `health_url`, `env_overrides` (`file`, `from` template, `set` KEY→giá trị; idempotent).

User không phải tự đưa lệnh: suy luận toàn bộ từ bằng chứng, theo thứ tự ưu tiên:

1. `CLAUDE.md` ở workspace root (nguồn chính: mô tả cách chạy toàn hệ thống), rồi `CLAUDE.md`/README của từng repo.
2. `package.json` scripts của từng app; với monorepo đọc thêm workspaces/turbo/nx để biết app nào, thư mục nào, script nào, workspace package phải build trước (→ `prepare`).
3. Script dev có sẵn (`dev.sh`, `scripts/dev.sh`, `Makefile`...): **chỉ đọc**, không bao giờ chạy và không đặt làm `up_cmd`. Lấy từ đó app/service nào, lệnh mỗi app, port, cách tạo `.env.development.local` từ template và key bị ghi đè, file env nạp trước backend, bước cài/build phải chạy trước.
4. `docker-compose*.yml`, `.env.example`, `.env.development` và các template env (port, URL, key cần ghi đè); lệnh install/lint/typecheck/build/test/migrate và base/ship branch của repo theo cùng cách, nơi có bằng chứng.

Trình bày MỘT bản đề xuất (repo commands, branches, `e2e.services`) kèm `file:line` cho từng giá trị, rồi hỏi một câu xác nhận duy nhất bằng `AskUserQuestion` với hai lựa chọn: "Đúng hết" hoặc "Cần sửa" (chọn sửa thì hỏi phần cần đổi). Chỉ hỏi riêng từng giá trị khi không có bằng chứng nào; không tự bịa lệnh hay port.

File env bị gitignore mà service cần (vd file env cục bộ của backend) phải có trong `repos[].env_files` để ff chép vào checkout verify; `ff doctor` đỏ nếu `env_files` thiếu, `env_overrides.from` không tồn tại, repo không rõ hoặc cổng trùng.

## Safety

Không đọc secret values, database values, `.ff.env`, storage-state hoặc token. Không tự tạo port, branch, role, user, endpoint hay lệnh. Mỗi trường đề xuất phải có `source`; thiếu nguồn thì hỏi user.
