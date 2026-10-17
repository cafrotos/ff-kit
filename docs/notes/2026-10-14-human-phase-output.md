# Operating phase human output

Detailed artifacts remain agent contracts. Operating skills now prepare a separate business synthesis for CLI chat and one-way channel notifications; ff-init and inbound chat are excluded.

`ff present` validates phase fields, binds task/revision/scope and current source hashes, and renders the same presentation used by Ask notifications. Whole-function packets aggregate child contracts; scoped packets bind shared and local contracts. Changed sources, malformed cache records or changed presentation content invalidate the cached view. Presentation records never grant approval.

Ask notifications preserve all questions, options and descriptions, current identity and the route back to CLI. Both channel renderers preserve metadata. Gate C retains the session, records acceptance/not-shipped explicitly, and remains separate from ship confirmation. Reopen clears prior active acceptance metadata. Standalone ship requests keep CLI confirmation available and warn when a current bound presentation is missing.

Delivery distinguishes delivered, not sent, rejected and unknown. Client and hook deadlines cover the channel deadline; downstream timeout/network uncertainty stays unknown and is not blindly retried. Verification distinguishes non-applicable signals from required signals that were not observed, and UX observations cannot replace technical PASS.

## Verification

- Test-first regressions observed against the prior behavior, including transport truncation, scope identity, cache integrity, child-only contracts, revision ledger changes and acceptance reset.
- Full `npm test`: **338 tests, 337 passed, 0 failed, 1 skipped**.
- `npm run build`, `node bin/ff help`, bundled worker help and `git diff --check`: passed.
- One independent final reviewer found integration issues; fixes have targeted regression coverage and a resolution check. The revision-local ledger dependency was also added and tested.

## Limits

The Playwright template enumeration test remains skipped because Playwright is not installed in ff-kit. No live Claude Code, Rocket.Chat, Trello or model-comprehension evaluation ran. Content/schema/transport tests verify mechanical contracts, not semantic fidelity of a model-generated summary. Future operating evals are documented as unrun. Hooks remain application controls, not an OS sandbox.
