# ff-kit Plan 4 — Skills, agents, `/ff-init`, install docs

> Spec: `docs/superpowers/specs/2026-10-12-ff-kit-packaging-design.md` §§4.3–4.5, 5, 7, 8, 10.1–10.2.
> Source files are read from `../tiniweb/.claude`; that repository remains read-only.

## Goal

Port the existing understand/build/verify workflows into a generic plugin, add `/ff-init` and `/ff-worker`, and document installation for any workspace without embedding Tiniweb paths or secrets.

## Tasks

1. Copy the 3 skills, their references/briefs, 9 agents and `ship-to-dev`; adapt all commands to the current `ff` CLI, D21 Gate record, ledger/source references, `AskUserQuestion`, and generic workspace config.
2. Add `ff-gate-reader`, `ff-init`, its detect/report/env-key references, shared `references/writing.md`, `/ff-worker`, and genericized `/ship-to-dev`.
3. Add `INSTALL.md`, `README.md`, `NOTICE`; keep installation idempotent and never read `.ff.env`, run sudo, auto-start worker, or edit the source workspace.
4. Add doctor warnings for CodeGraph and Playwright plugin without making them core blockers; Playwright discovery remains a manual check so the doctor does not invoke Claude CLI.
5. Add static tests for frontmatter/tools, required generic commands, secret handling language, source attribution, and forbidden workspace-specific paths/tools.
6. Run targeted static tests, full suite, plugin/worker builds, grep audit, and `git diff --check`.

## Review focus

- Skills only call commands present in `ff help`; `allowed-tools` never grants `ship-approve` or `relock`.
- Agents have `model` and `effort`; CodeGraph and Playwright tools are declared only for roles that use them.
- `/ff-init` reports evidence and missing keys without reading secret values, and never starts the worker.
- Gate approval remains a separate `AskUserQuestion` after user decisions; only explicit `Duyệt` is approval.
- Installation asks before privileged/network actions and keeps workspace changes idempotent.

## Status

- [x] Generic skills, references, briefs, agents and commands.
- [x] `/ff-init`, `/ff-worker`, install docs and source attribution.
- [x] Non-blocking doctor warnings and static-content tests.
- [x] Targeted tests passed; full suite/build/package checks are part of Plan 5.
- [x] Claude Code interactive smoke deferred to user review; no Claude process used.
