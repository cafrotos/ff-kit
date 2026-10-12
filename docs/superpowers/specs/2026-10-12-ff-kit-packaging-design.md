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

6. Mọi dòng Brief/AC/design truy được về câu dossier hoặc quyết định người dùng (`ff trace-check` xanh). Người duyệt quyết được Gate mà không phải hỏi lại để agent diễn đạt lại.

**Ngoài phạm vi (YAGNI):** plugin loader động cho adapter; adapter Slack/Telegram; giao tiếp 2 chiều qua chat; MCP bridge; cài kèm nguyên bộ `addyosmani/agent-skills` (skill `using-agent-skills` sẽ giành điều phối khỏi luồng ff — chỉ chuyển thể pattern); cross-model review.

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
| D10 | Sổ dossier `01b-ledger.md`: mỗi câu dossier có mã `D-xx`, trích nguyên văn. Mọi dòng Brief/AC/design trỏ về `D-xx` hoặc `U-xx`. `ff trace-check` kiểm xác định, đỏ thì chặn Gate A |
| D11 | Gate là "tài liệu để quyết định" theo khuôn cố định. Bỏ giới hạn 1200 ký tự (sinh ra vì RocketChat) |
| D12 | Luật viết chung `references/writing.md`, chuyển thể từ `diataxis-writer` (MIT, ghi nguồn). Thêm agent `ff-gate-reader` kiểm độ dễ hiểu của Gate |
| D13 | Vệ sinh prompt theo model 5.x: thêm giới hạn phạm vi, hạ giọng ra lệnh gắt, bỏ lệnh tự kiểm thừa, đặt `effort` từng agent, đo bằng thẻ thật |

## 3. Cấu trúc repo

```
ff-kit/
├── .claude-plugin/plugin.json
├── skills/    ff-understand ff-build ff-verify ff-init
├── agents/    ff-*.md (10 file, thêm ff-gate-reader)
├── references/writing.md       # luật viết chung (D12)
├── NOTICE                      # ghi nguồn MIT: tronghieu/agent-skills, addyosmani/agent-skills
├── commands/  ship-to-dev.md, ff-worker.md
├── hooks/hooks.json
├── bin/ff                      # CLI: cfg get, doctor, notify, state, copy, squash-check, verify-lock, ship-request, trace-check...
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
- Phải sửa: `ff-understand/SKILL.md` (Gate A/B, P1), `ff-verify/SKILL.md` (Gate C, mục 6), `ff-understand/rules.md §8` (bỏ "100% qua MCP" và luật 1200 ký tự, thay bằng §5.4), `references/brief.md` (ledger, cột `Nguồn`, khuôn Gate), `briefs/adversary.md` (hướng 9), `references/reopen.md` (Gate A'), mọi chỗ hardcode đường dẫn/lệnh → `ff cfg get`.
- Việc trước đây qua MCP chuyển thành CLI: `ff verify-lock acquire|release`, `ff ship-request`, `ff notify`.
- Lựa chọn trong `AskUserQuestion` của Gate có nhãn rõ: lựa chọn đồng ý và lựa chọn yêu cầu sửa. Chỉ lựa chọn đồng ý mới cho ghi marker `ĐÃ DUYỆT`. Câu trả lời tự do kiểu "tùy bạn" hay "ok" không tính là duyệt; agent hỏi lại bằng 2 lựa chọn cụ thể (theo addy `interview-me` bước 5).

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

### 5.3 Bám dossier (D10)

**Vấn đề quan sát được ở tiniweb:** agent diễn giải lại dossier thành Trước→Sau bằng từ kỹ thuật, không có bước nào kiểm câu dossier nào bị bỏ, hiểu lệch hay thêm suy luận. `ff-brief-adversary` chỉ bắt dòng Brief *thêm* không nguồn.

1. **P1 bước đầu:** agent tạo `01b-ledger.md` trước khi đọc code. Mỗi câu Mô tả/Checklist/comment quyết định → 1 dòng: `D-xx | trích nguyên văn | vị trí trong dossier`. Comment bookkeeping bị lọc vẫn ghi với nhãn `bỏ: bookkeeping` để người duyệt thấy.
2. **Quyết định của người dùng** (từ `AskUserQuestion`) ghi vào cùng file: `U-xx | câu hỏi | đáp án | ngày`.
3. **Truy vết bắt buộc:** mỗi dòng Brief (mục, bất biến, Tự quyết, Cần bạn quyết), mỗi YC/AC trong `02-spec.md`, mỗi thành phần trong `03-design.md` có cột `Nguồn` chứa `D-xx` hoặc `U-xx`. Căn cứ code (`file:line`) là bằng chứng hiện trạng, không thay được nguồn yêu cầu.
4. **`ff trace-check <id>`** (xác định, không LLM). Fail khi:
   - có `D-xx` không được dòng nào trỏ tới và không nằm trong "Ngoài phạm vi";
   - có dòng trỏ tới mã không tồn tại, hoặc không có cột `Nguồn`;
   - trích nguyên văn trong ledger không còn khớp `01-dossier.md` (dossier đổi sau khi lập ledger).
5. **Chặn:** `guard.mjs` không cho trình Gate A/B (`AskUserQuestion` header `GATE_A|GATE_B`) khi `trace-check` đỏ.
6. **`ff-brief-adversary` thêm hướng 9 "bóp méo dossier":** với từng `D-xx`, so câu gốc với cách Brief diễn giải. Báo 3 loại: đổi nghĩa, bỏ sót, thêm suy luận dossier không nói. Agent nhận ledger + dossier + Brief, không nhận kết luận của người viết (theo addy `doubt-driven`).
7. **Khi dossier mơ hồ hoặc mâu thuẫn với code:** ghi theo khuôn `MƠ HỒ: <trích D-xx> · Cách hiểu A/B · Hậu quả mỗi cách · Khuyến nghị + căn cứ` (theo addy `context-engineering`). Không tự chọn khi rơi vào 4 ranh giới dừng hỏi.

### 5.4 Trình bày cho người duyệt (D11, D12)

**Vấn đề quan sát được:** luật "5–10 dòng, dưới 1200 ký tự" (`rules.md §8`) ép nén Gate nên mất bối cảnh; Brief trộn bảng tra cứu với phần cần quyết; dày từ nội bộ; bảng "Cần bạn quyết" không nói hậu quả.

**Khuôn Gate (phần chính, người duyệt đọc trong ~2 phút):**
1. **Thẻ yêu cầu gì** — trích nguyên văn các `D-xx` chính.
2. **Tôi hiểu là** — viết lại bằng lời thường, mỗi ý trỏ `D-xx`. Không dùng từ nội bộ.
3. **Sẽ làm / Không làm** — "Không làm" bắt buộc có (theo addy `interview-me` bước 4).
4. **Cần bạn chọn** — mỗi câu hỏi là 1 khối riêng: bối cảnh 1–2 câu · từng phương án kèm hậu quả người dùng/nghiệp vụ thấy được · khuyến nghị + căn cứ. Mỗi khối map 1:1 sang 1 câu trong `AskUserQuestion`.
5. **Phụ lục** (không bắt buộc đọc): bảng nguồn dữ liệu, ngân sách request, bất biến, precedent, ma trận AC.

**`references/writing.md`** (chuyển thể `diataxis-writer` → "Reader-First Prose", áp cho mọi artifact người dùng đọc):
- 1 ý mỗi câu; câu > 25 từ phải xem lại.
- 1 thuật ngữ cho 1 khái niệm; từ nội bộ (precedent, slice, bất biến, dòng MỚI) chỉ dùng ở phụ lục hoặc giải thích ngay lần đầu.
- Giữ nguyên mức chắc chắn của nguồn; không thêm nguyên nhân, tần suất, sự kiện nguồn không nói.
- Tách tra cứu (reference) khỏi giải thích/quyết định (explanation).
- Không lấy: phụ thuộc `humanizer`, luật STE tiếng Anh.

**`ff-gate-reader`** (agent mới, model `haiku`, ngữ cảnh mới): chỉ nhận phần chính của Gate. Phải trả lời: "người duyệt cần quyết gì; mỗi lựa chọn dẫn tới gì; thẻ sẽ làm/không làm gì". Trả lời sai hoặc thiếu so với Brief → agent chính viết lại Gate trước khi gọi `AskUserQuestion`. Tối đa 2 vòng, sau đó trình kèm ghi chú phần còn khó hiểu.

**`ff notify` cho Gate:** 1 dòng tiêu đề + lệnh `tmux attach -t ff-<id>`. Nội dung đầy đủ chỉ nằm trong phiên.

### 5.5 Vệ sinh prompt theo model 5.x (D13)

Căn cứ: docs "Prompting Claude Opus 5 / Opus 5.5 / Sonnet 5.5 / Haiku 5.5" và "Prompting best practices" (platform.claude.com, đọc 2026-10-12). Số liệu trong docs là test nội bộ của Anthropic.

| Việc | Áp dụng ở |
|---|---|
| Thêm đoạn giới hạn phạm vi (chuyển thể mẫu docs Opus 5 "Task scope"): làm đúng phạm vi thẻ, tự quyết việc thường, chỉ hỏi khi cách hiểu khác dẫn tới việc khác hẳn; thấy yêu cầu sai thì nói 1 câu rồi làm theo yêu cầu, không tự thu hẹp/mở rộng/biến đổi | `ff-understand`, `ff-build`, `ff-planner`, `ff-implementer*` |
| Hạ 23 chỗ giọng gắt (`CẤM`, `Tuyệt đối`, `BẮT BUỘC`, `⚠️`) thành câu thường kèm lý do. Luật cứng do `guard.mjs` chặn bằng code | toàn bộ skills/agents |
| Bỏ lệnh tự kiểm/làm lại ở agent chính (10 chỗ "tự đối chiếu", "kiểm lại", "self-check" — phân loại từng chỗ ở bước plan) | `ff-understand`, `ff-build`, `ff-verify` |
| Giữ lệnh chạy check thật (test/build/type-check) trước khi báo xong — docs Sonnet/Haiku 5.5 khuyến nghị | `ff-implementer`, `ff-implementer-haiku`, `ff-test-writer` |
| Giữ `ff-brief-adversary`, `ff-design-reviewer`, `ff-diff-reviewer`: đầu vào khác người viết, không phải "tự kiểm lại" | — |
| Đặt `effort` trong frontmatter từng agent (gợi ý: implementer `medium`, reviewer/adversary `high`, gate-reader `low`); chốt sau đo | `agents/*.md` |
| Brief giao cho Haiku ngắn, không nhúng rules dài (docs: prompt dài làm Haiku dừng sớm) | `ff-implementer-haiku`, `ff-gate-reader` |
| Không yêu cầu viết lập luận ra output theo định dạng cố định (rủi ro `reasoning_extraction`). Yêu cầu kết luận + bằng chứng thì được | rà ở bước plan |
| Cho ví dụ mẫu Gate tốt thay vì liệt kê điều cấm | `references/writing.md` |

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
- `ff trace-check`: unit test cho từng điều kiện fail ở §5.3 mục 4 (D-xx mồ côi, mã không tồn tại, thiếu cột `Nguồn`, trích lệch dossier). `guard.mjs` chặn header `GATE_A|GATE_B` khi trace-check đỏ.
- Grep CI: skills/agents không chứa `CẤM`, `Tuyệt đối`, `TUYỆT ĐỐI`, `BẮT BUỘC` viết hoa kiểu ra lệnh; mỗi `agents/*.md` có `model` và `effort`.
- **Đo trước/sau trên 2–3 thẻ cũ của tiniweb** (chạy bộ ff cũ và ff-kit trên cùng dossier). Chỉ số: số `D-xx` bị bỏ sót/bóp méo (người dùng chấm theo ledger); số lần người dùng phải hỏi lại tại Gate; `ff-gate-reader` trả lời đúng ở vòng 1; tổng token. ff-kit không được tệ hơn bản cũ ở chỉ số nào; dùng kết quả để chốt `effort`.

## 9. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Hook `AskUserQuestion` không bắt được trong mọi chế độ chạy (vd `--permission-mode auto`) | Kiểm sớm ở plan; nếu không bắt được thì `Notification`/`Stop` là đường dự phòng |
| Skills dài, nhiều chỗ hardcode, sót chỗ | Grep CI ở §8 |
| `ff.sh` 491 dòng bash viết lại thành CLI | Port theo từng lệnh, giữ test hiện có (`test-guard.sh`, `test-lock.mjs`, `test-tools.sh`) làm đối chiếu |
| Quy ước gate-header bị agent quên | Hook đối chiếu; thiếu thì guard chặn marker nên không thể "qua Gate" nhầm |
| Ledger + cột `Nguồn` làm Brief nặng hơn, task Nhỏ tốn thời gian | Task Nhỏ: ledger vẫn bắt buộc (rẻ, chép nguyên văn), cột `Nguồn` chỉ ở bảng mục dossier |
| Hạ giọng gắt làm agent bỏ qua luật quan trọng | Luật không được vi phạm đều có chặn xác định (`guard.mjs`, `trace-check`, `doctor`); đo trước/sau ở §8 |
| `ff-gate-reader` (haiku) đánh giá sai, gây vòng viết lại vô ích | Tối đa 2 vòng; đo tỉ lệ đúng vòng 1 ở §8, tệ thì nâng model |
| Docs model 5.x thay đổi theo phiên bản | Ghi ngày đọc docs trong `references/writing.md`; quyết định `effort` dựa trên đo thật, không dựa docs |
