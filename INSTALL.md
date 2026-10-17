# Cài đặt ff-kit vào workspace

Thực hiện trong workspace mục tiêu; các bước đặc quyền hoặc tải dependency/browser cần user xác nhận theo môi trường của họ.

## Điều kiện

- Node.js theo phiên bản tối thiểu ghi trong `package.json`, Git và Claude Code có hỗ trợ plugin.
- Workspace có `CLAUDE.md` (nếu chưa có, chạy `/init`) và một repo Git. Có thể dùng bộ e2e hiện có hoặc tạo `ff-e2e/` bằng `ff e2e-scaffold`.
- `tmux` chỉ cần khi muốn chạy worker nền. Thiếu thì worker không thể khởi động; các skill thủ công vẫn dùng được.

## Cài plugin từ GitHub

Repo public đã có marketplace manifest, nên trên máy cài đặt chạy trong shell:

```sh
claude plugin marketplace add cafrotos/ff-kit
claude plugin install ff-kit@ff-kit --scope user
npm install --global git+https://github.com/cafrotos/ff-kit.git
```

Hai lệnh Claude Code thêm marketplace `ff-kit` từ GitHub và cài plugin cho user hiện tại trên máy. Lệnh npm cài CLI `ff` từ cùng repo; các skill cần CLI này để chạy `ff doctor` và các lệnh workspace. Nếu muốn giới hạn plugin trong workspace hiện tại, dùng `--scope local` thay cho `--scope user`.

Kiểm tra cài đặt:

```sh
claude plugin list
ff help
```

Mở hoặc khởi động lại Claude Code trong workspace, rồi gõ `/` và gọi skill theo tên plugin (ví dụ `/ff-kit:ff-init`). Nếu skill chưa xuất hiện, chạy `/reload-plugins` hoặc mở lại phiên. Có thể xem plugin đang bật trong `/plugin`.

Để cập nhật sau này:

```sh
claude plugin marketplace update ff-kit
claude plugin update ff-kit@ff-kit
```

Không chạy lệnh cài đặt từ nguồn chưa tin cậy. Đọc phần an toàn bên dưới trước khi bật plugin vì plugin chạy với quyền của user Claude Code.

Nếu muốn agent quan sát/verify UI, cài và bật plugin Playwright riêng theo hướng dẫn chính thức của môi trường Claude Code. `ff doctor` không gọi Claude CLI để kiểm plugin; nó in cảnh báo tùy chọn. CodeGraph cũng tùy chọn; thiếu `codegraph` thì agent có thể dùng tìm kiếm văn bản thay thế.

## Khởi tạo workspace

1. Nếu chưa có e2e, thông báo trước rằng `ff e2e-scaffold` chạy `npm install`, rồi hỏi user trước khi chạy vì lệnh tải dependency qua mạng. Không tải browser tự động; nếu cần Chromium, hỏi riêng trước `npx playwright install chromium`.
2. Gọi `/ff-kit:ff-init`. Skill khảo sát repo, scripts, branch, URL và nguồn auth; mọi giá trị chưa có bằng chứng phải được hỏi. Nó tạo/cập nhật `ff.config.yaml`, lock và `.ff.env.example`.
3. Điền secret cần thiết trực tiếp vào file secret cục bộ theo tên key trong báo cáo. Không đưa giá trị secret vào prompt hoặc config YAML.
4. Chạy `ff doctor`. Nhóm `core` phải xanh để các lệnh config hoạt động. Nhóm `e2e` cần xanh cho `/ff-kit:ff-verify`; nhóm `worker` cần xanh trước `/ff-kit:ff-worker start`.
5. Dùng `/ff-kit:ff-understand <id>` để bắt đầu task, hoặc đưa yêu cầu trực tiếp để tạo dossier theo hướng dẫn skill.

## Worker tùy chọn

Trước khi chạy worker, mở `claude` một lần trong workspace và chọn "Yes, I trust this folder" (nếu không phiên worker kẹt ở hộp thoại trust; `ff doctor` sẽ cảnh báo). Cấu hình nguồn task và channel trong `ff.config.yaml`, cung cấp key trong file secret đã cấu hình, cài `tmux`, rồi chạy `/ff-kit:ff-worker start`. Lệnh này kiểm tra doctor trước khi tạo session. Không chạy service worker nếu chỉ dùng workflow skill thủ công.

### Đồng bộ và tạm dừng thẻ

- Worker quét các cột poll mỗi 5 phút (`worker.task_source.trello.poll_interval_sec`, mặc định 300).
- Kéo thẻ khỏi cột poll (Doing/QA Fail) hoặc bỏ gán người → worker tạm dừng task.
- Tạm dừng từ chat của thẻ → thẻ chuyển sang `worker.task_source.trello.park_list` kèm comment.
- Kéo thẻ về Doing/QA Fail → task tiếp tục ở lần quét kế tiếp.
- Trước mỗi lần chạy hoặc tiếp tục, worker pull lại đầy đủ thẻ và ghi lại dossier; comment mới từ lần pull trước nằm trong mục `## Comment mới kể từ lần pull trước`.
- Chọn thẻ: cột Doing trước. Chỉ khi Doing không có việc chờ mới lấy thẻ từ QA Fail (`worker.task_source.trello.qa_fail_list`): pull lại, kéo thẻ về Doing, rồi chạy. Thẻ đã có task thì phiên nhận prompt `QA fail lần N`, sửa bug trên branch hiện tại và chạy lại verify, không làm lại Brief.
- Số lần mở lại tối đa là `ship.max_reopen` (mặc định 3). Quá số này, worker tạm dừng thẻ (chuyển sang `park_list`) để người xử lý.
- Cấu hình cột: `worker.task_source.trello.doing_list` và `qa_fail_list` (mặc định suy từ `poll_lists`). Worker không khởi động nếu cột nào không có trên board; worker không tự tạo cột.
- Phiên tmux của task tạm dừng bị đóng sau 60 phút nếu không ai attach (`worker.park_close_after_minutes`); lịch sử giữ nguyên, tiếp tục bằng `claude --resume`.
- Task đang chờ người không chiếm slot worker.

## Lệnh `ff` toàn cục

`ff` là CLI của ff-kit. Cài từ GitHub như ở trên là đủ cho người dùng. Chỉ khi bạn đang phát triển ff-kit, clone repo và link checkout đó để sửa là có hiệu lực ngay:

```sh
git clone https://github.com/cafrotos/ff-kit.git <đường-dẫn-ff-kit>
cd <đường-dẫn-ff-kit> && npm install --global .
```

Với cách này, `npm` tạo symlink `$(npm prefix -g)/bin/ff` → `lib/node_modules/ff-kit` → `<đường-dẫn-ff-kit>`. Kiểm tra:

```sh
command -v ff     # phải ra đường dẫn trong thư mục bin của npm global
ff --help         # in danh sách lệnh
```

`claude plugin update ff-kit@ff-kit` không ảnh hưởng `ff` vì nó không đọc từ thư mục plugin. Để lấy bản mới của CLI, cập nhật checkout (`git pull` trong `<đường-dẫn-ff-kit>`); symlink nên có hiệu lực ngay, không cần cài lại.

## An toàn và cập nhật

Không đọc hoặc in `.ff.env`, token, storage-state hay giá trị secret. `ff doctor` chỉ báo tên key có/thiếu. Cài đặt và nâng cấp plugin không tự sửa dossier, repo sản phẩm hay bộ e2e đã tồn tại. Sao lưu workspace trước các thay đổi cấu hình lớn và rà diff sau `/ff-kit:ff-init`.

Để cập nhật, nâng phiên bản plugin theo marketplace/nguồn cài ban đầu và nạp lại plugin. Template e2e hiện có không tự bị ghi đè.

## Bật persistent harness 0.2.0

Mặc định `worker.driver.enabled: false` giữ workflow cũ. Để bật thử nghiệm,
đặt `worker.driver.enabled: true` cùng `worker.task_source.trello.accept_list`
và `reopen_list` hợp lệ; giữ board/poll/done list và config lock đúng workflow.
Node.js >=20.10 và Claude hỗ trợ `--plugin-dir`, `--session-id`, `--resume`,
`--permission-mode auto` là bắt buộc. Chạy doctor rồi chủ động `ff worker start`.
Không có fallback CLI global, API/PAYG hay permission bypass khi snapshot hoặc
runner bị lỗi. Xem ví dụ cấu hình từng phần trong README.

Mỗi phiên Claude của thẻ mở được bằng Remote Control (`ff-<id> <slug>` trong Claude app/claude.ai/code; tắt bằng `worker.driver.remote_control: false`) hoặc `tmux a -t <session>` (cần cho lệnh `!` như `ff worker resolve`, Remote Control không chạy được). Thông báo chỉ hướng dẫn hai cách này; trả lời Gate, relock hoặc xác
nhận ship trong Claude CLI, rồi worker tự tiếp tục sau evidence. Không nhập lệnh
chuyển pha thủ công, không clear/kill/recreate phiên. Trello và Rocket.Chat không
cấp phê duyệt. Xem `ff worker status`, `ff state <id> --json` và `ff worker logs`
khi blocked. Verify thiếu setup lưu receipt `environment_blocked`, không tự sửa
implementation. Sau khi sửa setup, worker kiểm preflight mới gắn đúng revision/HEAD,
giữ receipt lỗi và tự cấp dispatch verify mới trong cùng phiên; không dùng cơ chế
này để xóa block identity/pin/unknown hoặc tiêu tốn thêm repair. Preflight Git ở S1 và `gh auth status` ở S2 chặn đúng pha.

`ship.mode: dev_only` là mặc định và cần nghiệm thu CLI sau S1; `dev_and_pr` tạo
PR nhưng chỉ done sau người merge. Gate C và xác nhận ship là hai quyết định
riêng, gắn revision/HEAD/đích; Gate C `auto_passed` (qua `ff gate-auto --gate GATE_C`)
cho phép `ff ship-approve <slug> --auto` không hỏi người (TTL 2 giờ cho mutation mới). Conflict/unknown PR
không hủy S1, không tự rebase/merge/force push. Reopen tạo delta trong cùng phiên;
task đã done/PR đã đóng hoặc merge cần thẻ Fix mới. Không suy deployment từ push.

Fake-service regression không thay nghiệm thu production: browser và real
Claude/tmux pane probe chưa được chấp nhận ở môi trường này. Probe không chứng
minh được input rỗng/idle thì fail closed; không tự gửi phím để vượt kiểm tra.
