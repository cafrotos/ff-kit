# ff-kit Plan 2 — Port CLI và bộ e2e

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port các lệnh còn lại từ `tiniweb/scripts/ff/ff.sh` sang CLI `ff`, dựng template e2e tái sử dụng, và giữ các lệnh an toàn theo config hiện có.

**Architecture:** Mỗi lệnh là module `scripts/cli/<name>.mjs` đăng ký trong dispatcher hiện hữu. Logic dùng chung đặt trong `scripts/lib/`; lệnh đọc config qua loader hiện có và dùng `ctx.cwd` để chạy fixture được. Template e2e nằm ở `templates/ff-e2e/`, được copy bằng `ff e2e-scaffold` mà không khởi tạo git repo.

**Tech Stack:** Node.js ESM >=20.10, `node:test`, YAML 2.x, Ajv 8.x, Node built-ins; template Playwright TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-12-ff-kit-packaging-design.md` §§4.1, 4.4, 4.6, 8, 10.3, 10.3b. Roadmap: `docs/superpowers/plans/2026-10-13-ff-kit-roadmap.md`.

## Global Constraints

- Giữ runtime dependencies chỉ `yaml` và `ajv`; dùng `node:crypto` cho JWT.
- Không in hay log secret hoặc JWT; file auth storage phải có mode `0600`.
- Mọi đường dẫn workspace lấy từ `ff.config.yaml`; không hardcode tiniweb, repo, branch, port hoặc đường dẫn máy.
- Mặc định workspace không có worker vẫn dùng được các lệnh không phụ thuộc worker.
- Giữ thông báo CLI bằng tiếng Việt và exit code đã định ở Plan 1.
- Mỗi lệnh có fixture test; fixture không đọc/ghi repo `tiniweb` thật.
- Build cập nhật `dist/` đã commit; test theo `node --test tests/*.test.mjs`.

## Review Focus

1. **Lệnh phá hủy hoặc đổi trạng thái Git** — fixture chứng minh không stash, push, `add -A`, hoặc ghi đè branch ngoài hành vi được spec cho phép.
2. **Secret/JWT** — test xác nhận giá trị không xuất hiện ở stdout/stderr và file được ghi quyền `0600`.
3. **Đường dẫn do config hoặc người dùng nhập** — test chặn path traversal và xác nhận thao tác chỉ nằm trong workspace fixture.
4. **Workspace thiếu cấu hình e2e/DB** — doctor báo đúng nhóm e2e; lệnh liên quan từ chối rõ ràng, lệnh core vẫn hoạt động.
5. **Template đích đã có dữ liệu** — scaffold dừng và giữ nguyên file hiện có; không tạo `.git`.

## File Structure

- Modify: `schema/ff.config.schema.mjs`, `scripts/lib/doctor.mjs`, `scripts/cli/doctor.mjs` — xác thực và báo nhóm e2e.
- Create: `scripts/lib/jwt.mjs`, CLI module cho các lệnh P2, và các helper dùng chung khi test xác nhận cần thiết.
- Create: `templates/ff-e2e/**` — Playwright config, auth, env, global setup, fixtures và tài liệu sử dụng trung tính.
- Create: `tests/cli-*.test.mjs`, `tests/jwt.test.mjs`, `tests/e2e-scaffold.test.mjs`, `tests/e2e-template.test.mjs`.
- Modify: `scripts/cli/main.mjs`, `scripts/build.mjs`, `tests/main.test.mjs` — đăng ký lệnh và entry build.
- Modify: `docs/superpowers/plans/2026-10-13-ff-kit-roadmap.md` — đánh dấu P2 sau khi toàn bộ kiểm chứng hoàn tất.

### Task 1: E2E config và doctor

**Files:** `schema/ff.config.schema.mjs`, `scripts/lib/doctor.mjs`, `scripts/cli/doctor.mjs`, `tests/config.test.mjs`, `tests/doctor.test.mjs`.

- [x] Thêm test config e2e hợp lệ/không hợp lệ cho `auth.strategy`, `jwt-mint`, apps, health URLs, auth storage và DB driver.
- [x] Chạy test mục tiêu trước khi port các quy tắc P2.
- [x] Thêm xác thực offline cho strategy và JWT config; kiểm tra Playwright config/dependencies và secret cần thiết trong doctor group e2e.
- [x] Chạy test mục tiêu, rồi toàn bộ test; xác nhận lỗi e2e không làm đỏ core.

### Task 2: JWT và lệnh xác thực e2e

**Files:** `scripts/lib/jwt.mjs`, `scripts/cli/mcp-auth.mjs`, `scripts/cli/e2e-auth-check.mjs`, `scripts/cli/main.mjs`, tests tương ứng.

- [x] Viết test vector JWT cho thuật toán cấu hình, placeholder payload, thời hạn, email lookup, storage mode `0600`, lỗi thiếu user/401/mất kết nối và không lộ token.
- [x] Chạy test mục tiêu trước khi cài signer.
- [x] Viết signer bằng `node:crypto`; port `mcp-auth --email` và `e2e-auth-check --email` theo §4.6, dùng DB/config hiện có và không import dependency từ tiniweb.
- [x] Chạy test mục tiêu, toàn bộ test và build.

### Task 3: Template e2e và scaffold

**Files:** `templates/ff-e2e/**`, `scripts/cli/e2e-scaffold.mjs`, `scripts/cli/main.mjs`, `scripts/build.mjs`, tests scaffold/template.

- [x] Test scaffold sinh file theo config, `--db`, từ chối đích có file, không tạo git repo; template được kiểm bằng `playwright test --list` trong fixture tạm có dependency.
- [x] Chạy test mục tiêu trước khi port template.
- [x] Port các phần tổng quát: project theo `e2e.apps`, health check theo `health_urls`, env/config loader, auth helpers và DB helpers tùy chọn; loại bỏ hardcode dự án.
- [x] Chạy test mục tiêu, kiểm tra hardcode và build. Suite có test Playwright được skip nếu dependency chưa cài vào ff-kit; đã chạy Playwright list thủ công trong fixture tạm.

### Task 4: Workspace và verify commands

**Files:** `scripts/cli/{sync,state,copy,squash-check,verify-up,verify-down}.mjs`, helpers cần thiết, `scripts/cli/main.mjs`, tests CLI.

- [x] Viết fixture tests cho sync `--check`, state từ Gate record + hash, copy từ config, squash checks, verify up/down với lock, migration và cleanup.
- [x] Chạy test mục tiêu trước khi port.
- [x] Port hành vi từ `tiniweb/scripts/ff/ff.sh`, đổi nguồn config/path/branch sang `ff.config.yaml`; `state` coi marker không có Gate record hoặc hash lệch là chưa duyệt.
- [x] Chạy test mục tiêu; kiểm tra lệnh trên fixture; chạy full suite.

### Task 5: Gate, allowlist, test lock và slice

**Files:** `scripts/cli/{ship-approve,allow,lock-tests,relock,probe-slice}.mjs`, `scripts/lib/**`, tests CLI.

- [x] Viết tests cho ship approval, allow TTL/clear, hash lock và chmod, relock có lý do, probe-slice theo card/task; xác nhận Gate hash dùng record P1.
- [x] Chạy test mục tiêu trước khi port.
- [x] Implement port theo config; fixture không chạm repo thật; relock/ship-approve giữ cơ chế `ask` của guard.
- [x] Chạy test mục tiêu, test guard liên quan và full suite.

### Task 6: Kiểm tra spec, e2e và DB

**Files:** `scripts/cli/{ac-matrix,e2e-lint,design-check,db-query}.mjs`, helpers, tests CLI.

- [x] Viết tests fixture cho COVERED/SKIP/MISSING/ORPHAN/DROPPED, lint strict, kiểm tra file:line/identifier, và SQL chỉ SELECT/EXPLAIN.
- [x] Chạy test mục tiêu trước khi port.
- [x] Port scripts; `db-query` đọc env trong process, không log env hoặc URL có secret; mọi đường dẫn lấy từ config.
- [x] Chạy test mục tiêu và full suite.

### Task 7: Tích hợp, tương thích và build

**Files:** `scripts/cli/main.mjs`, `scripts/build.mjs`, `tests/main.test.mjs`, docs P2.

- [x] Xác nhận dispatcher help/version liệt kê đủ lệnh P2.
- [x] Kiểm tra `ff.sh reopen`: không có command trong dispatcher nguồn. Các ca `test-tools.sh`/`test-lock.mjs` đã được port vào fixture Node tests, không đụng tiniweb.
- [x] Chạy `npm test` (170 pass, 1 skip do Playwright không cài tại checkout), `npm run build` và `git diff --check`.
- [x] Cập nhật roadmap; P1 spike Claude tương tác thật vẫn được ghi là chưa xong.
