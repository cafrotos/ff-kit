# ff-kit — Roadmap các plan

> Spec: `docs/superpowers/specs/2026-10-12-ff-kit-packaging-design.md`
> Spec gồm 4 phân hệ độc lập → 5 plan. Mỗi plan ra phần mềm chạy và test được riêng. Viết plan N+1 sau khi plan N xong, vì interface thật của plan N quyết định plan N+1.

| Plan | Phạm vi | Spec | Phụ thuộc | Ước lượng |
|---|---|---|---|---|
| **1. Nền tảng** (`2026-10-13-ff-kit-p1-foundation.md`) | Spike Claude Code; scaffold plugin + build `dist/`; config loader + schema; `ff cfg get`; `ff env-example`; lock nguồn; `ff doctor`; guard port + luật mới (`.ff.env`, marker `ĐÃ DUYỆT`); `ff trace-check`; gate recorder; `ff notify` client; hooks SessionStart/AskUserQuestion/Notification | §3, §4.1–4.5, §5.1–5.3 (phần xác định), §8 (doctor, cfg, guard, trace) | — | 2–3 ngày |
| **2. Port lệnh `ff.sh`** | `sync state copy squash-check verify-up verify-down mcp-auth ship-approve ac-matrix e2e-lint design-check lock-tests relock allow db-query probe-slice` thành `scripts/cli/*.mjs`; port `test-tools.sh`, `test-lock.mjs` lên fixture; xác minh `ff.sh reopen` | §4.1 bảng ánh xạ, §10.3 | Plan 1 | 2–3 ngày |
| **3. ff-worker** | Adapter `TaskSource`/`Channel` (trello, console, rocketchat chỉ notify); gỡ MCP; HTTP local `POST /notify`, verify-lock, ship-request; `.ff/worker.json`; supervisor tmux + exit 75; watcher reload; `ff worker start/stop/status/logs`; hook `Stop`; contract test | §6, §10.4 | Plan 1 (config/validator dùng chung) | 3–4 ngày |
| **4. Skills, agents, ff-init** | Port 49 file theo §10.1–10.2 (H/M/P/W); ledger + khuôn Gate + `references/writing.md`; `ff-gate-reader`; vệ sinh prompt; `/ff-init` 10 bước; `INSTALL.md`, `README.md`, `NOTICE`; grep CI hardcode/giọng gắt | §4.3, §5.1, §5.3–5.5, §7, §10.1–10.2 | Plan 1, 2, 3 | 3–4 ngày |
| **5. Nghiệm thu thật** | Cài plugin vào tiniweb; `/ff-init`; đo trước/sau 2–3 thẻ cũ; chốt `effort`; xóa bản cũ trong tiniweb (có xác nhận); publish npm `ff-worker` | §8 (e2e + đo), §3 (dọn tiniweb), §6.5 | Plan 1–4 | 1–2 ngày |
