# ff-worker

Worker package for ff-kit workspaces. It reads the workspace `ff.config.yaml`, polls the configured task source, writes task dossiers, starts one exact tmux session per task, and sends notifications through the configured one-way channel.

```sh
npx ff-worker --config ./ff.config.yaml
```

Run it through `ff worker start` so a supervisor can restart it after config changes. The worker binds HTTP only to `127.0.0.1`; its bearer token is stored in `.ff/worker.json` with file mode `0600`. Do not share that file.

Node.js 20.10 or newer is required. Build the publishable bundle from the ff-kit repository with `npm run build`.

The 0.2.0 persistent harness is opt in: `worker.driver.enabled: false` remains
the default. Enabling it requires valid Trello `accept_list` and `reopen_list` in
addition to the existing source settings. See the root README for the partial
configuration example. The worker persists one Claude UUID and tmux session per
task, pins an executable snapshot CLI, and automatically dispatches each phase.
Only working tasks consume concurrency/lifetime; Gate and verify-lock waits do
not. Three repair cycles per revision survive restart; setup failure is blocked. Once setup is repaired, a
fresh preflight and current source/receipt/pin/session validation let the worker
archive that failure and issue a new verify dispatch in the same session. This
consumes no implementation repair and cannot clear unrelated unknown/identity
blocks.

Notifications tell the human to attach to the task session. Answer in Claude's
CLI and the worker continues after the answer and validated receipt. Channels
have no input/approval role. Do not manually advance phases or recreate/clear the
conversation. Use `ff worker status`, `ff state <id> --json` and `ff worker logs`
to inspect blocked tasks. Unknown dispatch/pane readiness fails closed.

Gate C and exact-target ship confirmation remain separate CLI decisions. S1
verifies ship/task Git delivery; S2 checks `gh auth status` before PR operations.
`dev_only` (default) requires CLI acceptance; `dev_and_pr` requires every PR to be
merged by a human at its approved HEAD. Conflicts preserve S1 and wait; no agent
merge/rebase/force push exists. Reopen creates a delta revision in the same
conversation; closed/merged/done work requires a new Fix card. Another task's dev
advance does not undo prior delivery; delivery does not prove deployment.

Fake-service integration tests use actual runtime, driver, persistent runner,
Git and CLI/hook receipts. Browser execution and real Claude/tmux pane readiness
are still unverified production limits. Missing verify setup is durably blocked;
real unproven pane readiness never permits typing. No new runtime service or DB
is required.
