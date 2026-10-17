# MVP harness acceptance — 2026-10-16

## Outcome

**Blocked: real operational acceptance was not performed.** This report records the automated implementation evidence separately from the required two-card run. No real workspace, configured workspace files, or real cards were available here. Subscription-backed session status is unverified; it could not be tested because Claude CLI is absent. No live card IDs were selected or invented, no notifications or external actions were issued, and no credentials were inspected.

The implementation is **not production-ready by operational acceptance**. Keep `worker.driver.enabled` off. The implementation default is false; this checkout has no `.ff` workspace configuration to override it. This is an environment block, not a failed operational run.

## Environment and versions

Checked on 2026-10-16 in the implementation worktree at base `d1a3d0d17eb5434c4ad66ae8157beceacfb2573e`:

| Check | Result |
|---|---|
| Node.js | `v24.19.0` |
| Git | `git version 2.51.1` |
| Packaged `./bin/ff --version` | `0.2.0` |
| Root package / plugin manifest version | `0.2.0` / `0.2.0` |
| `ff` on current `PATH` | Absent; packaged `./bin/ff` is available and reports `0.2.0` |
| `tmux`, `claude`, `gh` on `PATH` | All absent |
| Workspace `.ff` directory/configuration | Absent |
| Real workspace/cards | Not available or configured in this checkout |
| Subscription-backed session | Unverified; could not test because Claude CLI is absent |

The prior preflight recorded the same missing operational tools and workspace setup. No environment dump or credential inspection was performed. The prescribed user-machine prerequisites are a real configured workspace, two owner-selected cards (including one that fails acceptance and is reopened), and a subscription-backed Claude Code session with tmux and required workspace access. Notifications remain notify-only; a subscription/quota failure must block and notify, with no SDK or API/PAYG fallback.

## Automated evidence from Task 17

Task 17's final full suite recorded **583 tests: 582 passed, 0 failed, 1 unchanged optional skip**. The skip is the existing Playwright template-listing test because `@playwright/test` is not installed in this checkout. The packaged build completed twice with exit 0 and the second build produced no `dist/**` or `ff-worker/dist/**` diff, supporting deterministic build output for version `0.2.0`.

These are code, unit, and fake-boundary integration results, not live operational acceptance. The composed regressions use fake tmux/GitHub/Trello/channel adapters and simulated phase-agent output. In the smoke path, verify was invoked through its API rather than a real browser. The real pane parser/probe remains deliberately fail-closed and unverified; a fake pane does not establish live Claude/tmux behavior. No real push, PR, Trello update, notification, or deployment was attempted or evidenced.

## Final integration fix verification — 2026-10-17

The final integration fixes add source/revision-bound Done movement and replay, conservative failed-phase waits, a persisted stuck wait that releases its slot and stops its working clock, durable attention intents, missing-reopen-feedback notification, and separate sanitized S1/PR/ready comments. Focused fake-boundary regressions passed: 73/73 core tests, 30/30 shipping/e2e tests, and a final 22/22 regression-only check. The single final `npm test` run exited 0: **605 tests, 604 passed, 0 failed, 1 unchanged optional Playwright-dependency skip**, duration 149579.172024ms. Both `npm run build` runs exited 0; SHA-256 comparison found all **9/9 generated files byte-identical** across the two builds. The rebuilt packaged CLI reports `0.2.0`, and `git diff --check` is clean.

Attention uses at-most-once delivery because the channel abstraction has no idempotent delivery lookup. A pending intent remains pending when no channel exists, is durably claimed as unknown before a send, and is marked done only after successful return. A failed call, response loss, or crash can leave notification delivery unknown or lost. The worker never automatically resends an unknown notification; `ff worker status` exposes `attention_pending` and `attention_unknown` counts, and local task `pendingEffects` retains scoped reason/detail/status. Unknown does not mean delivered. Distinct concrete block reasons retain separate identities.

General same-revision recovery for stuck or non-verify setup/human/implementation-failure waits has no authoritative resolution API in this implementation. These paths stop, notify, preserve session and pending evidence, release the slot, and await owner intervention; later idle/progress or unrelated question answers do not authorize dispatch. Existing narrow verified e2e setup recovery is unchanged. Existing reopen retains its Gate C, revision, PR and max_reopen constraints and is not a recovery claim for preapproval understand/build failures. An evidence-backed same-revision human resolution path remains a precise residual for scoped review before operational enablement; no generic unblock was added.

These results remain automated implementation evidence. **Real operational acceptance remains BLOCKED**, the live pane probe remains fail-closed, and `worker.driver.enabled` must stay off for production.

## Two-card acceptance

| Card | Selection | Run outcome | Human interventions / elapsed time / tokens |
|---|---|---|---|
| A | Not selected | Not run | Unknown; not measured |
| B (acceptance failure/reopen) | Not selected | Not run | Unknown; not measured |

There are no real session IDs, phase timings, question counts, retries, repair/reopen counts, escaped errors, merge outcomes, or deployment evidence to report. These values are unknown, not zero. The required restart observations (waiting at Gate and after dispatch), same-session continuity, first ship, failed acceptance/reopen, separate B ship, human merge, and completion checks remain unperformed.

## T1–T7 evidence status

| Spike | Automated evidence in Task 17 | Live status |
|---|---|---|
| T1 — build receipt coverage and staleness | Receipt, HEAD, build, and lock behavior covered in automated tests; recovery regression revalidates actual preflight evidence. | Unverified on a real card. |
| T2 — Claude auto mode, resume, and protected questions | Configuration/dispatch contracts exercised with fake runner boundaries; actual CLI `--session-id`, `--resume`, and `--permission-mode auto` could not be probed. | Unverified; Claude Code absent. |
| T3 — same-session send-keys and restart safety | Composed fake-tmux tests cover persisted UUID/session, delivery uncertainty, dedupe, restarts, and no blind resend. | Unverified; tmux absent and live pane probe remains fail-closed. |
| T4 — `CLAUDE_PLUGIN_ROOT` in SessionStart hook | Static/content and implementation tests provide limited code evidence. | Unverified in a real Claude hook environment. |
| T5 — skill calls `ff decide` at the right time | Skills-content tests cover documented instructions. | Real-agent timing/behavior unverified. |
| T6 — real `gh` permissions and team PR conventions | Fake boundary tests cover denial, reconciliation, conflicts, and PR flow. | Untestable here: `gh` is absent; repository permissions and team conventions were not exercised. |
| T7 — future SDK/background/channel runner | Not implemented; explicitly deferred beyond MVP. | No spike performed; not an MVP acceptance result. |

## Follow-up required

On the workspace owner's machine, select the two real cards and run the operational steps in Task 18 with the driver enabled only in the configured test workspace. Keep channel use to notifications; the person answers Gate and ship prompts in the CLI. Capture sanitized outcomes and measurements, prove the real pane parser/runner behavior before relying on it, and keep feature use blocked if any required setup or subscription check fails. Do not claim deployment without project evidence. Operational acceptance remains blocked until that report is completed.
