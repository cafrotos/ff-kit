# Workflow compatibility and verified gates

User approved fixing both phases after the review of 6e56ec4.

- Keep physical task-N directories and 00-subtasks.md; business prose may call these clusters.
- Gate records and content hashes are authoritative. Add a typed auto_passed Gate B bound to the active Gate A, design, spec, ledger and dossier. It is never user approval.
- Reopen creates rev-N/delta.md, spec/design/report for that revision. Gate headers stay GATE_A/B/C; questions name [#id] [rev-N]. Store revision receipts separately and preserve earlier approvals. A changed delta or dossier invalidates its receipt.
- State exposes machine-readable JSON and reports pending, approved, auto_passed and stale. Build and verify consume active revision state.
- Understand may prepare a copy and observation environment without modifying product code. Cleanup precedes handoff.
- Review rules have one owner. Exact output contracts and configured paths take precedence over keyword tests. Preserve useful checks; replace brittle duplicate-location anchors with tests of cross-file contracts.
- Guard combines base and mirror rules, checks absolute executable names and known shell writes, and conservatively blocks opaque mutations while locked tests/allowlists exist. Document that hooks are not an OS sandbox.
- DB queries use read-only transactions, reject SELECT INTO and unsafe control/function forms, apply timeouts and rollback. Credentials must have least privilege; read-only is not a general sandbox for external side effects.
- Copies preserve upstream origin while retaining an explicit local reference for base history. Health failures keep the verification lock until cleanup. Dirty squash checks fail.
- Worker retries are bounded; failed launches free concurrency slots. Resume prompts follow on-disk state; Stop notifications are registered.
- No automated merge, deployment or push of product changes. This maintenance branch/PR is authorized by the user.

Validation: node test suite, bundled CLI build/smoke, real local Git copy tests, gate/revision/hash integration fixtures, read-only DB connection contracts (no live DB available), and an independent diff review. Report real-service integration limits.
