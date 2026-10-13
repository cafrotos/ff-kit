# ff-kit — Thiết kế đóng gói bộ công cụ ff-* thành Claude Code plugin

> Ngày: 2026-10-12 · Trạng thái: CHỜ DUYỆT
> Nguồn: `~/Workspaces/tiniweb` (`.claude/{skills,agents,commands}`, `scripts/ff/*`, `ff-worker/`).

## 1. Mục tiêu

Đóng gói bộ ff-* (skills, agents, command, hooks, scripts) và `ff-worker` thành **1 monorepo** cài được như Claude Code plugin, dùng được cho workspace bất kỳ (không còn gắn cứng tiniweb).

**Tiêu chí thành công**
1. Làm theo `INSTALL.md` trong workspace bất kỳ: có plugin, `CLAUDE.md`, bộ e2e chạy được (`ff-e2e/` hoặc bộ có sẵn), và `ff.config.yaml` hợp lệ do `/ff-init` sinh.
2. Skills/agents/hooks/scripts không chứa tên repo, đường dẫn, lệnh build/test cứng. Mọi giá trị lấy qua `ff cfg get`.
3. Config sai/thiếu → `ff doctor` fail rõ ràng, phiên ff bị chặn. Agent không tự bịa giá trị.
4. ff-worker chạy qua `npx`, daemon trong tmux. `INSTALL.md` đủ để một AI như Claude tự cài.
5. Channel thông báo là adapter thay được. Mặc định `console`. `rocketchat` đi kèm. Channel **chỉ 1 chiều**.
6. Mọi dòng Brief/AC/design truy được về câu dossier hoặc quyết định người dùng (`ff trace-check` xanh). Người duyệt quyết được Gate mà không phải hỏi lại để agent diễn đạt lại.
7. `/ff-init` kết thúc bằng báo cáo nói rõ đã cấu hình gì, còn thiếu key nào, lấy ở đâu, bước tiếp theo. Điền `.ff.env` xong, `/ff-worker start` bật worker trong tmux và báo cái gì đang chạy, xem ở đâu, dừng thế nào. Sửa config → worker tự nạp lại.
8. Không agent nào đọc được nội dung `.ff.env`.
9. Mọi file ff trong tiniweb có đích đến và danh sách thay đổi trong §10. Không file nào bị bỏ sót khi port.

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
| D14 | 3 giai đoạn tách rời. **Cài đặt** (`INSTALL.md`): tiền kiểm, cài/hỏi cài `tmux`, cài plugin, `/init` của Claude nếu chưa có `CLAUDE.md`, dựng bộ e2e, gọi `/ff-init`. **Cấu hình** (`/ff-init`): chỉ sinh config + báo cáo, không bật worker (lúc này chưa có key). **Bật worker** (`/ff-worker start`): sau khi người dùng điền `.ff.env`, doctor xanh mới spawn tmux |
| D15 | ff-worker tự restart khi `ff.config.yaml`, `ff.config.lock.json` hoặc `.ff.env` đổi; config mới đỏ thì giữ config cũ và báo lỗi |
| D16 | `.ff.env` bị cấm đọc bằng 3 lớp: `permissions.deny` trong `.claude/settings.json`, `guard.mjs`, dòng luật trong `CLAUDE.md`. `/ff-init` sinh/bổ sung `.ff.env.example` theo adapter đã chọn |
| D17 | `workspace.cards_dir` mặc định `trellocards` |
| D19 | Đăng nhập e2e kiểu `jwt-mint`: config chỉ mô tả **cách** ký và đưa token (file + key secret, thuật toán, payload, cách đưa, URL kiểm). **User nào** do từng bài test tự tạo/chọn, không nằm trong config. Có pre-check offline (doctor) và online (`ff e2e-auth-check --email`) |
| D18 | Plugin kèm template `templates/ff-e2e/` (Playwright). `INSTALL.md` dựng `ff-e2e/` nằm chung workspace (không `git init` riêng) bằng `ff e2e-scaffold`, trừ khi người dùng chọn dùng bộ e2e có sẵn. Code test đọc thẳng `ff.config.yaml` |

## 3. Cấu trúc repo

```
ff-kit/
├── .claude-plugin/plugin.json
├── skills/
│   ├── ff-understand/ SKILL.md rules.md briefs/ references/
│   ├── ff-build/      SKILL.md briefs/ references/
│   ├── ff-verify/     SKILL.md briefs/ references/
│   └── ff-init/       SKILL.md references/{detect.md, report.md, env-keys.md}
├── agents/    ff-*.md (10 file, thêm ff-gate-reader)
├── references/writing.md       # luật viết chung (D12), skill nào cũng trỏ tới
├── NOTICE                      # ghi nguồn MIT: tronghieu/agent-skills, addyosmani/agent-skills
├── commands/  ship-to-dev.md, ff-worker.md
├── hooks/hooks.json
├── bin/ff                      # CLI Node (1 entry), lệnh con ở scripts/cli/*
├── scripts/                    # guard.mjs, allow.mjs, design-check.mjs, ... (từ scripts/ff)
├── templates/
│   ├── ff-e2e/                 # bộ Playwright mẫu (D18, §4.6)
│   └── ...                     # khối CLAUDE.md, settings deny
├── schema/ff.config.schema.json
├── tests/                      # fixture workspace giả + test guard/doctor/trace-check/cli
├── ff-worker/                  # package npm (bin: ff-worker)
│   └── src/ core/ adapters/{task-source/trello, channel/{console,rocketchat}}
├── INSTALL.md                  # dành cho AI
└── README.md
```

- Đường dẫn trong skills/hooks dùng `${CLAUDE_PLUGIN_ROOT}/...`.
- `scripts/ff/ff.sh` (gắn tiniweb) được viết lại thành CLI `ff` đọc `ff.config.yaml`.
- Quy ước tiniweb (`yarn`, `oe-hrm-fe`, `trellisflow/`) chỉ là giá trị trong `ff.config.yaml` của project đích, không nằm trong repo này.
- Skills nằm trong plugin, **không chép vào workspace đích**. Workspace đích chỉ nhận: `ff.config.yaml`, `ff.config.lock.json`, `.ff.env.example`, `.ff/` (state, gate, log), `ff-e2e/` (nếu dựng mới), khối luật trong `CLAUDE.md`, mục deny trong `.claude/settings.json`, dòng `.gitignore`.
- Workspace tiniweb cũ: sau khi chuyển sang plugin, xóa `.claude/skills/ff-*`, `.claude/agents/ff-*`, `scripts/ff/*`, `ff-worker/` (bước cuối của plan, có xác nhận người dùng).

## 4. Cấu hình

### 4.1 `ff.config.yaml` (gốc workspace)

```yaml
version: 1
workspace:
  root: .
  cards_dir: trellocards            # mặc định (D17); thư mục thẻ đã xong: <cards_dir>/task-dones
                                    # workspace đã có thư mục thẻ (vd tiniweb `trellisflow/`) → ff-init hỏi giữ tên cũ hay đổi; không tự di chuyển thư mục
  worktrees_dir: worktrees
repos:
  - name: web
    path: oe-hrm-fe
    base_branch: dev
    commands: { install, lint, typecheck, build, test, migrate?, migrate_create? }
    env_files: [.env.local]         # chỉ tên file để guard/copy biết, không đọc nội dung
e2e:
  dir: ff-e2e                       # dựng từ template (§4.6) hoặc bộ có sẵn (vd tiniweb `e2e`)
  playwright_config: ff-e2e/playwright.config.ts
  tests_dir: ff-e2e/tests
  done_tests_dir: ff-e2e/tests/task-done
  auth_storage: ff-e2e/.auth/state.json
  apps: [{ name: web, base_url: http://localhost:3001 }]   # mỗi app 1 project Playwright
  health_urls: [http://localhost:8080/health]              # global-setup kiểm trước khi chạy suite
  auth: { strategy: jwt-mint, jwt: {...} }   # storage-state | form-login | jwt-mint | none (§4.6); form-login thêm login_url, lấy E2E_USER/E2E_PASSWORD từ .ff.env
  up_cmd, down_cmd, test_cmd
project_docs:                       # tùy chọn; thiếu thì skill bỏ bước liên quan và ghi "không áp dụng"
  roles_file: _project/environment.toml
  verification_queries_dir: _project/verification-queries
db:                                 # tùy chọn, cho `ff db-query`
  driver: postgres|mysql
  env_file: system-service/.env.DATABASE   # chỉ trỏ file; db-query đọc trong process, không in
guard: { protected_paths: [...], allowed_bash: [...] }
engine: { default: claude, commands: {...} }
worker:
  max_concurrent_tasks: 2
  task_source: { adapter: trello, trello: { board_id, lists: { todo, doing, review, done } } }
  channel: { adapter: console }        # console | rocketchat
  tmux: { session_name: ff-worker-<slug>, session_prefix, cleanup_on_success, cleanup_on_failure, max_session_lifetime_hours }
  http: { port: 0 }                    # 0 = tự chọn, ghi cổng thật vào .ff/worker.json
  reload: { watch: true, debounce_ms: 2000 }
secrets: { env_file: .ff.env }         # chỉ trỏ file, không chứa giá trị
```

**Ánh xạ lệnh → trường** (chốt danh sách trường; plan chỉ được thêm trường khi port phát hiện thiếu và phải cập nhật bảng này):

| Lệnh `ff` | Trường dùng |
|---|---|
| `sync`, `state` | `workspace.*`, `repos[].path`, `repos[].base_branch` |
| `copy` | `workspace.worktrees_dir`, `repos[].{path,base_branch,commands.install,env_files}` |
| `squash-check` | `repos[].{path,base_branch,commands.lint,commands.typecheck,commands.build}` |
| `verify-up`, `verify-down` | `e2e.{up_cmd,down_cmd}`, `repos[].commands.migrate` |
| `lock-tests`, `relock`, `ac-matrix`, `e2e-lint` | `e2e.{tests_dir,done_tests_dir,playwright_config}`, `workspace.cards_dir` |
| `mcp-auth`, `e2e-auth-check` | `e2e.{auth_storage,auth,apps}`, `db.*`, `project_docs.roles_file` |
| `e2e-scaffold` | `e2e.dir` (đích; mặc định `ff-e2e`), template `templates/ff-e2e/` |
| `db-query` | `db.*`, `project_docs.verification_queries_dir` |
| `design-check`, `trace-check`, `probe-slice` | `workspace.cards_dir`, `repos[].path` |
| `allow` | `guard.*` |
| `worker start/stop/status/logs` | `worker.*`, `secrets.env_file` |

### 4.2 `ff.config.lock.json`
Cạnh YAML, ghi `source` cho từng giá trị: `file:line` (đọc từ repo/AGENTS.md) hoặc `user` (người dùng xác nhận). Giá trị không có nguồn thì không được ghi.

### 4.3 `/ff-init` (có LLM; chạy lần đầu, chạy lại được)

Chạy lại trên workspace đã có config → chỉ hỏi phần đổi, giữ nguyên `source` cũ, không ghi đè `.ff.env`.

Tiền kiểm, tmux, `/init` của Claude và bộ e2e thuộc giai đoạn cài đặt (§7). `/ff-init` giả định chúng đã xong; thiếu `CLAUDE.md` hoặc thư mục e2e → dừng, chỉ người dùng quay lại bước tương ứng trong `INSTALL.md`.

| Bước | Việc | Điều kiện xong / khi lỗi |
|---|---|---|
| 1. Dò workspace | Đọc `CLAUDE.md`, `AGENTS.md`, `package.json`/`Makefile`/CI của từng repo; tìm repo con bằng git; dò cổng dev server từ script `dev`/`start` (cho `e2e.apps`); dò cách đăng nhập: chỗ backend ký JWT (`jwt.sign`, `JwtService.sign` → payload, tên key secret), chỗ frontend nhận token (`searchParams.get(...)`, `localStorage.setItem(...)` → cách đưa token), endpoint kiểu `/me` (→ `verify.url`); mỗi giá trị kèm `file:line`. Chi tiết `skills/ff-init/references/detect.md` | Danh sách ứng viên cho mọi trường bắt buộc |
| 2. Hỏi khi mơ hồ | Trường có bằng chứng → ghi kèm `source`. Mơ hồ/nhiều ứng viên → 1 câu `AskUserQuestion` có lựa chọn → `source: user`. Hỏi: adapter (TaskSource, Channel; mặc định `console`), app + base URL, health URL, cách đăng nhập e2e | Không trường bắt buộc nào thiếu nguồn |
| 3. Ghi file | `ff.config.yaml` + lock; `ff env-example` (§4.5); khối luật vào `CLAUDE.md`; deny vào `.claude/settings.json`; `.gitignore` thêm `.ff.env`, `.ff/`, `ff-e2e/.auth/`, `ff-e2e/test-results/`, `ff-e2e/node_modules/` | `ff doctor --schema-only` xanh |
| 4. `ff doctor` | Chạy đầy đủ. Thiếu key là bình thường ở lần đầu | Ghi kết quả vào báo cáo; không dừng vì thiếu key |
| 5. Hỏi bật worker | **Chỉ khi doctor xanh** (vd chạy lại `/ff-init` khi key đã có): hỏi "Bật worker ngay? / Để sau". Đồng ý → `ff worker start` (§6.6) | — |
| 6. Báo cáo | Theo khuôn `references/report.md` (dưới) | — |

**Khuôn báo cáo cuối `/ff-init`** (viết theo `references/writing.md`):
1. **Đã cấu hình:** repo nào, nhánh gốc, lệnh build/test, app e2e, adapter đã chọn. Mỗi mục ghi nguồn (file:dòng hoặc "bạn chọn").
2. **Còn thiếu:** từng key chưa có trong `.ff.env`, lấy ở đâu (link/menu cụ thể), hoặc "không". Lỗi doctor khác (nếu có) kèm cách sửa.
3. **Bước tiếp theo:** "Điền các key trên vào `.ff.env` (agent không đọc file này), rồi gõ `/ff-worker start`." Doctor đã xanh và worker đã bật → thay bằng khuôn báo cáo của `/ff-worker start` (§6.6).

### 4.4 `ff doctor` (xác định, không LLM)
- Validate theo JSON Schema.
- Kiểm: path tồn tại; repo là git repo; `base_branch` tồn tại; binary lệnh có trong PATH; adapter đã chọn đủ credential trong `secrets.env_file`.
- Kiểm `source` còn đúng (dòng đó vẫn chứa giá trị) để phát hiện config lỗi thời.
- Kiểm e2e: `e2e.dir` có `node_modules/@playwright/test`; trình duyệt chromium của Playwright đã cài; `npx playwright test --list` trong `e2e.dir` chạy được (không cần bật server); `auth.strategy: form-login` → `.ff.env` có `E2E_USER`, `E2E_PASSWORD`.
- Lỗi → exit ≠ 0. Hook `SessionStart` và `ff cfg get` chặn phiên khi doctor đỏ.

### 4.5 Secrets (D16)

**Không ai đọc `.ff.env` ngoài process của worker và CLI `ff`.** 3 lớp chặn:
1. `.claude/settings.json` của workspace (ff-init thêm, không xóa mục có sẵn):
   ```json
   { "permissions": { "deny": ["Read(./.ff.env)", "Edit(./.ff.env)", "Write(./.ff.env)", "Read(./**/.env*)"] } }
   ```
   `Read(./**/.env*)` chỉ thêm khi người dùng đồng ý ở bước 4 (có repo cần agent đọc `.env.example`; plan kiểm deny không chặn nhầm `.env.example`).
2. `guard.mjs`: chặn Bash có tham chiếu `.ff.env` (cat/less/head/tail/grep/sed/awk/source/cp/base64/`<`), trừ đúng các lệnh `ff …`. Cùng luật áp cho file secret của `jwt-mint` (`e2e.auth.jwt.secret.file`, vd `system-service/.env`): chặn tool đọc/sửa đúng file đó và chặn Bash nhắc tới tên file đó (so theo tên, nên `cd system-service && cat .env` cũng bị chặn).
3. Khối luật trong `CLAUDE.md`: "Không đọc, in, chép `.ff.env`. Cần biết key có hay chưa → `ff doctor`."

**`.ff.env.example`:** sinh bằng `ff env-example` từ danh sách key trong code (`ADAPTER_KEYS`) theo adapter đã chọn. Chỉ có tên key + comment chỉ chỗ lấy, giá trị rỗng. Đã có file → chỉ **thêm key còn thiếu**, không sửa/xóa dòng có sẵn. Key theo adapter:

| Adapter / tính năng | Key |
|---|---|
| `trello` | `TRELLO_API_KEY`, `TRELLO_API_TOKEN` (`TRELLO_BOARD_ID` chuyển sang YAML `worker.task_source.trello.board_id` — không phải secret) |
| `rocketchat` | `RC_URL`, `RC_USER_ID`, `RC_AUTH_TOKEN`, `RC_ROOM_ID` |
| `console` | (không) |
| `e2e.auth.strategy: form-login` | `E2E_USER`, `E2E_PASSWORD` |

Giữ đúng tên biến ff-worker hiện dùng để workspace tiniweb chuyển sang không phải đổi `.env`. `PROJECT_DIR` bỏ, thay bằng `workspace.root`.

YAML không chứa token. `doctor` đọc `.ff.env` trong process, chỉ in "có/thiếu" từng key, không in giá trị.

### 4.6 Bộ e2e `ff-e2e/` (D18)

**Vì sao:** ff-build viết và khóa test Playwright trước khi code; ff-verify chạy chính các test đó. Workspace không có bộ e2e thì 2 skill này không chạy được, nên dựng bộ e2e là bước bắt buộc của cài đặt.

**Template `templates/ff-e2e/`** (rút từ `tiniweb/e2e`, bỏ phần riêng của tiniweb):

| File | Nội dung | Nguồn tiniweb |
|---|---|---|
| `package.json` | `@playwright/test`, `yaml`; driver DB (`pg` hoặc `mysql2`) thêm khi `db.driver` có | `e2e/package.json` |
| `playwright.config.ts` | `workers: 1`, `retries: 0`, trace/ảnh khi fail, `globalSetup`; mỗi `e2e.apps[]` → 1 project (`baseURL`, `storageState` = `e2e.auth_storage`) | `e2e/playwright.config.ts` |
| `global-setup.ts` | Health-check `e2e.health_urls` + base URL từng app; mọi phản hồi HTTP = đang chạy; lỗi → tiếng Việt, chỉ lệnh `ff verify-up <id> <app>`; không tự bật server | `e2e/global-setup.ts` |
| `helpers/env.ts` | Tìm `ff.config.yaml` ngược lên, đọc khối `e2e`, `db`; đọc `E2E_USER`/`E2E_PASSWORD` và biến DB trong process, không log | `e2e/helpers/env.ts` (bỏ đường dẫn `system-service`, JWT) |
| `helpers/auth.ts`, `helpers/jwt.ts` | API cho test: `mintToken(user)`, `loginAs(page, app, path, user)`, `authHeader(user)`. `user` do bài test truyền vào (object có các field payload cần, vd `{ id, email }`). `jwt-mint`: ký bằng `node:crypto` theo `e2e.auth.jwt`, đưa token theo `deliver`. `storage-state`: dùng file do `ff mcp-auth` ghi. `form-login`: mở `login_url`, điền user/pass. `none`: bỏ qua. Template copy 1 lần, sau đó là code của dự án | `e2e/helpers/auth.ts`, `e2e/helpers/env.ts` (`jwtConfig`) |
| `helpers/db.ts`, `helpers/restore.ts` | Kết nối DB, backup/restore dữ liệu test. Chỉ tạo khi có khối `db` | `e2e/helpers/{db,restore}.ts` |
| `fixtures/test.ts` | Fixture `api` (luôn có), `db` (khi có khối `db`) | `e2e/fixtures/test.ts` |
| `tests/README.md`, `tests/task-done/` | Quy ước `tests/<id>-<slug>/main-behavior.spec.ts` + `main.locators.ts` | `e2e/tests/README.md` |
| `examples/000-sample/` | 1 thẻ mẫu (spec + locators) cho agent làm theo. Nằm ngoài `tests/` để lệnh chạy test không quét tới | 1 thẻ đã xong của tiniweb, đã bỏ dữ liệu riêng |

**Đăng nhập `jwt-mint` (D19).** Config chỉ mô tả cách ký và đưa token; không có danh sách user:

```yaml
e2e:
  auth:
    strategy: jwt-mint
    jwt:
      secret: { file: system-service/.env, key: JWT_SECRET }   # đọc trong process, không in; guard chặn agent đọc file này
      expires_in: { key: JWT_EXPIRES_IN, default: 2h }         # lấy từ cùng file secret, thiếu thì dùng default
      algorithm: HS256                                          # HS256 | HS384 | HS512
      payload: { sub: "{user.id}", email: "{user.email}", sid: "{uuid}" }   # {user.<field>} lấy từ object test truyền vào
      deliver: { via: query, name: token }                      # query | local_storage | cookie
      verify: { url: http://localhost:8080/api/v1/users/me, expect_status: 200 }
      user_lookup: 'select id, email from "user" where email = $1'   # tùy chọn: CÁCH tra 1 user theo email (cho mcp-auth, auth-check, helper userByEmail); không phải danh sách user
```

- **User do test quyết định.** Bài test tự tạo user cần cho kịch bản (qua fixture `db`/`api`, có backup/restore) hoặc tự tra user có sẵn, rồi gọi `loginAs(page, 'web', '/path', user)`. Spec thẻ nêu role/dữ liệu nào thì test tạo đúng như vậy.
- **Ký token** bằng `node:crypto`, không mượn `node_modules` của backend, không thêm dependency. Token không bao giờ được in hay ghi log.
- **`ff mcp-auth --email <email>`** (cho Playwright MCP của agent quan sát app): tra user theo `--email` bằng `jwt.user_lookup` (cần khối `db`), ký token, ghi storage-state vào `e2e.auth_storage` quyền `0600`. Email do agent chọn theo Brief/thẻ, không lấy từ config.
- **Pre-check:**
  - Offline, trong `ff doctor`: file secret tồn tại, key có trong file (chỉ báo có/thiếu), `algorithm` hợp lệ, `payload` chỉ dùng biến `{user.*}`/`{uuid}`.
  - Online, `ff e2e-auth-check --email <email>` (chạy khi server đang bật): tra user → ký → gọi `verify.url` → báo từng bước. Lỗi được dịch ra nguyên nhân: không có user trong DB; `401` = sai secret/payload; không kết nối được = server chưa bật.
  - Chạy ở: cuối `/ff-init` (hỏi bạn 1 email có sẵn trong DB local để thử, bỏ qua được, email không ghi vào config); đầu `ff-verify` với user mà test của thẻ dùng; người dùng tự gọi.

**`ff e2e-scaffold [--dir ff-e2e] [--db postgres|mysql]`** (xác định, không LLM):
1. Đích đã tồn tại và không rỗng → dừng, không ghi đè.
2. Copy template; bỏ `helpers/db.ts`, `helpers/restore.ts`, fixture `db` khi không có `--db`.
3. `npm install` trong đích.
4. In lệnh `npx playwright install chromium` (tải ~150 MB) để AI cài đặt hỏi người dùng trước khi chạy.
5. `npx playwright test --list` phải chạy được.
6. `ff-e2e/` nằm chung workspace, không `git init` riêng. Thư mục gốc workspace có là git repo hay không do người dùng quản; ff-init chỉ thêm dòng `.gitignore` cho `.auth/`, `test-results/`, `node_modules/`.

**Workspace đã có bộ e2e** (vd tiniweb `e2e/`): `INSTALL.md` hỏi "Dùng bộ có sẵn / Dựng ff-e2e mới". Dùng bộ có sẵn → không scaffold; `/ff-init` trỏ `e2e.*` vào bộ đó; `ff doctor` kiểm như §4.4.

**Nâng cấp template:** plugin không tự sửa `ff-e2e/` đã dựng. Template đổi → ghi trong changelog plugin, người dùng tự áp.

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

### 6.6 Vòng đời worker: tmux, tự restart (D14, D15)

**`/ff-worker start`** (command, gọi `ff worker start`). Người dùng gõ sau khi điền `.ff.env`; `/ff-init` chỉ gọi khi doctor đã xanh và người dùng đồng ý (§4.3 bước 5):
0. Chạy `ff doctor`. Đỏ → báo từng lỗi + cách sửa (vd "thiếu `TRELLO_API_TOKEN`, lấy ở …"), **không spawn**.
1. Session đã tồn tại và `status = ready` → báo "đang chạy", không tạo thêm.
2. Tạo `tmux new-session -d -s <worker.tmux.session_name> -c <workspace.root>` chạy vòng giám sát `scripts/worker-supervise.sh`:
   - chạy `npx ff-worker@<version-khớp-plugin> --config ff.config.yaml`;
   - exit code `75` (= yêu cầu restart do config đổi) → chạy lại ngay;
   - exit khác 0 → đợi 5 giây rồi chạy lại; quá 5 lần trong 10 phút → dừng vòng, ghi `.ff/worker.json` `state: crashed`, in lý do;
   - exit 0 (`ff worker stop`) → thoát vòng, đóng session.
3. Đợi tối đa 30 giây cho `.ff/worker.json` có `state: ready` (worker ghi kèm `pid`, `port`, adapter, thời điểm nạp config).
4. Báo cáo theo khuôn (viết theo `references/writing.md`):
   1. **Đang chạy:** worker trong tmux session `<tên>`, TaskSource `<adapter>` nhận thẻ từ list `<todo>`, thông báo đi qua `<channel>`.
   2. **Xem thế nào:** `tmux attach -t <tên>` (thoát mà không dừng: `Ctrl-b` rồi `d`). Với `console`, thông báo hiện trong chính cửa sổ này.
   3. **Duyệt Gate:** khi có thông báo Gate, chạy lệnh `tmux attach -t ff-<id>` có trong thông báo.
   4. **Dừng/khởi động lại:** `/ff-worker stop` / `/ff-worker start`. Sửa `ff.config.yaml` hoặc `.ff.env` → worker tự nạp lại.
   5. **Còn thiếu:** danh sách cụ thể hoặc "không".

**Tự restart khi config đổi** (trong worker, `worker.reload.watch: true`):
1. Theo dõi `ff.config.yaml`, `ff.config.lock.json`, `secrets.env_file` (theo mtime/inode, chịu được editor ghi bằng rename). Debounce `debounce_ms`.
2. Đổi → chạy validator như `ff doctor` trên bản mới, trong process.
3. **Đỏ:** giữ config cũ, chạy tiếp, `notify(kind: error)` kèm danh sách lỗi; ghi `.ff/worker.json` `config_state: rejected`.
4. **Xanh:** dừng poll mới, đợi lệnh HTTP đang dở xong (tối đa 10 giây), ghi state, exit `75`. Supervisor chạy lại; worker mới khôi phục task đang chạy bằng cơ chế startup sẵn có (`orchestrator.ts` "Khôi phục task dở dang" theo session tmux `ff-<id>`). Phiên Claude của từng thẻ **không bị dừng**.
5. Sau khi lên lại: `notify(kind: info)` "Đã nạp config mới: <các trường đổi>" (chỉ tên trường, không giá trị; với `.ff.env` chỉ ghi "secrets đổi").

**Lệnh khác:** `ff worker stop` (gửi tín hiệu dừng êm, worker exit 0), `ff worker status` (đọc `.ff/worker.json` + `tmux has-session`), `ff worker logs [-n 100]` (`tmux capture-pane`). Hook `SessionStart` chạy `ff worker status`: doctor xanh mà worker không chạy → nhắc 1 dòng "chạy `/ff-worker start`"; không tự bật, không chặn phiên.

## 7. `INSTALL.md` (cho AI)

Giai đoạn **cài đặt** (D14). Chạy 1 lần cho mỗi workspace; chạy lại an toàn (bước nào đã xong thì bỏ qua).

| Bước | Việc | Điều kiện xong / khi lỗi |
|---|---|---|
| 1. Tiền kiểm | `node -v` (theo `engines`), `git --version`, `claude --version`. Thiếu node/git → dừng, nói lệnh cài, không tự cài | Đủ 3 binary |
| 2. tmux | `tmux -V`. Thiếu → hỏi (Cài giúp / Tôi tự cài / Hủy). Cài giúp: macOS `brew install tmux` (thiếu brew → không cài brew, chuyển "tự cài"); Debian/Ubuntu `sudo apt-get install -y tmux`; Fedora `sudo dnf install -y tmux`; khác → in lệnh. Lệnh có `sudo` để người dùng tự chạy qua `! <lệnh>`. Windows ngoài WSL → không hỗ trợ, dừng | `tmux -V` chạy được |
| 3. Plugin | `/plugin marketplace add <repo>` rồi `/plugin install ff-kit` | `ff --version` chạy được |
| 4. `/init` của Claude | Workspace chưa có `CLAUDE.md` → chạy `/init` (headless `claude -p "/init"` nếu spike xác nhận được; không thì nhờ người dùng gõ `/init`). Đã có → bỏ qua, không sửa | `CLAUDE.md` tồn tại |
| 5. Bộ e2e | Tìm `playwright.config.*` (ngoài `node_modules`, sâu ≤ 3). Có → hỏi "Dùng bộ có sẵn / Dựng ff-e2e mới". Không có hoặc chọn dựng mới → hỏi có dùng DB trong test không, rồi `ff e2e-scaffold --dir ff-e2e [--db …]` (§4.6). Hỏi trước khi chạy `npx playwright install chromium` | `npx playwright test --list` chạy được trong thư mục e2e |
| 6. `/ff-init` | Gọi `/ff-init` (§4.3) | Báo cáo của `/ff-init` |
| 7. Chuyển lời nhắc | Đưa nguyên mục "Còn thiếu" + "Bước tiếp theo" của `/ff-init` cho người dùng. Không tự điền `.ff.env`, không đọc/in giá trị | Người dùng biết phải điền gì và gõ `/ff-worker start` |

Mỗi bước: lỗi thì dừng, báo nguyên lỗi + bước cần làm lại. Cấm AI sửa `ff.config.yaml` bằng tay ngoài `/ff-init`. Không bật worker trong `INSTALL.md`.

## 8. Kiểm thử

- `ff doctor`: unit test theo từng loại lỗi (path thiếu, binary thiếu, source lệch, adapter thiếu credential).
- `ff cfg get`: thiếu key → exit ≠ 0, không in giá trị mặc định.
- `guard.mjs`: test chặn marker `ĐÃ DUYỆT` khi thiếu/khớp file gate (mở rộng `test-guard.sh`).
- Adapter: contract test dùng chung cho `console` và `rocketchat` (mock HTTP); lỗi gửi không làm reject task.
- Orchestrator: test chạy với `console` + TaskSource giả, xác nhận không còn nhánh đợi phản hồi.
- Grep CI: repo không chứa `oe-hrm`, `system-service`, `trellisflow` (ngoài ví dụ trong docs), `/Users/`, `ff_ask_user`, `ff_submit_gate`.
- Thử end-to-end: cài vào workspace tiniweb thật theo `INSTALL.md` (chọn "dùng bộ e2e có sẵn"), `/ff-init`, `/ff-worker start` → doctor xanh, worker `ready`. Thêm 1 workspace mẫu rỗng (2 repo giả) → dựng `ff-e2e` mới.
- `ff trace-check`: unit test cho từng điều kiện fail ở §5.3 mục 4 (D-xx mồ côi, mã không tồn tại, thiếu cột `Nguồn`, trích lệch dossier). `guard.mjs` chặn header `GATE_A|GATE_B` khi trace-check đỏ.
- Grep CI: skills/agents không chứa `CẤM`, `Tuyệt đối`, `TUYỆT ĐỐI`, `BẮT BUỘC` viết hoa kiểu ra lệnh; mỗi `agents/*.md` có `model` và `effort`.
- Worker reload: sửa YAML hợp lệ → exit `75`, supervisor chạy lại, task giả đang chạy vẫn còn session và được khôi phục; sửa YAML sai → worker giữ config cũ, có `notify(kind: error)`; crash 6 lần/10 phút → supervisor dừng, `state: crashed`.
- `ff worker start` chạy 2 lần liên tiếp → chỉ 1 session.
- `INSTALL.md` trên fixture: không có `CLAUDE.md` → gọi `/init`; thiếu tmux (giả lập PATH) → hỏi, không tự `sudo`; có `playwright.config.ts` sẵn → hỏi dùng hay dựng mới; không bật worker.
- `/ff-init` trên fixture: `.ff.env` trống → báo cáo liệt kê key thiếu + bước `/ff-worker start`, **không** có session tmux nào được tạo; `.ff.env.example` có sẵn 1 key → chỉ thêm key thiếu; `.claude/settings.json` có sẵn → giữ mục cũ, thêm deny; chạy lại khi doctor xanh → hỏi bật worker; chạy lại → không ghi đè `source` cũ.
- `/ff-worker start`: doctor đỏ → không spawn, báo lỗi; xanh → 1 session, báo cáo 5 mục.
- `ff e2e-scaffold`: đích rỗng → đủ file, `playwright test --list` chạy được; không `--db` → không có `helpers/db.ts`, fixture `db`; đích đã có file → dừng, không ghi đè; không tạo `.git` trong đích.
- `jwt-mint`: token ký bằng `node:crypto` khớp `jsonwebtoken.verify` cùng secret (test vector); payload thay đúng `{user.*}`, `{uuid}`; biến lạ trong payload → doctor đỏ; `deliver` query/local_storage/cookie đều đăng nhập được trên app mẫu; `ff e2e-auth-check` báo đúng 3 loại lỗi (không có user, 401, mất kết nối); không lệnh nào in token.
- Guard: `cat system-service/.env`, `cd system-service && cat .env`, Read đúng file secret JWT → chặn.
- Template ff-e2e: `playwright.config.ts` sinh đúng số project theo `e2e.apps`; `global-setup` báo lỗi tiếng Việt khi health URL không kết nối được; `helpers/env.ts` tìm được `ff.config.yaml` khi chạy từ thư mục con.
- Chặn `.ff.env`: `Read(.ff.env)` bị từ chối bởi deny; `cat .ff.env`, `grep X .ff.env`, `source .ff.env` bị guard chặn; `ff doctor` vẫn báo có/thiếu key; `.env.example` của repo vẫn đọc được với mẫu deny mặc định.
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
| `claude -p "/init"` không chạy được ở chế độ headless | Kiểm ở spike (Plan 1 Task 1); không được thì `INSTALL.md` bước 4 nhờ người dùng gõ `/init` |
| Template ff-e2e quá chung, dự án có cách đăng nhập riêng | 4 chiến lược sẵn; `jwt-mint` phủ kiểu backend chỉ có OAuth như tiniweb; `helpers/auth.ts` là code của dự án sau khi dựng, sửa tự do |
| Thuật toán JWT khác HS* (RS256…) | Ngoài phạm vi bản đầu; schema chỉ nhận HS256/384/512; dự án cần RS* sửa `helpers/jwt.ts` |
| Tải chromium chậm/bị chặn mạng | Hỏi trước khi tải; lỗi → in lệnh để người dùng tự chạy, doctor đỏ ở mục e2e tới khi cài xong |
| Cài tmux cần `sudo` | Không bao giờ chạy `sudo` ngầm; luôn hỏi trước và để người dùng tự chạy qua `! <lệnh>` |
| Restart khi config đổi làm mất task đang chạy | Phiên Claude của thẻ nằm ở tmux session riêng, không bị dừng; worker mới khôi phục bằng cơ chế startup sẵn có; có test ở §8 |
| Config sửa dở (đang gõ) bị nạp | Debounce + validate trước khi restart; đỏ thì giữ config cũ |
| `permissions.deny` chặn nhầm file `.env.example` mà agent cần đọc | Mẫu deny hẹp mặc định (chỉ `.ff.env`); mẫu rộng chỉ thêm khi người dùng đồng ý; test ở §8 |

## 10. Bản đồ chuyển đổi file (tiniweb → ff-kit)

Quy ước cột "Thay đổi chung" áp cho **mọi** file skill/agent/command, không nhắc lại từng dòng:
- **H** — hardcode → `ff cfg get <key>` hoặc lệnh `ff …`: `trellisflow` → `workspace.cards_dir`; `oe-hrm-fe`/`system-service` → `repos[]`; `yarn …` → `repos[].commands.*`; `_project/...` → `project_docs.*`; `bash scripts/ff/ff.sh X` → `ff X`; `.claude/skills/...` → `${CLAUDE_PLUGIN_ROOT}/skills/...`.
- **M** — gỡ MCP của ff-worker (`ff_*`, "qua MCP", RocketChat) → `AskUserQuestion` + header Gate (§5.1) hoặc CLI `ff notify|verify-lock|ship-request`. **Playwright MCP giữ nguyên** (quan sát/verify app).
- **P** — vệ sinh prompt §5.5: hạ giọng gắt, phân loại lệnh tự kiểm, thêm đoạn phạm vi nếu là skill/agent làm việc chính.
- **W** — phần người dùng đọc tuân `references/writing.md`.

Số trong ngoặc = (dòng / số chỗ hardcode / số chỗ giọng gắt) đếm ngày 2026-10-12.

### 10.1 Skills

| Nguồn `.claude/skills/` | Đích `skills/` | Thay đổi riêng |
|---|---|---|
| `ff-understand/SKILL.md` (70/17/2) | giữ | H M P W. P0: `ff sync`, `ff state`. P1 bước 0 mới: lập `01b-ledger.md` (§5.3). Gate A/B → `AskUserQuestion` theo khuôn §5.4, chạy `ff trace-check` + `ff-gate-reader` trước khi trình. Bỏ `ff_notify` các mốc (hook `Stop` lo). "Ranh giới dừng hỏi" → `AskUserQuestion` thay `ff_ask_user`. `allowed-tools` → `Bash(ff *)`. `description` bỏ chữ "tiniweb" |
| `ff-understand/rules.md` (113/21/8) | giữ | H M P. §8 viết lại hoàn toàn: bỏ "100% qua MCP", bỏ luật 1200 ký tự/không bảng; thay bằng trỏ §5.4 + `references/writing.md`. Giữ 4 ranh giới dừng hỏi. §9 bảng trạng thái → lệnh `ff`. Thêm đoạn giới hạn phạm vi (§5.5) |
| `ff-understand/references/brief.md` (108/4/0) | giữ | H W. Mục 1 đọc dossier → lập ledger trước. Khuôn `brief.md`: phần chính theo khuôn Gate §5.4; bảng nguồn dữ liệu/bất biến/precedent/ngân sách chuyển vào phụ lục; mọi bảng thêm cột `Nguồn` (`D-xx`/`U-xx`). "Cần bạn quyết" đổi từ bảng sang khối hỏi có hậu quả từng phương án |
| `ff-understand/references/design.md` (44/3/0) | giữ | H. Cột `Nguồn` của YC/AC dùng `D-xx`/`U-xx` (thay "dòng Brief / trích dossier"). `ff design-check` + `ff trace-check` |
| `ff-understand/references/reopen.md` (62/2/0) | giữ | H M. Gate A' → `AskUserQuestion` header `GATE_A`. Comment mới sau ship → thêm vào ledger dưới dạng `D-xx` mới (đánh dấu `reopen`). `ff.sh reopen` không có trong dispatcher hiện tại → plan xác minh, hoặc bỏ tham chiếu |
| `ff-understand/references/big-task.md` (28/2/0) | giữ | H. Ledger cấp thẻ, các cụm/slice trỏ `D-xx` |
| `ff-understand/references/agents.md` (70/13/0) | giữ | H M. Bảng agent thêm `ff-gate-reader`; ghi `model` + `effort` từng agent; bỏ mô tả MCP bridge |
| `ff-understand/briefs/adversary.md` (39/2/0) | giữ | H. Đầu vào: ledger + dossier + Brief. Thêm hướng 9 "bóp méo dossier" (§5.3 mục 6); định dạng kết quả thêm dòng 9 |
| `ff-understand/briefs/design-review.md` (33/5/0) | giữ | H. Kiểm thêm: mỗi thành phần design có `Nguồn` |
| `ff-understand/briefs/observe.md` (33/3/0) | giữ | H. `ff mcp-auth`; app/port lấy từ config |
| — | `ff-understand/briefs/gate-reader.md` (mới) | Brief cho `ff-gate-reader`: chỉ nhận phần chính Gate; 3 câu phải trả lời; định dạng `ĐỦ | THIẾU: <câu không trả lời được>` |
| `ff-build/SKILL.md` (82/18/0) | giữ | H M P. Bỏ 3 `ff_notify`. Thêm đoạn giới hạn phạm vi. Mọi `ff.sh` → `ff` |
| `ff-build/references/plan-slice.md` (78/5/1) | giữ | H P. `yarn tsc` → `repos[].commands.typecheck`. Slice trỏ `D-xx`/AC |
| `ff-build/references/review-squash.md` (49/9/0) | giữ | H. Lệnh lint/build/install theo `repos[].commands` |
| `ff-build/references/test-first.md` (71/5/2) | giữ | H P. Role lấy từ `project_docs.roles_file`; thiếu → hỏi |
| `ff-build/briefs/planner.md` (28/2/0) | giữ | H. "scope = dossier" → "scope = ledger" |
| `ff-build/briefs/implement-micro.md` (34/2/0) | giữ | H P. Rút gọn cho Haiku; giữ yêu cầu chạy check thật |
| `ff-build/briefs/test-writer.md` (31/3/1) | giữ | H P |
| `ff-build/briefs/diff-review.md` (39/1/0) | giữ | H. Kiểm thêm: hunk ngoài các `D-xx`/AC → báo "ngoài phạm vi" |
| `ff-verify/SKILL.md` (89/18/2) | giữ | H M P W. Gate C → `AskUserQuestion` theo khuôn §5.4 (kết luận ĐẠT/CHƯA ĐẠT, mỗi `D-xx` đạt/không). Verify lock → `ff verify-lock`. `yarn migration:run` → `repos[].commands.migrate` |
| `ff-verify/references/report.md` (96/5/0) | giữ | H W. Bảng AC thêm cột `D-xx`. Phần chính theo khuôn Gate, bảng chi tiết vào phụ lục |
| `ff-verify/references/measure.md` (94/12/2) | giữ | H P. `ff db-query`; file query mẫu từ `project_docs.verification_queries_dir` |
| `ff-verify/references/proof-discipline.md` (112/4/1) | giữ | H P |
| `ff-verify/references/bind-locators.md` (41/4/0) | giữ | H |
| `ff-verify/references/ship.md` (80/8/0) | giữ | H M. `ff_request_ship` → `ff ship-request` (notify 1 chiều + chờ người dùng xác nhận qua `AskUserQuestion`) |
| `ff-verify/briefs/bind-verify.md` (40/5/0) | giữ | H |
| — | `ff-init/SKILL.md`, `references/{detect,report,env-keys}.md` (mới) | Theo §4.3, §4.5 |
| — | `references/writing.md` (mới, gốc plugin) | Theo §5.4; ghi nguồn diataxis-writer |

### 10.2 Agents, commands

| Nguồn | Đích | Thay đổi riêng |
|---|---|---|
| `.claude/agents/ff-*.md` × 9 (14 dòng mỗi file) | `agents/` | Bỏ "(repo tiniweb)"; đường dẫn brief → `${CLAUDE_PLUGIN_ROOT}`; thêm `effort`; giữ `model`. `ff-observer`, `ff-verifier`, `ff-test-writer` giữ tool Playwright MCP |
| — | `agents/ff-gate-reader.md` (mới) | `model: haiku`, `effort: low`, tools: `Read` |
| `.claude/commands/ship-to-dev.md` (230/13/1) | `commands/ship-to-dev.md` | H M. Bỏ RocketChat/`ff_request_ship`; xác nhận push qua `AskUserQuestion`; lệnh test/build/install theo `repos[].commands`; `task-dones` → `<cards_dir>/task-dones` |
| — | `commands/ff-worker.md` (mới) | `/ff-worker start|stop|status|logs` → `ff worker …`; `start` chạy doctor trước, báo cáo 5 mục (§6.6) |
| `.claude/settings.json` (hooks guard) | `hooks/hooks.json` | Chuyển hook guard sang plugin; thêm hook §5.2. Mục `permissions` của tiniweb **không** chuyển (là của workspace) |

### 10.3 Scripts → CLI `ff`

| Nguồn `scripts/ff/` | Đích | Thay đổi riêng |
|---|---|---|
| `ff.sh` (491/45/5) | `bin/ff` + `scripts/cli/<lệnh>.mjs` | Viết lại bằng Node, mỗi lệnh 1 file: `sync state copy squash-check verify-up verify-down mcp-auth ship-approve ac-matrix e2e-lint design-check lock-tests relock allow db-query probe-slice` + mới `cfg doctor env-example notify verify-lock ship-request trace-check e2e-scaffold worker`. Thông báo lỗi giữ tiếng Việt |
| `ff-common.mjs` (41/3/0) | `scripts/lib/config.mjs` | Bỏ `trellisflow` cứng; đọc YAML qua 1 loader dùng chung với `doctor` |
| `guard.mjs` (359/10/0) | `scripts/guard.mjs` | Đọc `guard.*`, `repos[]` từ config. Thêm: chặn marker `ĐÃ DUYỆT` thiếu file gate (§5.2); chặn `GATE_A|GATE_B` khi trace-check đỏ (§5.3); chặn đọc `.ff.env` (§4.5) |
| `allow.mjs`, `design-check.mjs`, `ac-matrix.mjs`, `e2e-lint.mjs`, `probe-slice.mjs`, `db-query.mjs`, `mcp-auth.mjs` | `scripts/cli/` | H; đường dẫn theo config; `db-query` đọc `db.env_file` trong process |
| `hook-dump.mjs` (26) | `scripts/dev/hook-dump.mjs` | Công cụ debug hook, không đăng ký hook mặc định |
| `test-guard.sh` (199/71/0), `test-tools.sh` (167/7/0), `test-lock.mjs` (71/1/0) | `tests/` | Chạy trên fixture workspace giả trong `tests/fixtures/` (2 repo git giả, `ff.config.yaml` mẫu) thay vì tiniweb thật; giữ nguyên các ca kiểm |

### 10.3b Bộ e2e tiniweb → template

| Nguồn `tiniweb/e2e/` | Đích `templates/ff-e2e/` | Thay đổi riêng |
|---|---|---|
| `package.json` | giữ | Bỏ script `codegen:<app>` cứng; thêm `yaml`; driver DB theo `--db` |
| `playwright.config.ts` | giữ | Project sinh từ `e2e.apps`; `storageState` = `e2e.auth_storage` |
| `global-setup.ts` | giữ | Health URL từ `e2e.health_urls`; bỏ đường dẫn `/Users/...` và `run.dev.sh`, thay bằng `ff verify-up <id> <app>` |
| `helpers/env.ts` | giữ | Đọc `ff.config.yaml`; bỏ `SS_ROOT`, `borrow()` từ `system-service`, `jwtConfig` |
| `helpers/auth.ts` | giữ | Giữ `loginAs`/`authHeader`/`mintToken`, nhận `user` từ test; khái quát mint JWT thành `jwt-mint` đọc `e2e.auth.jwt` (§4.6); bỏ mượn `jsonwebtoken`/`dotenv` từ `system-service` |
| `helpers/db.ts`, `helpers/restore.ts`, `fixtures/test.ts` | giữ | Đọc cấu hình DB theo `db.*`; tạo khi có `--db` |
| `helpers/xlsx.ts` | **không chuyển** | Riêng 1 thẻ tiniweb |
| `tests/README.md` | giữ | Bỏ tên thẻ tiniweb |
| 1 thẻ trong `tests/<id>-<slug>/` | `examples/000-sample/` | Đổi selector/dữ liệu sang app mẫu trung tính |
| `00-STATUS.md`, `_analysis-part*.md`, `.auth/`, `test-results/`, `yarn.lock` | **không chuyển** | Ghi chú/dữ liệu riêng tiniweb |

Tiniweb giữ nguyên `e2e/` của mình (chọn "dùng bộ có sẵn" khi cài).

### 10.4 ff-worker

| Nguồn `ff-worker/` | Đích `ff-worker/` | Thay đổi riêng |
|---|---|---|
| `src/index.ts` (28) | giữ | Nhận `--config`; exit code `75` cho restart (§6.6) |
| `src/config.ts` (105) | `src/core/config.ts` | Đọc `ff.config.yaml` + `.ff.env`; dùng chung validator với `ff doctor`; thêm watcher (§6.6) |
| `src/orchestrator.ts` (556) | `src/core/orchestrator.ts` | Gọi `TaskSource`/`Channel` qua interface; bỏ nhánh nghe thread `WAITING_*`; giữ "Khôi phục task dở dang"; thêm HTTP local cho `ff notify|verify-lock|ship-request` |
| `src/services/trello.ts` (176) | `src/adapters/task-source/trello.ts` | Implement `TaskSource`; bỏ phụ thuộc `scripts/trello.sh` |
| `src/services/rocketchat.ts` (376), `ui-blocks.ts` (438) | `src/adapters/channel/rocketchat/` | Chỉ `notify`; bỏ `getLatestUserMessage`, `approval_keywords`, `sanitizeAndWrapFeedback` |
| — | `src/adapters/channel/console.ts` (mới) | §6.2 |
| `src/services/tmux.ts` (126), `ff-monitor.ts` (545), `quota.ts` (75), `verify-mutex.ts` (55) | `src/core/` | H (tên session, đường dẫn thẻ từ config). `verify-mutex` phục vụ `ff verify-lock` qua HTTP |
| `src/types/index.ts` (111) | `src/core/types.ts` + `src/adapters/types.ts` | Bỏ kiểu RocketChat khỏi core |
| `src/mcp/server.ts` (841), `src/mcp-stdio.ts` (272), `claude-mcp.json` | **xóa** | D8 |
| `docs/02-mcp-architecture-spec.md` (349) | **xóa** | Hết hiệu lực |
| `test/*.ts`, `test-rc-blocks.ts` | `ff-worker/test/` | Viết lại theo contract test §8; bỏ `real-gate-a-wait.ts` (luồng đợi chat) |
| `config.example.yaml` | **xóa** | Thay bằng `ff.config.yaml` do `/ff-init` sinh |
| `config.yaml` | **không chuyển, không đọc** | Có thể chứa giá trị thật; để nguyên trong tiniweb |
| `README.md` | gộp vào `README.md` + `INSTALL.md` gốc | — |
| `.codegraph/`, `package-lock.json` | không chuyển / sinh lại | — |
