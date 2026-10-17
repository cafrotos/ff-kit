# Review diff, kiểm tra và squash

Mọi lệnh chạy trong worktree do `ff copy` tạo; lấy đường dẫn từ `ff state <id>` và lệnh từ `ff.config.yaml`.

## Review mỗi đợt

- Giao `ff-diff-reviewer` trong context mới với brief `briefs/diff-review.md`, AC, design, plan và danh sách file.
- Nếu CodeGraph có sẵn, đồng bộ index của repo trong worktree trước khi review.
- Mỗi hunk phải truy được về AC và micro-task. Xử lý phát hiện rồi mới mở đợt tiếp theo.

## Lint và build

Chạy các lệnh lint/build/test đã cấu hình tại repo tương ứng. Không chạy lệnh sửa tự động như `--fix`. Chỉ kiểm repo có thay đổi; phân biệt lỗi mới với lỗi có sẵn bằng diff so với `repos[].base_branch`. Nếu cần sửa, mở allowlist đúng file bằng `ff allow` trước.

## Squash và kiểm tra

Theo quy ước commit của workspace. Lần đầu ở repo, squash toàn bộ thay đổi kể từ fork ban đầu thành một commit; ở lần tiếp theo, squash riêng delta mới so với task branch trên remote thành một commit. Trước lần push đầu, nhánh feature phải luôn đúng **một** commit squash: mỗi lần sửa (kể cả vòng sửa sau verify fail) thì re-squash/amend vào commit đó (được phép vì chưa push), vì `ff ship-test` từ chối nhánh nhiều commit. Sau lần push đầu (reopen `rev-N`): giữ nguyên commit đã push, không force-push, mỗi lần sửa là một commit mới; chỉ cherry-pick commit mới sang dev khi ship. Trước khi stage, đọc `git status --short`; chỉ thêm file thuộc task bằng đường dẫn tường minh. Không dùng `git add -A`, `git add .`, `git stash` hoặc `git push` trong bước build. Hoàn tất squash trước khi bắt đầu verify/Gate C. Sau khi tạo commit, chạy `ff squash-check <id>` và `ff ac-matrix <id>`; xử lý mọi lỗi và báo AC còn thiếu.

Kết quả bàn giao gồm hash test lock, review, lint/build/test, squash-check, AC còn thiếu và việc cần user quyết. Sau đó chuyển `/ff-verify <id>`.
