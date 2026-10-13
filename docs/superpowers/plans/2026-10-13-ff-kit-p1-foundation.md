# ff-kit Plan 1 — Nền tảng: config, doctor, guard, trace-check, hooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng plugin ff-kit chạy được với CLI `ff` (`cfg get`, `doctor`, `env-example`, `trace-check`, `notify`), guard chặn luật cũ và luật mới, và các hook ghi/kiểm Gate qua `AskUserQuestion`.

**Architecture:** Mã nguồn Node ESM trong `scripts/` (thư viện ở `scripts/lib/`, lệnh ở `scripts/cli/`, hook ở `scripts/hooks/`). esbuild bundle ra `dist/` (commit vào git), vì plugin cài từ marketplace không chạy `npm install`. `bin/ff` và `hooks/hooks.json` chỉ gọi `dist/`. Mọi lệnh đọc `ff.config.yaml` qua một loader dùng chung. Validator dùng chung giữa `doctor`, `cfg`, guard và (ở Plan 3) worker.

**Tech Stack:** Node ≥ 20.10, `yaml` 2.x, `ajv` 8.x, `esbuild` (dev), test bằng `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-12-ff-kit-packaging-design.md`. Roadmap: `docs/superpowers/plans/2026-10-13-ff-kit-roadmap.md`.

## Global Constraints

- Node `>=20.10`. ESM, file `.mjs`. Test: `node --test tests/*.test.mjs`.
- Runtime deps chỉ `yaml` và `ajv`; dev dep chỉ `esbuild`.
- `dist/` commit vào git. Build bằng `npm run build`. `bin/ff` và hooks chạy từ `dist/`, không chạy từ `scripts/`.
- Không đọc, in hay log giá trị trong `.ff.env`, kể cả trong output test. Chỉ báo key có/thiếu.
- Thông báo cho người dùng viết tiếng Việt; tên lệnh, field, key giữ nguyên.
- Exit code CLI: `0` ok · `1` kiểm tra đỏ · `2` sai cách dùng hoặc guard chặn · `3` thiếu key config · `4` config chưa sẵn sàng (không có file, hỏng, doctor đỏ/cũ).
- Mặc định `workspace.cards_dir: trellocards`.
- Card id khớp `[A-Za-z0-9]+`; thư mục thẻ `<cards_dir>/<id>-<slug>`; câu hỏi Gate bắt đầu `[#<id>]`; header `GATE_A|GATE_B|GATE_C`; nhãn duyệt đúng chuỗi `Duyệt`.
- Hook không bao giờ làm hỏng phiên khi worker không chạy; hook không làm gì khi cwd không thuộc workspace có `ff.config.yaml`.
- Thêm trường config → sửa khối YAML và bảng ánh xạ §4.1 của spec trong cùng commit.
- Mỗi commit kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Plugin cài toàn cục, mở project không có `ff.config.yaml`** → mọi hook và guard thoát `0`, không in gì. Test: Task 11 (`guard no-op ngoài workspace`), Task 12 (`hooks no-op ngoài workspace`).
2. **Workspace qua symlink** (macOS `/var` → `/private/var`, thư mục link) → guard vẫn nhận đúng repo/worktree. Test: Task 8 (`guard qua đường dẫn symlink`).
3. **Dossier/ledger có Unicode NFD (copy từ macOS), CRLF hoặc BOM** → trace-check và lock không báo lệch giả. Test: Task 6 (`lock NFD`), Task 9 (`trace NFD/CRLF/BOM`).
4. **`ff.config.yaml` hỏng cú pháp giữa chừng** → doctor in dòng lỗi, `cfg get` exit 4, guard vẫn chặn luật cơ bản và `.ff.env`. Test: Task 3, Task 4, Task 11.
5. **Worker không chạy hoặc treo** → hook `AskUserQuestion` trả về trong thời gian timeout, không chặn câu hỏi. Test: Task 10 (`notify timeout`).

## File Structure

```
ff-kit/
├── package.json                    # Task 2
├── .gitignore                      # Task 2
├── .claude-plugin/plugin.json      # Task 2
├── bin/ff                          # Task 2 — launcher gọi dist/cli.mjs
├── scripts/
│   ├── build.mjs                   # Task 2 — esbuild nhiều entry
│   ├── dev/hook-dump.mjs           # Task 1 — ghi payload hook khi spike
│   ├── lib/
│   │   ├── config.mjs              # Task 3 — findRoot, loadConfig, getKey, DEFAULTS
│   │   ├── schema.mjs              # Task 3 — validate()
│   │   ├── state.mjs               # Task 4 — .ff/doctor.json
│   │   ├── env.mjs                 # Task 5 — ADAPTER_KEYS, presentKeys, mergeEnvExample
│   │   ├── lock.mjs                # Task 6 — leafKeys, checkLock
│   │   ├── shell.mjs               # Task 7 — tokenize, segments, stripHeredocs, stripPrefix, commandBinaries
│   │   ├── doctor.mjs              # Task 7 — runDoctor
│   │   ├── paths.mjs               # Task 8 — realish
│   │   ├── guard-rules.mjs         # Task 8, 11 — makeGuard().evaluate()
│   │   ├── cards.mjs               # Task 9 — findCardDir
│   │   ├── trace.mjs               # Task 9 — parseTables, parseLedger, traceCheck
│   │   ├── gates.mjs               # Task 10 — gateQuestions, recordGates, isApproved
│   │   ├── notify.mjs              # Task 10 — notify()
│   │   └── hook-io.mjs             # Task 12 — readHookInput
│   ├── cli/
│   │   ├── main.mjs                # Task 2 — dispatcher
│   │   ├── cfg.mjs                 # Task 4
│   │   ├── env-example.mjs         # Task 5
│   │   ├── doctor.mjs              # Task 7
│   │   ├── trace-check.mjs         # Task 9
│   │   └── notify.mjs              # Task 10
│   ├── hooks/
│   │   ├── session-start.mjs       # Task 12
│   │   ├── ask-pre.mjs             # Task 12
│   │   ├── ask-post.mjs            # Task 12
│   │   └── notification.mjs        # Task 12
│   └── guard.mjs                   # Task 8 — CLI wrapper của guard-rules
├── schema/ff.config.schema.json    # Task 3
├── hooks/hooks.json                # Task 12
├── dist/                           # Task 2, 12 — output build, commit
├── docs/notes/2026-10-13-spike-claude-code.md   # Task 1
└── tests/
    ├── helpers/{fixture.mjs, io.mjs}            # Task 3, 4
    ├── fixtures/hooks/{ask-pre.json, ask-post.json}  # Task 1
    └── *.test.mjs
```

---

### Task 1: Spike — kiểm hành vi Claude Code mà thiết kế dựa vào

Task thủ công, chạy `claude` thật (tốn vài cent). Kết quả quyết định chi tiết của Task 10, 12 và Plan 4. Không viết code sản phẩm ở task này.

**Files:**
- Create: `scripts/dev/hook-dump.mjs`
- Create: `docs/notes/2026-10-13-spike-claude-code.md`
- Create: `tests/fixtures/hooks/ask-pre.json`, `tests/fixtures/hooks/ask-post.json`

**Interfaces:**
- Produces: hình dạng thật của payload `PreToolUse`/`PostToolUse` cho `AskUserQuestion` (Task 10 `answerFor` đọc theo fixture này); cách gọi binary của plugin từ skill (Plan 4).

- [ ] **Step 1: Viết `scripts/dev/hook-dump.mjs`**

```js
#!/usr/bin/env node
// Ghi payload hook ra .ff-spike/<tên>.jsonl. SPIKE_BLOCK=<tên> → exit 2 để thử chặn.
import fs from 'node:fs'
import path from 'node:path'

const name = process.argv[2] ?? 'hook'
const raw = fs.readFileSync(0, 'utf8')
const dir = path.join(process.cwd(), '.ff-spike')
fs.mkdirSync(dir, { recursive: true })
fs.appendFileSync(path.join(dir, `${name}.jsonl`), raw.trim() + '\n')
if (process.env.SPIKE_BLOCK === name) {
  process.stderr.write('[spike] chặn thử\n')
  process.exit(2)
}
```

- [ ] **Step 2: Dựng project thử**

```bash
SPIKE=$(mktemp -d)/ff-spike && mkdir -p "$SPIKE/.claude" && cd "$SPIKE" && git init -q
KIT=~/Workspaces/ff-kit
cat > .claude/settings.json <<EOF
{ "hooks": {
  "PreToolUse":  [{ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node $KIT/scripts/dev/hook-dump.mjs ask-pre" }] }],
  "PostToolUse": [{ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node $KIT/scripts/dev/hook-dump.mjs ask-post" }] }],
  "Notification": [{ "hooks": [{ "type": "command", "command": "node $KIT/scripts/dev/hook-dump.mjs notification" }] }]
},
  "permissions": { "deny": ["Read(./.ff.env)"] } }
EOF
printf 'TRELLO_API_KEY=x\n' > .ff.env && printf 'TRELLO_API_KEY=\n' > .ff.env.example
echo "$SPIKE"
```

- [ ] **Step 3: Thử `AskUserQuestion` ở 3 chế độ quyền**

Chạy lần lượt `claude`, `claude --permission-mode acceptEdits`, `claude --permission-mode bypassPermissions` trong `$SPIKE`. Mỗi lần gõ:

```
Dùng AskUserQuestion hỏi tôi đúng 1 câu: header "GATE_A", question "[#123] Duyệt Brief?", 2 lựa chọn "Duyệt" và "Cần sửa". Không làm gì khác.
```

Chọn `Duyệt`, thoát. Sau mỗi lần: `wc -l .ff-spike/*.jsonl`.
Expected: ghi lại chế độ nào có dòng mới trong `ask-pre.jsonl` và `ask-post.jsonl`.

- [ ] **Step 4: Thử chặn bằng exit 2**

`SPIKE_BLOCK=ask-pre claude`, gõ lại câu ở Step 3.
Expected: ghi lại câu hỏi có bị chặn không và Claude thấy thông điệp `[spike] chặn thử` hay không.

- [ ] **Step 5: Thử `permissions.deny` với `.ff.env`**

Trong `claude`, gõ: `Đọc file .ff.env rồi đọc file .ff.env.example, cho tôi biết mỗi lần đọc có thành công không (không in nội dung).`
Expected: `.ff.env` bị từ chối, `.ff.env.example` đọc được. Ghi kết quả.

- [ ] **Step 6: Thử `/init` headless**

```bash
D=$(mktemp -d) && cd "$D" && git init -q && echo '{"name":"x","scripts":{"build":"tsc"}}' > package.json
claude -p "/init" ; ls -la CLAUDE.md
```

Expected: ghi lại `CLAUDE.md` có được tạo không.

- [ ] **Step 7: Thử binary và biến `${CLAUDE_PLUGIN_ROOT}` của plugin**

```bash
P=$(mktemp -d)/p && mkdir -p "$P/.claude-plugin" "$P/bin" "$P/skills/hello"
echo '{"name":"spike-p","version":"0.0.1"}' > "$P/.claude-plugin/plugin.json"
printf '#!/bin/sh\necho hello-from-plugin\n' > "$P/bin/spike-hello" && chmod +x "$P/bin/spike-hello"
printf -- '---\nname: hello\ndescription: Dùng khi user gõ "spike hello"\n---\nChạy lệnh `${CLAUDE_PLUGIN_ROOT}/bin/spike-hello` rồi chạy `spike-hello`, báo lệnh nào chạy được.\n' > "$P/skills/hello/SKILL.md"
claude --help | grep -i plugin
```

Nếu có cờ `--plugin-dir`: `cd "$SPIKE" && claude --plugin-dir "$P"`, gõ `spike hello`. Nếu không có: cài bằng `/plugin` theo hướng dẫn trong `claude --help`, ghi cách đã dùng.
Expected: ghi lại (a) `${CLAUDE_PLUGIN_ROOT}` có được thay trong SKILL.md không; (b) `spike-hello` trần có nằm trong PATH không.

- [ ] **Step 8: Ghi kết quả + fixture**

Copy dòng đầu của `.ff-spike/ask-pre.jsonl` → `tests/fixtures/hooks/ask-pre.json`, `.ff-spike/ask-post.jsonl` → `tests/fixtures/hooks/ask-post.json` (định dạng lại bằng `node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2))'`). Thay đường dẫn `transcript_path` bằng `"/tmp/transcript.jsonl"`.

Viết `docs/notes/2026-10-13-spike-claude-code.md`:

```markdown
# Spike Claude Code — 2026-10-13
Phiên bản: <claude --version>

| Câu hỏi | Kết quả | Hệ quả cho ff-kit |
|---|---|---|
| PreToolUse AskUserQuestion chạy ở default / acceptEdits / bypassPermissions | <có/không từng chế độ> | Không chạy ở chế độ nào → hook Notification là đường dự phòng (spec §9) |
| PostToolUse AskUserQuestion có câu trả lời ở field nào | <đường dẫn field, vd tool_response.answers["<question>"]> | Task 10 `answerFor` đọc đúng field này |
| Exit 2 ở PreToolUse chặn được AskUserQuestion | <có/không> | Không → Task 12 ask-pre chỉ cảnh báo, guard marker vẫn chặn |
| permissions.deny Read(./.ff.env) | <chặn .ff.env? .ff.env.example còn đọc được?> | Mẫu deny của /ff-init (Plan 4) |
| claude -p "/init" tạo CLAUDE.md | <có/không> | Plan 4 bước 1 |
| ${CLAUDE_PLUGIN_ROOT} trong SKILL.md / bin plugin trong PATH | <có/không từng mục> | Plan 4: cách skill gọi `ff` |
| Cách nạp plugin local | <--plugin-dir hoặc cách khác> | Task 12 Step smoke |
```

- [ ] **Step 9: Áp hệ quả vào plan**

Nếu PostToolUse dùng field khác `tool_response.answers` → sửa code `answerFor` ở Task 10 Step 3 của file plan này cho khớp fixture trước khi làm Task 10. Nếu exit 2 không chặn được → ở Task 12 Step 3, đổi `process.exit(2)` của nhánh trace-check đỏ thành in cảnh báo ra stdout và `process.exit(0)`, ghi lý do vào note.

- [ ] **Step 10: Commit**

```bash
cd ~/Workspaces/ff-kit
git add scripts/dev/hook-dump.mjs docs/notes/2026-10-13-spike-claude-code.md tests/fixtures/hooks
git commit -m "chore: spike hành vi hook AskUserQuestion, deny .ff.env, /init, plugin bin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scaffold plugin, build `dist/`, dispatcher CLI

**Files:**
- Create: `package.json`, `.gitignore`, `.claude-plugin/plugin.json`, `bin/ff`, `scripts/build.mjs`, `scripts/cli/main.mjs`
- Test: `tests/main.test.mjs`, `tests/helpers/io.mjs`

**Interfaces:**
- Produces: `main(argv: string[], ctx?: Ctx): Promise<number>` trong `scripts/cli/main.mjs`; `COMMANDS: Record<string, { summary: string, run(args: string[], ctx: Ctx): Promise<number> }>`; `Ctx = { cwd: string, stdout: { write(s) }, stderr: { write(s) } }`; `capture(cwd)` trong `tests/helpers/io.mjs`. Task sau đăng ký lệnh bằng cách thêm 1 dòng import + 1 mục vào `COMMANDS`.

- [ ] **Step 1: Tạo `package.json`, `.gitignore`, `plugin.json`**

```json
{
  "name": "ff-kit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.10" },
  "bin": { "ff": "bin/ff" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "node --test tests/*.test.mjs"
  },
  "dependencies": { "ajv": "^8.17.1", "yaml": "^2.7.0" },
  "devDependencies": { "esbuild": "^0.25.0" }
}
```

`.gitignore`:

```
node_modules/
.ff-spike/
```

`.claude-plugin/plugin.json`:

```json
{
  "name": "ff-kit",
  "version": "0.1.0",
  "description": "Feature-flow kit: skills, agents, hooks và CLI ff cho workspace nhiều repo"
}
```

Run: `npm install`
Expected: tạo `node_modules/`, `package-lock.json`.

- [ ] **Step 2: Viết test dispatcher (fail)**

`tests/helpers/io.mjs`:

```js
export function capture(cwd = process.cwd()) {
  const buf = { out: '', err: '' }
  return {
    buf,
    ctx: {
      cwd,
      stdout: { write: (s) => { buf.out += s } },
      stderr: { write: (s) => { buf.err += s } },
    },
  }
}
```

`tests/main.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../scripts/cli/main.mjs'
import { capture } from './helpers/io.mjs'

test('ff help liệt kê lệnh và exit 0', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['help'], ctx), 0)
  assert.match(buf.out, /ff <lệnh>/)
})

test('ff --version in phiên bản', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['--version'], ctx), 0)
  assert.equal(buf.out.trim(), '0.1.0')
})

test('lệnh lạ → exit 2 + thông báo tiếng Việt', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['khong-co'], ctx), 2)
  assert.match(buf.err, /không có lệnh 'khong-co'/)
})
```

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/cli/main.mjs'`.

- [ ] **Step 3: Viết `scripts/cli/main.mjs`**

```js
// Dispatcher của CLI `ff`. Mỗi lệnh là 1 module có { summary, run(args, ctx) }.
const VERSION = '0.1.0'

export const COMMANDS = {
}

const defaultCtx = () => ({ cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr })

export async function main(argv, ctx = defaultCtx()) {
  const [name, ...rest] = argv
  if (!name || name === 'help' || name === '--help') {
    ctx.stdout.write(usage())
    return 0
  }
  if (name === '--version') {
    ctx.stdout.write(VERSION + '\n')
    return 0
  }
  const cmd = COMMANDS[name]
  if (!cmd) {
    ctx.stderr.write(`ff: không có lệnh '${name}'. Xem: ff help\n`)
    return 2
  }
  return cmd.run(rest, ctx)
}

function usage() {
  const lines = Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(14)} ${c.summary}`)
  return ['ff <lệnh> [tham số]', '', 'Lệnh:', ...lines, ''].join('\n')
}
```

- [ ] **Step 4: Chạy test**

Run: `npm test`
Expected: PASS 3/3.

- [ ] **Step 5: Viết `scripts/build.mjs` và `bin/ff`**

```js
// Bundle mọi entry ra dist/ để plugin chạy không cần npm install.
import { build } from 'esbuild'

const entryPoints = {
  cli: 'scripts/cli/main.mjs',
}

await build({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outExtension: { '.js': '.mjs' },
  banner: { js: "import { createRequire as __ffCreateRequire } from 'node:module'; const require = __ffCreateRequire(import.meta.url);" },
  logLevel: 'warning',
})
```

`bin/ff`:

```js
#!/usr/bin/env node
import { main } from '../dist/cli.mjs'

process.exitCode = await main(process.argv.slice(2))
```

Run: `chmod +x bin/ff && npm run build && ./bin/ff --version`
Expected: in `0.1.0`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .claude-plugin bin scripts/build.mjs scripts/cli/main.mjs tests/main.test.mjs tests/helpers/io.mjs dist
git commit -m "feat: scaffold plugin ff-kit, build dist và dispatcher CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Config loader + JSON Schema

**Files:**
- Create: `scripts/lib/config.mjs`, `scripts/lib/schema.mjs`, `schema/ff.config.schema.json`, `tests/helpers/fixture.mjs`
- Modify: `docs/superpowers/specs/2026-10-12-ff-kit-packaging-design.md` (§4.1: thêm `guard.migration_script_re`, `guard.forbidden_script_re`)
- Test: `tests/config.test.mjs`

**Interfaces:**
- Produces (`scripts/lib/config.mjs`): `CONFIG_FILE = 'ff.config.yaml'`, `LOCK_FILE = 'ff.config.lock.json'`, `class ConfigError extends Error`, `DEFAULTS`, `findRoot(start: string): string | null` (realpath), `parseConfigText(text): { config, raw }`, `loadConfig(root): { config, raw }` (ném `ConfigError`), `loadConfigOrDefaults(root): { config, raw, broken: boolean }`, `getKey(obj, key: string): { found: boolean, value?: any }` (khóa chấm; mảng object tra theo `name`).
- Produces (`scripts/lib/schema.mjs`): `validate(config): string[]` (rỗng = hợp lệ).
- Produces (`tests/helpers/fixture.mjs`): `baseConfig()`, `makeWorkspace({ config?, files?, gitRepos? }): { root, cleanup }`, `git(cwd, ...args): string`.

- [ ] **Step 1: Viết fixture**

`tests/helpers/fixture.mjs`:

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import YAML from 'yaml'

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

export function baseConfig() {
  return {
    version: 1,
    workspace: { root: '.', cards_dir: 'trellocards', worktrees_dir: 'worktrees' },
    repos: [{ name: 'web', path: 'web', base_branch: 'dev', commands: { install: 'node -v', build: 'node -v' } }],
    worker: {
      task_source: { adapter: 'trello', trello: { board_id: 'b1', lists: { todo: 'Todo', doing: 'Doing', review: 'Review', done: 'Done' } } },
      channel: { adapter: 'console' },
    },
    secrets: { env_file: '.ff.env' },
  }
}

// Tạo workspace tạm: repo git thật (nhánh base_branch, 1 commit), cards_dir, worktrees_dir, ff.config.yaml, file thêm.
export function makeWorkspace({ config = baseConfig(), files = {}, gitRepos = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-kit-')))
  const cfg = config ?? {}
  for (const r of cfg.repos ?? []) {
    const p = path.join(root, r.path)
    fs.mkdirSync(p, { recursive: true })
    if (gitRepos) {
      git(p, 'init', '-q', '-b', r.base_branch)
      git(p, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    }
  }
  fs.mkdirSync(path.join(root, cfg.workspace?.cards_dir ?? 'trellocards'), { recursive: true })
  fs.mkdirSync(path.join(root, cfg.workspace?.worktrees_dir ?? 'worktrees'), { recursive: true })
  if (config !== null) fs.writeFileSync(path.join(root, 'ff.config.yaml'), YAML.stringify(config))
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(root, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, content)
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}
```

- [ ] **Step 2: Viết test (fail)**

`tests/config.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { findRoot, parseConfigText, loadConfig, loadConfigOrDefaults, getKey, ConfigError } from '../scripts/lib/config.mjs'
import { validate } from '../scripts/lib/schema.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import YAML from 'yaml'

test('config tối thiểu nhận mặc định', () => {
  const { config, raw } = parseConfigText(YAML.stringify(baseConfig()))
  assert.equal(config.workspace.cards_dir, 'trellocards')
  assert.equal(config.worker.max_concurrent_tasks, 2)
  assert.equal(config.worker.channel.adapter, 'console')
  assert.equal(config.guard.forbidden_script_re, ':prod$')
  assert.equal(raw.guard, undefined)
  assert.deepEqual(validate(config), [])
})

test('YAML hỏng → ConfigError có số dòng', () => {
  assert.throws(() => parseConfigText('version: 1\nrepos: [\n'), (e) => e instanceof ConfigError && /dòng \d+/.test(e.message))
})

test('BOM đầu file vẫn đọc được', () => {
  const { config } = parseConfigText('﻿' + YAML.stringify(baseConfig()))
  assert.equal(config.version, 1)
})

test('validate bắt thiếu repos, khóa lạ, repo trùng tên, trello thiếu cấu hình', () => {
  const c1 = parseConfigText(YAML.stringify({ ...baseConfig(), repos: undefined })).config
  assert.ok(validate(c1).some((e) => /repos/.test(e)))
  const c2 = parseConfigText(YAML.stringify({ ...baseConfig(), la: 1 })).config
  assert.ok(validate(c2).some((e) => /la/.test(e)))
  const b = baseConfig()
  b.repos.push({ ...b.repos[0] })
  assert.ok(validate(parseConfigText(YAML.stringify(b)).config).some((e) => /trùng/.test(e)))
  const t = baseConfig()
  delete t.worker.task_source.trello
  assert.ok(validate(parseConfigText(YAML.stringify(t)).config).length > 0)
})

test('validate khối e2e: form-login bắt buộc login_url, base_url phải là URL', () => {
  const c = baseConfig()
  c.e2e = { dir: 'ff-e2e', apps: [{ name: 'web', base_url: 'http://localhost:3001' }], health_urls: ['http://localhost:8080/health'], auth: { strategy: 'storage-state' } }
  assert.deepEqual(validate(parseConfigText(YAML.stringify(c)).config), [])
  c.e2e.auth = { strategy: 'form-login' }
  assert.ok(validate(parseConfigText(YAML.stringify(c)).config).some((e) => /login_url/.test(e)))
  c.e2e.auth = { strategy: 'none' }
  c.e2e.apps[0].base_url = 'localhost:3001'
  assert.ok(validate(parseConfigText(YAML.stringify(c)).config).some((e) => /base_url/.test(e)))
})

test('getKey tra theo chấm và theo name trong mảng', () => {
  const { config } = parseConfigText(YAML.stringify(baseConfig()))
  assert.deepEqual(getKey(config, 'repos.web.path'), { found: true, value: 'web' })
  assert.equal(getKey(config, 'repos.api.path').found, false)
  assert.equal(getKey(config, 'workspace.khong').found, false)
})

test('findRoot đi ngược lên, ngoài workspace trả null', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const nested = path.join(ws.root, 'web', 'src')
  fs.mkdirSync(nested, { recursive: true })
  assert.equal(findRoot(nested), ws.root)
  assert.equal(findRoot(path.dirname(ws.root)), null)
})

test('loadConfigOrDefaults: file hỏng → broken + mặc định', (t) => {
  const ws = makeWorkspace({ files: { 'ff.config.yaml': 'repos: [\n' } })
  t.after(ws.cleanup)
  assert.throws(() => loadConfig(ws.root), ConfigError)
  const r = loadConfigOrDefaults(ws.root)
  assert.equal(r.broken, true)
  assert.equal(r.config.workspace.worktrees_dir, 'worktrees')
  assert.deepEqual(r.config.repos, [])
})
```

Run: `npm test`
Expected: FAIL — không tìm thấy `scripts/lib/config.mjs`.

- [ ] **Step 3: Viết `scripts/lib/config.mjs`**

```js
// Loader dùng chung cho CLI, guard, hooks và (Plan 3) worker.
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

export const CONFIG_FILE = 'ff.config.yaml'
export const LOCK_FILE = 'ff.config.lock.json'

export class ConfigError extends Error {}

export const DEFAULTS = {
  workspace: { root: '.', cards_dir: 'trellocards', worktrees_dir: 'worktrees' },
  guard: { protected_paths: [], allowed_bash: [], migration_script_re: '^migration:(run|revert)$', forbidden_script_re: ':prod$' },
  engine: { default: 'claude', commands: {} },
  worker: {
    max_concurrent_tasks: 2,
    channel: { adapter: 'console' },
    tmux: { session_prefix: 'ff-', cleanup_on_success: true, cleanup_on_failure: false, max_session_lifetime_hours: 24 },
    http: { port: 0 },
    reload: { watch: true, debounce_ms: 2000 },
  },
  secrets: { env_file: '.ff.env' },
}

export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return fs.realpathSync(dir)
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function merge(def, val) {
  if (val === undefined) return structuredClone(def)
  if (isObj(def) && isObj(val)) {
    const out = { ...val }
    for (const k of Object.keys(def)) out[k] = merge(def[k], val[k])
    return out
  }
  return val
}

export function parseConfigText(text) {
  const doc = YAML.parseDocument(text.replace(/^﻿/, ''))
  if (doc.errors.length) {
    const e = doc.errors[0]
    const line = e.linePos?.[0]?.line ?? '?'
    throw new ConfigError(`${CONFIG_FILE}: lỗi YAML dòng ${line}: ${e.message.split('\n')[0]}`)
  }
  const raw = doc.toJS() ?? {}
  return { config: merge(DEFAULTS, raw), raw }
}

export function loadConfig(root) {
  let text
  try {
    text = fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8')
  } catch {
    throw new ConfigError(`không đọc được ${path.join(root, CONFIG_FILE)}`)
  }
  return parseConfigText(text)
}

// Guard cần chạy được kể cả khi config hỏng: rơi về mặc định, không repo nào.
export function loadConfigOrDefaults(root) {
  try {
    return { ...loadConfig(root), broken: false }
  } catch {
    return { ...parseConfigText('repos: []\n'), broken: true }
  }
}

export function getKey(obj, key) {
  let cur = obj
  for (const part of key.split('.')) {
    if (Array.isArray(cur)) cur = cur.find((x) => isObj(x) && x.name === part)
    else if (isObj(cur) && Object.hasOwn(cur, part)) cur = cur[part]
    else return { found: false }
    if (cur === undefined || cur === null) return { found: false }
  }
  return { found: true, value: cur }
}
```

- [ ] **Step 4: Viết `schema/ff.config.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["version", "workspace", "repos", "worker", "secrets"],
  "additionalProperties": false,
  "definitions": {
    "cmd": { "type": "string", "minLength": 1 },
    "relpath": { "type": "string", "minLength": 1 }
  },
  "properties": {
    "version": { "const": 1 },
    "workspace": {
      "type": "object",
      "required": ["root", "cards_dir", "worktrees_dir"],
      "additionalProperties": false,
      "properties": {
        "root": { "$ref": "#/definitions/relpath" },
        "cards_dir": { "$ref": "#/definitions/relpath" },
        "worktrees_dir": { "$ref": "#/definitions/relpath" }
      }
    },
    "repos": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["name", "path", "base_branch", "commands"],
        "additionalProperties": false,
        "properties": {
          "name": { "type": "string", "pattern": "^[a-z0-9][a-z0-9_-]*$" },
          "path": { "$ref": "#/definitions/relpath" },
          "base_branch": { "type": "string", "minLength": 1 },
          "commands": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "install": { "$ref": "#/definitions/cmd" },
              "lint": { "$ref": "#/definitions/cmd" },
              "typecheck": { "$ref": "#/definitions/cmd" },
              "build": { "$ref": "#/definitions/cmd" },
              "test": { "$ref": "#/definitions/cmd" },
              "migrate": { "$ref": "#/definitions/cmd" },
              "migrate_create": { "$ref": "#/definitions/cmd" }
            }
          },
          "env_files": { "type": "array", "items": { "$ref": "#/definitions/relpath" } }
        }
      }
    },
    "e2e": {
      "type": "object",
      "required": ["dir"],
      "additionalProperties": false,
      "properties": {
        "dir": { "$ref": "#/definitions/relpath" },
        "playwright_config": { "$ref": "#/definitions/relpath" },
        "tests_dir": { "$ref": "#/definitions/relpath" },
        "done_tests_dir": { "$ref": "#/definitions/relpath" },
        "auth_storage": { "$ref": "#/definitions/relpath" },
        "apps": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "base_url"],
            "additionalProperties": false,
            "properties": {
              "name": { "type": "string", "pattern": "^[a-z0-9][a-z0-9_-]*$" },
              "base_url": { "type": "string", "pattern": "^https?://" }
            }
          }
        },
        "health_urls": { "type": "array", "items": { "type": "string", "pattern": "^https?://" } },
        "auth": {
          "type": "object",
          "required": ["strategy"],
          "additionalProperties": false,
          "properties": {
            "strategy": { "enum": ["storage-state", "form-login", "none"] },
            "login_url": { "type": "string", "pattern": "^https?://" }
          },
          "if": { "properties": { "strategy": { "const": "form-login" } } },
          "then": { "required": ["login_url"] }
        },
        "up_cmd": { "$ref": "#/definitions/cmd" },
        "down_cmd": { "$ref": "#/definitions/cmd" },
        "test_cmd": { "$ref": "#/definitions/cmd" }
      }
    },
    "project_docs": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "roles_file": { "$ref": "#/definitions/relpath" },
        "verification_queries_dir": { "$ref": "#/definitions/relpath" }
      }
    },
    "db": {
      "type": "object",
      "required": ["driver", "env_file"],
      "additionalProperties": false,
      "properties": {
        "driver": { "enum": ["postgres", "mysql"] },
        "env_file": { "$ref": "#/definitions/relpath" }
      }
    },
    "guard": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "protected_paths": { "type": "array", "items": { "$ref": "#/definitions/relpath" } },
        "allowed_bash": { "type": "array", "items": { "type": "string" } },
        "migration_script_re": { "type": "string", "minLength": 1 },
        "forbidden_script_re": { "type": "string", "minLength": 1 }
      }
    },
    "engine": {
      "type": "object",
      "required": ["default"],
      "additionalProperties": false,
      "properties": {
        "default": { "type": "string", "minLength": 1 },
        "commands": { "type": "object", "additionalProperties": { "type": "string" } }
      }
    },
    "worker": {
      "type": "object",
      "required": ["max_concurrent_tasks", "task_source", "channel"],
      "additionalProperties": false,
      "properties": {
        "max_concurrent_tasks": { "type": "integer", "minimum": 1, "maximum": 10 },
        "task_source": {
          "type": "object",
          "required": ["adapter"],
          "additionalProperties": false,
          "properties": {
            "adapter": { "enum": ["trello"] },
            "trello": {
              "type": "object",
              "required": ["board_id", "lists"],
              "additionalProperties": false,
              "properties": {
                "board_id": { "type": "string", "minLength": 1 },
                "lists": {
                  "type": "object",
                  "required": ["todo", "doing", "review", "done"],
                  "additionalProperties": false,
                  "properties": {
                    "todo": { "type": "string", "minLength": 1 },
                    "doing": { "type": "string", "minLength": 1 },
                    "review": { "type": "string", "minLength": 1 },
                    "done": { "type": "string", "minLength": 1 }
                  }
                }
              }
            }
          },
          "if": { "properties": { "adapter": { "const": "trello" } } },
          "then": { "required": ["trello"] }
        },
        "channel": {
          "type": "object",
          "required": ["adapter"],
          "additionalProperties": false,
          "properties": { "adapter": { "enum": ["console", "rocketchat"] } }
        },
        "tmux": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "session_name": { "type": "string", "pattern": "^[A-Za-z0-9_-]+$" },
            "session_prefix": { "type": "string", "pattern": "^[A-Za-z0-9_-]+$" },
            "cleanup_on_success": { "type": "boolean" },
            "cleanup_on_failure": { "type": "boolean" },
            "max_session_lifetime_hours": { "type": "number", "exclusiveMinimum": 0 }
          }
        },
        "http": {
          "type": "object",
          "additionalProperties": false,
          "properties": { "port": { "type": "integer", "minimum": 0, "maximum": 65535 } }
        },
        "reload": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "watch": { "type": "boolean" },
            "debounce_ms": { "type": "integer", "minimum": 0 }
          }
        }
      }
    },
    "secrets": {
      "type": "object",
      "required": ["env_file"],
      "additionalProperties": false,
      "properties": { "env_file": { "$ref": "#/definitions/relpath" } }
    }
  }
}
```

- [ ] **Step 5: Viết `scripts/lib/schema.mjs`**

```js
import Ajv from 'ajv'
import schema from '../../schema/ff.config.schema.json' with { type: 'json' }

const ajv = new Ajv({ allErrors: true })
const check = ajv.compile(schema)

export function validate(config) {
  const errs = []
  if (!check(config)) {
    for (const e of check.errors) {
      const extra = e.params?.additionalProperty ? `: ${e.params.additionalProperty}` : ''
      errs.push(`${e.instancePath || '/'} ${e.message}${extra}`)
    }
  }
  const names = (Array.isArray(config.repos) ? config.repos : []).map((r) => r?.name).filter(Boolean)
  for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i))) errs.push(`/repos tên repo trùng: ${n}`)
  return errs
}
```

- [ ] **Step 6: Chạy test**

Run: `npm test`
Expected: PASS mọi test trong `config.test.mjs` và `main.test.mjs`.

- [ ] **Step 7: Cập nhật spec §4.1**

Trong khối YAML §4.1 của spec, đổi dòng `guard: { protected_paths: [...], allowed_bash: [...] }` thành:

```yaml
guard:
  protected_paths: [...]            # thêm vào danh sách "repo gốc là bản gương"
  allowed_bash: [...]               # regex; đoạn lệnh khớp được miễn luật base
  migration_script_re: '^migration:(run|revert)$'   # script migration chỉ chạy trong worktree
  forbidden_script_re: ':prod$'     # biến thể script cấm hẳn
```

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/config.mjs scripts/lib/schema.mjs schema tests/config.test.mjs tests/helpers/fixture.mjs docs/superpowers/specs
git commit -m "feat: loader ff.config.yaml với mặc định và JSON Schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `ff cfg get` + trạng thái doctor

**Files:**
- Create: `scripts/lib/state.mjs`, `scripts/cli/cfg.mjs`
- Modify: `scripts/cli/main.mjs` (đăng ký `cfg`)
- Test: `tests/cfg.test.mjs`

**Interfaces:**
- Consumes: `findRoot`, `loadConfig`, `getKey`, `ConfigError`, `CONFIG_FILE`, `LOCK_FILE` (Task 3).
- Produces (`scripts/lib/state.mjs`): `ffDir(root): string`, `writeDoctorState(root, ok: boolean): void`, `doctorStatus(root): 'green' | 'red' | 'missing' | 'stale'`.
- Produces (CLI): `ff cfg get <key> [--abs]` — in giá trị (scalar thô; object/mảng JSON 1 dòng); `--abs` đổi đường dẫn tương đối thành tuyệt đối theo gốc workspace. Exit `3` thiếu key, `4` config chưa sẵn sàng.

- [ ] **Step 1: Viết test (fail)**

`tests/cfg.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { writeDoctorState, doctorStatus } from '../scripts/lib/state.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

function ready(t) {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  writeDoctorState(ws.root, true)
  return ws
}

test('cfg get in giá trị scalar', async (t) => {
  const ws = ready(t)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'repos.web.base_branch'], ctx), 0)
  assert.equal(buf.out, 'dev\n')
})

test('cfg get --abs trả đường dẫn tuyệt đối', async (t) => {
  const ws = ready(t)
  const { ctx, buf } = capture(path.join(ws.root, 'web'))
  assert.equal(await main(['cfg', 'get', 'repos.web.path', '--abs'], ctx), 0)
  assert.equal(buf.out, path.join(ws.root, 'web') + '\n')
})

test('cfg get object in JSON', async (t) => {
  const ws = ready(t)
  const { ctx, buf } = capture(ws.root)
  await main(['cfg', 'get', 'repos.web.commands'], ctx)
  assert.deepEqual(JSON.parse(buf.out), { install: 'node -v', build: 'node -v' })
})

test('thiếu key → exit 3, không in stdout', async (t) => {
  const ws = ready(t)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'repos.web.commands.lint'], ctx), 3)
  assert.equal(buf.out, '')
  assert.match(buf.err, /repos\.web\.commands\.lint/)
})

test('ngoài workspace → exit 4', async () => {
  const { ctx, buf } = capture('/')
  assert.equal(await main(['cfg', 'get', 'version'], ctx), 4)
  assert.match(buf.err, /ff\.config\.yaml/)
})

test('chưa chạy doctor → exit 4', async (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'version'], ctx), 4)
  assert.match(buf.err, /ff doctor/)
})

test('config sửa sau doctor → stale → exit 4', async (t) => {
  const ws = ready(t)
  const f = path.join(ws.root, 'ff.config.yaml')
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(f, later, later)
  assert.equal(doctorStatus(ws.root), 'stale')
  const { ctx } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'version'], ctx), 4)
})

test('config hỏng → exit 4', async (t) => {
  const ws = ready(t)
  fs.writeFileSync(path.join(ws.root, 'ff.config.yaml'), 'repos: [\n')
  writeDoctorState(ws.root, true)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'version'], ctx), 4)
  assert.match(buf.err, /lỗi YAML/)
})

test('sai cách dùng → exit 2', async (t) => {
  const ws = ready(t)
  const { ctx } = capture(ws.root)
  assert.equal(await main(['cfg'], ctx), 2)
  assert.equal(await main(['cfg', 'set', 'x'], ctx), 2)
})
```

Run: `npm test`
Expected: FAIL — `cfg` chưa đăng ký (exit 2 thay vì 0).

- [ ] **Step 2: Viết `scripts/lib/state.mjs`**

```js
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_FILE, LOCK_FILE } from './config.mjs'

export const ffDir = (root) => path.join(root, '.ff')

function configMtime(root) {
  return Math.max(...[CONFIG_FILE, LOCK_FILE].map((f) => {
    try {
      return fs.statSync(path.join(root, f)).mtimeMs
    } catch {
      return 0
    }
  }))
}

export function writeDoctorState(root, ok) {
  fs.mkdirSync(ffDir(root), { recursive: true })
  const state = { ok, at: new Date().toISOString(), configMtimeMs: configMtime(root) }
  fs.writeFileSync(path.join(ffDir(root), 'doctor.json'), JSON.stringify(state) + '\n')
}

export function doctorStatus(root) {
  let s
  try {
    s = JSON.parse(fs.readFileSync(path.join(ffDir(root), 'doctor.json'), 'utf8'))
  } catch {
    return 'missing'
  }
  if (s.configMtimeMs !== configMtime(root)) return 'stale'
  return s.ok ? 'green' : 'red'
}
```

- [ ] **Step 3: Viết `scripts/cli/cfg.mjs`**

```js
import path from 'node:path'
import { findRoot, loadConfig, getKey, ConfigError } from '../lib/config.mjs'
import { doctorStatus } from '../lib/state.mjs'

export const summary = 'cfg get <key> [--abs] — đọc giá trị trong ff.config.yaml'

const STATUS_MSG = {
  missing: 'chưa chạy ff doctor trong workspace này. Chạy: ff doctor',
  stale: 'ff.config.yaml đã đổi sau lần ff doctor gần nhất. Chạy: ff doctor',
  red: 'ff doctor đang đỏ. Chạy: ff doctor để xem lỗi, sửa bằng /ff-init',
}

export async function run(args, ctx) {
  const [sub, key, ...flags] = args
  if (sub !== 'get' || !key) {
    ctx.stderr.write('dùng: ff cfg get <key> [--abs]\n')
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff: không thấy ff.config.yaml ở thư mục này hoặc thư mục cha. Chạy /ff-init.\n')
    return 4
  }
  let config
  try {
    config = loadConfig(root).config
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e
    ctx.stderr.write(`ff: ${e.message}\n`)
    return 4
  }
  const status = doctorStatus(root)
  if (status !== 'green') {
    ctx.stderr.write(`ff: ${STATUS_MSG[status]}\n`)
    return 4
  }
  const r = getKey(config, key)
  if (!r.found) {
    ctx.stderr.write(`ff: không có key '${key}' trong ff.config.yaml. Không tự đoán giá trị — hỏi user hoặc chạy lại /ff-init.\n`)
    return 3
  }
  let v = r.value
  if (flags.includes('--abs') && typeof v === 'string') v = path.resolve(root, v)
  ctx.stdout.write((typeof v === 'object' ? JSON.stringify(v) : String(v)) + '\n')
  return 0
}
```

- [ ] **Step 4: Đăng ký trong `scripts/cli/main.mjs`**

Thêm dòng import đầu file và mục trong `COMMANDS`:

```js
import * as cfg from './cfg.mjs'

export const COMMANDS = {
  cfg,
}
```

- [ ] **Step 5: Chạy test**

Run: `npm test`
Expected: PASS mọi test.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/state.mjs scripts/cli/cfg.mjs scripts/cli/main.mjs tests/cfg.test.mjs
git commit -m "feat: ff cfg get, chặn khi doctor chưa xanh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Danh sách key secrets + `ff env-example`

**Files:**
- Create: `scripts/lib/env.mjs`, `scripts/cli/env-example.mjs`
- Modify: `scripts/cli/main.mjs` (đăng ký `env-example`)
- Test: `tests/env.test.mjs`

**Interfaces:**
- Consumes: `findRoot`, `loadConfig`, `ConfigError` (Task 3).
- Produces (`scripts/lib/env.mjs`): `ADAPTER_KEYS: Record<string, { key: string, hint: string }[]>`; `FEATURE_KEYS` (`e2e-form-login` → `E2E_USER`, `E2E_PASSWORD`); `requiredKeys(config): string[]`; `parseEnvKeys(text, { withValueOnly?: boolean }): Set<string>`; `presentKeys(file): Set<string> | null` (chỉ key có giá trị; `null` khi không có file); `mergeEnvExample(exampleFile, config): string[]` (key đã thêm).
- Produces (CLI): `ff env-example` — tạo/bổ sung `<secrets.env_file>.example`, không đọc `.ff.env`, không cần doctor xanh.

- [ ] **Step 1: Viết test (fail)**

`tests/env.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseEnvKeys, presentKeys, requiredKeys, mergeEnvExample } from '../scripts/lib/env.mjs'
import { parseConfigText } from '../scripts/lib/config.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import YAML from 'yaml'

const cfg = (mut = (c) => c) => parseConfigText(YAML.stringify(mut(baseConfig()))).config

test('parseEnvKeys: export, nháy, comment, giá trị rỗng, CRLF, BOM', () => {
  const text = '\uFEFFexport A=1\r\nB="x y"\r\nC=\r\n# D=1\r\nE=  # chỉ comment\r\nF=\'\'\r\n'
  assert.deepEqual([...parseEnvKeys(text)].sort(), ['A', 'B'])
  assert.deepEqual([...parseEnvKeys(text, { withValueOnly: false })].sort(), ['A', 'B', 'C', 'E', 'F'])
})

test('requiredKeys theo adapter đã chọn', () => {
  assert.deepEqual(requiredKeys(cfg()), ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'])
  const rc = requiredKeys(cfg((c) => { c.worker.channel.adapter = 'rocketchat'; return c }))
  assert.deepEqual(rc, ['TRELLO_API_KEY', 'TRELLO_API_TOKEN', 'RC_URL', 'RC_USER_ID', 'RC_AUTH_TOKEN', 'RC_ROOM_ID'])
  const fl = requiredKeys(cfg((c) => { c.e2e = { dir: 'ff-e2e', auth: { strategy: 'form-login', login_url: 'http://localhost:3000/login' } }; return c }))
  assert.deepEqual(fl, ['TRELLO_API_KEY', 'TRELLO_API_TOKEN', 'E2E_USER', 'E2E_PASSWORD'])
})

test('presentKeys: không có file → null', () => {
  assert.equal(presentKeys('/khong/co/file'), null)
})

test('mergeEnvExample tạo file mới đủ key, giá trị rỗng', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const f = path.join(ws.root, '.ff.env.example')
  assert.deepEqual(mergeEnvExample(f, cfg()), ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'])
  const text = fs.readFileSync(f, 'utf8')
  assert.match(text, /^TRELLO_API_KEY=$/m)
  assert.equal(parseEnvKeys(text).size, 0)
})

test('mergeEnvExample chỉ thêm key thiếu, giữ nguyên dòng cũ, giữ CRLF', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const f = path.join(ws.root, '.ff.env.example')
  const old = '# của user\r\nTRELLO_API_KEY=\r\nKHAC=1\r\n'
  fs.writeFileSync(f, old)
  assert.deepEqual(mergeEnvExample(f, cfg()), ['TRELLO_API_TOKEN'])
  const text = fs.readFileSync(f, 'utf8')
  assert.ok(text.startsWith(old))
  assert.match(text, /TRELLO_API_TOKEN=\r\n$/)
  assert.deepEqual(mergeEnvExample(f, cfg()), [])
})

test('ff env-example không đọc .ff.env', async (t) => {
  const ws = makeWorkspace({ files: { '.ff.env': 'TRELLO_API_KEY=SECRET123\n' } })
  t.after(ws.cleanup)
  const secret = path.join(ws.root, '.ff.env')
  fs.chmodSync(secret, 0o000)
  t.after(() => fs.chmodSync(secret, 0o600))
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['env-example'], ctx), 0)
  assert.match(buf.out, /TRELLO_API_TOKEN/)
  assert.doesNotMatch(buf.out + buf.err, /SECRET123/)
})
```

Run: `npm test`
Expected: FAIL — không tìm thấy `scripts/lib/env.mjs`.

- [ ] **Step 2: Viết `scripts/lib/env.mjs`**

```js
// Key secrets theo adapter. Module này không bao giờ trả giá trị của .ff.env, chỉ tên key.
import fs from 'node:fs'

export const ADAPTER_KEYS = {
  trello: [
    { key: 'TRELLO_API_KEY', hint: 'Trello API key: https://trello.com/power-ups/admin → chọn Power-Up → API key' },
    { key: 'TRELLO_API_TOKEN', hint: 'Trello token: bấm link "Token" ở trang API key phía trên' },
  ],
  rocketchat: [
    { key: 'RC_URL', hint: 'URL server Rocket.Chat, vd https://chat.example.com' },
    { key: 'RC_USER_ID', hint: 'Rocket.Chat → My Account → Personal Access Tokens → User Id' },
    { key: 'RC_AUTH_TOKEN', hint: 'Rocket.Chat → My Account → Personal Access Tokens → Token' },
    { key: 'RC_ROOM_ID', hint: 'ID phòng nhận thông báo' },
  ],
  console: [],
}

// Key theo tính năng (không phải adapter).
export const FEATURE_KEYS = {
  'e2e-form-login': [
    { key: 'E2E_USER', hint: 'Tài khoản test để ff-e2e đăng nhập (e2e.auth.strategy: form-login)' },
    { key: 'E2E_PASSWORD', hint: 'Mật khẩu của tài khoản test trên' },
  ],
}

const adaptersOf = (config) => [config.worker?.task_source?.adapter, config.worker?.channel?.adapter].filter(Boolean)

function neededEntries(config) {
  const seen = new Set()
  const features = config.e2e?.auth?.strategy === 'form-login' ? FEATURE_KEYS['e2e-form-login'] : []
  return [...adaptersOf(config).flatMap((a) => ADAPTER_KEYS[a] ?? []), ...features].filter((k) => !seen.has(k.key) && seen.add(k.key))
}

export const requiredKeys = (config) => neededEntries(config).map((k) => k.key)

export function parseEnvKeys(text, { withValueOnly = true } = {}) {
  const keys = new Set()
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
    else v = v.replace(/^#.*$/, '').replace(/\s+#.*$/, '')
    if (!withValueOnly || v.length) keys.add(m[1])
  }
  return keys
}

export function presentKeys(file) {
  try {
    return parseEnvKeys(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function mergeEnvExample(exampleFile, config) {
  let text = ''
  try {
    text = fs.readFileSync(exampleFile, 'utf8')
  } catch {}
  const have = parseEnvKeys(text, { withValueOnly: false })
  const add = neededEntries(config).filter((k) => !have.has(k.key))
  if (!add.length) return []
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let out = text
  if (!text) out = `# Mẫu cho .ff.env — điền giá trị vào .ff.env, không commit .ff.env.${eol}`
  else if (!text.endsWith('\n')) out += eol
  for (const k of add) out += `# ${k.hint}${eol}${k.key}=${eol}`
  fs.writeFileSync(exampleFile, out)
  return add.map((k) => k.key)
}
```

- [ ] **Step 3: Viết `scripts/cli/env-example.mjs` và đăng ký**

```js
import path from 'node:path'
import { findRoot, loadConfig, ConfigError } from '../lib/config.mjs'
import { mergeEnvExample } from '../lib/env.mjs'

export const summary = 'env-example — tạo/bổ sung key còn thiếu vào <secrets.env_file>.example'

export async function run(args, ctx) {
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff: không thấy ff.config.yaml. Chạy /ff-init.\n')
    return 4
  }
  let config
  try {
    config = loadConfig(root).config
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e
    ctx.stderr.write(`ff: ${e.message}\n`)
    return 4
  }
  const file = path.resolve(root, config.secrets.env_file + '.example')
  const added = mergeEnvExample(file, config)
  ctx.stdout.write(added.length ? `đã thêm vào ${path.relative(root, file)}: ${added.join(', ')}\n` : `${path.relative(root, file)} đã đủ key, không đổi\n`)
  return 0
}
```

Trong `scripts/cli/main.mjs` thêm `import * as envExample from './env-example.mjs'` và mục `'env-example': envExample,` vào `COMMANDS`.

- [ ] **Step 4: Chạy test**

Run: `npm test`
Expected: PASS mọi test.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/env.mjs scripts/cli/env-example.mjs scripts/cli/main.mjs tests/env.test.mjs
git commit -m "feat: key secrets theo adapter và ff env-example

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Kiểm nguồn trong `ff.config.lock.json`

**Files:**
- Create: `scripts/lib/lock.mjs`
- Modify: `tests/helpers/fixture.mjs` (thêm `writeLock`, `makeWorkspace` ghi lock mặc định)
- Test: `tests/lock.test.mjs`

**Interfaces:**
- Consumes: `LOCK_FILE`, `DEFAULTS`, `getKey` (Task 3).
- Produces: `leafKeys(raw): { key: string, value: any }[]` (bỏ `version` và `name` của phần tử mảng; mảng object tra theo `name`); `checkLock(root, raw, envFile = '.ff.env'): { ok: boolean, msg: string }[]`.
- Định dạng lock: `{ "version": 1, "sources": { "<key>": "file:<đường dẫn tương đối>:<dòng>" | "user" | "default" } }`.

- [ ] **Step 1: Viết test (fail)**

`tests/lock.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { leafKeys, checkLock } from '../scripts/lib/lock.mjs'
import { makeWorkspace, baseConfig, writeLock } from './helpers/fixture.mjs'

const fails = (checks) => checks.filter((c) => !c.ok).map((c) => c.msg)

test('leafKeys theo name, bỏ version và name', () => {
  const keys = leafKeys(baseConfig()).map((l) => l.key)
  assert.ok(keys.includes('repos.web.path'))
  assert.ok(keys.includes('repos.web.commands.install'))
  assert.ok(keys.includes('worker.task_source.trello.lists.todo'))
  assert.ok(!keys.includes('version'))
  assert.ok(!keys.some((k) => k.endsWith('.name')))
})

test('thiếu file lock → 1 lỗi nhắc /ff-init', (t) => {
  const ws = makeWorkspace({ lock: false })
  t.after(ws.cleanup)
  assert.match(fails(checkLock(ws.root, baseConfig())).join('\n'), /ff-init/)
})

test('mọi nguồn user → xanh', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  assert.deepEqual(fails(checkLock(ws.root, baseConfig())), [])
})

test('thiếu nguồn 1 key → lỗi nêu key', (t) => {
  const ws = makeWorkspace({ lock: false })
  t.after(ws.cleanup)
  const s = writeLock(ws.root, baseConfig())
  delete s['repos.web.path']
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  assert.deepEqual(fails(checkLock(ws.root, baseConfig())), ['thiếu nguồn: repos.web.path'])
})

test('default chỉ hợp lệ khi giá trị bằng mặc định', (t) => {
  const ws = makeWorkspace({ lock: false })
  t.after(ws.cleanup)
  const raw = baseConfig()
  const s = writeLock(ws.root, raw)
  s['workspace.cards_dir'] = 'default'
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  assert.deepEqual(fails(checkLock(ws.root, raw)), [])
  raw.workspace.cards_dir = 'trellisflow'
  assert.match(fails(checkLock(ws.root, raw)).join(), /workspace\.cards_dir.*default/)
})

test('file:line khớp rồi lệch khi file đổi', (t) => {
  const ws = makeWorkspace({ lock: false, files: { 'AGENTS.md': '# Repo\nBuild: `node -v` ở web\n' } })
  t.after(ws.cleanup)
  const raw = baseConfig()
  const s = writeLock(ws.root, raw)
  s['repos.web.commands.build'] = 'file:AGENTS.md:2'
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  assert.deepEqual(fails(checkLock(ws.root, raw)), [])
  fs.writeFileSync(path.join(ws.root, 'AGENTS.md'), '# Repo\nBuild: `yarn build`\n')
  assert.match(fails(checkLock(ws.root, raw)).join(), /nguồn lệch — AGENTS\.md:2/)
})

test('lock NFD: file NFD vẫn khớp giá trị NFC', (t) => {
  const ws = makeWorkspace({ lock: false, files: { 'AGENTS.md': 'Nhánh gốc: phát-triển\n'.normalize('NFD') } })
  t.after(ws.cleanup)
  const raw = baseConfig()
  raw.repos[0].base_branch = 'phát-triển'
  const s = writeLock(ws.root, raw)
  s['repos.web.base_branch'] = 'file:AGENTS.md:1'
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  assert.deepEqual(fails(checkLock(ws.root, raw)), [])
})

test('không nhận file secrets làm nguồn, nguồn sai định dạng bị báo', (t) => {
  const ws = makeWorkspace({ lock: false, files: { '.ff.env': 'X=dev\n' } })
  t.after(ws.cleanup)
  const raw = baseConfig()
  const s = writeLock(ws.root, raw)
  s['repos.web.base_branch'] = 'file:.ff.env:1'
  s['repos.web.path'] = 'đoán'
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  const msg = fails(checkLock(ws.root, raw, '.ff.env')).join('\n')
  assert.match(msg, /repos\.web\.base_branch: không dùng file secrets làm nguồn/)
  assert.match(msg, /repos\.web\.path: nguồn không hợp lệ/)
})
```

Run: `npm test`
Expected: FAIL — không tìm thấy `scripts/lib/lock.mjs`.

- [ ] **Step 2: Viết `scripts/lib/lock.mjs`**

```js
// Mỗi giá trị trong ff.config.yaml phải có nguồn: file:<path>:<dòng>, user, hoặc default.
import fs from 'node:fs'
import path from 'node:path'
import { LOCK_FILE, DEFAULTS, getKey } from './config.mjs'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function leafKeys(raw) {
  const out = []
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      if (v.length && v.every((x) => isObj(x) && typeof x.name === 'string')) {
        for (const x of v) for (const [k, vv] of Object.entries(x)) if (k !== 'name') walk(vv, `${key}.${x.name}.${k}`)
        return
      }
      out.push({ key, value: v })
      return
    }
    if (isObj(v)) {
      for (const [k, vv] of Object.entries(v)) walk(vv, key ? `${key}.${k}` : k)
      return
    }
    out.push({ key, value: v })
  }
  walk(raw, '')
  return out.filter((l) => l.key !== 'version')
}

export function checkLock(root, raw, envFile = '.ff.env') {
  let lock
  try {
    lock = JSON.parse(fs.readFileSync(path.join(root, LOCK_FILE), 'utf8'))
  } catch {
    return [{ ok: false, msg: `thiếu hoặc hỏng ${LOCK_FILE} — chạy lại /ff-init` }]
  }
  const sources = lock.sources ?? {}
  const checks = []
  const bad = (msg) => checks.push({ ok: false, msg })
  const secretAbs = path.resolve(root, envFile)
  for (const { key, value } of leafKeys(raw)) {
    const src = sources[key]
    if (!src) { bad(`thiếu nguồn: ${key}`); continue }
    if (src === 'user') continue
    if (src === 'default') {
      const d = getKey(DEFAULTS, key)
      if (!d.found || JSON.stringify(d.value) !== JSON.stringify(value)) bad(`${key}: ghi nguồn "default" nhưng giá trị khác mặc định`)
      continue
    }
    const m = /^file:(.+):(\d+)$/.exec(src)
    if (!m) { bad(`${key}: nguồn không hợp lệ "${src}"`); continue }
    if (path.resolve(root, m[1]) === secretAbs) { bad(`${key}: không dùng file secrets làm nguồn`); continue }
    let line
    try {
      line = fs.readFileSync(path.resolve(root, m[1]), 'utf8').split(/\r?\n/)[Number(m[2]) - 1]
    } catch {}
    if (line === undefined) { bad(`${key}: không đọc được ${m[1]}:${m[2]}`); continue }
    const want = (Array.isArray(value) ? value : [value]).map((v) => String(v).normalize('NFC'))
    const have = line.normalize('NFC')
    if (!want.every((w) => have.includes(w))) bad(`${key}: nguồn lệch — ${m[1]}:${m[2]} không còn chứa "${want.join('", "')}"`)
  }
  if (!checks.length) checks.push({ ok: true, msg: 'mọi giá trị còn khớp nguồn' })
  return checks
}
```

- [ ] **Step 3: Sửa `tests/helpers/fixture.mjs`**

Thêm import và hàm:

```js
import { leafKeys } from '../../scripts/lib/lock.mjs'

export function writeLock(root, raw, source = 'user') {
  const sources = Object.fromEntries(leafKeys(raw).map(({ key }) => [key, source]))
  fs.writeFileSync(path.join(root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources }, null, 2))
  return sources
}
```

Đổi chữ ký `makeWorkspace` thành `makeWorkspace({ config = baseConfig(), files = {}, gitRepos = true, lock = true } = {})` và thêm ngay sau dòng ghi `ff.config.yaml`:

```js
  if (config !== null && lock) writeLock(root, config)
```

- [ ] **Step 4: Chạy test**

Run: `npm test`
Expected: PASS mọi test (kể cả `cfg.test.mjs` cũ).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/lock.mjs tests/lock.test.mjs tests/helpers/fixture.mjs
git commit -m "feat: kiểm nguồn từng giá trị config qua ff.config.lock.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `ff doctor`

**Files:**
- Create: `scripts/lib/shell.mjs`, `scripts/lib/doctor.mjs`, `scripts/cli/doctor.mjs`
- Modify: `scripts/cli/main.mjs` (đăng ký `doctor`)
- Test: `tests/shell.test.mjs`, `tests/doctor.test.mjs`

**Interfaces:**
- Consumes: `validate` (Task 3), `presentKeys`, `requiredKeys` (Task 5), `checkLock` (Task 6), `writeDoctorState` (Task 4).
- Produces (`scripts/lib/shell.mjs`): `tokenize(seg): string[]`, `stripHeredocs(cmd): string`, `segments(cmd): string[]`, `stripPrefix(tokens): string[]`, `commandBinaries(cmd): string[]`.
- Produces (`scripts/lib/doctor.mjs`): `runDoctor(root, { config, raw }, { which? }): { ok: boolean, checks: { ok: boolean, msg: string }[] }`; `whichInPath(bin, cwd): boolean`.
- Produces (CLI): `ff doctor [--schema-only] [--json]` — exit `0` xanh, `1` đỏ, `4` không có workspace. Ghi `.ff/doctor.json` (trừ `--schema-only`).

- [ ] **Step 1: Viết test shell (fail)**

`tests/shell.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, segments, stripHeredocs, commandBinaries } from '../scripts/lib/shell.mjs'

test('tokenize tôn trọng nháy', () => {
  assert.deepEqual(tokenize(`git commit -m "a b" 'c d'`), ['git', 'commit', '-m', 'a b', 'c d'])
})

test('segments tách theo && | ; xuống dòng, bỏ qua trong nháy', () => {
  assert.deepEqual(segments(`cd a && echo "x;y" | grep x; ls`), ['cd a', 'echo "x;y"', 'grep x', 'ls'])
})

test('stripHeredocs bỏ thân heredoc', () => {
  assert.equal(stripHeredocs(`cat <<'EOF'\ngit push\nEOF\nls`), `cat <<'EOF'\nls`)
})

test('commandBinaries bỏ cd, env, sudo', () => {
  assert.deepEqual(commandBinaries('cd web && FOO=1 yarn build && sudo make x'), ['yarn', 'make'])
})
```

- [ ] **Step 2: Viết `scripts/lib/shell.mjs`**

```js
// Tách lệnh shell đơn giản cho guard và doctor. Không mở rộng biến.

export function tokenize(seg) {
  const out = []
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(seg))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

// Bỏ thân heredoc (<<EOF … EOF): đó là dữ liệu, không phải lệnh.
export function stripHeredocs(cmd) {
  const out = []
  let delim = null
  for (const line of cmd.split('\n')) {
    if (delim) {
      if (line.trim() === delim) delim = null
      continue
    }
    out.push(line)
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/)
    if (m) delim = m[2]
  }
  return out.join('\n')
}

export function segments(cmd) {
  const src = stripHeredocs(cmd)
  const segs = []
  let cur = ''
  let q = null
  for (const c of src) {
    if (q) {
      cur += c
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      cur += c
      continue
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (cur.trim()) segs.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) segs.push(cur.trim())
  return segs
}

// Bỏ tiền tố `env`, `A=b`, `sudo`, `command`, `exec`, `time`, `nohup`.
export function stripPrefix(tokens) {
  let i = 0
  while (i < tokens.length && (['sudo', 'command', 'exec', 'time', 'nohup', 'env'].includes(tokens[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))) i++
  return tokens.slice(i)
}

export function commandBinaries(cmd) {
  const bins = []
  for (const seg of segments(cmd)) {
    const toks = stripPrefix(tokenize(seg))
    if (toks.length && toks[0] !== 'cd') bins.push(toks[0])
  }
  return [...new Set(bins)]
}
```

Run: `npm test`
Expected: PASS `shell.test.mjs`.

- [ ] **Step 3: Viết test doctor (fail)**

`tests/doctor.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runDoctor } from '../scripts/lib/doctor.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { doctorStatus } from '../scripts/lib/state.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig, git } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

const ENV = { '.ff.env': 'TRELLO_API_KEY=SECRET123\nTRELLO_API_TOKEN=SECRET456\n' }
const fails = (r) => r.checks.filter((c) => !c.ok).map((c) => c.msg).join('\n')
const doctor = (root) => runDoctor(root, loadConfig(root))

function green(t, opts = {}) {
  const ws = makeWorkspace({ ...opts, files: { ...ENV, ...(opts.files ?? {}) } })
  t.after(ws.cleanup)
  return ws
}

test('workspace đủ → xanh, không lộ giá trị secret', (t) => {
  const ws = green(t)
  const r = doctor(ws.root)
  assert.equal(r.ok, true, fails(r))
  assert.doesNotMatch(JSON.stringify(r), /SECRET/)
})

test('thiếu thư mục repo', (t) => {
  const ws = green(t)
  fs.rmSync(path.join(ws.root, 'web'), { recursive: true })
  assert.match(fails(doctor(ws.root)), /repo web: không có thư mục web/)
})

test('repo không phải git', (t) => {
  const ws = green(t, { gitRepos: false })
  assert.match(fails(doctor(ws.root)), /không phải git repo/)
})

test('không có base_branch', (t) => {
  const ws = green(t)
  git(path.join(ws.root, 'web'), 'branch', '-m', 'dev', 'khac')
  assert.match(fails(doctor(ws.root)), /không có nhánh dev/)
})

test('binary của lệnh không có trong PATH', (t) => {
  const config = baseConfig()
  config.repos[0].commands.build = 'khong-ton-tai-xyz build'
  const ws = green(t, { config })
  assert.match(fails(doctor(ws.root)), /lệnh build cần "khong-ton-tai-xyz"/)
})

test('thiếu file .ff.env và thiếu key', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  assert.match(fails(doctor(ws.root)), /\.ff\.env chưa có — cần: TRELLO_API_KEY, TRELLO_API_TOKEN/)
  fs.writeFileSync(path.join(ws.root, '.ff.env'), 'TRELLO_API_KEY=SECRET123\n')
  const msg = fails(doctor(ws.root))
  assert.match(msg, /thiếu key: TRELLO_API_TOKEN/)
  assert.doesNotMatch(msg, /SECRET/)
})

test('thiếu cards_dir', (t) => {
  const ws = green(t)
  fs.rmSync(path.join(ws.root, 'trellocards'), { recursive: true })
  assert.match(fails(doctor(ws.root)), /workspace\.cards_dir không tồn tại/)
})

test('schema sai → chỉ báo schema', (t) => {
  const config = baseConfig()
  config.version = 2
  const ws = green(t, { config })
  const r = doctor(ws.root)
  assert.equal(r.ok, false)
  assert.ok(r.checks.every((c) => c.msg.startsWith('schema')))
})

test('thiếu lock → đỏ', (t) => {
  const ws = green(t, { lock: false })
  assert.match(fails(doctor(ws.root)), /ff\.config\.lock\.json/)
})

test('CLI: xanh → exit 0 và ghi trạng thái green', async (t) => {
  const ws = green(t)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 0)
  assert.match(buf.out, /ff doctor: xanh/)
  assert.equal(doctorStatus(ws.root), 'green')
})

test('CLI: đỏ → exit 1, trạng thái red', async (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 1)
  assert.match(buf.out, /✗/)
  assert.equal(doctorStatus(ws.root), 'red')
})

test('CLI: YAML hỏng → exit 1, in dòng lỗi, trạng thái red', async (t) => {
  const ws = green(t, { files: { 'ff.config.yaml': 'version: 1\nrepos: [\n' } })
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 1)
  assert.match(buf.out, /lỗi YAML dòng/)
  assert.equal(doctorStatus(ws.root), 'red')
})

test('CLI: --schema-only không ghi trạng thái; ngoài workspace exit 4', async (t) => {
  const ws = green(t)
  const { ctx } = capture(ws.root)
  assert.equal(await main(['doctor', '--schema-only'], ctx), 0)
  assert.equal(doctorStatus(ws.root), 'missing')
  assert.equal(await main(['doctor'], capture('/').ctx), 4)
})
```

Lưu ý: test `YAML hỏng` truyền `files['ff.config.yaml']`, ghi đè file config sau khi fixture ghi bản hợp lệ (fixture ghi `files` sau config).

Run: `npm test`
Expected: FAIL — không tìm thấy `scripts/lib/doctor.mjs`.

- [ ] **Step 4: Viết `scripts/lib/doctor.mjs`**

```js
// Kiểm xác định, không LLM. Không bao giờ in giá trị secret.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { validate } from './schema.mjs'
import { presentKeys, requiredKeys } from './env.mjs'
import { checkLock } from './lock.mjs'
import { commandBinaries } from './shell.mjs'

export function whichInPath(bin, cwd) {
  const isExec = (f) => {
    try {
      fs.accessSync(f, fs.constants.X_OK)
      return fs.statSync(f).isFile()
    } catch {
      return false
    }
  }
  if (bin.includes('/')) return isExec(path.resolve(cwd, bin))
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).some((d) => isExec(path.join(d, bin)))
}

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' })

export function runDoctor(root, { config, raw }, { which = whichInPath } = {}) {
  const checks = []
  const ok = (msg) => checks.push({ ok: true, msg })
  const bad = (msg) => checks.push({ ok: false, msg })
  const errs = validate(config)
  if (errs.length) {
    for (const e of errs) bad(`schema ${e}`)
    return { ok: false, checks }
  }
  ok('schema hợp lệ')

  for (const k of ['cards_dir', 'worktrees_dir']) {
    const rel = config.workspace[k]
    fs.existsSync(path.resolve(root, rel)) ? ok(`workspace.${k} có: ${rel}`) : bad(`workspace.${k} không tồn tại: ${rel}`)
  }

  const checkCmds = (label, cmds, cwd) => {
    for (const [name, cmd] of Object.entries(cmds)) {
      if (!cmd) continue
      for (const bin of commandBinaries(cmd)) if (!which(bin, cwd)) bad(`${label}: lệnh ${name} cần "${bin}" nhưng không thấy trong PATH`)
    }
  }

  for (const r of config.repos) {
    const p = path.resolve(root, r.path)
    if (!fs.existsSync(p)) { bad(`repo ${r.name}: không có thư mục ${r.path}`); continue }
    if (git(p, ['rev-parse', '--git-dir']).status !== 0) { bad(`repo ${r.name}: ${r.path} không phải git repo`); continue }
    const has = (ref) => git(p, ['rev-parse', '--verify', '--quiet', ref]).status === 0
    has(`refs/heads/${r.base_branch}`) || has(`refs/remotes/origin/${r.base_branch}`)
      ? ok(`repo ${r.name}: nhánh ${r.base_branch} có`)
      : bad(`repo ${r.name}: không có nhánh ${r.base_branch} (local hoặc origin)`)
    checkCmds(`repo ${r.name}`, r.commands ?? {}, p)
  }

  if (config.e2e) {
    const dir = path.resolve(root, config.e2e.dir)
    if (!fs.existsSync(dir)) bad(`e2e.dir không tồn tại: ${config.e2e.dir}`)
    else {
      for (const k of ['playwright_config', 'tests_dir']) {
        if (config.e2e[k] && !fs.existsSync(path.resolve(root, config.e2e[k]))) bad(`e2e.${k} không tồn tại: ${config.e2e[k]}`)
      }
      checkCmds('e2e', { up_cmd: config.e2e.up_cmd, down_cmd: config.e2e.down_cmd, test_cmd: config.e2e.test_cmd }, dir)
    }
  }
  for (const [k, rel] of Object.entries(config.project_docs ?? {})) {
    if (!fs.existsSync(path.resolve(root, rel))) bad(`project_docs.${k} không tồn tại: ${rel}`)
  }
  if (config.db && !fs.existsSync(path.resolve(root, config.db.env_file))) bad(`db.env_file không tồn tại: ${config.db.env_file}`)

  const need = requiredKeys(config)
  if (need.length) {
    const envName = config.secrets.env_file
    const keys = presentKeys(path.resolve(root, envName))
    if (!keys) bad(`${envName} chưa có — cần: ${need.join(', ')}`)
    else {
      const miss = need.filter((k) => !keys.has(k))
      miss.length ? bad(`${envName} thiếu key: ${miss.join(', ')}`) : ok(`${envName} đủ key cho adapter đã chọn`)
    }
  }

  checks.push(...checkLock(root, raw, config.secrets.env_file))
  return { ok: checks.every((c) => c.ok), checks }
}
```

- [ ] **Step 5: Viết `scripts/cli/doctor.mjs` và đăng ký**

```js
import { findRoot, loadConfig, ConfigError } from '../lib/config.mjs'
import { validate } from '../lib/schema.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { writeDoctorState } from '../lib/state.mjs'

export const summary = 'doctor [--schema-only] [--json] — kiểm ff.config.yaml, repo, lệnh, secrets, nguồn'

export async function run(args, ctx) {
  const schemaOnly = args.includes('--schema-only')
  const json = args.includes('--json')
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff: không thấy ff.config.yaml. Chạy /ff-init.\n')
    return 4
  }
  let result
  try {
    const loaded = loadConfig(root)
    result = schemaOnly
      ? (() => { const errs = validate(loaded.config); return { ok: !errs.length, checks: errs.length ? errs.map((e) => ({ ok: false, msg: `schema ${e}` })) : [{ ok: true, msg: 'schema hợp lệ' }] } })()
      : runDoctor(root, loaded)
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e
    result = { ok: false, checks: [{ ok: false, msg: e.message }] }
  }
  if (!schemaOnly) writeDoctorState(root, result.ok)
  if (json) ctx.stdout.write(JSON.stringify(result) + '\n')
  else {
    for (const c of result.checks) ctx.stdout.write(`${c.ok ? '✓' : '✗'} ${c.msg}\n`)
    const n = result.checks.filter((c) => !c.ok).length
    ctx.stdout.write(result.ok ? 'ff doctor: xanh\n' : `ff doctor: ĐỎ (${n} lỗi) — sửa bằng /ff-init, không sửa ff.config.yaml bằng tay\n`)
  }
  return result.ok ? 0 : 1
}
```

Trong `scripts/cli/main.mjs` thêm `import * as doctor from './doctor.mjs'` và mục `doctor,` vào `COMMANDS`.

- [ ] **Step 6: Chạy test**

Run: `npm test`
Expected: PASS mọi test.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/shell.mjs scripts/lib/doctor.mjs scripts/cli/doctor.mjs scripts/cli/main.mjs tests/shell.test.mjs tests/doctor.test.mjs
git commit -m "feat: ff doctor kiểm repo, nhánh, lệnh, secrets, nguồn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Port guard sang config (luật cũ)

**Files:**
- Create: `scripts/lib/paths.mjs`, `scripts/lib/guard-rules.mjs`, `scripts/guard.mjs`
- Modify: `scripts/build.mjs` (thêm entry `guard`)
- Test: `tests/guard.test.mjs`, `tests/guard-cli.test.mjs`
- Nguồn đối chiếu: `~/Workspaces/tiniweb/scripts/ff/guard.mjs`, `~/Workspaces/tiniweb/scripts/ff/test-guard.sh`

**Interfaces:**
- Consumes: `findRoot`, `loadConfigOrDefaults`, `loadConfig` (Task 3); `tokenize`, `segments`, `stripHeredocs`, `stripPrefix` (Task 7).
- Produces (`scripts/lib/paths.mjs`): `realish(p): string` — realpath của tổ tiên gần nhất tồn tại + phần đuôi.
- Produces (`scripts/lib/guard-rules.mjs`): `EDIT_TOOLS: string[]`; `makeGuard(root, config): { root, evaluate({ cmd?, file?, tool?, cwd, mode?: 'base' | 'feature-flow', input? }): string | null, needsAsk(cmd): boolean }`. Task 11 thêm luật vào `evaluate`.
- Produces (CLI): `node dist/guard.mjs [--mode base|feature-flow] [--format agy] [--cmd …|--file … --tool …] [--cwd …]`, hoặc JSON hook ở stdin. Exit `2` + `[ff-guard] <lý do>` ở stderr khi chặn; `--format agy` in JSON `decision`.

Ánh xạ từ guard cũ: `oe-hrm-fe`/`system-service` → `repos[].path` + `guard.protected_paths`; `worktrees/` → `workspace.worktrees_dir`; `e2e/tests` → `e2e.tests_dir`; regex migration → `guard.migration_script_re`/`forbidden_script_re`; `bash scripts/ff/ff.sh X` → `ff X`; `scripts/dev.sh stop` → `ff verify-down <id>`.

- [ ] **Step 1: Viết test luật (fail)**

`tests/guard.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeGuard } from '../scripts/lib/guard-rules.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

const WT = 'worktrees/999-guard-test'
const now = () => Math.floor(Date.now() / 1000)

function setup(t, mut = (c) => c) {
  const config = baseConfig()
  config.repos = [
    { name: 'api', path: 'api', base_branch: 'dev', commands: { build: 'node -v' } },
    { name: 'web', path: 'web', base_branch: 'dev', commands: { build: 'node -v' } },
  ]
  config.e2e = { dir: 'e2e', tests_dir: 'e2e/tests' }
  const ws = makeWorkspace({ config: mut(config), gitRepos: false })
  t.after(ws.cleanup)
  for (const d of ['e2e/tests', `${WT}/api`]) fs.mkdirSync(path.join(ws.root, d), { recursive: true })
  const G = makeGuard(ws.root, loadConfig(ws.root).config)
  const at = (rel) => path.join(ws.root, rel)
  const check = (want, mode, cwd, cmd) => {
    const r = G.evaluate({ cmd, cwd: at(cwd), mode })
    assert.equal(r === null ? 0 : 2, want, `[${mode}] (${cwd}) ${cmd} → ${r}`)
  }
  const checkFile = (want, mode, tool, cwd, file) => {
    const r = G.evaluate({ file, tool, cwd: at(cwd), mode })
    assert.equal(r === null ? 0 : 2, want, `[${mode} ${tool}] ${file} → ${r}`)
  }
  return { root: ws.root, at, G, check, checkFile }
}

test('push chỉ qua khi có marker ship còn hạn', (t) => {
  const { at, check } = setup(t)
  check(2, 'base', 'api', 'git push origin prod')
  check(2, 'base', WT, 'cd api && git push -u origin feature/x')
  fs.writeFileSync(at(`${WT}/.ff-ship-approved`), `${now()}\n`)
  check(0, 'base', WT, 'cd api && git push -u origin feature/x')
  check(0, 'base', '.', `git -C ${WT}/api push origin dev`)
  fs.writeFileSync(at(`${WT}/.ff-ship-approved`), `${now() - 3 * 3600}\n`)
  check(2, 'base', WT, 'cd api && git push origin dev')
  fs.rmSync(at(`${WT}/.ff-ship-approved`))
  check(2, 'base', 'api', 'FF_ALLOW_PUSH=1 git push origin feature/x')
  check(2, 'base', 'api', 'echo FF_ALLOW_PUSH=1; git push origin feature/x')
})

test('add / commit / stash', (t) => {
  const { check } = setup(t)
  const d = `${WT}/api`
  check(2, 'base', d, 'git add -A')
  check(2, 'base', d, 'git add .')
  check(2, 'base', d, 'git add -u')
  check(0, 'base', d, 'git add src/a.ts ./src/b.ts')
  check(2, 'base', d, "git commit -am 'x'")
  check(0, 'base', d, "git commit -m 'add all the things'")
  check(2, 'base', d, 'git stash')
  check(2, 'base', d, 'git stash push -m wip')
  check(0, 'base', d, 'git stash list')
})

test('kill', (t) => {
  const { check } = setup(t)
  check(2, 'base', WT, 'kill 1234')
  check(2, 'base', WT, 'lsof -ti:3001 | xargs kill -9')
  check(2, 'base', WT, 'pkill -f vite')
  check(0, 'base', WT, 'kill -0 1234')
  check(0, 'base', WT, 'ff verify-down 999')
})

test('migration chỉ trong worktree, :prod cấm hẳn', (t) => {
  const { check } = setup(t)
  check(2, 'base', 'api', 'yarn migration:run')
  check(0, 'base', `${WT}/api`, 'yarn migration:run')
  check(0, 'base', '.', `cd ${WT}/api && yarn migration:run`)
  check(2, 'base', `${WT}/api`, 'yarn migration:run:prod')
  check(0, 'base', 'api', 'yarn migration:show')
  check(2, 'base', 'api', 'yarn run migration:run')
})

test('migration theo regex cấu hình', (t) => {
  const { check } = setup(t, (c) => ({ ...c, guard: { migration_script_re: '^db:migrate$' } }))
  check(2, 'base', 'api', 'npm run db:migrate')
  check(0, 'base', 'api', 'yarn migration:run')
})

test('playwright phải kèm path thẻ', (t) => {
  const { check } = setup(t)
  check(2, 'base', 'e2e', 'npx playwright test')
  check(2, 'base', 'e2e', 'yarn test')
  check(0, 'base', 'e2e', 'npx playwright test tests/123-abc/')
  check(0, 'base', '.', 'cd e2e && npx playwright test tests/123-abc/x.spec.ts')
  check(0, 'base', 'web/apps/crm', 'yarn test')
})

test('heredoc và chuỗi chỉ là dữ liệu', (t) => {
  const { check } = setup(t)
  check(0, 'base', '.', "python3 - <<'EOF'\ns = 'yarn migration:revert và git push origin dev, git stash'\nEOF")
  check(0, 'base', '.', "grep -n 'migration:run' docs/x.md")
  check(2, 'base', '.', 'cat <<EOF > /tmp/x\nhi\nEOF\ngit stash')
  check(0, 'base', 'api', 'git status -sb && git log --oneline -3')
  check(0, 'base', 'api', 'git checkout dev && git pull')
})

test('lệnh bọc', (t) => {
  const { check } = setup(t)
  check(2, 'base', WT, 'bash -c "git push origin dev"')
  check(2, 'base', WT, "sh -c 'git stash'")
  check(2, 'base', WT, 'eval "git add -A"')
  check(2, 'base', WT, 'echo $(git push origin x)')
  check(2, 'base', WT, 'echo `pkill node`')
  check(2, 'base', '.', 'bash -c "yarn migration:run"')
  check(2, 'base', `${WT}/api`, 'bash -c "yarn migration:run:prod"')
  check(0, 'base', WT, "T=$(git log -1 --format=%B origin/$B | grep -m1 '^Trello: #')")
  check(0, 'base', WT, 'M=$(git rev-parse HEAD)')
  check(0, 'base', WT, 'bash -c "echo hello"')
  check(0, 'base', WT, 'echo $(git add ./src/a.ts)')
})

test('feature-flow: repo gốc là bản gương', (t) => {
  const { check, checkFile } = setup(t)
  check(2, 'feature-flow', 'api', 'git commit -m x')
  check(2, 'feature-flow', '.', 'git -C web checkout -b feature/x')
  check(0, 'feature-flow', 'api', 'git checkout dev && git pull')
  check(0, 'feature-flow', `${WT}/api`, 'git commit -m x')
  check(0, 'feature-flow', 'api', 'git push origin x')
  checkFile(2, 'feature-flow', 'Edit', '.', 'web/apps/recruit/src/a.tsx')
  checkFile(2, 'feature-flow', 'Write', 'api', 'src/x.ts')
  checkFile(0, 'feature-flow', 'Edit', '.', `${WT}/api/src/x.ts`)
  checkFile(0, 'feature-flow', 'Edit', '.', 'web/CLAUDE.md')
  checkFile(0, 'feature-flow', 'Edit', '.', 'trellocards/123-x/02-spec.md')
  checkFile(0, 'feature-flow', 'Read', '.', 'web/apps/recruit/src/a.tsx')
})

test('protected_paths và allowed_bash', (t) => {
  const { check, checkFile } = setup(t, (c) => ({ ...c, guard: { protected_paths: ['shared'], allowed_bash: ['^git push origin docs$'] } }))
  checkFile(2, 'feature-flow', 'Edit', '.', 'shared/a.ts')
  check(0, 'base', 'api', 'git push origin docs')
  check(2, 'base', 'api', 'git push origin dev')
})

test('khóa test', (t) => {
  const { at, check, checkFile } = setup(t)
  const slug = '990-lock-test'
  const rel = `e2e/tests/${slug}/task-1-a.spec.ts`
  fs.mkdirSync(at(`worktrees/${slug}`), { recursive: true })
  fs.mkdirSync(at(`e2e/tests/${slug}`), { recursive: true })
  fs.writeFileSync(at(rel), 'x')
  fs.writeFileSync(at(`e2e/tests/${slug}/task-1-b.spec.ts`), 'y')
  fs.writeFileSync(at(`worktrees/${slug}/.ff-test-lock`), `${'0'.repeat(64)}  ${rel}\n`)
  checkFile(2, 'base', 'Edit', '.', rel)
  checkFile(2, 'base', 'Write', '.', at(rel))
  checkFile(2, 'feature-flow', 'Edit', '.', rel)
  checkFile(2, 'base', 'MultiEdit', 'e2e', `tests/${slug}/task-1-a.spec.ts`)
  checkFile(0, 'base', 'Read', '.', rel)
  checkFile(0, 'base', 'Edit', '.', `e2e/tests/${slug}/task-1-b.spec.ts`)
  check(2, 'base', '.', `sed -i '' 's/x/y/' ${rel}`)
  check(2, 'base', 'e2e', `echo hi >> tests/${slug}/task-1-a.spec.ts`)
  check(2, 'base', '.', `rm ${rel}`)
  check(2, 'base', '.', `chmod u+w ${rel}`)
  check(2, 'base', '.', `cp /tmp/a ${rel}`)
  check(0, 'base', '.', `cat ${rel}`)
  check(0, 'base', '.', `cat ${rel} 2>/dev/null | head -3`)
  check(0, 'base', '.', `sed -i '' 's/x/y/' e2e/tests/${slug}/task-1-b.spec.ts`)
  check(0, 'base', '.', 'ff relock 990 --reason x')
  check(0, 'base', '.', 'ff lock-tests 990')
})

test('allowlist đợt', (t) => {
  const { at, checkFile } = setup(t)
  const slug = '990-allow-test'
  fs.mkdirSync(at(`worktrees/${slug}/web/src`), { recursive: true })
  const allow = (ts) => fs.writeFileSync(at(`worktrees/${slug}/.ff-allow`), `ts=${ts}\nweb/src/a.ts\nweb/src/b.ts\n`)
  allow(now())
  checkFile(0, 'base', 'Edit', '.', `worktrees/${slug}/web/src/a.ts`)
  checkFile(0, 'feature-flow', 'Write', '.', at(`worktrees/${slug}/web/src/b.ts`))
  checkFile(2, 'base', 'Edit', '.', `worktrees/${slug}/web/src/c.ts`)
  checkFile(2, 'base', 'MultiEdit', `worktrees/${slug}/web`, 'src/c.ts')
  checkFile(0, 'base', 'Read', '.', `worktrees/${slug}/web/src/c.ts`)
  checkFile(0, 'base', 'Edit', '.', `trellocards/${slug}/04-plan.md`)
  checkFile(0, 'base', 'Write', '.', `${WT}/api/src/x.ts`)
  allow(now() - 5 * 3600)
  checkFile(0, 'base', 'Edit', '.', `worktrees/${slug}/web/src/c.ts`)
  fs.rmSync(at(`worktrees/${slug}/.ff-allow`))
  checkFile(0, 'base', 'Edit', '.', `worktrees/${slug}/web/src/c.ts`)
})

test('guard qua đường dẫn symlink', (t) => {
  const { root, G } = setup(t)
  const link = root + '-link'
  fs.symlinkSync(root, link)
  t.after(() => fs.unlinkSync(link))
  assert.notEqual(G.evaluate({ cmd: 'git commit -m x', cwd: path.join(link, 'api'), mode: 'feature-flow' }), null)
  assert.notEqual(G.evaluate({ file: path.join(link, 'web/src/a.ts'), tool: 'Edit', cwd: link, mode: 'feature-flow' }), null)
  assert.equal(G.evaluate({ cmd: 'git commit -m x', cwd: path.join(link, WT, 'api'), mode: 'feature-flow' }), null)
})
```

Run: `npm test`
Expected: FAIL — không tìm thấy `scripts/lib/guard-rules.mjs`.

- [ ] **Step 2: Viết `scripts/lib/paths.mjs`**

```js
import fs from 'node:fs'
import path from 'node:path'

// realpath của tổ tiên gần nhất còn tồn tại, nối phần đuôi chưa tồn tại (file sắp tạo).
export function realish(p) {
  const tail = []
  let cur = path.resolve(p)
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail)
    } catch {}
    const up = path.dirname(cur)
    if (up === cur) return path.resolve(p)
    tail.unshift(path.basename(cur))
    cur = up
  }
}
```

- [ ] **Step 3: Viết `scripts/lib/guard-rules.mjs`**

```js
// Luật chặn dùng chung cho Claude Code, OpenCode, agy. Đọc repo/worktree/e2e từ ff.config.yaml.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { tokenize, stripHeredocs, segments, stripPrefix } from './shell.mjs'
import { realish } from './paths.mjs'

const SHIP_MARKER_TTL_S = 2 * 60 * 60
const ALLOW_TTL_S = 4 * 60 * 60
export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write', 'patch', 'multiedit', 'replace_file_content', 'multi_replace_file_content', 'write_to_file']
const WRITE_VERB_RE = /\bsed\s+(?:-\w*i|--in-place)|\bperl\s+-\w*i|\btee\b|\bcp\b|\bmv\b|\brm\b|\bchmod\b|\bchflags\b|\btruncate\b/
const WRAPPER_RE = /\b(?:ba|z)?sh\s+-\w*c\b|\beval\b|\$\(|`|\bxargs\b/
const FF_EXEMPT_RE = /(?:^|[\s/])ff\s+(?:relock|lock-tests)\b/
const FF_ASK_RE = /(?:^|[\s/])ff\s+(?:ship-approve|relock)\b/

const under = (p, dir) => (p + path.sep).startsWith(dir + path.sep)
const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p)
const unanchor = (s) => s.replace(/^\^/, '').replace(/\$$/, '')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function makeGuard(rootIn, config) {
  const root = realish(rootIn)
  const g = config.guard
  const relWt = config.workspace.worktrees_dir
  const worktrees = path.resolve(root, relWt)
  const repoRoots = [...config.repos.map((r) => r.path), ...(g.protected_paths ?? [])].map((p) => path.resolve(root, p))
  const e2eDir = config.e2e?.dir ? path.resolve(root, config.e2e.dir) : null
  const e2eTests = config.e2e?.tests_dir ? path.resolve(root, config.e2e.tests_dir) : null
  const testsRel = e2eDir && e2eTests ? path.relative(e2eDir, e2eTests).split(path.sep).join('/') : null
  const migRe = new RegExp(g.migration_script_re)
  const prodRe = new RegExp(g.forbidden_script_re)
  const allowedBash = (g.allowed_bash ?? []).map((s) => new RegExp(s))
  const forbiddenRes = [
    /\bgit\s+(?:-C\s+\S+\s+)?push\b/,
    /\bgit\s+(?:-C\s+\S+\s+)?stash\b/,
    /\bgit\s+(?:-C\s+\S+\s+)?add\s+(?:-A|--all|\.)(?=\s|$|["'`)])/,
    /\bcommit\s+(?:-a\w*|--all)(?=\s|$|["'`)])/,
    /(?:^|[\s;&|`("'])(?:kill|pkill|killall)(?=\s|$|["'`)])/,
    new RegExp(unanchor(g.migration_script_re)),
    new RegExp(unanchor(g.forbidden_script_re) + '\\b'),
  ]

  const resolveDir = (base, p) => realish(path.resolve(base, expandHome(p)))
  const inRootRepo = (p) => repoRoots.some((r) => under(p, r))
  const inWorktree = (p) => under(p, worktrees)
  const slugOf = (p) => {
    if (inWorktree(p)) return path.relative(worktrees, p).split(path.sep)[0] || null
    if (e2eTests && under(p, e2eTests)) {
      const parts = path.relative(e2eTests, p).split(path.sep)
      return parts.length > 1 && /^[A-Za-z0-9]+-.+$/.test(parts[0]) ? parts[0] : null
    }
    return null
  }
  const idOf = (slug) => (slug ? slug.split('-')[0] : '<id>')
  const isEdit = (tool) => !tool || EDIT_TOOLS.includes(tool)

  const lockedOf = (slug) => {
    try {
      return fs.readFileSync(path.join(worktrees, slug, '.ff-test-lock'), 'utf8').split('\n')
        .map((l) => l.match(/^[0-9a-f]{64}\s{2}(.+)$/)).filter(Boolean).map((m) => path.join(root, m[1]))
    } catch {
      return []
    }
  }
  const allLocked = () => {
    let slugs = []
    try { slugs = fs.readdirSync(worktrees) } catch {}
    return slugs.flatMap(lockedOf)
  }
  const lockMsg = (slug) => `file test đã khóa; đổi qua: ff relock ${idOf(slug)} --reason "…" (cần user cho phép)`

  function checkLockedFile(tool, abs) {
    if (!isEdit(tool)) return null
    const slug = slugOf(abs)
    if (!slug) return null
    return lockedOf(slug).includes(abs) ? lockMsg(slug) : null
  }

  function checkAllowlist(tool, abs) {
    if (!isEdit(tool) || !inWorktree(abs)) return null
    const slug = slugOf(abs)
    if (!slug) return null
    let lines
    try { lines = fs.readFileSync(path.join(worktrees, slug, '.ff-allow'), 'utf8').split('\n') } catch { return null }
    const ts = Number((lines[0] ?? '').match(/^ts=(\d+)$/)?.[1])
    if (!Number.isFinite(ts) || Date.now() / 1000 - ts > ALLOW_TTL_S) return null
    const rel = path.relative(path.join(worktrees, slug), abs).split(path.sep).join('/')
    if (lines.slice(1).map((l) => l.trim()).filter(Boolean).includes(rel)) return null
    return `file ngoài allowlist của đợt; thêm qua: ff allow ${idOf(slug)} <file>`
  }

  function checkLockedBash(cmd, cwd) {
    const locked = allLocked()
    if (!locked.length) return null
    for (const seg of segments(cmd)) {
      if (FF_EXEMPT_RE.test(seg)) continue
      const hits = locked.filter((l) => seg.includes(l) || seg.includes(path.relative(root, l)) || seg.includes(path.basename(l)))
      if (!hits.length) continue
      const redirects = [...seg.matchAll(/(?<![\d&=-])>>?\s*(\S+)/g)].map((m) => m[1].replace(/^['"]|['"]$/g, ''))
      const redirHit = redirects.some((t) => hits.some((l) => realish(path.resolve(cwd, t)) === l || path.basename(t) === path.basename(l)))
      if (redirHit || WRITE_VERB_RE.test(seg)) return lockMsg(slugOf(hits[0]))
    }
    return null
  }

  function parseGit(tokens, dir) {
    let gitDir = dir
    let i = 1
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (tokens[i] === '-C') gitDir = resolveDir(gitDir, tokens[++i] ?? '.')
      else if (tokens[i] === '-c') i++
      i++
    }
    return { sub: tokens[i], args: tokens.slice(i + 1), gitDir }
  }

  function shipApproved(dir) {
    const slug = slugOf(dir)
    if (!slug || !inWorktree(dir)) return { ok: false, why: `lệnh không chạy trong ${relWt}/<id>-<slug>/` }
    const marker = path.join(worktrees, slug, '.ff-ship-approved')
    if (!fs.existsSync(marker)) return { ok: false, why: `chưa có ${path.relative(root, marker)}`, slug }
    const ts = Number(fs.readFileSync(marker, 'utf8').trim().split(/\s+/)[0])
    const age = Date.now() / 1000 - ts
    if (!Number.isFinite(age) || age > SHIP_MARKER_TTL_S) return { ok: false, why: 'marker ship đã quá 2 giờ', slug }
    return { ok: true }
  }

  function checkWrapped(cmd) {
    const body = stripHeredocs(cmd)
    if (!WRAPPER_RE.test(body)) return null
    if (!forbiddenRes.some((re) => re.test(body))) return null
    return 'chạy lệnh trực tiếp, không bọc trong bash -c/eval/$(…)'
  }

  function checkBash(cmd, cwd, mode) {
    const wrapped = checkWrapped(cmd)
    if (wrapped) return wrapped
    let dir = cwd
    for (const seg of segments(cmd)) {
      const tokens = stripPrefix(tokenize(seg))
      if (!tokens.length) continue
      const [head] = tokens
      if (head === 'cd') {
        dir = resolveDir(dir, tokens[1] ?? os.homedir())
        continue
      }
      if (allowedBash.some((re) => re.test(seg))) continue

      if (mode === 'base') {
        const killAt = tokens.findIndex((t, i) => ['kill', 'pkill', 'killall'].includes(t) && (i === 0 || tokens[0] === 'xargs'))
        if (killAt >= 0 && !(tokens[killAt] === 'kill' && tokens[killAt + 1] === '-0'))
          return 'Không kill/pkill trực tiếp. Tắt service bằng `ff verify-down <id>`; tiến trình của repo gốc/task khác → báo user.'

        const runsScript = ['yarn', 'npm', 'npx', 'pnpm', 'typeorm', 'ts-node'].includes(head)
        const migTok = runsScript && tokens.find((t) => migRe.test(t.replace(prodRe, '')))
        if (migTok) {
          if (prodRe.test(migTok)) return `Cấm chạy ${migTok} từ agent.`
          const cwdFlag = tokens.indexOf('--cwd')
          const target = cwdFlag >= 0 ? resolveDir(dir, tokens[cwdFlag + 1] ?? '.') : dir
          if (!inWorktree(target))
            return `${migTok} chỉ được chạy trong ${relWt}/<id>-<slug>/<repo> (DB dùng chung). Dùng \`ff verify-up <id> <app>\`.`
        }

        if (e2eDir && testsRel) {
          const pwAt = tokens.findIndex((t, i) => /(^|\/)playwright$/.test(t) && tokens[i + 1] === 'test')
          const bareTest = dir === e2eDir && ['yarn', 'npm', 'pnpm'].includes(head) && (tokens[1] === 'test' || (tokens[1] === 'run' && tokens[2] === 'test'))
          if (pwAt >= 0 || bareTest) {
            const rest = pwAt >= 0 ? tokens.slice(pwAt + 2) : tokens.slice(2)
            const pathRe = new RegExp(`(^|/)${escapeRe(testsRel)}/[^/\\s]+`)
            if (!rest.some((t) => pathRe.test(t)))
              return `Chạy Playwright phải kèm path: \`npx playwright test ${testsRel}/<id>-<slug>/\`. Lệnh trần quét cả thẻ cũ và fail trên dữ liệu cũ.`
          }
        }
      }

      if (head !== 'git') continue
      const { sub, args, gitDir } = parseGit(tokens, dir)

      if (mode === 'base') {
        if (sub === 'push') {
          const s = shipApproved(gitDir)
          if (!s.ok)
            return `Cấm git push (${s.why}). Chỉ push qua /ship-to-dev SAU KHI user xác nhận, rồi chạy \`ff ship-approve ${s.slug ? idOf(s.slug) : '<id>'}\` (user sẽ được hỏi). "Chạy/ok/verify PASS" không phải lệnh push.`
        }
        if (sub === 'add' && args.some((t) => ['-A', '--all', '.', ':/', '-u', '--update'].includes(t)))
          return 'Cấm `git add -A/./-u` — chỉ add đúng từng file của task (tránh cuốn .env, file build, file task khác).'
        if (sub === 'commit' && args.some((t) => t === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(t)))
          return 'Cấm `git commit -a` — add đúng từng file của task rồi commit.'
        if (sub === 'stash' && !['list', 'show'].includes(args[0]))
          return 'Cấm `git stash` — stash ẩn việc dở của user. Cây bẩn thì dừng và báo user.'
      }

      if (mode === 'feature-flow' && inRootRepo(gitDir) && !inWorktree(gitDir)) {
        const writes = ['commit', 'reset', 'rebase', 'merge', 'cherry-pick', 'am', 'apply', 'revert']
        const newBranch = (sub === 'checkout' && args.some((t) => t === '-b' || t === '-B')) || (sub === 'switch' && args.some((t) => t === '-c' || t === '-C'))
        if (writes.includes(sub) || newBranch)
          return `Repo gốc ${path.relative(root, gitDir) || '.'} chỉ là bản gương — không \`git ${sub}\` ở đây. Làm trong ${relWt}/<id>-<slug>/ (\`ff copy <id>\`).`
      }
    }
    return null
  }

  function checkMirrorFile(tool, abs) {
    if (!isEdit(tool)) return null
    if (!inRootRepo(abs) || inWorktree(abs)) return null
    if (['CLAUDE.md', 'AGENTS.md'].includes(path.basename(abs))) return null
    return `Repo gốc là bản gương — không sửa ${path.relative(root, abs)}. Sửa bản trong ${relWt}/<id>-<slug>/${path.relative(root, abs)}.`
  }

  function evaluate({ cmd, file, tool, cwd, mode = 'base', input = {} }) {
    const c = realish(cwd)
    const abs = file ? realish(path.resolve(c, expandHome(file))) : null
    let reason = null
    if (cmd) reason = checkLockedBash(cmd, c) ?? checkBash(cmd, c, mode)
    if (!reason && abs) reason = checkLockedFile(tool, abs) ?? checkAllowlist(tool, abs)
    if (!reason && mode === 'feature-flow' && abs) reason = checkMirrorFile(tool, abs)
    return reason
  }

  const needsAsk = (cmd) => segments(cmd).some((s) => FF_ASK_RE.test(s))

  return { root, evaluate, needsAsk }
}
```

- [ ] **Step 4: Chạy test luật**

Run: `node --test tests/guard.test.mjs`
Expected: PASS mọi test. Test fail → so ca đó với dòng tương ứng trong `test-guard.sh` cũ để xác định lỗi port.

- [ ] **Step 5: Viết test CLI (fail)**

`tests/guard-cli.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

const GUARD = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url))
const run = (args, input = '') => spawnSync('node', [GUARD, ...args], { input, encoding: 'utf8' })

function ws(t) {
  const config = baseConfig()
  config.repos = [{ name: 'api', path: 'api', base_branch: 'dev', commands: {} }]
  const w = makeWorkspace({ config, gitRepos: false })
  t.after(w.cleanup)
  return w.root
}

test('stdin kiểu Claude: git stash → exit 2', (t) => {
  const root = ws(t)
  const r = run([], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git stash' }, cwd: path.join(root, 'api') }))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^\[ff-guard\]/)
})

test('stdin kiểu Claude: Edit repo gốc ở feature-flow → exit 2', (t) => {
  const root = ws(t)
  const r = run(['--mode', 'feature-flow'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(root, 'api/src/a.ts') }, cwd: root }))
  assert.equal(r.status, 2)
})

test('kiểu agy: deny, cho qua, force_ask', (t) => {
  const root = ws(t)
  const cwd = path.join(root, 'api')
  const deny = run(['--format', 'agy'], JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'git add -A', Cwd: cwd } } }))
  assert.match(deny.stdout, /"decision":"deny"/)
  const allow = run(['--format', 'agy'], JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'git status', Cwd: cwd } } }))
  assert.equal(allow.stdout, '')
  const ask = run(['--format', 'agy'], JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'ff ship-approve 999', Cwd: root } } }))
  assert.match(ask.stdout, /"decision":"force_ask"/)
})

test('kiểu agy: write_to_file vào file test đã khóa → deny', (t) => {
  const root = ws(t)
  const rel = 'e2e/tests/991-agy/a.spec.ts'
  fs.mkdirSync(path.join(root, 'e2e/tests/991-agy'), { recursive: true })
  fs.mkdirSync(path.join(root, 'worktrees/991-agy'), { recursive: true })
  fs.writeFileSync(path.join(root, 'worktrees/991-agy/.ff-test-lock'), `${'0'.repeat(64)}  ${rel}\n`)
  const cfgPath = path.join(root, 'ff.config.yaml')
  fs.appendFileSync(cfgPath, 'e2e:\n  dir: e2e\n  tests_dir: e2e/tests\n')
  const r = run(['--format', 'agy'], JSON.stringify({ toolCall: { name: 'write_to_file', args: { TargetFile: path.join(root, rel) } }, cwd: root }))
  assert.match(r.stdout, /"decision":"deny"/)
})

test('kiểu OpenCode: shell git stash → exit 2', (t) => {
  const root = ws(t)
  const r = run([], JSON.stringify({ tool_name: 'shell', tool_input: { command: 'git stash', workdir: path.join(root, 'api') }, cwd: path.join(root, 'api') }))
  assert.equal(r.status, 2)
})

test('tham số --cmd/--cwd', (t) => {
  const root = ws(t)
  assert.equal(run(['--cwd', path.join(root, 'api'), '--cmd', 'git push origin dev']).status, 2)
  assert.equal(run(['--cwd', path.join(root, 'api'), '--cmd', 'git status']).status, 0)
})
```

Lưu ý ở test `write_to_file`: `ff.config.yaml` của fixture không có khóa `e2e`, nên `appendFileSync` thêm khối `e2e` hợp lệ ở cuối file.

Run: `node --test tests/guard-cli.test.mjs`
Expected: FAIL — không tìm thấy `scripts/guard.mjs`.

- [ ] **Step 6: Viết `scripts/guard.mjs`**

```js
#!/usr/bin/env node
// Hook PreToolUse. Vào: JSON hook ở stdin, hoặc --cmd/--file/--tool/--cwd. Ra: exit 0 cho qua; exit 2 + lý do ở stderr = chặn.
import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfigOrDefaults } from './lib/config.mjs'
import { makeGuard } from './lib/guard-rules.mjs'

function parseArgs(argv) {
  const a = { mode: 'base' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--cmd') a.cmd = argv[++i]
    else if (k === '--file') a.file = argv[++i]
    else if (k === '--tool') a.tool = argv[++i]
    else if (k === '--cwd') a.cwd = argv[++i]
    else if (k === '--mode') a.mode = argv[++i]
    else if (k === '--format') a.format = argv[++i]
  }
  return a
}

function readStdinJson() {
  if (process.stdin.isTTY) return null
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.length > 0)

function fromHookJson(j) {
  if (!j) return {}
  const tc = j.toolCall ?? {}
  const ti = j.tool_input ?? j.toolInput ?? tc.args ?? j.args ?? j.input ?? j.parameters ?? {}
  return {
    tool: pick(j.tool_name, j.toolName, tc.name, j.tool, j.name),
    cmd: pick(ti.command, ti.cmd, ti.CommandLine, j.command),
    file: pick(ti.file_path, ti.filePath, ti.notebook_path, ti.path, ti.target_file, ti.TargetFile, ti.AbsolutePath),
    cwd: pick(j.cwd, ti.cwd, ti.workdir, ti.Cwd),
    input: ti,
  }
}

const args = parseArgs(process.argv.slice(2))
const hook = fromHookJson(readStdinJson())
const cmd = args.cmd ?? hook.cmd
const file = args.file ?? hook.file
const tool = args.tool ?? hook.tool
const cwd = path.resolve(args.cwd ?? hook.cwd ?? process.cwd())
const root = findRoot(cwd) ?? (file ? findRoot(path.dirname(path.resolve(cwd, file))) : null)
if (!root) process.exit(0)

const G = makeGuard(root, loadConfigOrDefaults(root).config)
const reason = G.evaluate({ cmd, file, tool, cwd, mode: args.mode, input: hook.input ?? {} })

if (reason) {
  const msg = `[ff-guard] ${reason}`
  if (args.format === 'agy') {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: msg, allow_tool: false, deny_reason: msg }) + '\n')
    process.exit(0)
  }
  process.stderr.write(msg + '\n')
  process.exit(2)
}
if (args.format === 'agy' && cmd && G.needsAsk(cmd)) {
  process.stdout.write(JSON.stringify({ decision: 'force_ask', reason: '[ff-guard] cần user xác nhận trước khi chạy ship-approve/relock' }) + '\n')
}
process.exit(0)
```

- [ ] **Step 7: Thêm entry build**

Trong `scripts/build.mjs`, đổi `entryPoints` thành:

```js
const entryPoints = {
  cli: 'scripts/cli/main.mjs',
  guard: 'scripts/guard.mjs',
}
```

- [ ] **Step 8: Chạy toàn bộ test + build**

Run: `npm test && npm run build && echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"/"}' | node dist/guard.mjs; echo "exit=$?"`
Expected: test PASS; dòng cuối `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/paths.mjs scripts/lib/guard-rules.mjs scripts/guard.mjs scripts/build.mjs tests/guard.test.mjs tests/guard-cli.test.mjs dist
git commit -m "feat: port guard sang ff.config.yaml, giữ đủ ca kiểm cũ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Ledger dossier + `ff trace-check`

**Files:**
- Create: `scripts/lib/cards.mjs`, `scripts/lib/trace.mjs`, `scripts/cli/trace-check.mjs`
- Modify: `scripts/cli/main.mjs` (đăng ký `trace-check`)
- Test: `tests/trace.test.mjs`

**Interfaces:**
- Consumes: `findRoot`, `loadConfig`, `ConfigError` (Task 3).
- Produces (`scripts/lib/cards.mjs`): `CARD_ID_RE = /^[A-Za-z0-9]+$/`; `findCardDir(root, config, id): { dir: string } | { error: string }`.
- Produces (`scripts/lib/trace.mjs`): `parseTables(text): { header: string[], rows: { cells: string[], line: number }[], line: number }[]`; `parseLedger(text): { D: Map<code, { quote, where, note, line }>, U: Map<code, { question, answer, date, line }>, errors: string[] }`; `traceCheck(cardDir): { ok: boolean, errors: string[], counts: { D: number, U: number } }`.
- Produces (CLI): `ff trace-check <id> [--json]` — exit `0` xanh, `1` đỏ, `2` id sai/không thấy thẻ, `4` config chưa sẵn sàng.
- Quy ước file (Plan 4 viết skill theo đúng quy ước này):
  - Ledger `<thẻ>/01b-ledger.md`: dòng bảng có ô đầu `D-<số>` = `| D-xx | trích nguyên văn | vị trí | ghi chú |` (ghi chú bắt đầu `bỏ:` = loại khỏi yêu cầu phủ); ô đầu `U-<số>` = `| U-xx | câu hỏi | đáp án | ngày |`.
  - Artifact được kiểm: `brief.md`, `brief-chi-tiet.md`, `02-spec.md`, `03-design.md` ở thư mục thẻ và thư mục con (trừ thư mục bắt đầu bằng `.` và `observe`).
  - Bảng nào có cột tiêu đề `Nguồn` thì mọi dòng phải chứa ≥ 1 mã `D-xx`/`U-xx` có trong ledger.
  - Mục `## Ngoài phạm vi` (cấp 2–4) ở ledger hoặc artifact: mã `D-xx` nhắc trong mục này được coi là đã xử lý.

- [ ] **Step 1: Viết test (fail)**

`tests/trace.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { traceCheck, parseTables } from '../scripts/lib/trace.mjs'
import { findCardDir } from '../scripts/lib/cards.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

const CARD = 'trellocards/123-loc-ung-vien'
const DOSSIER = `# Thẻ 123: Lọc ứng viên
## Mô tả
Cho phép lọc ứng viên theo trạng thái.
## Checklist
- [ ] Thêm bộ lọc trạng thái ở màn danh sách ứng viên
- [ ] Giữ bộ lọc khi chuyển trang
## Comments
- 🔄 Sync từ sheet row 77
`
const LEDGER = `# Ledger thẻ 123
| Mã | Trích nguyên văn | Vị trí | Ghi chú |
|---|---|---|---|
| D-01 | Cho phép lọc ứng viên theo trạng thái. | Mô tả | |
| D-02 | Thêm bộ lọc trạng thái ở màn danh sách ứng viên | Checklist #1 | |
| D-03 | Giữ bộ lọc khi chuyển trang | Checklist #2 | |
| D-04 | 🔄 Sync từ sheet row 77 | Comment 1 | bỏ: bookkeeping |

| Mã | Câu hỏi | Đáp án | Ngày |
|---|---|---|---|
| U-01 | Lọc nhiều trạng thái cùng lúc? | Có | 2026-10-13 |
`
const BRIEF = `> Trạng thái: CHỜ DUYỆT
# Brief 123
| # | Mục | Nguồn |
|---|---|---|
| 1 | Bộ lọc trạng thái | D-01, D-02 |
| 2 | Chọn nhiều trạng thái | U-01 |

## Ngoài phạm vi
- D-03: để thẻ sau
`

function card(t, files = {}) {
  const base = { [`${CARD}/01-dossier.md`]: DOSSIER, [`${CARD}/01b-ledger.md`]: LEDGER, [`${CARD}/brief.md`]: BRIEF }
  const merged = { ...base, ...files }
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k]
  const ws = makeWorkspace({ files: merged })
  t.after(ws.cleanup)
  return { root: ws.root, dir: path.join(ws.root, CARD) }
}

test('bộ thẻ đúng → xanh', (t) => {
  const r = traceCheck(card(t).dir)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.counts, { D: 4, U: 1 })
})

test('D-xx không được phủ và không nằm Ngoài phạm vi → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/brief.md`]: BRIEF.replace('- D-03: để thẻ sau\n', '') }).dir)
  assert.match(r.errors.join('\n'), /D-03 chưa được dòng nào phủ/)
})

test('dòng bảng thiếu nguồn → đỏ kèm file:dòng', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/brief.md`]: BRIEF.replace('| U-01 |', '| |') }).dir)
  assert.match(r.errors.join('\n'), /brief\.md:6 dòng thiếu nguồn/)
})

test('mã không có trong ledger → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/brief.md`]: BRIEF.replace('U-01 |', 'D-09 |') }).dir)
  assert.match(r.errors.join('\n'), /D-09 không có trong ledger/)
})

test('trích ledger lệch nguyên văn dossier → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/01b-ledger.md`]: LEDGER.replace('màn danh sách ứng viên', 'màn ứng viên') }).dir)
  assert.match(r.errors.join('\n'), /D-02: trích không khớp nguyên văn/)
})

test('trace NFD/CRLF/BOM vẫn xanh', (t) => {
  const r = traceCheck(card(t, {
    [`${CARD}/01-dossier.md`]: DOSSIER.normalize('NFD').replace(/\n/g, '\r\n'),
    [`${CARD}/brief.md`]: '\uFEFF' + BRIEF.replace(/\n/g, '\r\n'),
  }).dir)
  assert.deepEqual(r.errors, [])
})

test('thiếu ledger → đỏ', (t) => {
  const r = traceCheck(card(t, { [`${CARD}/01b-ledger.md`]: null }).dir)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /thiếu 01b-ledger\.md/)
})

test('bảng không có cột Nguồn bị bỏ qua; ô có \\| vẫn khớp', (t) => {
  const r = traceCheck(card(t, {
    [`${CARD}/01-dossier.md`]: DOSSIER + 'Lọc theo A | B\n',
    [`${CARD}/01b-ledger.md`]: LEDGER.replace('| D-04 |', '| D-05 | Lọc theo A \\| B | Comment 2 | bỏ: trùng D-01 |\n| D-04 |'),
    [`${CARD}/brief.md`]: BRIEF + '\n| a | b |\n|---|---|\n| 1 | 2 |\n',
  }).dir)
  assert.deepEqual(r.errors, [])
})

test('design ở thư mục task con được tính', (t) => {
  const r = traceCheck(card(t, {
    [`${CARD}/brief.md`]: BRIEF.replace('- D-03: để thẻ sau\n', ''),
    [`${CARD}/task-1/03-design.md`]: '| Thành phần | Nguồn |\n|---|---|\n| Giữ filter qua URL | D-03 |\n',
  }).dir)
  assert.deepEqual(r.errors, [])
})

test('parseTables trả số dòng 1-based', () => {
  const [tb] = parseTables('x\n| a | b |\n|---|---|\n| 1 | 2 |\n')
  assert.deepEqual(tb.header, ['a', 'b'])
  assert.deepEqual(tb.rows, [{ cells: ['1', '2'], line: 4 }])
})

test('findCardDir: không thấy, trùng, id sai', (t) => {
  const { root } = card(t, { 'trellocards/123-khac/01-dossier.md': 'x' })
  const config = loadConfig(root).config
  assert.match(findCardDir(root, config, '999').error, /không thấy/)
  assert.match(findCardDir(root, config, '123').error, /nhiều thư mục/)
  assert.match(findCardDir(root, config, '1/2').error, /không hợp lệ/)
})

test('CLI: xanh exit 0, đỏ exit 1, không thấy thẻ exit 2', async (t) => {
  const { root } = card(t)
  const ok = capture(root)
  assert.equal(await main(['trace-check', '123'], ok.ctx), 0)
  assert.match(ok.buf.out, /trace-check: xanh/)
  fs.writeFileSync(path.join(root, CARD, 'brief.md'), BRIEF.replace('- D-03: để thẻ sau\n', ''))
  const red = capture(root)
  assert.equal(await main(['trace-check', '123'], red.ctx), 1)
  assert.match(red.buf.out, /D-03/)
  assert.equal(await main(['trace-check', '999'], capture(root).ctx), 2)
})
```

Run: `npm test`
Expected: FAIL — không tìm thấy `scripts/lib/trace.mjs`.

- [ ] **Step 2: Viết `scripts/lib/cards.mjs`**

```js
import fs from 'node:fs'
import path from 'node:path'

export const CARD_ID_RE = /^[A-Za-z0-9]+$/

export function findCardDir(root, config, id) {
  if (!CARD_ID_RE.test(String(id))) return { error: `id thẻ không hợp lệ: ${id}` }
  const base = path.resolve(root, config.workspace.cards_dir)
  let names = []
  try {
    names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {}
  const hits = names.filter((n) => n === id || n.startsWith(`${id}-`))
  if (!hits.length) return { error: `không thấy thư mục ${config.workspace.cards_dir}/${id}-*` }
  if (hits.length > 1) return { error: `nhiều thư mục khớp thẻ ${id}: ${hits.join(', ')}` }
  return { dir: path.join(base, hits[0]) }
}
```

- [ ] **Step 3: Viết `scripts/lib/trace.mjs`**

```js
// Truy vết xác định: mọi dòng có cột Nguồn trỏ về D-xx/U-xx; mọi D-xx được phủ hoặc nằm Ngoài phạm vi.
import fs from 'node:fs'
import path from 'node:path'

const CODE_RE = /\b([DU]-\d+)\b/g
const ARTIFACTS = new Set(['brief.md', 'brief-chi-tiet.md', '02-spec.md', '03-design.md'])
const norm = (s) => s.replace(/^\uFEFF/, '').normalize('NFC')
const squash = (s) => norm(s).replace(/\\\|/g, '|').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()

function splitRow(line) {
  const parts = line.trim().split(/(?<!\\)\|/)
  if (parts[0].trim() === '') parts.shift()
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop()
  return parts.map((c) => c.trim())
}

export function parseTables(text) {
  const lines = norm(text).split(/\r?\n/)
  const tables = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue
    const rows = []
    let j = i + 2
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push({ cells: splitRow(lines[j]), line: j + 1 })
    tables.push({ header: splitRow(lines[i]), rows, line: i + 1 })
    i = j - 1
  }
  return tables
}

export function outOfScopeCodes(text) {
  const codes = []
  let inside = false
  for (const line of norm(text).split(/\r?\n/)) {
    if (/^#{1,4}\s/.test(line)) inside = /^#{2,4}\s*Ngoài phạm vi/i.test(line)
    else if (inside) codes.push(...[...line.matchAll(CODE_RE)].map((m) => m[1]).filter((c) => c.startsWith('D-')))
  }
  return codes
}

export function parseLedger(text) {
  const D = new Map()
  const U = new Map()
  const errors = []
  for (const tb of parseTables(text)) {
    for (const r of tb.rows) {
      const code = r.cells[0] ?? ''
      if (!/^[DU]-\d+$/.test(code)) continue
      const map = code.startsWith('D') ? D : U
      if (map.has(code)) { errors.push(`01b-ledger.md:${r.line} ${code} bị trùng`); continue }
      if (code.startsWith('D')) map.set(code, { quote: r.cells[1] ?? '', where: r.cells[2] ?? '', note: r.cells[3] ?? '', line: r.line })
      else map.set(code, { question: r.cells[1] ?? '', answer: r.cells[2] ?? '', date: r.cells[3] ?? '', line: r.line })
    }
  }
  return { D, U, errors }
}

function listArtifacts(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'observe') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listArtifacts(p))
    else if (ARTIFACTS.has(e.name)) out.push(p)
  }
  return out
}

export function traceCheck(cardDir) {
  const errors = []
  const read = (f) => {
    try {
      return norm(fs.readFileSync(path.join(cardDir, f), 'utf8'))
    } catch {
      return null
    }
  }
  const dossier = read('01-dossier.md')
  const ledgerText = read('01b-ledger.md')
  if (dossier === null) errors.push('thiếu 01-dossier.md')
  if (ledgerText === null) {
    errors.push('thiếu 01b-ledger.md — lập ledger trước khi viết Brief')
    return { ok: false, errors, counts: { D: 0, U: 0 } }
  }
  const ledger = parseLedger(ledgerText)
  errors.push(...ledger.errors)
  if (dossier !== null) {
    const d = squash(dossier)
    for (const [code, e] of ledger.D) {
      if (!d.includes(squash(e.quote))) errors.push(`01b-ledger.md:${e.line} ${code}: trích không khớp nguyên văn trong 01-dossier.md`)
    }
  }
  const known = new Set([...ledger.D.keys(), ...ledger.U.keys()])
  const referenced = new Set()
  const outOfScope = new Set(outOfScopeCodes(ledgerText))
  for (const file of listArtifacts(cardDir)) {
    const rel = path.relative(cardDir, file).split(path.sep).join('/')
    const text = norm(fs.readFileSync(file, 'utf8'))
    for (const c of outOfScopeCodes(text)) outOfScope.add(c)
    for (const tb of parseTables(text)) {
      const col = tb.header.findIndex((h) => squash(h).toLowerCase() === 'nguồn')
      if (col < 0) continue
      for (const r of tb.rows) {
        const codes = [...(r.cells[col] ?? '').matchAll(CODE_RE)].map((m) => m[1])
        if (!codes.length) errors.push(`${rel}:${r.line} dòng thiếu nguồn (cần D-xx hoặc U-xx)`)
        for (const c of codes) {
          if (known.has(c)) referenced.add(c)
          else errors.push(`${rel}:${r.line} ${c} không có trong ledger`)
        }
      }
    }
  }
  for (const [code, e] of ledger.D) {
    if (e.note.startsWith('bỏ:') || referenced.has(code) || outOfScope.has(code)) continue
    errors.push(`${code} chưa được dòng nào phủ và không nằm trong "Ngoài phạm vi": "${e.quote}"`)
  }
  return { ok: errors.length === 0, errors, counts: { D: ledger.D.size, U: ledger.U.size } }
}
```

- [ ] **Step 4: Viết `scripts/cli/trace-check.mjs` và đăng ký**

```js
import { findRoot, loadConfig, ConfigError } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { traceCheck } from '../lib/trace.mjs'

export const summary = 'trace-check <id> [--json] — mọi dòng Brief/spec/design truy về câu dossier hoặc quyết định user'

export async function run(args, ctx) {
  const [id, ...flags] = args
  if (!id) {
    ctx.stderr.write('dùng: ff trace-check <id thẻ> [--json]\n')
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff: không thấy ff.config.yaml. Chạy /ff-init.\n')
    return 4
  }
  let config
  try {
    config = loadConfig(root).config
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e
    ctx.stderr.write(`ff: ${e.message}\n`)
    return 4
  }
  const card = findCardDir(root, config, id)
  if (card.error) {
    ctx.stderr.write(`ff: ${card.error}\n`)
    return 2
  }
  const r = traceCheck(card.dir)
  if (flags.includes('--json')) ctx.stdout.write(JSON.stringify(r) + '\n')
  else if (r.ok) ctx.stdout.write(`trace-check: xanh (${r.counts.D} mã D, ${r.counts.U} mã U)\n`)
  else ctx.stdout.write(`trace-check: ĐỎ (${r.errors.length} lỗi)\n${r.errors.map((e) => `- ${e}`).join('\n')}\n`)
  return r.ok ? 0 : 1
}
```

Trong `scripts/cli/main.mjs` thêm `import * as traceCheck from './trace-check.mjs'` và mục `'trace-check': traceCheck,` vào `COMMANDS`.

- [ ] **Step 5: Chạy test**

Run: `npm test`
Expected: PASS mọi test.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/cards.mjs scripts/lib/trace.mjs scripts/cli/trace-check.mjs scripts/cli/main.mjs tests/trace.test.mjs
git commit -m "feat: ledger dossier và ff trace-check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Ghi Gate từ `AskUserQuestion` + client `ff notify`

**Files:**
- Create: `scripts/lib/gates.mjs`, `scripts/lib/notify.mjs`, `scripts/cli/notify.mjs`
- Modify: `scripts/cli/main.mjs` (đăng ký `notify`)
- Test: `tests/gates.test.mjs`, `tests/notify.test.mjs`

**Interfaces:**
- Consumes: `ffDir` (Task 4); fixture `tests/fixtures/hooks/ask-post.json` (Task 1).
- Produces (`scripts/lib/gates.mjs`): `GATES`, `APPROVE_LABEL = 'Duyệt'`, `ARTIFACT_GATE = { 'brief.md': 'GATE_A', '03-design.md': 'GATE_B', '05-verify-report.md': 'GATE_C' }`, `GATE_TTL_MS = 86400000`; `gateQuestions(toolInput): { gate, cardId: string | null, question }[]`; `answerFor(toolResponse, question): string | null`; `recordGates(root, toolInput, toolResponse, now?: Date): GateRecord[]`; `isApproved(root, cardId, gate, nowMs?): boolean`. File: `.ff/gates/<cardId>-<gate>.json` = `{ gate, cardId, question, answer, approved, at }`.
- Produces (`scripts/lib/notify.mjs`): `KINDS = ['info','gate','ask','attention','error','done']`; `makeEvent({ kind, taskId?, title, fields?, body? }): NotifyEvent` (ném lỗi khi `kind` sai hoặc thiếu `title`); `notify(root, event, { timeoutMs = 1500, log }): Promise<{ delivered: boolean }>`.
- Hợp đồng HTTP (Plan 3 cài phía worker): đọc cổng từ `.ff/worker.json` `{ port }`; `POST http://127.0.0.1:<port>/notify`, body JSON `NotifyEvent`, worker trả `2xx`.
- Produces (CLI): `ff notify --kind <kind> --title <tiêu đề> [--task <id>] [--body <nội dung>]` — exit `0` kể cả khi worker không chạy; `2` khi sai tham số.

- [ ] **Step 1: Viết test gates (fail)**

`tests/gates.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateQuestions, answerFor, recordGates, isApproved } from '../scripts/lib/gates.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'

const fixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/hooks/ask-post.json', import.meta.url)), 'utf8'))
const Q = '[#123] Duyệt Brief?'
const input = { questions: [{ header: 'GATE_A', question: Q, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }], multiSelect: false }] }
const respWith = (answer) => ({ ...fixture.tool_response, answers: { [Q]: answer } })

test('fixture spike đọc được câu trả lời', () => {
  const q = fixture.tool_input.questions[0].question
  assert.equal(typeof answerFor(fixture.tool_response, q), 'string')
})

test('gateQuestions lọc header GATE_* và lấy id thẻ', () => {
  assert.deepEqual(gateQuestions(input), [{ gate: 'GATE_A', cardId: '123', question: Q }])
  assert.deepEqual(gateQuestions({ questions: [{ header: 'Khác', question: Q }] }), [])
  assert.equal(gateQuestions({ questions: [{ header: 'GATE_B', question: 'Duyệt design?' }] })[0].cardId, null)
})

test('Duyệt → approved; Cần sửa hoặc trả lời tự do → không', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  recordGates(ws.root, input, respWith('Duyệt'))
  assert.equal(isApproved(ws.root, '123', 'GATE_A'), true)
  const rec = JSON.parse(fs.readFileSync(path.join(ws.root, '.ff/gates/123-GATE_A.json'), 'utf8'))
  assert.equal(rec.answer, 'Duyệt')
  recordGates(ws.root, input, respWith('Cần sửa'))
  assert.equal(isApproved(ws.root, '123', 'GATE_A'), false)
  recordGates(ws.root, input, respWith('ok tùy bạn'))
  assert.equal(isApproved(ws.root, '123', 'GATE_A'), false)
})

test('Gate quá 24 giờ hết hiệu lực', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  recordGates(ws.root, input, respWith('Duyệt'), new Date(Date.now() - 25 * 3600 * 1000))
  assert.equal(isApproved(ws.root, '123', 'GATE_A'), false)
})

test('answerFor chịu được mảng và thiếu dữ liệu', () => {
  assert.equal(answerFor({ answers: [{ question: Q, answer: 'Duyệt' }] }, Q), 'Duyệt')
  assert.equal(answerFor(null, Q), null)
  assert.equal(answerFor({ answers: {} }, Q), null)
})
```

- [ ] **Step 2: Viết `scripts/lib/gates.mjs`**

Nếu Task 1 ghi nhận field câu trả lời khác `tool_response.answers`, sửa `answerFor` cho khớp fixture trước khi chạy test.

```js
// Ghi câu trả lời Gate từ hook PostToolUse(AskUserQuestion); guard đọc để cho/không cho ghi marker ĐÃ DUYỆT.
import fs from 'node:fs'
import path from 'node:path'
import { ffDir } from './state.mjs'

export const GATES = ['GATE_A', 'GATE_B', 'GATE_C']
export const APPROVE_LABEL = 'Duyệt'
export const ARTIFACT_GATE = { 'brief.md': 'GATE_A', '03-design.md': 'GATE_B', '05-verify-report.md': 'GATE_C' }
export const GATE_TTL_MS = 24 * 60 * 60 * 1000
const CARD_PREFIX_RE = /^\s*\[#([A-Za-z0-9]+)\]/

export function gateQuestions(toolInput) {
  const qs = Array.isArray(toolInput?.questions) ? toolInput.questions : []
  return qs
    .filter((q) => GATES.includes(q?.header))
    .map((q) => ({ gate: q.header, cardId: String(q.question ?? '').match(CARD_PREFIX_RE)?.[1] ?? null, question: q.question }))
}

export function answerFor(resp, question) {
  if (!resp) return null
  const a = resp.answers ?? resp
  if (Array.isArray(a)) {
    const hit = a.find((x) => x?.question === question)
    return hit ? String(hit.answer ?? hit.value ?? '') : null
  }
  if (a && typeof a === 'object' && Object.hasOwn(a, question)) {
    const v = a[question]
    return Array.isArray(v) ? v.join(', ') : String(v)
  }
  return null
}

const gateFile = (root, cardId, gate) => path.join(ffDir(root), 'gates', `${cardId}-${gate}.json`)

export function recordGates(root, toolInput, toolResponse, now = new Date()) {
  const out = []
  for (const g of gateQuestions(toolInput)) {
    if (!g.cardId) continue
    const answer = answerFor(toolResponse, g.question)
    const rec = {
      gate: g.gate,
      cardId: g.cardId,
      question: g.question,
      answer,
      approved: (answer ?? '').normalize('NFC').trim() === APPROVE_LABEL,
      at: now.toISOString(),
    }
    const f = gateFile(root, g.cardId, g.gate)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify(rec, null, 2) + '\n')
    out.push(rec)
  }
  return out
}

export function isApproved(root, cardId, gate, nowMs = Date.now()) {
  try {
    const r = JSON.parse(fs.readFileSync(gateFile(root, cardId, gate), 'utf8'))
    return r.approved === true && nowMs - Date.parse(r.at) <= GATE_TTL_MS
  } catch {
    return false
  }
}
```

Run: `node --test tests/gates.test.mjs`
Expected: PASS.

- [ ] **Step 3: Viết test notify (fail)**

`tests/notify.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { notify, makeEvent } from '../scripts/lib/notify.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

async function server(t, handler) {
  const s = http.createServer(handler)
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  t.after(() => { s.closeAllConnections(); s.close() })
  return s.address().port
}
const writePort = (root, port) => {
  fs.mkdirSync(path.join(root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ff/worker.json'), JSON.stringify({ port }))
}
const ws = (t) => { const w = makeWorkspace(); t.after(w.cleanup); return w.root }
const ev = makeEvent({ kind: 'gate', taskId: '123', title: 'GATE_A thẻ #123 chờ duyệt' })

test('makeEvent chặn kind sai và thiếu title', () => {
  assert.throws(() => makeEvent({ kind: 'x', title: 'a' }))
  assert.throws(() => makeEvent({ kind: 'info' }))
  assert.deepEqual(makeEvent({ kind: 'info', title: 'a' }), { kind: 'info', taskId: '', title: 'a', fields: {}, body: '' })
})

test('worker không chạy → delivered false, có log', async (t) => {
  const logs = []
  const r = await notify(ws(t), ev, { log: (s) => logs.push(s) })
  assert.equal(r.delivered, false)
  assert.match(logs.join(), /worker không chạy/)
})

test('worker nhận đúng body', async (t) => {
  const root = ws(t)
  let got
  const port = await server(t, (req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => { got = { url: req.url, method: req.method, body: JSON.parse(b) }; res.writeHead(204).end() })
  })
  writePort(root, port)
  assert.equal((await notify(root, ev, { log: () => {} })).delivered, true)
  assert.deepEqual(got, { url: '/notify', method: 'POST', body: ev })
})

test('worker trả 500 → delivered false', async (t) => {
  const root = ws(t)
  writePort(root, await server(t, (req, res) => res.writeHead(500).end()))
  assert.equal((await notify(root, ev, { log: () => {} })).delivered, false)
})

test('notify timeout: worker treo → trả trong thời hạn', async (t) => {
  const root = ws(t)
  writePort(root, await server(t, () => {}))
  const t0 = Date.now()
  const r = await notify(root, ev, { timeoutMs: 200, log: () => {} })
  assert.equal(r.delivered, false)
  assert.ok(Date.now() - t0 < 1500)
})

test('CLI: exit 0 khi worker không chạy, exit 2 khi sai tham số', async (t) => {
  const root = ws(t)
  assert.equal(await main(['notify', '--kind', 'info', '--title', 'xin chào'], capture(root).ctx), 0)
  assert.equal(await main(['notify', '--kind', 'sai', '--title', 'x'], capture(root).ctx), 2)
  assert.equal(await main(['notify', '--kind', 'info'], capture(root).ctx), 2)
})
```

Run: `node --test tests/notify.test.mjs`
Expected: FAIL — không tìm thấy `scripts/lib/notify.mjs`.

- [ ] **Step 4: Viết `scripts/lib/notify.mjs`**

```js
// Client thông báo 1 chiều tới worker. Không bao giờ ném lỗi ra ngoài; worker vắng thì bỏ qua.
import fs from 'node:fs'
import path from 'node:path'

export const KINDS = ['info', 'gate', 'ask', 'attention', 'error', 'done']

export function makeEvent({ kind, taskId = '', title, fields = {}, body = '' }) {
  if (!KINDS.includes(kind)) throw new Error(`kind phải là một trong: ${KINDS.join(', ')}`)
  if (!title) throw new Error('thiếu title')
  return { kind, taskId: String(taskId), title: String(title), fields, body: String(body) }
}

export async function notify(root, event, { timeoutMs = 1500, log = (s) => process.stderr.write(s) } = {}) {
  let port
  try {
    port = JSON.parse(fs.readFileSync(path.join(root, '.ff', 'worker.json'), 'utf8')).port
  } catch {}
  if (!port) {
    log(`[ff notify] worker không chạy — bỏ qua: ${event.kind} ${event.title}\n`)
    return { delivered: false }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { delivered: true }
  } catch (e) {
    log(`[ff notify] gửi lỗi (${e.message}) — bỏ qua\n`)
    return { delivered: false }
  }
}
```

- [ ] **Step 5: Viết `scripts/cli/notify.mjs` và đăng ký**

```js
import { findRoot } from '../lib/config.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'

export const summary = 'notify --kind <kind> --title <t> [--task <id>] [--body <b>] — gửi thông báo 1 chiều qua worker'

export async function run(args, ctx) {
  const opt = {}
  for (let i = 0; i < args.length; i++) {
    const m = /^--(kind|title|task|body)$/.exec(args[i])
    if (m) opt[m[1]] = args[++i]
  }
  let event
  try {
    event = makeEvent({ kind: opt.kind, title: opt.title, taskId: opt.task ?? '', body: opt.body ?? '' })
  } catch (e) {
    ctx.stderr.write(`ff notify: ${e.message}\n`)
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('[ff notify] không thấy ff.config.yaml — bỏ qua\n')
    return 0
  }
  const r = await notify(root, event, { log: (s) => ctx.stderr.write(s) })
  if (r.delivered) ctx.stdout.write('đã gửi\n')
  return 0
}
```

Trong `scripts/cli/main.mjs` thêm `import * as notifyCmd from './notify.mjs'` và mục `notify: notifyCmd,` vào `COMMANDS`.

- [ ] **Step 6: Chạy test**

Run: `npm test`
Expected: PASS mọi test.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/gates.mjs scripts/lib/notify.mjs scripts/cli/notify.mjs scripts/cli/main.mjs tests/gates.test.mjs tests/notify.test.mjs
git commit -m "feat: ghi Gate từ AskUserQuestion và client ff notify

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Guard — luật mới (`.ff.env`, marker `ĐÃ DUYỆT`, không làm gì ngoài workspace)

**Files:**
- Modify: `scripts/lib/guard-rules.mjs`
- Test: `tests/guard-new.test.mjs`

**Interfaces:**
- Consumes: `ARTIFACT_GATE`, `isApproved`, `recordGates` (Task 10); `makeGuard` (Task 8).
- Produces: `evaluate()` thêm 4 luật, chạy trước luật cũ:
  1. Bash có tham chiếu file secrets (`secrets.env_file`, so theo tên file, không khớp `.ff.env.example`) mà lệnh đầu đoạn không phải `ff` → chặn.
  2. Mọi tool có `file` trỏ đúng file secrets (Read, Grep, Edit, Write…) → chặn.
  3. Edit/Write làm **xuất hiện** dòng `> Trạng thái: ĐÃ DUYỆT` trong `brief.md`/`03-design.md`/`05-verify-report.md` dưới `cards_dir` mà chưa có Gate tương ứng được duyệt trong 24 giờ → chặn.
  4. Bash vừa chứa `ĐÃ DUYỆT` vừa ghi file (verb ghi hoặc redirect) → chặn (marker chỉ ghi bằng Edit/Write).

- [ ] **Step 1: Viết test (fail)**

`tests/guard-new.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeGuard } from '../scripts/lib/guard-rules.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { recordGates } from '../scripts/lib/gates.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

const GUARD = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url))
const CARD = 'trellocards/123-loc'
const MARK = '> Trạng thái: ĐÃ DUYỆT 2026-10-13\n# Brief\n'

function setup(t, mut = (c) => c) {
  const ws = makeWorkspace({ config: mut(baseConfig()), gitRepos: false, files: { [`${CARD}/brief.md`]: '> Trạng thái: CHỜ DUYỆT\n# Brief\n' } })
  t.after(ws.cleanup)
  const G = makeGuard(ws.root, loadConfig(ws.root).config)
  const ev = (o) => G.evaluate({ cwd: ws.root, mode: 'base', ...o })
  const approve = (gate, answer = 'Duyệt', at = new Date()) => {
    const q = `[#123] Duyệt ${gate}?`
    recordGates(ws.root, { questions: [{ header: gate, question: q }] }, { answers: { [q]: answer } }, at)
  }
  return { root: ws.root, ev, approve }
}

test('Bash chạm .ff.env bị chặn, ff và .ff.env.example được qua', (t) => {
  const { ev } = setup(t)
  for (const cmd of ['cat .ff.env', 'grep TOKEN .ff.env', 'source .ff.env', 'cat < .ff.env', 'cp .ff.env /tmp/x', 'base64 ./.ff.env', 'bash -c "cat .ff.env"', 'head -1 /abs/path/.ff.env'])
    assert.notEqual(ev({ cmd }), null, cmd)
  for (const cmd of ['ff doctor', 'cat .ff.env.example', 'echo ok', 'ls -la'])
    assert.equal(ev({ cmd }), null, cmd)
})

test('tool đọc/sửa file .ff.env bị chặn', (t) => {
  const { ev } = setup(t)
  assert.notEqual(ev({ file: '.ff.env', tool: 'Read' }), null)
  assert.notEqual(ev({ file: '.ff.env', tool: 'Grep' }), null)
  assert.notEqual(ev({ file: '.ff.env', tool: 'Edit' }), null)
  assert.equal(ev({ file: '.ff.env.example', tool: 'Read' }), null)
})

test('env_file tùy chỉnh', (t) => {
  const { ev } = setup(t, (c) => ({ ...c, secrets: { env_file: 'secrets/app.env' } }))
  assert.notEqual(ev({ cmd: 'cat secrets/app.env' }), null)
  assert.notEqual(ev({ file: 'secrets/app.env', tool: 'Read' }), null)
  assert.equal(ev({ cmd: 'cat .ff.env' }), null)
})

test('marker ĐÃ DUYỆT: chặn khi chưa có Gate, cho qua khi đã Duyệt', (t) => {
  const { ev, approve } = setup(t)
  const write = { file: `${CARD}/brief.md`, tool: 'Write', input: { content: MARK } }
  assert.match(ev(write), /GATE_A của thẻ #123/)
  approve('GATE_A', 'Cần sửa')
  assert.notEqual(ev(write), null)
  approve('GATE_A', 'Duyệt', new Date(Date.now() - 25 * 3600 * 1000))
  assert.notEqual(ev(write), null)
  approve('GATE_A')
  assert.equal(ev(write), null)
})

test('Edit thêm marker bị chặn; Edit giữ marker có sẵn thì qua', (t) => {
  const { ev } = setup(t)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'Edit', input: { old_string: '> Trạng thái: CHỜ DUYỆT', new_string: '> Trạng thái: ĐÃ DUYỆT 2026-10-13' } }), null)
  assert.equal(ev({ file: `${CARD}/brief.md`, tool: 'Edit', input: { old_string: '> Trạng thái: ĐÃ DUYỆT 2026-10-13\n# Brief', new_string: '> Trạng thái: ĐÃ DUYỆT 2026-10-13\n# Brief 123' } }), null)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'MultiEdit', input: { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'CHỜ DUYỆT', new_string: '\n> Trạng thái: ĐÃ DUYỆT' }] } }), null)
})

test('marker NFD vẫn bị nhận ra; GATE B TỰ QUA và file ngoài cards_dir không bị chặn', (t) => {
  const { ev } = setup(t)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'Write', input: { content: MARK.normalize('NFD') } }), null)
  assert.equal(ev({ file: `${CARD}/03-design.md`, tool: 'Write', input: { content: '> Trạng thái: GATE B TỰ QUA 2026-10-13\n' } }), null)
  assert.equal(ev({ file: 'docs/brief.md', tool: 'Write', input: { content: MARK } }), null)
})

test('Bash ghi marker bị chặn, Bash đọc marker được qua', (t) => {
  const { ev } = setup(t)
  assert.notEqual(ev({ cmd: `sed -i '' '1s/.*/> Trạng thái: ĐÃ DUYỆT/' ${CARD}/brief.md` }), null)
  assert.notEqual(ev({ cmd: `echo '> Trạng thái: ĐÃ DUYỆT' > ${CARD}/brief.md` }), null)
  assert.equal(ev({ cmd: `grep -c "ĐÃ DUYỆT" ${CARD}/brief.md 2>/dev/null` }), null)
})

test('guard no-op ngoài workspace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-none-'))
  const r = spawnSync('node', [GUARD, '--cwd', dir, '--cmd', 'git push origin dev && cat .ff.env'], { encoding: 'utf8' })
  fs.rmSync(dir, { recursive: true })
  assert.equal(r.status, 0)
  assert.equal(r.stdout + r.stderr, '')
})

test('config hỏng: vẫn chặn luật cơ bản và .ff.env', (t) => {
  const ws = makeWorkspace({ files: { 'ff.config.yaml': 'repos: [\n' }, gitRepos: false })
  t.after(ws.cleanup)
  const run = (cmd) => spawnSync('node', [GUARD, '--cwd', ws.root, '--cmd', cmd], { encoding: 'utf8' }).status
  assert.equal(run('git stash'), 2)
  assert.equal(run('cat .ff.env'), 2)
  assert.equal(run('git status'), 0)
})
```

Run: `node --test tests/guard-new.test.mjs`
Expected: FAIL ở các test `.ff.env` và marker (`guard no-op` và `config hỏng: git stash` có thể đã PASS từ Task 8).

- [ ] **Step 2: Sửa `scripts/lib/guard-rules.mjs`**

Thêm import đầu file:

```js
import { ARTIFACT_GATE, isApproved } from './gates.mjs'
```

Thêm hằng số dưới `FF_ASK_RE`:

```js
const MARKER_RE = /^\s*>\s*Trạng thái:\s*ĐÃ DUYỆT/m
const hasMarker = (s) => typeof s === 'string' && MARKER_RE.test(s.normalize('NFC'))
const REDIRECT_RE = /(?<![\d&=-])>>?\s*\S/
```

Trong `makeGuard`, ngay trước `function checkLockedFile`, thêm:

```js
  const cardsDir = path.resolve(root, config.workspace.cards_dir)
  const envName = config.secrets.env_file
  const envAbs = path.resolve(root, envName)
  const envRe = new RegExp(`(^|[\\s<>='"/])${escapeRe(path.basename(envName))}(?![\\w.-])`)
  const secretMsg = `Không đọc, sửa hay chép ${envName} (chứa secret). Cần biết key có hay chưa → \`ff doctor\`.`

  function checkSecretsBash(cmd) {
    for (const seg of segments(cmd)) {
      if (!envRe.test(seg)) continue
      const head = stripPrefix(tokenize(seg))[0] ?? ''
      if (head === 'ff' || head.endsWith('/ff')) continue
      return secretMsg
    }
    return null
  }

  const checkSecretsFile = (abs) => (abs === envAbs ? secretMsg : null)

  function introducesMarker(tool, input, abs) {
    if (['Write', 'write', 'write_to_file'].includes(tool)) {
      let old = ''
      try { old = fs.readFileSync(abs, 'utf8') } catch {}
      return hasMarker(input.content ?? input.CodeContent) && !hasMarker(old)
    }
    const edits = Array.isArray(input.edits) ? input.edits : [input]
    return edits.some((e) => hasMarker(e?.new_string ?? e?.newString ?? e?.ReplacementContent) && !hasMarker(e?.old_string ?? e?.oldString ?? e?.TargetContent))
  }

  function checkMarker(tool, input, abs) {
    if (!isEdit(tool) || !under(abs, cardsDir)) return null
    const gate = ARTIFACT_GATE[path.basename(abs)]
    if (!gate || !introducesMarker(tool, input, abs)) return null
    const cardId = path.relative(cardsDir, abs).split(path.sep)[0].split('-')[0]
    if (isApproved(root, cardId, gate)) return null
    return `Chưa có câu trả lời "Duyệt" cho ${gate} của thẻ #${cardId}. Trình Gate bằng AskUserQuestion (header ${gate}, câu hỏi bắt đầu "[#${cardId}]", lựa chọn "Duyệt"/"Cần sửa") rồi mới ghi marker ĐÃ DUYỆT.`
  }

  function checkMarkerBash(cmd) {
    const c = cmd.normalize('NFC')
    if (!c.includes('ĐÃ DUYỆT')) return null
    return WRITE_VERB_RE.test(c) || REDIRECT_RE.test(c) ? 'Ghi marker ĐÃ DUYỆT bằng Edit/Write (để hook kiểm Gate), không ghi bằng Bash.' : null
  }
```

Thay thân `evaluate` bằng:

```js
  function evaluate({ cmd, file, tool, cwd, mode = 'base', input = {} }) {
    const c = realish(cwd)
    const abs = file ? realish(path.resolve(c, expandHome(file))) : null
    let reason = null
    if (cmd) reason = checkSecretsBash(cmd) ?? checkMarkerBash(cmd) ?? checkLockedBash(cmd, c) ?? checkBash(cmd, c, mode)
    if (!reason && abs) reason = checkSecretsFile(abs) ?? checkMarker(tool, input ?? {}, abs) ?? checkLockedFile(tool, abs) ?? checkAllowlist(tool, abs)
    if (!reason && mode === 'feature-flow' && abs) reason = checkMirrorFile(tool, abs)
    return reason
  }
```

- [ ] **Step 3: Chạy test**

Run: `npm test`
Expected: PASS mọi test, kể cả `guard.test.mjs` cũ.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/guard-rules.mjs tests/guard-new.test.mjs
git commit -m "feat: guard chặn đọc .ff.env và marker ĐÃ DUYỆT chưa qua Gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Hooks, `hooks.json`, build `dist/`, chạy thử trong Claude Code

**Files:**
- Create: `scripts/lib/hook-io.mjs`, `scripts/hooks/session-start.mjs`, `scripts/hooks/ask-pre.mjs`, `scripts/hooks/ask-post.mjs`, `scripts/hooks/notification.mjs`, `hooks/hooks.json`
- Modify: `scripts/build.mjs` (thêm 4 entry hook)
- Test: `tests/hooks.test.mjs`

**Interfaces:**
- Consumes: `findRoot`, `loadConfig` (Task 3), `runDoctor` (Task 7), `writeDoctorState` (Task 4), `findCardDir`, `traceCheck` (Task 9), `gateQuestions`, `recordGates` (Task 10), `notify`, `makeEvent` (Task 10), fixture `tests/fixtures/hooks/ask-pre.json` (Task 1).
- Produces (`scripts/lib/hook-io.mjs`): `readHookInput(): object` (stdin JSON; `{}` khi TTY/rỗng/hỏng).
- Produces: 4 hook script, mỗi script thoát `0` và im lặng khi cwd không thuộc workspace ff.
  - `session-start`: chạy doctor, ghi `.ff/doctor.json`, in tóm tắt ra stdout (Claude Code đưa vào ngữ cảnh). Không bao giờ exit ≠ 0.
  - `ask-pre`: Gate thiếu `[#id]` → exit 2; `GATE_A`/`GATE_B` mà trace-check đỏ → exit 2 + danh sách lỗi; còn lại gửi `notify` (`gate` kèm lệnh `tmux attach -t <session_prefix><id>`, hoặc `ask`) rồi exit 0.
  - `ask-post`: `recordGates`.
  - `notification`: `notify(kind: attention)`.

- [ ] **Step 1: Viết test (fail)**

`tests/hooks.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeWorkspace } from './helpers/fixture.mjs'
import { doctorStatus } from '../scripts/lib/state.mjs'
import { isApproved } from '../scripts/lib/gates.mjs'

const HOOK = (n) => fileURLToPath(new URL(`../scripts/hooks/${n}.mjs`, import.meta.url))
const preFixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/hooks/ask-pre.json', import.meta.url)), 'utf8'))
const postFixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/hooks/ask-post.json', import.meta.url)), 'utf8'))
const ENV = { '.ff.env': 'TRELLO_API_KEY=a\nTRELLO_API_TOKEN=b\n' }
const CARD = 'trellocards/123-loc'
const CARD_FILES = {
  [`${CARD}/01-dossier.md`]: '# Thẻ 123\nCho phép lọc ứng viên.\n',
  [`${CARD}/01b-ledger.md`]: '| Mã | Trích | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Cho phép lọc ứng viên. | Mô tả | |\n',
  [`${CARD}/brief.md`]: '| # | Mục | Nguồn |\n|---|---|---|\n| 1 | Lọc | D-01 |\n',
}

function runHook(name, input) {
  return new Promise((resolve) => {
    const p = spawn('node', [HOOK(name)], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (c) => { out += c })
    p.stderr.on('data', (c) => { err += c })
    p.on('close', (status) => resolve({ status, out, err }))
    p.stdin.end(JSON.stringify(input))
  })
}
const askInput = (cwd, question, header) => ({ ...preFixture, cwd, tool_input: { questions: [{ header, question, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }], multiSelect: false }] } })

async function listen(t) {
  const got = []
  const s = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => { got.push(JSON.parse(b)); res.writeHead(204).end() })
  })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  t.after(() => { s.closeAllConnections(); s.close() })
  return { port: s.address().port, got }
}
function ws(t, files = {}) {
  const w = makeWorkspace({ files: { ...ENV, ...CARD_FILES, ...files } })
  t.after(w.cleanup)
  return w.root
}

test('hooks no-op ngoài workspace', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-none-'))
  for (const name of ['session-start', 'ask-pre', 'ask-post', 'notification']) {
    const r = await runHook(name, askInput(dir, '[#1] x', 'GATE_A'))
    assert.deepEqual([r.status, r.out, r.err], [0, '', ''], name)
  }
  fs.rmSync(dir, { recursive: true })
})

test('session-start: xanh và đỏ, luôn exit 0', async (t) => {
  const root = ws(t)
  const g = await runHook('session-start', { cwd: root })
  assert.equal(g.status, 0)
  assert.match(g.out, /ff doctor: xanh/)
  assert.equal(doctorStatus(root), 'green')
  fs.rmSync(path.join(root, '.ff.env'))
  const r = await runHook('session-start', { cwd: root })
  assert.equal(r.status, 0)
  assert.match(r.out, /ĐỎ/)
  assert.equal(doctorStatus(root), 'red')
})

test('ask-pre: Gate thiếu [#id] → exit 2', async (t) => {
  const r = await runHook('ask-pre', askInput(ws(t), 'Duyệt Brief?', 'GATE_A'))
  assert.equal(r.status, 2)
  assert.match(r.err, /\[#<id thẻ>\]/)
})

test('ask-pre: trace-check đỏ → exit 2 kèm lỗi', async (t) => {
  const root = ws(t, { [`${CARD}/brief.md`]: '# trống\n' })
  const r = await runHook('ask-pre', askInput(root, '[#123] Duyệt Brief?', 'GATE_A'))
  assert.equal(r.status, 2)
  assert.match(r.err, /D-01 chưa được dòng nào phủ/)
})

test('ask-pre: trace xanh → notify gate kèm lệnh attach', async (t) => {
  const root = ws(t)
  const { port, got } = await listen(t)
  fs.mkdirSync(path.join(root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ff/worker.json'), JSON.stringify({ port }))
  const r = await runHook('ask-pre', askInput(root, '[#123] Duyệt Brief?', 'GATE_A'))
  assert.equal(r.status, 0, r.err)
  assert.equal(got[0].kind, 'gate')
  assert.equal(got[0].taskId, '123')
  assert.match(got[0].body, /tmux attach -t ff-123/)
  await runHook('ask-pre', askInput(root, 'Chọn màu nút?', 'Màu'))
  assert.equal(got[1].kind, 'ask')
})

test('ask-pre: worker vắng → vẫn exit 0', async (t) => {
  const r = await runHook('ask-pre', askInput(ws(t), '[#123] Duyệt Brief?', 'GATE_A'))
  assert.equal(r.status, 0)
})

test('ask-post ghi Gate đã Duyệt', async (t) => {
  const root = ws(t)
  const q = '[#123] Duyệt Brief?'
  const input = { ...postFixture, cwd: root, tool_input: { questions: [{ header: 'GATE_A', question: q }] }, tool_response: { ...postFixture.tool_response, answers: { [q]: 'Duyệt' } } }
  const r = await runHook('ask-post', input)
  assert.equal(r.status, 0)
  assert.equal(isApproved(root, '123', 'GATE_A'), true)
})

test('notification gửi attention', async (t) => {
  const root = ws(t)
  const { port, got } = await listen(t)
  fs.mkdirSync(path.join(root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ff/worker.json'), JSON.stringify({ port }))
  await runHook('notification', { cwd: root, message: 'Claude cần quyền chạy lệnh' })
  assert.deepEqual([got[0].kind, got[0].title], ['attention', 'Claude cần quyền chạy lệnh'])
})
```

Nếu Task 1 ghi nhận field câu trả lời khác `tool_response.answers`, sửa dòng `tool_response: { ... answers: ... }` trong test `ask-post` cho khớp.

Run: `node --test tests/hooks.test.mjs`
Expected: FAIL — không tìm thấy `scripts/hooks/*.mjs`.

- [ ] **Step 2: Viết `scripts/lib/hook-io.mjs` và `scripts/hooks/session-start.mjs`**

```js
// scripts/lib/hook-io.mjs
import fs from 'node:fs'

export function readHookInput() {
  if (process.stdin.isTTY) return {}
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
```

```js
// scripts/hooks/session-start.mjs — chạy doctor đầu phiên; đỏ thì báo vào ngữ cảnh, `ff cfg get` sẽ từ chối.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { writeDoctorState } from '../lib/state.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)

let lines
try {
  const r = runDoctor(root, loadConfig(root))
  writeDoctorState(root, r.ok)
  lines = r.ok
    ? ['ff doctor: xanh.']
    : ['ff doctor: ĐỎ — `ff cfg get` sẽ từ chối tới khi sửa xong:', ...r.checks.filter((c) => !c.ok).map((c) => `- ${c.msg}`), 'Sửa bằng /ff-init, không sửa ff.config.yaml bằng tay.']
} catch (e) {
  writeDoctorState(root, false)
  lines = [`ff doctor: ĐỎ — ${e.message}`, 'Sửa bằng /ff-init.']
}
process.stdout.write(lines.join('\n') + '\n')
process.exit(0)
```

- [ ] **Step 3: Viết `scripts/hooks/ask-pre.mjs`**

Nếu Task 1 ghi nhận exit 2 không chặn được `AskUserQuestion`: trong 2 nhánh `process.exit(2)` dưới đây, đổi `process.stderr.write` thành `process.stdout.write` và `process.exit(2)` thành `process.exit(0)`, sửa 2 test tương ứng thành kiểm `r.out`.

```js
// scripts/hooks/ask-pre.mjs — PreToolUse(AskUserQuestion): chặn Gate sai quy ước hoặc trace-check đỏ, rồi thông báo.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { traceCheck } from '../lib/trace.mjs'
import { gateQuestions } from '../lib/gates.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
let config
try {
  config = loadConfig(root).config
} catch {
  process.exit(0)
}

const ti = input.tool_input ?? {}
const gates = gateQuestions(ti)
for (const g of gates) {
  if (!g.cardId) {
    process.stderr.write(`[ff] Câu hỏi ${g.gate} phải bắt đầu bằng "[#<id thẻ>]", vd "[#123] Duyệt Brief?".\n`)
    process.exit(2)
  }
  if (g.gate === 'GATE_A' || g.gate === 'GATE_B') {
    const card = findCardDir(root, config, g.cardId)
    if (card.error) {
      process.stderr.write(`[ff] ${card.error}\n`)
      process.exit(2)
    }
    const r = traceCheck(card.dir)
    if (!r.ok) {
      process.stderr.write(`[ff] trace-check đỏ cho thẻ #${g.cardId} — sửa rồi trình lại ${g.gate}:\n${r.errors.map((e) => `- ${e}`).join('\n')}\n`)
      process.exit(2)
    }
  }
}

const prefix = config.worker.tmux.session_prefix
const first = Array.isArray(ti.questions) ? ti.questions[0] : null
const event = gates.length
  ? makeEvent({ kind: 'gate', taskId: gates[0].cardId, title: `${gates[0].gate} thẻ #${gates[0].cardId} chờ duyệt`, body: `Mở phiên để duyệt: tmux attach -t ${prefix}${gates[0].cardId}` })
  : makeEvent({ kind: 'ask', title: String(first?.question ?? 'Agent đang hỏi').slice(0, 120) })
await notify(root, event, { log: () => {} })
process.exit(0)
```

- [ ] **Step 4: Viết `scripts/hooks/ask-post.mjs` và `scripts/hooks/notification.mjs`**

```js
// scripts/hooks/ask-post.mjs — PostToolUse(AskUserQuestion): ghi câu trả lời Gate vào .ff/gates/.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot } from '../lib/config.mjs'
import { recordGates } from '../lib/gates.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
recordGates(root, input.tool_input ?? {}, input.tool_response ?? null)
process.exit(0)
```

```js
// scripts/hooks/notification.mjs — Claude cần người dùng chú ý (xin quyền, đang chờ).
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot } from '../lib/config.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
await notify(root, makeEvent({ kind: 'attention', title: String(input.message ?? 'Claude cần bạn chú ý').slice(0, 200) }), { log: () => {} })
process.exit(0)
```

- [ ] **Step 5: Chạy test**

Run: `npm test`
Expected: PASS mọi test.

- [ ] **Step 6: Viết `hooks/hooks.json`, thêm entry build, build**

`hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.mjs\"", "timeout": 30 }] }
    ],
    "PreToolUse": [
      { "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit|Read|Grep", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/guard.mjs\" --mode base", "timeout": 10 }] },
      { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/ask-pre.mjs\"", "timeout": 15 }] }
    ],
    "PostToolUse": [
      { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/ask-post.mjs\"", "timeout": 10 }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/notification.mjs\"", "timeout": 10 }] }
    ]
  }
}
```

Trong `scripts/build.mjs`, đổi `entryPoints` thành:

```js
const entryPoints = {
  cli: 'scripts/cli/main.mjs',
  guard: 'scripts/guard.mjs',
  'hooks/session-start': 'scripts/hooks/session-start.mjs',
  'hooks/ask-pre': 'scripts/hooks/ask-pre.mjs',
  'hooks/ask-post': 'scripts/hooks/ask-post.mjs',
  'hooks/notification': 'scripts/hooks/notification.mjs',
}
```

Run: `npm run build && ls dist dist/hooks && ./bin/ff help`
Expected: có `dist/cli.mjs`, `dist/guard.mjs`, `dist/hooks/{session-start,ask-pre,ask-post,notification}.mjs`; `ff help` liệt kê `cfg`, `env-example`, `doctor`, `trace-check`, `notify`.

- [ ] **Step 7: Chạy thử thật trong Claude Code**

Tạo workspace thử:

```bash
cd ~/Workspaces/ff-kit
W=$(node --input-type=module -e "import { makeWorkspace } from './tests/helpers/fixture.mjs'; const w = makeWorkspace({ files: { '.ff.env': 'TRELLO_API_KEY=a\nTRELLO_API_TOKEN=b\n' } }); console.log(w.root)")
echo "$W"
```

Mở Claude Code trong `$W` với plugin local theo cách ghi ở `docs/notes/2026-10-13-spike-claude-code.md` (vd `cd "$W" && claude --plugin-dir ~/Workspaces/ff-kit`). Lần lượt gõ:
1. `Chạy "git -C web stash" bằng Bash.` → Expected: bị chặn với `[ff-guard] Cấm git stash`.
2. `Đọc file .ff.env.` → Expected: bị chặn (deny của guard).
3. `Tạo file trellocards/123-x/brief.md với dòng đầu "> Trạng thái: ĐÃ DUYỆT 2026-10-13".` → Expected: bị chặn, lý do nhắc `GATE_A của thẻ #123`.
4. Thoát; kiểm `cat "$W/.ff/doctor.json"` có `"ok":true` (SessionStart đã chạy).

Ghi kết quả 4 bước vào cuối `docs/notes/2026-10-13-spike-claude-code.md` (mục "Smoke plugin Plan 1"). Bước nào sai → sửa trước khi commit. Xong: `rm -rf "$W"`.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/hook-io.mjs scripts/hooks hooks/hooks.json scripts/build.mjs tests/hooks.test.mjs dist docs/notes
git commit -m "feat: hooks SessionStart, AskUserQuestion, Notification và hooks.json của plugin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phạm vi Plan 1 so với spec

| Spec | Có trong Plan 1 | Để plan sau |
|---|---|---|
| §3 cấu trúc repo | `.claude-plugin`, `bin/ff`, `scripts/`, `schema/`, `hooks/`, `tests/`, `dist/` | `skills/`, `agents/`, `commands/`, `references/`, `templates/`, `NOTICE`, `INSTALL.md`, `README.md` (Plan 4); `ff-worker/` (Plan 3) |
| §4.1 config | loader, mặc định, schema, `cfg get` | — |
| §4.2 lock | kiểm nguồn trong doctor | ghi lock (Plan 4, `/ff-init`) |
| §4.3 `/ff-init` | `ff env-example`, `ff doctor --schema-only` (công cụ cho init) | skill `/ff-init` + `INSTALL.md` (Plan 4); `/ff-worker start` (Plan 3) |
| §4.4 doctor | đủ, trừ mục e2e | kiểm e2e (`node_modules`, chromium, `playwright test --list`) cùng `ff e2e-scaffold` (Plan 2); `ff worker status` trong SessionStart (Plan 3) |
| §4.6 ff-e2e | schema `e2e.apps`, `e2e.health_urls`, `e2e.auth`; key `E2E_USER`/`E2E_PASSWORD` cho `form-login` | template + `ff e2e-scaffold` (Plan 2); bước e2e trong `INSTALL.md` (Plan 4) |
| §4.5 secrets | guard chặn Bash + tool; doctor chỉ báo có/thiếu | `permissions.deny` + khối `CLAUDE.md` (Plan 4) |
| §5.1 Gate | quy ước header/`[#id]`/`Duyệt`, ghi Gate, chặn marker | sửa skill (Plan 4) |
| §5.2 hooks | SessionStart, PreToolUse/PostToolUse AskUserQuestion, Notification, guard | `Stop` (Plan 3, cần phase từ ff-monitor) |
| §5.3 ledger | `trace-check` + chặn Gate A/B khi đỏ | khuôn ledger trong skill, adversary hướng 9 (Plan 4) |
| §8 test | doctor, cfg, guard (cũ + marker + `.ff.env`), trace-check | adapter, orchestrator, reload, ff-init, grep CI, đo trước/sau (Plan 3–5) |
