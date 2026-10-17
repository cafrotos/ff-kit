---
description: Ship các commit đã squash sang ship_branch sau khi user xác nhận Gate C và yêu cầu ship
argument-hint: "[id | slug]"
allowed-tools: Bash(ff present *), Bash(ff cfg get *), Bash(ff state *), Bash(ff squash-check *), Bash(ff ship-request *), Bash(ff ship-approve *), Bash(ff ship *), Bash(ff stage *), Bash(ff doctor *), Read, Write, Edit
---

# /ship-to-dev

Chạy `ff state <id> --json`; lấy `activeDir`, `activeRevision`, `slug` và `testLock`. Chỉ chạy sau khi Gate C hiện tại là `approved` theo bản ghi/hash. Đọc dossier, `<activeDir>/05-verify-report.md` và `ff squash-check <id>`; không dùng report hoặc Gate C revision cũ. Lấy repo path, `base_branch`, `ship_branch`, build/test command từ `ff.config.yaml`; không dùng tên repo/branch mặc định.

## 1. Kiểm tra và trình yêu cầu

Đọc `${CLAUDE_PLUGIN_ROOT}/references/human-output.md`. Tạo packet `phase: ship` từ spec/design/report hiện tại: phạm vi Gate C đã chấp nhận, đích repo/remote/branch/hash, checks đã chạy và giới hạn. Chạy `ff present <id> --file <activeDir>/human-output.json` rồi in bản render trong chat; trước push, `nextAction` nêu đang chờ xác nhận ship riêng, không báo đã ship.

Với từng repo có commit cần ship:

- Xác nhận worktree sạch, branch đúng task và commit thuộc task này.
- `ff.localOnly=true` nghĩa là bản copy không có upstream và không được ship. Kiểm `origin` đúng remote thật; `ff-local` chỉ là nguồn lịch sử từ bản gương, không phải đích push.
- Xác nhận source branch được tách từ `base_branch`; không force push, stash hoặc đổi cấu hình remote.
- Nếu cần thông báo riêng, chạy `ff ship-request --task <id> --title "Ship <id>" --body "<repo, branch và commit cần ship>"`. Worker không chạy/gửi thất bại không chặn lượt xác nhận CLI; thông báo chỉ tùy chọn, không cấp quyền. Timeout là giao chưa rõ, không thử lại mù.
- Packet `phase: ship` phải có decision `Q1`, question không lặp prefix thẻ, options `Duyệt` và `Không duyệt`. `ff present` tự bind các target hiện tại (repo, source HEAD, origin fetch/push, ship branch, task branch) vào presentationId trước khi hỏi. In đầy đủ targets đã render.
- Trình riêng một `AskUserQuestion` với header `Q1`, question đúng nguyên văn câu hỏi Q1 đã render (gồm prefix thẻ/revision), options đúng packet, multiSelect false. Hook giữ snapshot và câu trả lời CLI. Gate C là điều kiện riêng, không phải xác nhận ship.

Nếu user từ chối hoặc yêu cầu sửa, dừng. Chỉ khi user chọn `Duyệt` cho packet hiện hành, lấy questionId từ captured history rồi chạy `ff ship-approve <slug> --question-id <questionId>`. Harness không nhận boolean approved, marker cũ, Trello prose hoặc lời ok ngoài câu hỏi. Receipt không gia hạn khi gọi lại; hết hạn sau đúng 7200 giây từ đáp án. Source/remote/branch/revision thay đổi cần trình packet và hỏi mới. Standalone giữ marker legacy riêng.

Trong harness, mọi push và tạo PR phải đi qua `ff ship <id>`; command tự kiểm receipt ở từng mutation. Không tự `git push`, `gh pr create` hoặc `gh pr merge`, kể cả trong shell wrapper. Người tự merge PR.

## 2. Ship qua CLI có checkpoint

Đọc `${CLAUDE_PLUGIN_ROOT}/references/stage-protocol.md`. Chạy `ff stage context <id> --json`; khi có pending dispatch stage ship, `ff ship <id>` tự gọi begin cho dispatch đó, thực thi S1 và chỉ finish pass khi mọi chặng bắt buộc đã xác minh. Không tự finish pass từ report verify hay từ việc push trả mã 0.

Chạy `ff ship <id>`. CLI giữ nguyên source branch/HEAD đã duyệt, kiểm Gate C, receipt build/verify, squash và human ship approval trước từng mutation/push; dùng checkout ship riêng, khóa theo origin/ship_branch, build/test theo cấu hình và checkpoint riêng push dev/task. Không chạy recipe Git thủ công song song.

Commit đẩy lên `ship_branch` là commit đã được verify trên `ff-test/<id>` (`ff ship-test`) khi `origin/<ship_branch>` vẫn bằng base đã test; nếu nhánh ship đã tiến, CLI cherry-pick lại, chạy build + test rồi mới push (conflict/đỏ → chặn, người xử lý). Checks cấu hình vẫn chạy trên đúng commit sắp push. Nhánh `ff-test/*` chỉ ở máy, không bao giờ push.

Đọc JSON kết quả từng repo: `s1Complete` xác nhận cả dev và task branch; `complete` chỉ đúng khi đủ chặng theo mode. `dev_and_pr` còn chờ S2 thì không báo đã hoàn tất hay tự chuyển nghiệm thu. PR merge luôn do người thực hiện.

Nếu blocked, báo trạng thái và chặng đã xác minh; sửa điều kiện môi trường hoặc lấy phê duyệt mới khi hết hạn rồi chạy lại cùng `ff ship <id>`. CLI đối chiếu remote trước khi lặp tác động. Không reset/squash/switch source, không force push, không tự giải quyết conflict. Không xóa worktree, dossier hoặc e2e artifacts.

## 3. Nghiệm thu bản đã ship

In commit/source HEAD, dev hashes, checks và URL/trạng thái từng PR từ JSON kết quả. Chỉ báo commit trên remote đã xác minh khi CLI đối chiếu đầy đủ cả ship branch và task branch. Push thành công chỉ chứng minh Git delivery; khi chưa có bằng chứng triển khai, ghi rõ **chưa xác minh app đã triển khai**. Không thêm deploymentId hoặc điều kiện health mới. Task B tiếp tục lên dev không hủy nghiệm thu source của task A.

Với `dev_only`, sau `complete: true`, tạo packet mới `phase: ship`, `purpose: acceptance` bằng `ff present`, chứa source HEAD/revision đã ship, commit, checks và giới hạn triển khai. Decision Q1 hỏi nghiệm thu bản đã ship, options `Duyệt` và `Không duyệt`. In render, rồi gọi `AskUserQuestion` với header **ACCEPTANCE**, câu hỏi đúng nguyên văn Q1 đã render (gồm prefix thẻ/revision), options đúng packet và multiSelect false. Đây là nghiệm thu riêng sau ship, không phải Gate C hoặc xác nhận cho phép push. Hook chụp binding với source identity đã ship, kể cả khi worker đã xử lý ship receipt và xóa pending dispatch; câu trả lời CLI được lưu bền, worker tự tiếp tục. Không gọi `ff ship-approve` cho packet nghiệm thu. Trello move/comment không cấp nghiệm thu.

Với `dev_and_pr`, không hỏi ACCEPTANCE khác; chờ người merge mọi PR đúng source HEAD đã duyệt. Conflict chỉ ghi/notify và tiếp tục poll; không tự rebase, merge hoặc force push. Nếu cần sửa sau PR đã merge/đóng hoặc task done, dùng thẻ Fix mới. Reopen hợp lệ giữ cùng UUID, tmux và cuộc hội thoại, dùng revision kế tiếp, tối đa max_reopen (tách riêng repair cycles).
