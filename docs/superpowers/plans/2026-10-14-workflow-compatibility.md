# Workflow compatibility implementation plan

> **For agentic workers:** Use executing-plans for the integration and independent agents for disjoint tasks. Steps use checkbox syntax for tracking.

**Goal:** Make both approved phases work with current ff-kit runtime and deliver a tested maintenance PR.

**Architecture:** Preserve task-N storage. Shared gate functions resolve active revision and validate receipts; CLI and hooks consume these contracts. Skills describe the implemented commands rather than independent marker logic.

**Tech Stack:** Node.js >=20.10, ESM, node:test, YAML, esbuild.

**Spec:** ../specs/2026-10-14-workflow-compatibility.md

## Global Constraints
- Preserve legacy root Gate records and configured workspace paths.
- Auto pass is not user approval; revision receipts preserve history.
- No new runtime dependencies; no automatic product push or merge.
- User authorized both phases, maintenance branch and PR.

## Review Focus
- Hash changes and deleted artifacts must invalidate approvals.
- Reopened cards must not complete from a previous Gate C.
- Symlinks and shell interpreters must not silently bypass protected paths.
- Health failures must not release ownership of a running verification environment.
- Repeated worker failures must not starve new tasks.

### Task 1: Gate/revision runtime
Files: scripts/lib/gates.mjs, scripts/cli/state.mjs, scripts/cli/main.mjs, new scripts/cli/gate-auto.mjs and reopen.mjs, guard and hooks, worker completion; tests/workflow-gates.test.mjs.
Interfaces: gateStatus(root,id,gate,relPath,content,ledger), activeRevision(cardDir), recordAutoGate(root,config,id,reason), reopen CLI, state --json.
- [x] Add failing tests for marker-only status, auto pass invalidation, revision receipts and completion isolation.
- [x] Implement shared state/receipt APIs and commands, preserving root records.
- [x] Run focused integration tests.

### Task 2: Compatible skill and agent contracts
Files: skills/, agents/, references/, docs/skill-evals/, tests/skills-content.test.mjs.
- [x] Pin cross-file behavior and template compatibility; preserve tests for permission and secret boundaries.
- [x] Align routing, observation setup, active revision, configured paths and reviewer ownership.
- [x] Add concrete evaluation scenarios and run content/template tests.

### Task 3: Runtime protection and operational correctness
Files: guard/shell, db-query, copy, verify-up/down, squash-check, worker lifecycle; focused tests.
- [x] Write regressions for every reviewed failure.
- [x] Implement read-only transactions, upstream remote preservation, status-aware health and bounded retry.
- [x] Run focused tests and local Git fixtures.

### Task 4: Integration and delivery
- [x] Build bundles, run all tests and CLI smoke.
- [x] Review full diff independently; fix material findings and repeat relevant tests.
- [ ] Commit and attempt authorized PR creation. If authentication unavailable, deliver a portable patch/bundle and exact PR instructions.
