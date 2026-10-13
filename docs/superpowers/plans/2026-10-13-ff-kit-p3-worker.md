# ff-kit Plan 3 — ff-worker

> Spec: `docs/superpowers/specs/2026-10-12-ff-kit-packaging-design.md` §§6, 8.
> Execute inline, preserve the user's existing workspace changes, and do not modify tiniweb.

## Goal

Add a separately installable `ff-worker/` package that polls configured task sources, writes dossier files, sends one-way notifications, exposes token-protected loopback HTTP endpoints, and supports managed tmux lifecycle and safe config reload.

## Status

Implemented and verified. Full repository suite: 198 pass, 0 fail, 1 expected skip (Playwright is not installed in this checkout). `npm run build`, `git diff --check`, built worker `--help`, and `npm pack --dry-run` passed. Live Trello/Rocket.Chat calls and npm publish are intentionally left for the isolated acceptance/review stage.

## Constraints

- ESM, Node >=20.10. Config is always loaded and validated from the workspace; secrets are read only inside the process and never logged.
- Core depends on `TaskSource` and `Channel` interfaces. Core contains no Rocket.Chat-specific payload types and no inbound chat approval flow or MCP server.
- Task state is stored in `.ff/tasks/<id>.json`, independently of channel. HTTP listens only on `127.0.0.1`; random token and port are stored in `.ff/worker.json` with mode 0600.
- Tests use fake adapters, fake tmux/process runners, and local HTTP. No production workspace or tiniweb mutation.
- Honor existing P1/P2 APIs and config schema. Add config fields only with schema, defaults, docs mapping and tests updated together.

## Tasks

### 1. Package and adapter contracts

- Add `ff-worker/package.json`, ESM entrypoint, CLI argument parsing (`--config`), build/start scripts, and adapter types/factories.
- Implement the console channel and fake-friendly adapter registration. Validate unknown adapters clearly.
- Tests: package entry/help/config errors; console event formatting; adapter contract.

### 2. Worker core and persistent task state

- Implement config loading through ff-kit's shared config/schema code; load `.ff.env` without printing values.
- Implement task source and channel interfaces, task state persistence in `.ff/tasks/`, polling loop, dossier creation from `templates/dossier.md`, status moves, and startup recovery.
- Port Trello card polling and dossier generation from the read-only tiniweb source into `ff-worker/src/adapters/task-source/trello*`; do not port shell calls or approval/chat listeners.
- Tests: fake TaskSource + console Channel contract; state survives restart; dossier path/content; notification failure does not fail task; no inbound approval path.

### 3. Local HTTP API

- Bind only to loopback; require a random bearer token for every request; write worker status file atomically at mode 0600.
- Add `/notify`, `/verify-lock`, and `/ship-request` endpoints, delegating to existing workspace services where possible.
- Tests: loopback binding, auth rejection, valid calls, malformed input, atomic status permissions, no secret in response/log.

### 4. Reload and process supervision

- Watch config, lock, and configured env file across atomic rename; debounce changes; validate candidate config before swapping.
- Invalid config retains active config and notifies error. Valid config drains HTTP up to 10 seconds and exits 75 for restart.
- Add supervisor restart policy: exit 75 immediate restart; other nonzero exits retry after 5 seconds; stop after more than five failures in 10 minutes and record `crashed`.
- Tests: valid/invalid reload, rename events, exit codes, crash window, task state preserved.

### 5. `ff worker` lifecycle CLI and hooks

- Add `start`, `stop`, `status`, `logs` commands; doctor gates start; exact tmux session matching (`=<name>`); do not duplicate ready sessions.
- Start superviser in configured session, wait at most 30 seconds for ready state, and report all five fields from spec §6.6.
- Update SessionStart to report worker state without blocking sessions.
- Tests: injected tmux runner, duplicate start, doctor red, ready timeout, stop/status/logs, SessionStart notice.

### 6. Integration and verification

- Update schema/defaults and spec mapping only for fields proven necessary; update CLI help/build as needed.
- Run worker contract/integration tests, full `npm test`, worker build, `npm run build`, `git diff --check`.
- No npm publish or live Trello/Rocket.Chat calls in this plan.

## Review focus

- Tokens and secret values never appear in output, status responses, or logs.
- HTTP cannot bind beyond loopback and rejects requests without constant-time token comparison.
- Config reload never replaces a known-good runtime config with an invalid candidate.
- Tmux session lookup uses exact matching and never kills a card session during worker restart.
- Task recovery works with the console adapter and does not depend on Rocket.Chat thread identifiers.
