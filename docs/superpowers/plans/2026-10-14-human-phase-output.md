# Human phase output implementation plan

> Agentic workers use the approved scope below; root integrates and verifies the complete tree.

**Goal:** Print faithful phase summaries for humans and preserve them through one-way worker notifications.
**Architecture:** One validated, hash-bound presentation packet and shared renderer; existing Gates remain authoritative. Worker acceptance and delivery semantics are corrected independently.
**Tech stack:** Node ESM, existing CLI/hooks/worker, node:test; no new dependencies.
**Spec:** `docs/superpowers/specs/2026-10-14-human-phase-output.md`.

## Constraints and review focus
- No init changes or inbound channel features; no external test messages.
- Artifacts are agent detail, not notification dumps; human summaries use current revision.
- No summary, missing source, changed source and mismatched scope must never masquerade as an approved/current presentation.
- Preserve every question and option, including long Vietnamese descriptions.
- Gate C does not imply ship or permit destroying the waiting session.
- Delivery timeout is unknown and must not cause blind retries.

## Tasks
- [x] Root: add failing packet/CLI/hook/renderer tests; implement presentation validation, current-source hashes, shared rendering, CLI `present` and one-way Ask hooks.
- [x] Worker owner: add failing acceptance/delivery tests; retain session after Gate C, clarify accepted/not-shipped status, preserve fields in renderers and classify delivery outcomes.
- [x] Skill owner: update phase-specific output recipes, complex-task overview, Gate-reader, N/A versus UNVERIFIED and ship fallback; add contract/template tests and honest eval cases.
- [x] Root: integrate ship-request CLI fallback, build bundles, run focused and full tests, independent final review and git diff checks.
- [ ] Root: commit, publish exact tree on PR branch using a ref lease, update PR description and verify remote tree.
