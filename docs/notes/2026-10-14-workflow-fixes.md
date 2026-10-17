# Workflow and runtime fixes

Base: `6e56ec4` on `feat/p1-foundation`.

## Changes

- Skills route by `ff state --json`; marker text never grants approval. Physical cluster paths remain `task-N`.
- `ff gate-auto` requires an approved current Gate A and three boolean eligibility declarations in design frontmatter. The auto receipt binds contract content and its prerequisite receipt; it is not human approval.
- `ff reopen` creates active revision contracts, retains prior receipts, and records immutable task-branch commit bases. Gate questions identify the active revision. Gate C depends on current contracts and Gate A/B.
- Revision test manifests preserve original tests. Authorized `relock --add` adds later cluster tests without blessing changes to existing tests. Revision coverage cannot use old tests as evidence for new ACs.
- Copy preserves upstream remotes, resolves relative local URLs, and keeps local history under `ff-local`. Local-only copies cannot ship. Dirty or invalid squash ranges fail.
- Default guard combines mirror protection and base rules; protects revision manifests, metadata, aliases, redirects and known opaque mutations. Exact configured checks and the CLI remain trusted boundaries; hooks are not an OS sandbox.
- DB queries run in read-only transactions with timeouts and rollback. Conservative SQL preflight is supplementary; least-privilege credentials remain required, especially for functions with external side effects.
- HTTP health failures retain verification ownership until cleanup. Worker retries are bounded and session lifetime is enforced without killing unknown sessions. Resume and Stop attention follow on-disk state.

## Verification

- Full `node --test tests/*.test.mjs`: **303 tests, 302 passed, 0 failed, 1 skipped**.
- `npm run build`: passed; generated CLI and worker help smoke checks passed.
- `git diff --check`: passed.
- Independent review reproduced contract, cluster and Git lifecycle issues; regression fixes were verified, including a local cherry-pick → restore task branch → reopen → revision squash sequence.

## Limits

The skipped test enumerates the Playwright template because Playwright is not installed in ff-kit itself. No live Claude Code, browser app, Trello, Rocket.Chat, PostgreSQL or MySQL integration ran. Driver transaction setup/rollback was tested through connection contracts. Model behavior evaluation scenarios in `docs/skill-evals/` are a catalog, not executed evaluation results. No merge or product deployment is included.
