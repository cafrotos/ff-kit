# Runbook: chạy thử harness trên ~/workspaces/tiniweb

Chạy từ một terminal SSH riêng, user `cafrotos`. Mọi quyết định (Gate, câu hỏi, ship) làm trong phiên Claude của thẻ — qua Remote Control trên app hoặc `tmux a`. Rocket.Chat chỉ thông báo.

## 0. Kiểm tra môi trường

```sh
source ~/.nvm/nvm.sh            # nếu shell chưa nạp nvm
ff --version                    # 0.2.0 — symlink tới ~/workspaces/ff-kit (xem INSTALL.md, mục "Lệnh `ff` toàn cục")
claude --version                # >= 2.1.302, đã đăng nhập
tmux -V
```

`ff` cài bằng `npm i -g /home/cafrotos/workspaces/ff-kit` (symlink): sửa ff-kit là có hiệu lực ngay. Worker (`ff-worker`) nằm trong cùng gói, chạy bằng `ff worker start`; mỗi thẻ tự ghim snapshot plugin/CLI lúc tạo task. Khi ổn định sẽ publish npm với tên có scope (ví dụ `@cafrotos/ff-kit`, vì `ff-kit` đã có người dùng) để chạy `npx`.

## 1. Cài plugin (cập nhật tự động từ GitHub `main`)

```sh
claude plugin marketplace add cafrotos/ff-kit
claude plugin install ff-kit@ff-kit --scope user
claude plugin list               # thấy ff-kit enabled
```

Khi ff-kit có bản mới: `claude plugin marketplace update ff-kit && claude plugin update ff-kit@ff-kit`, rồi mở lại phiên (hoặc `/reload-plugins`).

### Mẹo copy chữ trong tmux/Claude qua SSH

tmux (bật chuột) và giao diện Claude Code bắt sự kiện chuột, nên kéo chọn thường không copy được:

- Giữ `Shift` khi kéo chuột (Windows Terminal, GNOME Terminal, đa số terminal Linux); iTerm2/macOS giữ `Option`.
- Hoặc copy mode của tmux: `Ctrl-b [`, chọn bằng `Space`, copy bằng `Enter`.
- Đưa copy của tmux thẳng vào clipboard máy bạn (terminal hỗ trợ OSC52): thêm `set -g set-clipboard on` vào `~/.tmux.conf`, rồi `tmux source ~/.tmux.conf`.

## 2. CLAUDE.md cho workspace

```sh
cd ~/workspaces/tiniweb
claude
```
Trong phiên: `/init` → kiểm tra `CLAUDE.md` mô tả đúng hai repo `oe-hrm-fe`, `system-service`.

## 3. Khởi tạo ff-kit

Trong phiên: `/ff-kit:ff-init`. `/ff-kit:ff-init` tự đề xuất mọi thứ (repo, nhánh, lệnh install/build/test/migrate, `e2e.services`) từ `CLAUDE.md` gốc, `CLAUDE.md`/`package.json` từng repo và `dev.sh` (chỉ đọc), kèm `file:line`; bạn chỉ xác nhận "Đúng hết" hoặc "Cần sửa". Nội dung dự kiến:

- Repo `oe-hrm-fe` (nhánh mặc định `dev`) và `system-service` (mặc định `main`). Với mỗi repo: `base_branch` = nhánh prod (đích PR), `ship_branch` = nhánh dev (nơi test/nghiệm thu).
- Lệnh `install` / `build` / `test` (và `migrate` nếu có) từng repo.
- Trello: `board_id`, `poll_lists`, `done_list`, `accept_list`, `reopen_list`, `park_list: Todo`.
- Channel: `rocketchat`.
- Harness: `worker.driver.enabled: true`; `worker.driver.remote_control: true` (mặc định); `ship.mode: dev_only` hoặc `dev_and_pr` (đã có `gh` đăng nhập).
- e2e: bắt buộc vì verify chạy trên nhánh ship. Đồng ý `ff e2e-scaffold` (npm install Playwright) và tải Chromium khi skill hỏi. Cách chạy app để test: trả lời `/ff-kit:ff-init` để định nghĩa `e2e.services` — **ff-kit tự bật/tắt service** (`ff verify-up` / `ff verify-down`), `dev.sh` của workspace chỉ là tài liệu tham khảo (skill đọc nó để đề xuất, không bao giờ chạy nó).
- Cài Chromium cho Playwright (một lần): `cd ~/workspaces/tiniweb/ff-e2e && npx playwright install chromium`.

Khối `e2e.services` đề xuất cho tiniweb (suy ra từ `dev.sh backend all`; xác nhận lại khi skill hỏi). Verify chạy trong `worktrees/<slug>.test/` (đủ cả hai repo cạnh nhau, giống workspace), nên đường dẫn là tương đối trong repo:

```yaml
repos:
  - name: system-service
    # ... như đã khai báo
    env_files:
      - .env
      # - .env.local   # chỉ thêm nếu bạn có file này (gitignored); backend nạp nó trước khi chạy như dev.sh
e2e:
  services:
    - name: backend
      repo: system-service
      cwd: .
      prepare: yarn
      cmd: yarn start:dev
      port: 8080
      env_load: [.env.local]
      health_url: http://localhost:8080/health
    - name: home
      repo: oe-hrm-fe
      cwd: apps/home
      prepare: yarn && yarn workspace @oe-ebm/utils build --mode development && yarn workspace @oe-ebm/ui build:dev && yarn workspace @oe-ebm/phone build
      cmd: rm -rf node_modules/.vite && yarn dev -- --host 0.0.0.0
      port: 3000
      env_overrides:
        - file: apps/home/.env.development.local
          from: apps/home/.env.development
          set: { VITE_HOME_URL: "http://0.0.0.0:3000", VITE_API_BASE_URL: "http://0.0.0.0:8080/api/v1" }
    - name: recruit
      repo: oe-hrm-fe
      cwd: apps/recruit
      cmd: rm -rf node_modules/.vite && yarn dev -- --host 0.0.0.0
      port: 3001
      env_overrides:
        - file: apps/recruit/.env.development.local
          from: apps/recruit/.env.development
          set: { VITE_HOME_URL: "http://0.0.0.0:3000", VITE_API_BASE_URL: "http://0.0.0.0:8080/api/v1" }
    - name: system
      repo: oe-hrm-fe
      cwd: apps/system
      cmd: rm -rf node_modules/.vite && yarn dev -- --host 0.0.0.0
      port: 3002
      env_overrides:
        - file: apps/system/.env.development.local
          from: apps/system/.env.development
          set: { VITE_HOME_URL: "http://0.0.0.0:3000", VITE_API_BASE_URL: "http://0.0.0.0:8080/api/v1" }
    - name: crm
      repo: oe-hrm-fe
      cwd: apps/crm
      cmd: rm -rf node_modules/.vite && yarn dev -- --host 0.0.0.0
      port: 3003
      env_overrides:
        - file: apps/crm/.env.development.local
          from: apps/crm/.env.development
          set: { VITE_HOME_URL: "http://0.0.0.0:3000", VITE_API_BASE_URL: "http://0.0.0.0:8080/api/v1" }
```

`prepare` chạy một lần mỗi repo (cài + build `@oe-ebm/utils`, `ui`, `phone` như dev.sh) rồi mới bật service; `env_overrides` tạo `.env.development.local` từ `.env.development` nếu chưa có và chỉ đặt hai key trên (idempotent, không `sed`). `ff doctor` đỏ nếu repo/cổng/template/`env_files` sai. Log từng service: `.ff/services/<id>/<name>.log`.

Kết quả: `ff.config.yaml`, `ff.config.lock.json`. Không sửa `ff.config.yaml` bằng tay — chạy lại `/ff-kit:ff-init`.

## 4. Secret (tự làm, không dán vào Claude)

```sh
cd ~/workspaces/tiniweb
ff env-example                   # tạo/bổ sung .ff.env.example theo key mà config đang cần
cat .ff.env.example              # chỉ có tên key, không có giá trị
cp -n .ff.env.example .ff.env
nano .ff.env                     # điền giá trị
chmod 600 .ff.env
```

Chạy `ff env-example` sau khi /ff-kit:ff-init đã khai worker (Trello, Rocket.Chat), nếu không file mẫu sẽ chưa có key worker.

## 5. Kiểm tra

```sh
ff doctor                        # core, worker, e2e đều xanh; không in giá trị secret
```

## 6. Chọn thẻ và chạy

1. Kéo một thẻ nhỏ, ít rủi ro (không lương/phân quyền/migration/dữ liệu cá nhân) vào cột thuộc `poll_lists`.
2. `ff worker start` (tmux session `ff-worker`), `ff worker status`.
3. Worker tạo phiên `ff-<id>` chạy Claude với Remote Control tên `ff-<id> <slug>`.

## 7. Trong lúc chạy

- **Vào phiên**: app Claude/claude.ai/code → phiên `ff-<id> <slug>`; hoặc `tmux a -t ff-<id>` (thoát `Ctrl-b d`). Lệnh `!` (vd `ff worker resolve`) chỉ chạy được từ tmux/terminal.
- **Đang attach tmux thì worker không gửi pha tiếp** (có người trong phiên). Xem mà không chặn: `tmux new-session -d -t ff-<id> -s view<id> && tmux a -r -t view<id>`.
- **Gate A/C, xác nhận ship, nghiệm thu**: luôn do bạn trả lời trong phiên. Lựa chọn Gate phải đúng `Duyệt` / `Cần sửa`.
- **Verify**: agent chạy `ff ship-test <id>` (nhánh cục bộ `ff-test/<id>` = `origin/<ship_branch>` + commit squash của thẻ), test e2e trên đó; fail → quay lại sửa trên feature (vẫn 1 commit) → test lại từ đầu. Push chỉ sau Gate C + xác nhận ship.
- **Bị chặn (`needs_human` / `setup:*`)**: xem `ff worker status`. Cách gỡ:
  1. Vào phiên, cùng agent xử lý nguyên nhân; agent chạy lại check và ghi `ff stage finish <id> --dispatch <cùng dispatch> --outcome pass --evidence …` → worker tự đi tiếp.
  2. Hoặc từ terminal: `ff worker resolve <id> --reason "<lý do>"` → worker chạy lại đúng pha đó. Không gỡ được chặn danh tính/giao lệnh, `repair_limit`, PR đã đóng.
- **Tạm dừng thẻ**: trong phiên của thẻ, nói "tạm dừng thẻ này" (kèm lý do nếu có); agent soạn comment để bạn duyệt, rồi thẻ chuyển sang `Todo`. Kéo thẻ về Doing/QA Fail để tiếp tục.
- **Theo dõi**: `ff worker status`, `ff state <id>`, `ff worker logs`.

## 8. Dừng

```sh
ff worker stop
```
Phiên `ff-<id>` được giữ lại để tiếp tục; không kill/clear phiên giữa chừng.
