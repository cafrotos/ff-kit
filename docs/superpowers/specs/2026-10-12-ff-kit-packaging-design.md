# ff-kit — Thiết kế đóng gói bộ công cụ ff-* thành Claude Code plugin

> Ngày: 2026-10-12 · Trạng thái: CHỜ DUYỆT
> Nguồn: `~/Workspaces/tiniweb` (`.claude/{skills,agents,commands}`, `scripts/ff/*`, `ff-worker/`).

## 1. Mục tiêu

Đóng gói bộ ff-* (skills, agents, command, hooks, scripts) và `ff-worker` thành **1 monorepo** cài được như Claude Code plugin, dùng được cho workspace bất kỳ (không còn gắn cứng tiniweb).

**Tiêu chí thành công**
1. Cài plugin + chạy `/ff-init` trong workspace bất kỳ sinh ra `ff.config.yaml` hợp lệ.
2. Skills/agents/hooks/scripts không chứa tên repo, đường dẫn, lệnh build/test cứng. Mọi giá trị lấy qua `ff cfg get`.
3. Config sai/thiếu → `ff doctor` fail rõ ràng, phiên ff bị chặn. Agent không tự bịa giá trị.
4. ff-worker chạy qua `npx`, daemon trong tmux. `INSTALL.md` đủ để một AI như Claude tự cài.
5. Channel thông báo là adapter thay được. Mặc định `console`. `rocketchat` đi kèm. Channel **chỉ 1 chiều**.

**Ngoài phạm vi (YAGNI):** plugin loader động cho adapter; adapter Slack/Telegram; giao tiếp 2 chiều qua chat; MCP bridge.

## 2. Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Generic hóa hoàn toàn (không chỉ đóng gói lại tiniweb) |
| D2 | Cấu hình sinh bởi `/ff-init` tương tác (đọc AGENTS.md + repo thật, hỏi khi mơ hồ) → 1 YAML chung cho workspace |
| D3 | LLM chỉ chạy lúc init. Runtime chỉ đọc YAML đã qua validator xác định |
| D4 | 1 monorepo: plugin + `ff-worker/` thư mục con. Worker phát hành npm, chạy `npx` |
| D5 | Adapter: TaskSource = `trello`. Channel = `console` (mặc định) và `rocketchat` |
| D6 | Channel 1 chiều (chỉ thông báo). Bỏ toàn bộ đọc phản hồi từ chat |
| D7 | Hỏi/duyệt Gate dùng `AskUserQuestion` gốc trong phiên. Hooks lo thông báo + chống tự ghi "đã duyệt" |
| D8 | Bỏ hẳn MCP bridge. Mọi thứ còn lại là CLI `ff` → HTTP local của worker |
| D9 | Skills lấy giá trị config qua CLI `ff cfg get` (không đọc YAML trực tiếp, không render sẵn) |

## 3. Cấu trúc repo

```
ff-kit/
├── .claude-plugin/plugin.json
├── skills/    ff-understand ff-build ff-verify ff-init
├── agents/    ff-*.md (9 file)
├── commands/  ship-to-dev.md, ff-worker.md
├── hooks/hooks.json
├── bin/ff                      # CLI: cfg get, doctor, notify, state, copy, squash-check, verify-lock, ship-request...
├── scripts/                    # guard.mjs, allow.mjs, design-check.mjs, ... (từ scripts/ff)
├── schema/ff.config.schema.json
├── ff-worker/                  # package npm (bin: ff-worker)
│   └── src/ core/ adapters/{task-source/trello, channel/{console,rocketchat}}
├── INSTALL.md                  # dành cho AI
└── README.md
```

- Đường dẫn trong skills/hooks dùng `${CLAUDE_PLUGIN_ROOT}/...`.
- `scripts/ff/ff.sh` (gắn tiniweb) được viết lại thành CLI `ff` đọc `ff.config.yaml`.
- Quy ước tiniweb (`yarn`, `oe-hrm-fe`, `trellisflow/`) chỉ là giá trị trong `ff.config.yaml` của project đích, không nằm trong repo này.

## 4. Cấu hình

### 4.1 `ff.config.yaml` (gốc workspace)

```yaml
version: 1
workspace: { root: ., cards_dir: trellisflow, worktrees_dir: worktrees }
repos:
  - name: web
    path: oe-hrm-fe
    base_branch: dev
    commands: { install, lint, build, test, migrate? }
e2e: { dir: e2e, up_cmd, down_cmd, test_cmd }
guard: { protected_paths: [...], allowed_bash: [...] }
engine: { default: claude, commands: {...} }
worker:
  max_concurrent_tasks: 2
  task_source: { adapter: trello, trello: {...} }
  channel: { adapter: console }        # console | rocketchat
  tmux: { session_prefix, cleanup_on_success, cleanup_on_failure, max_session_lifetime_hours }
secrets: { env_file: .ff.env }         # chỉ trỏ file, không chứa giá trị
```

Nhóm trường theo các lệnh `ff.sh` hiện có (`copy`, `squash-check`, `verify-up/down`, `lock-tests`, `ac-matrix`, `allow`, `db-query`...). Danh sách trường cuối cùng chốt ở bước plan khi đối chiếu từng lệnh.

### 4.2 `ff.config.lock.json`
Cạnh YAML, ghi `source` cho từng giá trị: `file:line` (đọc từ repo/AGENTS.md) hoặc `user` (người dùng xác nhận). Giá trị không có nguồn thì không được ghi.

### 4.3 `/ff-init` (có LLM, chạy 1 lần)
1. Đọc `AGENTS.md`, `package.json`/`Makefile`/CI của từng repo; tìm repo con bằng git.
2. Trường có bằng chứng → ghi kèm `source`.
3. Trường mơ hồ/nhiều ứng viên → hỏi người dùng 1 câu có lựa chọn → `source: user`.
4. Ghi YAML + lock, tự chạy `ff doctor`.

### 4.4 `ff doctor` (xác định, không LLM)
- Validate theo JSON Schema.
- Kiểm: path tồn tại; repo là git repo; `base_branch` tồn tại; binary lệnh có trong PATH; adapter đã chọn đủ credential trong `secrets.env_file`.
- Kiểm `source` còn đúng (dòng đó vẫn chứa giá trị) để phát hiện config lỗi thời.
- Lỗi → exit ≠ 0. Hook `SessionStart` và `ff cfg get` chặn phiên khi doctor đỏ.

### 4.5 Secrets
YAML không chứa token. `.ff.env` đã gitignore. `doctor` chỉ báo có/không, không in giá trị.

## 5. Skills, hooks và Gate

### 5.1 Skills/agents
- Hỏi người dùng và trình Gate dùng **`AskUserQuestion`**. Gate: agent ghi artifact (`brief.md`, `03-design.md`, `05-verify-report.md`) rồi gọi `AskUserQuestion` với `header` theo quy ước `GATE_A|GATE_B|GATE_C`.
- Bỏ các tool `ff_ask_user`, `ff_submit_gate`, `ff_notify`, `ff_report_cluster`, `ff_acquire_verify_lock`, `ff_release_verify_lock`, `ff_request_ship`.
- Phải sửa: `ff-understand/SKILL.md` (Gate A/B, P1), `ff-verify/SKILL.md` (Gate C, mục 6), `ff-understand/rules.md §8` (bỏ "100% qua MCP"), `references/reopen.md` (Gate A'), mọi chỗ hardcode đường dẫn/lệnh → `ff cfg get`.
- Việc trước đây qua MCP chuyển thành CLI: `ff verify-lock acquire|release`, `ff ship-request`, `ff notify`.

### 5.2 Hooks (`hooks/hooks.json`)

| Hook | Matcher | Việc |
|---|---|---|
| `SessionStart` | | `ff doctor`; đỏ thì chặn |
| `PreToolUse` | `AskUserQuestion` | `ff notify`: `kind: gate` nếu header khớp `GATE_*`, ngược lại `kind: ask` |
| `PostToolUse` | `AskUserQuestion` | ghi câu trả lời vào `.ff/gates/<id>-<gate>.json` |
| `Notification` | permission/idle | `ff notify kind: attention` |
| `Stop` | | `ff notify kind: info` nếu phase vừa xong |
| `PreToolUse` | Bash, Edit/Write | `guard.mjs`: chặn như cũ **và chặn ghi marker `ĐÃ DUYỆT` nếu chưa có file gate chứa đáp án đồng ý** |

`ff notify` POST vào HTTP local của worker. Worker không chạy → in stderr, không làm hỏng phiên.

## 6. ff-worker

### 6.1 Interface (`ff-worker/src/adapters/types.ts`)

```ts
interface TaskSource { name: string; poll(): Promise<TaskCard[]>; moveTo(id, status): Promise<void>; comment?(id, text): Promise<void> }
interface Channel    { name: string; notify(event: NotifyEvent): Promise<void> }
// NotifyEvent: { taskId, title, kind: 'info'|'gate'|'ask'|'attention'|'error'|'done', fields, body }
```

- `notify` không có giá trị trả về cần đợi. Lỗi gửi → log cảnh báo, không chặn task.
- Core không dùng kiểu `RocketChatBlock`. `ui-blocks.ts` chuyển vào adapter RocketChat để dịch `NotifyEvent` → Block Kit.

### 6.2 Adapter

| Loại | Adapter | Ghi chú |
|---|---|---|
| TaskSource | `trello` | từ `services/trello.ts`; bỏ phụ thuộc `scripts/trello.sh` |
| Channel | `console` (mặc định) | in stdout, màu theo `kind`, prefix `[card-id]` |
| Channel | `rocketchat` | chỉ `postMessage` (threads/`tshow`/`markAsUnread` như cũ); bỏ phần đọc |

Chọn adapter: `worker.channel.adapter`. Adapter không hợp lệ → `doctor` fail. Adapter mới = 1 file implement interface + đăng ký trong `adapters/index.ts`.

### 6.3 Bị xóa khỏi ff-worker
`getLatestUserMessage`, `approval_keywords`, `sanitizeAndWrapFeedback`, nhánh nghe thread của `WAITING_GATE_A/B/C` và `WAITING_USER`, toàn bộ `mcp/server.ts` và `mcp-stdio.ts`, `claude-mcp.json`, `--mcp-config` trong engine command.

### 6.4 Duyệt Gate
Người dùng `tmux attach -t ff-<id>` và trả lời `AskUserQuestion` trong phiên. Worker nhận `notify(kind: gate)` kèm lệnh attach. Task dừng tại Gate đến khi người dùng trả lời. `--remote-control` vẫn dùng được nếu cần duyệt từ xa. Tiến độ phase lấy từ `ff-monitor` và `ff state` (đọc file marker), không còn callback MCP.

### 6.5 Phân phối
`ff-worker/package.json` có `bin: ff-worker`, phát hành npm. Chạy: `npx ff-worker --config ff.config.yaml`. Worker tự validate config khi khởi động, không chạy khi config sai.

## 7. `INSTALL.md` (cho AI)

1. Kiểm tra `node -v` (theo `engines`), `tmux -V`, `claude --version`.
2. `/plugin marketplace add <repo>` rồi `/plugin install ff-kit`.
3. Chạy `/ff-init` trong workspace đích. Hỏi người dùng các câu mơ hồ, không tự đoán.
4. Người dùng tự điền `.ff.env`. AI không đọc/in giá trị.
5. `ff doctor` phải xanh.
6. `tmux new-session -d -s ff-worker 'npx ff-worker --config ff.config.yaml'`.
7. Xác nhận: `tmux capture-pane -t ff-worker -p | tail`, thấy `ready` và tên adapter.
8. Nhắc người dùng `tmux attach` để duyệt Gate.

Mỗi bước có "điều kiện xong" và "nếu lỗi thì dừng, báo người dùng". Cấm AI sửa `ff.config.yaml` bằng tay ngoài `/ff-init`.

## 8. Kiểm thử

- `ff doctor`: unit test theo từng loại lỗi (path thiếu, binary thiếu, source lệch, adapter thiếu credential).
- `ff cfg get`: thiếu key → exit ≠ 0, không in giá trị mặc định.
- `guard.mjs`: test chặn marker `ĐÃ DUYỆT` khi thiếu/khớp file gate (mở rộng `test-guard.sh`).
- Adapter: contract test dùng chung cho `console` và `rocketchat` (mock HTTP); lỗi gửi không làm reject task.
- Orchestrator: test chạy với `console` + TaskSource giả, xác nhận không còn nhánh đợi phản hồi.
- Grep CI: repo không chứa `oe-hrm`, `system-service`, `trellisflow` (ngoài ví dụ trong docs), `/Users/`, `ff_ask_user`, `ff_submit_gate`.
- Thử end-to-end: cài plugin vào workspace tiniweb thật và chạy `/ff-init` → doctor xanh.

## 9. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Hook `AskUserQuestion` không bắt được trong mọi chế độ chạy (vd `--permission-mode auto`) | Kiểm sớm ở plan; nếu không bắt được thì `Notification`/`Stop` là đường dự phòng |
| Skills dài, nhiều chỗ hardcode, sót chỗ | Grep CI ở §8 |
| `ff.sh` 491 dòng bash viết lại thành CLI | Port theo từng lệnh, giữ test hiện có (`test-guard.sh`, `test-lock.mjs`, `test-tools.sh`) làm đối chiếu |
| Quy ước gate-header bị agent quên | Hook đối chiếu; thiếu thì guard chặn marker nên không thể "qua Gate" nhầm |
