# MVP harness preflight — 2026-10-15

## Phạm vi

Đây là preflight trên checkout implementation của ff-kit. Baseline build/test tự động có sẵn trong workspace SDD và đã được đối chiếu; các kiểm tra runner cần một máy có Claude Code, tmux và workspace Trello thật chưa thể thực hiện trong môi trường này. Vì vậy, kết quả dưới đây tách bằng chứng tự động khỏi smoke test vận hành chưa chạy.

Đã đọc `INSTALL.md` và mục 13, 15 trong `docs/superpowers/specs/2026-10-15-mvp-harness-design.md`. `INSTALL.md` xác định tmux chỉ cần cho worker nền; thiếu tmux không cản các skill thủ công. Mục 13 đặt lát 0 là chạy tay một thẻ thật; mục 15 ghi các rủi ro runner cần thử nghiệm.

## Phiên bản và khả dụng

| Thành phần | Kết quả |
|---|---|
| Node.js | `v24.19.0` (đạt yêu cầu `>=20.10`) |
| Git | `git version 2.51.1` |
| tmux | Không có (`tmux: command not found`) |
| Claude Code | Không có (`claude: command not found`); không thể lấy `claude --version` hoặc `claude --help` |
| GitHub CLI | Không có (`gh: command not found`) |
| `ff` trên PATH của shell hiện tại | Không có (`ff: command not found`) |

Do Claude Code không cài trong môi trường này, không xác minh được flag `--session-id`, `--resume`, `--permission-mode auto`, hook SessionStart/Stop/AskUserQuestion hoặc plugin path bằng help thực tế. Không suy đoán về hỗ trợ hoặc ngữ nghĩa của các flag đó. Do không có tmux, không thể kiểm tra phiên tmux, `send-keys` literal, PATH Bash trong phiên Claude, hay phân giải `ff` từ snapshot. Không có workspace Trello thật hoặc phiên đăng nhập subscription được cấu hình, vì vậy cũng không thử tạo/cập nhật thẻ hoặc gửi thông báo.

## Baseline tự động

`npm ci` đã thành công trước preflight theo bằng chứng môi trường của controller. Không chạy lại cài dependency hoặc suite đã có.

| Lệnh baseline | Kết quả đã ghi nhận |
|---|---|
| `npm run build` | Exit 0; log tại `.superpowers/sdd/2026-10-15-mvp-harness-implementation-0d4c376018/baseline-build.log` |
| `npm test` | Exit 0; 338 tests, 337 pass, 1 skip, 0 fail; log tại `.superpowers/sdd/2026-10-15-mvp-harness-implementation-0d4c376018/baseline-test.log` |

Test bị skip là kiểm tra Playwright có thể liệt kê template khi Playwright được cài trong checkout; log ghi dependency Playwright không được cài trong ff-kit. Đây là baseline tự động của checkout, không phải bằng chứng nghiệm thu harness hay runner thật.

## Smoke test vận hành / lát 0

Không chạy được task thật bằng tay theo lát 0: không có tmux, Claude Code/subscription session hoặc workspace Trello thật đã cấu hình. Vì các điều kiện thiết lập không có, dừng trước các phần phụ thuộc; không cài công cụ, đăng nhập, thử tài khoản, gửi thông báo hoặc thay đổi billing. Không ghi nhận bước gõ chuyển pha thực tế nào. Cần thực hiện lại trên máy vận hành có workspace và quyền truy cập phù hợp để thu thập ma sát baseline.

Các khả năng runner cần xác minh trên máy đó gồm: tạo phiên với UUID do worker cấp qua `--session-id`; resume đúng UUID và auto mode; SessionStart chỉ xác nhận `session_id`; Stop/AskUserQuestion; plugin lấy từ path ghim; Bash trong phiên ưu tiên `snapshot/bin/ff`; gửi `send-keys` literal; người trả lời Gate trong CLI và phiên tự tiếp tục. Không thử push. Đây đều là kiểm tra chưa xác minh ở preflight này.

## Kết luận

Baseline Node/build/test sẵn có xanh. Preflight vận hành còn chặn bởi thiếu runner và workspace thật; đây là giới hạn môi trường, không phải lỗi baseline. Chưa có dữ liệu smoke test một task thật và chưa thể xác nhận các hành vi của Claude/tmux/Trello cho lát 0.
