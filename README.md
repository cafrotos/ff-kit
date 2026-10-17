# ff-kit

Plugin workflow và CLI `ff` cho workspace nhiều repository: hiểu yêu cầu, triển khai trong worktree, kiểm chứng theo AC và quản lý worker tùy chọn.

## Bắt đầu

Xem [INSTALL.md](INSTALL.md) để cài plugin và thiết lập workspace. Cấu hình do `/ff-init` tạo trong `ff.config.yaml`; chạy `ff doctor` để kiểm tra. `ff doctor` không đọc giá trị secret. Worker chỉ chạy sau khi người dùng cấu hình key và gọi `/ff-worker start`.

Các skill chính: `/ff-understand`, `/ff-build`, `/ff-verify`. CLI đầy đủ: `ff help`. Các component plugin được tự phát hiện từ `skills/`, `agents/`, `commands/` và `hooks/`.

## Phát triển ff-kit

Yêu cầu Node.js theo `package.json`.

```sh
npm install
npm test
npm run build
```

## Giới hạn

Plugin không thay quyết định người dùng ở các Gate, chỉ ship/push sau xác nhận CLI riêng và không tự bật worker. Adapter worker được cấu hình riêng; Playwright và CodeGraph là công cụ tùy chọn.

## MVP harness 0.2.0 (opt in)

The persistent harness is disabled by default (`worker.driver.enabled: false`).
To opt in, configure valid Trello acceptance and reopen lists alongside the existing
poll/done lists, and explicitly enable it:

```yaml
worker:
  driver:
    enabled: true
    max_stage_retries: 3
    max_repair_cycles: 3
    stuck_after_minutes: 90
  task_source:
    adapter: trello
    trello:
      # Keep your board_id, poll_lists and done_list here.
      accept_list: Acceptance
      reopen_list: Reopened
ship:
  mode: dev_only
```

This is a partial configuration example; merge it into the workspace configuration
through the normal config/lock workflow. Run `ff doctor`, then explicitly start
`ff worker start`. The worker creates one tmux session and one persisted Claude UUID
per task and pins the plugin/CLI snapshot. It calls understand → build → verify;
failed implementation checks return to build for at most three repair cycles per
revision, including after restart. An environment/setup failure blocks for a human
fix instead of consuming an implementation repair. After setup is repaired, the worker
reruns preflight for the exact failed revision/HEAD, archives that failure and
automatically issues a fresh verify dispatch in the same session. Stale source,
invalid pins, unconfirmed identity and unknown dispatch blocks cannot use this
recovery. Gate A/B/C remain human CLI
decisions. Verify setup runs when `ff stage begin` begins verify; ship checks its
configured Git destinations at S1 and GitHub authentication only at S2.

Each card's Claude session is reachable two ways: Claude Code Remote Control
(session `ff-<id> <slug>` in the Claude app or claude.ai/code; set
`worker.driver.remote_control: false` to disable) and `tmux attach -t <session shown by
ff worker status>`. Remote Control cannot run `!` shell commands such as
`ff worker resolve`, so use tmux for those. Read the question and answer in either. The worker continues automatically
after the answer and phase evidence; do not manually launch the next phase, clear
the conversation or recreate the session. Rocket.Chat and the other channels only
notify: card prose, comments and chat replies cannot approve a Gate or ship.
`ff worker status`, `ff state <id> --json` and `ff worker logs` show blocked/setup,
question and receipt state. An unproven pane or uncertain dispatch remains blocked.

Gate C does not authorize shipping. A separate exact-target CLI ship question and
`ff ship-approve <slug> --question-id <id>` authorize `ff ship <id>`. S1 verifies
both the configured ship branch and task branch; S2 creates/updates PRs only in
`dev_and_pr`. `dev_only` requires a separate CLI acceptance after verified S1.
`dev_and_pr` stays in acceptance until a human merges every required PR at its
approved source HEAD. Neither agent nor CLI merges, rebases onto production or
force pushes. Conflict/unknown mergeability keeps polling and preserves verified
S1. A human reopen on an unmerged task creates a delta revision in the same session;
closed/merged/done tasks require a new Fix card. Another task advancing the shared
ship branch does not invalidate the first task's historical delivery. Push success
does not prove an application has deployed.

The regression suite composes real Git bare origins, runtime/driver/runner, CLI
receipts and human-answer hooks with fake tmux/GitHub/Trello/channel boundaries.
The smoke simulates verify through the receipt API because this test host has no
browser; a separate real CLI test proves missing setup persists an
`environment_blocked` receipt and blocks safely. Live tmux/Claude pane readiness
has not been accepted in production; the real probe remains fail closed when it
cannot prove an idle empty input. The harness remains an opt-in MVP.

A card blocked on a stage receipt (`needs_human`, `implementation_failed`, `environment_blocked`) can be
resumed in two ways. Evidence resume: after you fix the cause in the attached Claude session, the agent
re-runs the checks and records a superseding `ff stage finish <id> --dispatch <same dispatchId> --outcome pass`;
a newer, valid, current passing receipt lets the driver clear the block by itself (a pass receipt can never be
superseded, and the old receipt is archived under `receipts/<id>/<rev>/history/`). Human resolve:
`ff worker resolve <id> --reason "..."` appends an audit record to `.ff/harness/resolutions/<id>.jsonl` and a
scoped `human_resolved` event; the driver, the only task writer, then re-dispatches the same stage with a fresh
dispatch in the same session. It never resets repair cycles, and it refuses `repair_limit`, `pr_closed_use_fix`
and integrity blocks (session mismatch, workflow pin, unknown launch/resume/dispatch); the guard asks you to
confirm it, like `ff relock`.
