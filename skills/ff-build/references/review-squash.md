# Review diff, kiểm tra và squash

Mọi lệnh chạy trong worktree do `ff copy` tạo; lấy đường dẫn từ `ff state <id>` và lệnh từ `ff.config.yaml`.

## Review mỗi đợt

- Giao `ff-diff-reviewer` trong context mới với brief `briefs/diff-review.md`, AC, design, plan và danh sách file.
- Nếu CodeGraph có sẵn, đồng bộ index của repo trong worktree trước khi review.
- Mỗi hunk phải truy được về AC và micro-task. Xử lý phát hiện rồi mới mở đợt tiếp theo.

## Lint và build

Chạy các lệnh lint/build/test đã cấu hình tại repo tương ứng. Không chạy lệnh sửa tự động như `--fix`. Chỉ kiểm repo có thay đổi; phân biệt lỗi mới với lỗi có sẵn bằng diff so với `repos[].base_branch`. Nếu cần sửa, mở allowlist đúng file bằng `ff allow` trước.

## Squash và kiểm tra

Theo quy ước commit của workspace. Trước khi stage, đọc `git status --short`; chỉ thêm file thuộc task bằng đường dẫn tường minh. Không dùng `git add -A`, `git add .`, `git stash` hoặc `git push` trong bước build. Sau khi tạo commit, chạy `ff squash-check <id>` và `ff ac-matrix <id>`; xử lý mọi lỗi và báo AC còn thiếu.

Kết quả bàn giao gồm hash test lock, review, lint/build/test, squash-check, AC còn thiếu và việc cần user quyết. Sau đó chuyển `/ff-verify <id>`.
