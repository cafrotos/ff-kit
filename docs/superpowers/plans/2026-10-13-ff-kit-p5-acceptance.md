# ff-kit Plan 5 — Workspace acceptance

> Spec: `docs/superpowers/specs/2026-10-12-ff-kit-packaging-design.md` §§8, 10.3.

## Goal

Verify the local package on an isolated synthetic workspace with two Git repositories, without reading or modifying Tiniweb and without invoking Claude. Keep interactive plugin smoke and npm publication for after user review.

## Tasks

1. Create an acceptance fixture with two repositories, configured branches/commands, task directory, and local secret-key names only.
2. Run the built `ff` CLI against the fixture: `help`, config read, doctor, and e2e scaffold with a mocked dependency-install callback. Confirm the scaffold does not initialize Git or overwrite existing files.
3. Reuse existing worker lifecycle/HTTP contract tests for readiness, one-session behavior, reload, and shutdown; add an acceptance assertion that two repos do not affect task config validation.
4. Build plugin and worker bundles; run the complete test suite, generic-content audit, and `git diff --check`.
5. Run `npm pack --dry-run` in `ff-worker` with a temporary npm cache and inspect the package file list. Do not publish.
6. Record deferred checks that require Claude Code interaction or a user-controlled npm account.

## Acceptance criteria

- Isolated two-repo fixture validates through `ff doctor` with no secrets printed.
- E2E template scaffolds through the CLI with no network dependency in the test, has no `.git`, and refuses to overwrite non-empty destinations.
- Full local tests and builds pass; package dry-run includes only worker runtime bundle, manifest, and README.
- No Claude CLI/process is invoked; no external publish or workspace mutation occurs.

## Status

- [x] Two-repository acceptance fixture passes config, doctor and e2e scaffold.
- [x] Full suite: 203 tests, 202 passed, 1 skipped (Playwright package absent in this checkout), 0 failed.
- [x] CLI and worker bundles build; npm package dry-run contains exactly three expected files.
- [x] Generic-content audit and `git diff --check` pass.
- [ ] Interactive Claude plugin smoke and npm publication await user review.
