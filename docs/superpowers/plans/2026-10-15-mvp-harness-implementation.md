# MVP Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tự chạy task Trello qua understand → build → verify → ship → nghiệm thu/reopen, để người chỉ vào khi có notify cần quyết định.

**Architecture:** Mở rộng ff-worker hiện có bằng một driver sở hữu trạng thái, runner điều khiển một phiên tmux/Claude xuyên suốt mỗi task, và CLI ship có checkpoint. Giữ Gate theo hash, skill làm từng pha rồi hướng dẫn; worker gọi pha tiếp theo. Sổ quyết định JSONL chỉ tư vấn ở một điểm trong understand, không cấp quyền duyệt Gate hoặc ship.

**Tech Stack:** Node.js ESM `>=20.10`, node:test, Git, tmux, Claude Code CLI với subscription cá nhân và `--permission-mode auto`; Ajv/YAML/esbuild hiện có; gh cho bước PR.

**Spec:** `docs/superpowers/specs/2026-10-15-mvp-harness-design.md` tại commit `756ee04280424b172a390da5b66d9de2aa8a0840`, branch `feat/mvp-harness`. Code tham chiếu ở lần lập plan: `1b5ba9a46804c196f8f12fa8273bd7ac306245fe`. Đọc cả spec và plan. Đây là plan, chưa phải bằng chứng đã chạy code hoặc nghiệm thu.

## Global Constraints

- Phiên Claude mới dùng UUID do worker sinh và lưu trước launch qua `--session-id`; resume bằng `--resume` cùng UUID; SessionStart chỉ đối chiếu và xác nhận, không cấp ID.
- Một task = một phiên tmux + một cuộc hội thoại Claude xuyên pha và rev-N; không kill/recreate, `/clear` hoặc ép compact khi chuyển pha. Cho phép Claude auto-compaction.
- Launcher tạo mới/resume dùng đúng một `--permission-mode auto`; không chuyển bypass/dontAsk, không tự bấm Yes, không tự fallback API/PAYG.
- Rocket.Chat chỉ notify. Người trả lời Gate/câu hỏi, relock và ship confirmation trong CLI; trả lời xong tự tiếp tục, không bàn giao quyền nhập thủ công.
- Worker gọi pha tiếp theo. Hướng dẫn cuối verify không phải một lần thực thi ship.
- `worker.driver.enabled: false` mặc định; bật harness phải có accept_list/reopen_list hợp lệ, không âm thầm chạy legacy.
- `max_stage_retries: 3`; `max_repair_cycles` là số nguyên 1–3, mặc định 3 vòng sửa → verify lại cho mỗi revision; không mở vòng thứ 4, restart không reset. `stuck_after_minutes: 90`; `max_reopen: 3`.
- `worker.max_concurrent_tasks` giữ cấu hình hiện có, mặc định 2. Chỉ task working chiếm suất; chờ Gate/verify_lock không chiếm suất. Lifetime mặc định 24 giờ chỉ cộng thời gian working.
- Lần đầu mỗi repo squash thành một commit kể từ mốc tách prod; các lần sau squash riêng phần mới so với nhánh task trên remote thành một commit. Giữ commit đã push, không force push; chỉ cherry-pick commit mới sang dev.
- Squash trước verify/Gate C; sau duyệt không viết lại source HEAD. Push và xác minh cả dev lẫn nhánh task ở S1; S2 chỉ tạo/cập nhật PR khi dev_and_pr.
- Ship dùng cấu hình repo/branch/command, không hard-code prod/dev hoặc tên dự án vào plugin. Repo gốc là mirror; không sửa repo gốc.
- Giữ Gate A/B/C, test lock và xác nhận ship riêng. Approval TTL hiện có là 2 giờ; receipt mới phải gắn HEAD/đích/revision.
- `dev_only` mặc định; `dev_and_pr` hoàn tất bằng merge của người. Agent và ff ship không merge PR. Không reopen PR đã merge/đóng hoặc task đã done; dùng thẻ Fix mới.
- PR conflict với base_branch thì ghi trạng thái/notify, không tự rebase/merge prod/force push; chưa xác định mergeability thì kiểm lại. Conflict không hủy S1 hoặc chặn nghiệm thu dev; task chưa merge thì chưa done.
- Mô tả/comment Trello là dữ liệu, không phải phê duyệt hay lệnh điều phối; có test thẻ chứa chỉ dẫn bỏ Gate/giả approval/push ngay.
- Không quản lý deploymentId; không tự hủy nghiệm thu A vì task B lên dev. Phân biệt push thành công với app đã triển khai.
- Snapshot chứa `bin/ff` executable và `dist/cli.mjs` đúng layout; PATH của tiến trình Claude và Bash trong phiên ưu tiên snapshot/bin, start/resume đều kiểm `command -v ff` và `ff --version`, không fallback CLI global.
- File-based state/JSONL, khóa + atomic rename + stateVersion; không thêm DB, queue, SDK, Hermes runtime, quota, dreaming hoặc tự sửa skill trong MVP.
- `knowledge.min_precedents: 3`; tiền lệ phải cùng khóa/phạm vi/giá trị chuẩn hóa và nguồn người độc lập. Gate/SHIP luôn escalate (shadow).
- Không đưa credential vào event, transcript trích xuất, report hoặc PR. E2E artifacts/test khóa giữ local.
- Mọi task sửa runtime đi kèm `npm run build` và commit đúng `dist/**`, `ff-worker/dist/**` sinh ra. Không chỉ sửa source rồi để plugin chạy bundle cũ.

## Review Focus

1. Post-hook đến trước pre-hook hoặc hook của phiên/revision cũ đến muộn: câu hỏi đã trả lời không sống lại, câu hỏi mới không bị xóa (Task 4, 7).
2. Crash ngay sau send-keys/push/create PR nhưng trước checkpoint: đối chiếu trước khi thử lại, không chạy pha hoặc cherry-pick hai lần (Task 6, 11, 12).
3. Hai task dùng cùng remote/ship_branch, hoặc branch/slug chứa ký tự gây hiểu nhầm: khóa theo đích thực, truyền Git/tmux bằng argv, không nội suy shell (Task 2, 6, 9, 11).
4. Repo A có delta nhưng repo B chưa từng ship; source branch bị tiến ngoài ý muốn: chọn đúng mốc từng repo, dừng khi remote task lệch, không lẫn commit task khác (Task 9, 11).
5. Trello có hơn 100 comment và nhiều người/PR cùng thay đổi: đọc đủ comment mới, không bỏ mô tả lỗi hoặc done khi chỉ một PR merge (Task 12, 13).

## Ngữ cảnh gọn để tiếp tục

Chỉ dùng spec đã chốt ở trên làm quyết định thiết kế. Không mở lại câu hỏi SDK/PAYG, một phiên mỗi pha, giao tiếp Rocket.Chat hai chiều, ownership bàn phím thủ công hoặc deployment controller. Ưu tiên ghép vào cơ chế ff-kit có sẵn. Những phần bên dưới chốt tên file/interface phục vụ triển khai, không bổ sung luồng sản phẩm.

Ba mốc chạy được: Task 1–8 cho tự chuyển pha và chờ ship; Task 9–13 cho ship/nghiệm thu/reopen; Task 14–18 cho tư vấn tiền lệ, đóng gói và nghiệm thu thật. Thực hiện tuần tự theo dependency; chưa bắt đầu implementation trước khi người review plan và chọn cách thực thi.

## File Structure

| Đường dẫn | Trách nhiệm |
|---|---|
| `scripts/lib/harness-contracts.mjs` | JSDoc/validation cho event, task harness, receipt, ship view; không chứa vòng poll |
| `scripts/lib/file-mutex.mjs` | Khóa file chống ghi/ship đồng thời; không dùng lock.mjs kiểm nguồn config |
| `scripts/lib/harness-events.mjs` | Inbox sự kiện bền trên đĩa, correlation và dedupe |
| `scripts/lib/stage-receipts.mjs`; `scripts/cli/stage.mjs` | Bắt đầu/kết thúc một dispatch, kiểm bằng chứng và ghi receipt |
| `scripts/lib/question-history.mjs` | Ghi lịch sử hỏi/đáp bất biến, làm nguồn quyết định người |
| `scripts/lib/workflow-snapshot.mjs` | Giữ bản CLI/plugin/skill của task bằng digest |
| `ff-worker/src/core/tmux-claude-runner.mjs` | Start/inspect/sendStage/resume/stop trong một phiên/task |
| `ff-worker/src/core/driver.mjs` | Reduce event, nextStage, repair budget và orchestration từng task |
| `scripts/lib/task-commits.mjs` | Chọn mốc và đúng commit mới của từng repo; dùng chung với squash-check/ship/reopen |
| `scripts/lib/ship-approval.mjs` | Receipt xác nhận ship ràng buộc revision/HEAD/remote/branch |
| `scripts/lib/ship-store.mjs`; `scripts/lib/ship.mjs`; `scripts/cli/ship.mjs` | Checkpoint và S1 dev + publish nhánh task |
| `scripts/lib/github-pr.mjs` | gh argv, PR identity, source HEAD và reconciliation |
| `ff-worker/src/core/ship-watch.mjs` | Quan sát PR/Trello và phát event; không ghi task snapshot |
| `scripts/lib/knowledge.mjs`; `scripts/cli/learn.mjs`; `scripts/cli/decide.mjs` | Import ledger, tra tiền lệ cùng khóa, tư vấn |
| File hiện có: runtime/worker/task-store/tmux, hooks, config/schema/doctor/guard, Trello adapter, skill/command | Tích hợp theo trách nhiệm hiện có; không refactor ngoài phạm vi |

Không cần tạo entry build riêng cho module được import từ CLI/worker. Chỉ thêm entry khi có executable mới thật sự được hook gọi.

## Hợp đồng dùng chung

Task 2 tạo `scripts/lib/harness-contracts.mjs` với các tên dưới đây. Các task sau dùng đúng tên, không tự tạo schema tương đương khác:

- `Revision = '' | 'rev-N'`; chuẩn hóa null của `inspectCard.activeRevision` thành chuỗi rỗng trong event/receipt.
- `Scope = {cardId, revision, runId, dispatchId}`, tất cả string; dispatchId rỗng chỉ cho quan sát ngoài dispatch. `questionId` tách biệt với header Q1.
- `HarnessEvent = {eventId, cardId, revision, runId, dispatchId, type, at, payload}`. Type: session_started, stage_started, stage_finished, question_opened, question_answered, permission_waiting, runner_idle, runner_exited, revision_created, ship_observed, acceptance_recorded, reopen_observed.
- `HarnessTask` mở rộng task cũ: `stateVersion, stage, waitingOn, executionStatus, revision, runId, dispatchId, pendingDispatch, tmuxSession, claudeSessionId, workflow, questions, handledEventIds, stageRetries, repairCycles, workingMs, workingSince, lastProgressAt, history, pendingEffects`. Stage là understand/build/verify/ship/acceptance/done; executionStatus dùng working/waiting_human/idle/blocked/failed/exited.
- `StageReceipt = {version:1, cardId, revision, runId, dispatchId, stage, outcome, heads, artifactHashes, testLockHash, checks, reviewRefs, acMatrixRef, at}`. Outcome pass/implementation_failed/environment_blocked/needs_human/no_change. `heads` map repo name → SHA; check gồm command/cwd/exitCode/logPath/logHash. Understand/ship chỉ yêu cầu các trường bằng chứng áp dụng cho pha đó.
- `ShipView = {cardId, revision, heads, s1Complete, s2Complete, mode, repos, acceptance}`. `PrView = {repos:[{repo, number, url, state, merged, headAtMerge, approvedSourceHead, baseHead, mergeability}]}`.
- `StageDecision = {stage, waitingOn, reason, action}`; action stay/dispatch/repair/acceptance/done. `waitingOn` dùng null hoặc mã đang chờ trong spec, kèm dữ liệu chi tiết ở task.
- Không coi schema là bằng chứng: mọi reader so scope, HEAD, hash thực tế và checkpoint trước khi dùng.

---

### Task 0: Kiểm tra môi trường thực thi và ghi baseline

**Files:** Create `docs/notes/2026-10-15-mvp-harness-preflight.md`; đọc `INSTALL.md`, spec `13/15`. Chỉ ghi phiên bản/kết quả, không credential.

**Interfaces:** Consumes spec và môi trường chủ máy. Produces báo cáo preflight có Node/Git/tmux/Claude/gh version, kết quả một task chạy tay, các khả năng runner đã thử.

- [ ] **Step 1:** Trên checkout đầy đủ, kiểm `node --version`, `git --version`, `tmux -V`, `claude --version`, `claude --help`, `gh --version`. Xác nhận Node >=20.10; đọc help thật để kiểm auto/resume/plugin path, không suy đoán flag. Chưa có gh vẫn cho tiếp tục mốc driver.
- [ ] **Step 2:** Chạy `npm ci`, `npm run build`, `npm test`. Ghi số test/failure thật; baseline có lỗi thì chẩn đoán trước khi gán lỗi cho harness.
- [ ] **Step 3:** Trong phiên thử riêng dùng subscription, thử tạo mới với --session-id UUID do worker cấp, resume cùng UUID với auto, SessionStart xác nhận session_id, Stop/AskUserQuestion input, plugin từ đường dẫn ghim, PATH của Bash resolve ff từ snapshot và send-keys literal. Xác nhận câu trả lời Gate vẫn cần người; không thử push. Không khả dụng thì ghi setup:permission/auth/runner và dừng phần phụ thuộc, không tự đổi billing.
- [ ] **Step 4:** Chạy một task hiện tại bằng tay theo spec lát 0, ghi các điểm phải gõ chuyển pha. Đây là dữ liệu so sánh, không phải nghiệm thu harness.
- [ ] **Step 5:** Commit riêng báo cáo: `git add docs/notes/2026-10-15-mvp-harness-preflight.md`; `git commit -m "docs: record MVP harness preflight"`.

### Task 1: Thêm cấu hình harness có feature flag

**Files:** Modify `scripts/lib/config.mjs`, `schema/ff.config.schema.mjs`, `scripts/lib/schema.mjs`, `tests/config.test.mjs`; Create `tests/harness-config.test.mjs`.

**Interfaces:** Consumes `parseConfigText(text)`/`loadConfig(root)`/`validate(config)` hiện có. Produces merged defaults `worker.driver={enabled:false,stuck_after_minutes:90,max_stage_retries:3,max_repair_cycles:3}`, `ship={mode:'dev_only',max_reopen:3}`, `knowledge={min_precedents:3,high_risk:[]}`.

- [ ] **Step 1:** Viết test với đúng assertions:
~~~js
assert.equal(parseConfigText(legacyYaml).config.worker.driver.enabled, false)
const noConcurrency = baseConfig()
delete noConcurrency.worker.max_concurrent_tasks
assert.equal(parseConfigText(YAML.stringify(noConcurrency)).config.worker.max_concurrent_tasks, 2)
assert.equal(parseConfigText(legacyYaml).config.worker.driver.max_repair_cycles, 3)
assert.equal(parseConfigText(legacyYaml).config.ship.mode, 'dev_only')
assert.equal(parseConfigText(legacyYaml).config.knowledge.min_precedents, 3)
~~~
Parser hiện trả {config,raw}; dùng đúng .config như assertions. Thêm ca enabled thiếu accept_list/reopen_list bị từ chối; disabled thiếu các list vẫn hợp lệ; số retry âm/0, max_repair_cycles >3 và mode lạ bị từ chối. Lấy legacyYaml từ YAML.stringify(baseConfig()) của fixture hiện có.
- [ ] **Step 2:** `node --test tests/harness-config.test.mjs tests/config.test.mjs` → FAIL vì trường harness chưa có.
- [ ] **Step 3:** Bổ sung schema/defaults và conditional validation khi enabled. Giữ merge của config lồng nhau và loadConfigOrDefaults phục vụ hook. high_risk chỉ nhận repo/keywords/paths; không thêm deploy command hoặc SDK config.
- [ ] **Step 4:** Chạy lại hai test → 0 failure; `npm run build` để cập nhật bundles.
- [ ] **Step 5:** Commit source/schema/test và bundle sinh ra: `git commit -m "feat: configure opt-in MVP harness"`.

### Task 2: Lưu task và sự kiện bền, có khóa và stateVersion

**Files:** Create `scripts/lib/harness-contracts.mjs`, `scripts/lib/file-mutex.mjs`, `scripts/lib/harness-events.mjs`, `tests/harness-store.test.mjs`, `tests/helpers/harness.mjs`; Modify `ff-worker/src/core/task-store.mjs`.

**Interfaces:** Produces `withFileMutex(file, owner, action, {isOwnerAlive}) → Promise<T>`; BusyError nếu đang bị giữ. `appendHarnessEvent(root,event) → Promise<{stored,eventId}>`; `listHarnessEvents(root,cardId) → HarnessEvent[]`. `updateHarnessTask(root,id,expectedVersion,reduce) → Promise<HarnessTask>` hoặc VersionConflictError. Giữ readTask/writeTask cho legacy; driver dùng updateHarnessTask.

Fixture `makeHarnessFixture(t) → {root,config,cardDir,task(overrides),event(overrides),seedTask(task),writeArtifact(relativePath,text),clock,cleanup}`; dựa makeWorkspace, tự cleanup qua t.after; root revision là ''. clock có `now()` và `advance(ms)`.

- [ ] **Step 1:** Viết test hai update cùng expectedVersion=1 chỉ một update thành công, stateVersion=2; event cùng eventId chỉ lưu một lần; JSON dở dang không trở thành event hợp lệ. Thêm khóa khác PID không được coi là idempotent theo slug; owner không rõ sống/chết thì giữ blocked; khóa có thể thu hồi chỉ khi chứng minh owner đã chết. Các file và directory nằm trong workspace, mode 0600/0700.
~~~js
assert.equal(listHarnessEvents(root, '123').filter(e => e.eventId === 'e1').length, 1)
assert.equal(readTask(root, '123').stateVersion, 2)
~~~
- [ ] **Step 2:** `node --test tests/harness-store.test.mjs` → FAIL vì module mới chưa có.
- [ ] **Step 3:** Implement contracts ở phần dùng chung; mutex bằng exclusive create, release kiểm owner token; event mỗi file ghi temp+rename dưới inbox từng card. updateHarnessTask giữ khóa, đọc lại version, reduce, tăng version, atomic rename. Không dùng lib/lock.mjs; task mutex chỉ giữ cho transaction đọc/ghi ngắn, không giữ khi chờ network hoặc người. Mutex ship ở Task 11 có phạm vi riêng để tuần tự hóa tác động Git cùng đích.
- [ ] **Step 4:** Test trên + `node --test tests/worker-lifecycle.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: persist harness events and versioned task updates`.

### Task 3: Receipt và CLI báo bắt đầu/kết thúc pha

**Files:** Create `scripts/lib/stage-receipts.mjs`, `scripts/cli/stage.mjs`, `tests/stage-receipts.test.mjs`; Modify `scripts/cli/main.mjs`, `scripts/cli/state.mjs`, `skills/ff-understand/SKILL.md`, `skills/ff-build/SKILL.md`, `skills/ff-verify/SKILL.md` và allowed-tools tương ứng.

**Interfaces:** `beginStage(root,config,{cardId,dispatchId}) → Promise<HarnessEvent>`; `finishStage(root,config,{cardId,dispatchId,outcome,evidenceFile}) → Promise<StageReceipt>`; `readStageReceipt(root,cardId,stage,revision) → StageReceipt|null`; `validateStageReceipt(root,config,receipt) → {valid,reasons}`. CLI `ff stage context <id> --json`, `ff stage begin <id> --dispatch <uuid>`, `ff stage finish <id> --dispatch <uuid> --outcome <outcome> --evidence <file>`. Context trả scope/stage pending, không credential.

- [ ] **Step 1:** Seed pending dispatch qua fixture. Test begin sai dispatch bị từ chối; duplicate begin cùng dispatch không tạo stage_started thứ hai. Build finish thiếu checks/review/test lock/AC evidence bị từ chối; đổi HEAD hoặc test lock làm receipt stale. Receipt chưa được xác nhận của run cũ không thể hoàn tất dispatch mới; revision cũ không hợp lệ. Receipt đã lưu/đã xác minh, cùng revision/HEAD/artifact/workflow vẫn dùng được sau resume, không bắt chạy lại pha đã xong chỉ vì runId mới. no_change cần AC evidence rõ ràng, không chỉ 0 commit.
~~~js
assert.equal(validateStageReceipt(root, config, oldHeadReceipt).valid, false)
assert.equal(validateStageReceipt(root, config, oldRevisionReceipt).valid, false)
~~~
- [ ] **Step 2:** `node --test tests/stage-receipts.test.mjs tests/state-cli.test.mjs` → FAIL các case mới.
- [ ] **Step 3:** Implement interface; kiểm evidence path/hash/exitCode và ràng buộc vào snapshot HEAD, report, review/AC/test lock. Build finish chạy kiểm hiện có squash-check/ac-matrix và kiểm manifest khóa; không tự tạo Gate. Understand pass chỉ khi readyForBuild hiện hành. Finish ghi receipt atomic rồi phát event; không ghi task snapshot. state --json thêm trạng thái receipt theo scope, giữ field cũ. Nối context → begin → finish vào understand/build/verify ngay trong task này để mốc driver ở Task 8 chạy được; standalone không có dispatch giữ cách dùng tay. Build P0 chỉ bỏ qua build khi có receipt hợp lệ cho HEAD hiện tại; riêng việc đã squash không đủ để bỏ qua vòng sửa. Hướng dẫn bước sau vẫn là hướng dẫn, không tự chạy. Task 16 rà nội dung và hardening, không trì hoãn phần nối protocol tới cuối plan.
- [ ] **Step 4:** Lặp lại test → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: add scoped stage receipts and dispatch acknowledgments`.

### Task 4: Hook câu hỏi, session và lịch sử quyết định

**Files:** Create `scripts/lib/question-history.mjs`, `tests/harness-hooks.test.mjs`; Modify `scripts/hooks/ask-pre.mjs`, `ask-post.mjs`, `session-start.mjs`, `stop.mjs`, `notification.mjs`, `scripts/lib/human-output.mjs`, `tests/hooks.test.mjs`. Các tên rút gọn hook ở đây đều thuộc scripts/hooks/.

**Interfaces:** `recordQuestion(root,context,input) → Promise<QuestionRecord[]>`; `recordAnswers(root,context,input) → Promise<DecisionRecord[]>`; `readQuestionHistory(root,cardId) → QuestionRecord[]`. context là Scope + claudeSessionId; QuestionRecord có questionId/toolUseId/header/presentationId/status/snapshot; DecisionRecord thêm provenance, normalizedValue, decisionContext. Dùng `appendHarnessEvent` của Task 2; gate vẫn ghi bằng `recordGates` hiện có.

- [ ] **Step 1:** Dựa hook fixture hiện có, test một lượt Q1/Q2 trả lời đủ; hai lần Cần sửa đều còn trong lịch sử dù receipt Gate bị ghi đè. Cùng session_id/tool_use_id/question index tạo questionId ổn định. Trả lời đến trước opened không làm câu hỏi sống lại; hook run/revision cũ không xóa câu mới. Stop chỉ phát idle, không tạo pass receipt; permission_prompt phát waiting riêng. Standalone driver disabled vẫn dùng được. SessionStart không tự sinh UUID và không thay ID khi hook đến muộn; ID thực tế lệch ID task thì blocked.
- [ ] **Step 2:** `node --test tests/harness-hooks.test.mjs tests/hooks.test.mjs tests/human-output.test.mjs` → FAIL ca mới.
- [ ] **Step 3:** SessionStart đọc session_id từ payload đã xác minh Task 0 và đối chiếu UUID worker đã lưu trước launch; ID lệch thì phát trạng thái blocked, không ghi đè UUID task. Bind xác nhận với card/run launcher cấp qua FF_CARD_ID/FF_RUN_ID; không đoán card từ thư mục workspace gốc. Giữ binding trong .ff/runner theo runId; revision/dispatch lấy từ pending dispatch hiện hành chứ không ghim env revision cho cả phiên vì reopen giữ cùng tiến trình. Pre-hook chụp scope theo session_id/tool_use_id; post-hook đọc lại scope đã chụp, không lấy dispatch mới để gắn nhãn lại câu hỏi cũ. ask-pre kiểm như cũ rồi lưu question snapshot trước notify; ask-post giữ recordGates, lưu câu trả lời, append .ff/decisions.jsonl dưới mutex trước gửi event. Missing answer không là từ chối/duyệt giả. Missing context thì không phát event có scope bịa. Idle bình thường của harness không notify như cần người; vẫn notify Gate/permission/blocked một lần mỗi question/reason.
- [ ] **Step 4:** Lặp lại test → 0 failure; `npm run build`. Không thêm hook mới khi các hook hiện có và CLI stage đã đủ.
- [ ] **Step 5:** Commit `feat: correlate CLI questions and preserve human decisions`.

### Task 5: Ghim workflow và lệnh launch/resume

**Files:** Create `scripts/lib/workflow-snapshot.mjs`, `tests/workflow-snapshot.test.mjs`; Modify `ff-worker/src/core/worker.mjs`, `scripts/hooks/session-start.mjs`, `scripts/lib/doctor.mjs`; snapshot bao gồm launcher `bin/ff` hiện có, không sửa/cài đè CLI global.

**Interfaces:** `prepareWorkflowSnapshot({root,packageRoot,cliVersion}) → {digest,path,binDir,cliPath,pluginPath,cliVersion}`; binDir=<snapshot>/bin, cliPath=<snapshot>/bin/ff là executable và giữ import tương đối tới ../dist/cli.mjs; `verifyWorkflowSnapshot(workflow) → {valid,reasons}`. `buildClaudeLaunch({engineCommand,workflow,claudeSessionId,resume}) → {command,args,env}`, export từ workflow-snapshot; parse command bằng tokenizer hiện có, không eval. claudeSessionId phải là UUID đã được worker lưu cho cả new/resume; new dùng --session-id, resume dùng --resume, không dùng --fork-session hoặc sinh UUID trong hàm này. env.PATH ưu tiên workflow.binDir trước PATH kế thừa. Không đổi engine config của người.

- [ ] **Step 1:** Test nội dung skill đổi sau snapshot không đổi bản của task cũ; mất/tamper snapshot bị blocked; secret/workspace không được copy. Lệnh mới có --session-id bằng UUID đã lưu; resume có --resume đúng UUID và không có --session-id/--fork-session. Cả hai có đúng một auto flag; flag mâu thuẫn bị báo lỗi hoặc chuẩn hóa thành auto, không còn hai mode. UUID input sai bị từ chối; engineCommand đã chứa --session-id/--resume/--continue/--fork-session thì từ chối trước launch để worker giữ một nguồn quyết định ID. Test engineCommand/snapshot path có khoảng trắng; một ff global giả được đặt sau binDir không được chọn. Test chmod/layout của bin/ff; test Bash của Claude sau SessionStart và sau resume resolve đúng snapshot và version.
~~~js
const storedUuid = '550e8400-e29b-41d4-a716-446655440000'
assert.equal(launch.args[launch.args.indexOf('--session-id') + 1], storedUuid)
assert.equal(resumed.args.includes('--session-id'), false)
assert.equal(resumed.args.includes('--fork-session'), false)
assert.equal(launch.args.filter(x => x === '--permission-mode').length, 1)
assert.equal(launch.args[launch.args.indexOf('--permission-mode') + 1], 'auto')
assert.equal(resumed.args[resumed.args.indexOf('--resume') + 1], storedUuid)
~~~
- [ ] **Step 2:** `node --test tests/workflow-snapshot.test.mjs` → FAIL.
- [ ] **Step 3:** Copy package chạy được (bin/ff, dist, ff-worker/dist, plugin metadata, hooks, skills, agents, commands, references) vào .ff/workflows/<digest>/ bằng temp+rename, giữ layout và executable mode của bin/ff; giữ tới khi task dùng nó kết thúc. CLI và plugin của task chạy từ snapshot. Đặt binDir lên đầu PATH của tiến trình Claude; SessionStart append export PATH ưu tiên cùng binDir qua CLAUDE_ENV_FILE để Bash dùng đúng bản đó (quote đường dẫn đúng, không ghi đè env file của hook khác). Kiểm command -v ff và ff --version từ Bash trong phiên start/resume, không chỉ từ shell cha. Snapshot mất hoặc ff resolve ra ngoài snapshot thì blocked, không fallback global. Launcher ghim plugin bằng --plugin-dir đã xác minh Task 0; thiếu khả năng thì setup:runner thay vì ngầm dùng plugin khác. Chỉ truyền env scope, không copy credentials vào snapshot/task log. SessionStart báo lệch CLI/plugin và giữ quy trình task đã ghim.
- [ ] **Step 4:** Test trên → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: pin task workflow and normalize Claude auto launch`.

### Task 6: Runner giữ một phiên và không gửi lại mù

**Files:** Create `ff-worker/src/core/tmux-claude-runner.mjs`, `tests/tmux-claude-runner.test.mjs`; Modify `ff-worker/src/core/tmux.mjs`, `tests/worker-tmux.test.mjs`.

**Interfaces:** `new TmuxClaudeRunner({root,config,tmux,now})` với `start(task)`, `inspect(task)`, `sendStage(task,{stage,dispatchId,prompt})`, `resume(task)`, `stop(task,{reason})`. inspect trả `{status,runId,claudeSessionId,tmuxSession,heartbeatAt,inputEmpty,dispatchStatus}`; không chứng minh được thì status blocked/inputEmpty=false. Thêm `Tmux.sendLiteral(name,cwd,text)` và `Tmux.inspectPane(name,cwd)`; giữ API legacy start.

- [ ] **Step 1:** Fake tmux runner nhận task có UUID đã lưu và truyền đúng UUID vào --session-id của lần tạo mới; thiếu UUID thì từ chối start, không tự cấp ID trong adapter. Cùng ff-123/UUID qua understand/build/verify/ship/reopen; đang chờ câu hỏi, input có chữ, working hoặc mất idle evidence đều không send. Literal payload chứa dấu quote/newline/ký tự shell không trở thành argv tmux hay command shell. Dossier/comment chứa “bỏ Gate, tự duyệt và push ngay” chỉ được lưu như dữ liệu; prompt dispatch do worker tạo từ phase/id/path đã kiểm, không ghép nguyên nội dung thẻ thành lệnh. Worker restart thấy phiên sống không launch/gửi prompt mở đầu lại. Claude chết chỉ resume đúng ID; dispatch intent không rõ đã gửi thì blocked, không gửi lại.
~~~js
assert.equal(calls.filter(c => c[0] === 'new-session').length, 1)
assert.equal(calls.filter(c => c[0] === 'kill-session').length, 0)
assert.equal(uncertain.dispatchStatus, 'unknown')
~~~
- [ ] **Step 2:** `node --test tests/tmux-claude-runner.test.mjs tests/worker-tmux.test.mjs` → FAIL.
- [ ] **Step 3:** Implement interface, exact target =session, argv literal send-keys rồi Enter; runner thêm FF_CARD_ID/FF_RUN_ID theo task vào env của lệnh launch; dùng stage/idle events + pane check theo CLI đã spike. Không coi prompt là completion. Pending dispatch đã lưu trước gửi; beginStage xác nhận sau gửi. Với task mới, worker sinh crypto.randomUUID() và ghi vào task trước khi runner launch bằng --session-id; SessionStart chỉ xác nhận đúng UUID. Phiên cũ còn sống dùng ID đã lưu/binding đã xác minh, không cấp UUID thay thế khi restart; tmux name/runId không thay ID hội thoại. Không tìm thấy transcript/resume bất khả thi thì recovery từ artifacts ghi rõ context lost; không tự tạo hai tiến trình. stop không kill khi chuyển pha/stuck/chờ người; timeout khởi tạo không kill một phiên task có sẵn.
- [ ] **Step 4:** Test trên → 0 failure; chạy lại probe Task 0 trên phiên thử để xác nhận idle/input parser theo bản CLI thật; `npm run build`.
- [ ] **Step 5:** Commit `feat: drive persistent Claude task sessions through tmux`.

### Task 7: Driver thuần và giới hạn sửa code

**Files:** Create `ff-worker/src/core/driver.mjs`, `tests/harness-driver.test.mjs`.

**Interfaces:** `reduceEvent(task,event,observation) → HarnessTask`; `nextStage({state,task,ship,pr}) → StageDecision`; `driveTask({root,config,task,observation,runner,now}) → Promise<HarnessTask>`. observation chứa inspectCard, HEAD/hash/receipt hợp lệ, runner state và ShipView/PrView; nextStage không I/O. Task 8 gọi driveTask; chỉ hàm này cập nhật snapshot khi harness bật.

- [ ] **Step 1:** Table tests toàn bộ hàng spec 5.1. Thêm: Gate C approved chưa ship vẫn ship, không done; build pass mới chuyển verify; code/head mới không dùng receipt cũ; no-change không có bằng chứng không qua. Verify implementation_failed gọi repair; environment_blocked giữ setup. Đúng ba lần repair rồi needs_human; restart đọc repairCycles cũ, revision mới reset. Test worker sinh UUID, persist task rồi fake runner.start mới được gọi, ID trước/sau SessionStart phải khớp. Event của dispatch cũ không ghi đè kết quả mới; pending Q1/Q2 phải trả lời đủ, answered-before-open không sống lại.
~~~js
assert.equal(nextStage(afterGateC).stage, 'ship')
assert.equal(nextStage(afterThirdFailedRepair).waitingOn, 'needs_human')
assert.equal(nextStage(environmentFailure).action, 'stay')
assert.equal(reduceEvent(newRunTask, oldRunEvent, observation).runId, newRunTask.runId)
~~~
Các biến fixture là input shape đã định nghĩa ở Hợp đồng dùng chung; tạo ngay trong từng test bằng task()/event() của Task 2.
- [ ] **Step 2:** `node --test tests/harness-driver.test.mjs` → FAIL.
- [ ] **Step 3:** Reduce sự kiện có scope, mark handledEventIds và kết quả cùng một transaction. Áp dụng failure một lần theo dispatch/HEAD. Task mới chưa có claudeSessionId: sinh crypto.randomUUID() và lưu cùng intent launch trước runner.start; adapter chỉ nhận ID đã lưu. Chỉ tăng repairCycles khi ghi intent mở vòng repair mới; retry/resume vòng đang dở không tăng. Lưu intent dispatch/effect trước I/O; nhận started/receipt sau I/O, crash đọc intent để reconcile. Unknown error không được che lỗi implementation đã phân loại. Không suy ra Gate từ transcript/precedent.
- [ ] **Step 4:** Table và recovery tests → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: derive workflow stages and cap repair rounds`.

### Task 8: Tích hợp runtime, scheduler, clock và status

**Files:** Modify `ff-worker/src/core/runtime.mjs`, `worker.mjs`, `task-store.mjs`, `scripts/cli/worker.mjs`, `scripts/cli/reopen.mjs`; Create `tests/harness-runtime.test.mjs`. Core filenames rút gọn thuộc ff-worker/src/core/.

**Interfaces:** `runHarnessCycle({root,config,source,channel,runner,now}) → Promise<{tasks,effects}>` export từ runtime; `discoverTasks({root,config,source}) → Promise<CardObservation[]>` trong worker, không tự ghi lifecycle harness. Runtime legacy giữ đường gọi cũ khi flag false.

- [ ] **Step 1:** Test enabled không gọi checkCompletedTasks legacy, Gate C không move done. Hai task working chiếm đúng max=2; task chờ Gate hoặc verify_lock không chiếm suất và cũng không bị gửi pha mới. Qua đêm ở Gate không cộng workingMs; 24h working bị needs_human/failed theo lý do, giữ phiên. stuck 90 phút chỉ notify một lần, không kill. Stop/worker restart không mất questions/counter/pending dispatch; flag false giữ acceptance legacy.
- [ ] **Step 2:** `node --test tests/harness-runtime.test.mjs tests/worker-runtime.test.mjs tests/worker-lifecycle.test.mjs tests/worker-cli.test.mjs` → FAIL ca harness.
- [ ] **Step 3:** Runtime chọn một nhánh legacy/harness ngay từ startup và recovery. Harness discovery tạo dossier như dữ liệu rồi đưa observation tới driver; legacy processTasks không tự ghi phase cho task harness. Reserve working slot trước start/send để không vượt max. Cộng elapsed working khi có transition/checkpoint, không cộng khoảng daemon chết chưa xác minh là working. reopen khi harness bật tạo revision rồi phát event, không writeTask như legacy. Status in card/stage/waitingOn/since/revision/PR/dev hash, không in token hoặc nội dung credentials.
- [ ] **Step 4:** Các test trên + `node --test tests/worker-reload.test.mjs` → 0 failure; `npm run build`. Mốc này tự understand → build → verify và chờ ship có thể chạy trên phiên thử.
- [ ] **Step 5:** Commit `feat: schedule harness tasks and preserve legacy mode`.

### Task 9: Chọn commit và mốc remote đúng cho từng lượt ship

**Files:** Create `scripts/lib/task-commits.mjs`, `tests/task-commits.test.mjs`, `tests/helpers/ship.mjs`; Modify `scripts/cli/squash-check.mjs`, `repo-common.mjs`, `reopen.mjs`, `copy.mjs` khi cần dùng chung mốc. Các filename rút gọn thuộc scripts/cli/.

**Interfaces:** `getTaskCommitRange({root,config,cardDir,repo,repoPath}) → {baseSha,sourceHead,commits,alreadyShipped,firstShip}`; `captureReopenBases({root,config,cardDir,taskBranch}) → bases`. Không tự squash trong ff ship; build recipe dùng range này trước verify. Fixture `makeShipWorkspace(t,{repoNames=['web'],taskId='123'}) → {root,config,cardDir,copies,origins,branches,forkShas}`, mỗi map dùng repo name; bare origin thật, prod/dev/task branches tách đúng, dùng git() fixture hiện có.

- [ ] **Step 1:** Git thật: prod tiến sau khi task tách vẫn range từ fork ban đầu. Lần đầu nhiều commit → build squash A; push task A; sửa thêm B/C → range A..HEAD, squash thành D; lần ship hai chỉ D. Reopen fetch remote và so local HEAD với task remote; lệch/thiếu mốc repo đã ship thì dừng. Repo B chưa từng ship có thể bắt đầu ở revision sau từ fork ban đầu. Repo không đổi có commits=[] và không bị ép tạo commit rỗng. Branch có slash/space không hợp lệ phải qua check-ref-format, không shell.
~~~js
assert.equal(first.baseSha, forkShas.web)
assert.deepEqual(second.commits, [deltaSha])
assert.equal(unchanged.commits.length, 0)
assert.throws(() => captureReopenBases(mismatchedInputs), /remote|khớp|mốc/)
~~~
- [ ] **Step 2:** `node --test tests/task-commits.test.mjs tests/workspace-cli.test.mjs tests/workflow-gates.test.mjs` → FAIL ca mới.
- [ ] **Step 3:** Dùng ff-local snapshot/merge-base sẵn có cho lượt đầu; revision.json.bases là source HEAD đã push lượt trước, không dùng cherry-pick SHA trên dev. Ghi bases theo repo trước sửa, validate ancestor; squash-check và ship dùng cùng hàm chọn range. Mỗi lượt repo thay đổi phải đúng một commit (bao gồm trường hợp subtasks), repo không đổi được skip có AC evidence. Không reset/force push hoặc tự cập nhật mốc khi remote lệch.
- [ ] **Step 4:** Test trên + `node --test tests/p2-cli.test.mjs tests/operational-regression.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: select only new task commits for each ship round`.

### Task 10: Xác nhận ship gắn đúng code và đích

**Files:** Create `scripts/lib/ship-approval.mjs`, `tests/ship-approval.test.mjs`; Modify `scripts/cli/gate-tools.mjs`, `scripts/lib/guard-rules.mjs`, `scripts/lib/human-output.mjs`, `commands/ship-to-dev.md`, `tests/guard-new.test.mjs`.

**Interfaces:** `createShipApproval(root,config,{cardId,questionId,now}) → ApprovalReceipt`; `validateShipApproval(root,config,approval,targets,now) → {valid,reasons}`. Receipt: version/cardId/revision/questionId/presentationId/issuedAt/expiresAt/targets; target chứa repo/sourceHead/origin/shipBranch/taskBranch. Gate C là điều kiện riêng, không đồng nhất với approval ship. CLI ship-approve giữ nhận full slug.

- [ ] **Step 1:** Hook question history có đáp án Duyệt cho ship packet hiện hành mới tạo receipt. Chỉ Gate C, lời “ok” không thuộc câu hỏi ship, marker cũ, source/remote/branch/revision đổi đều không đủ. TTL đúng 7200 giây, thời gian tương lai bất thường bị từ chối. Trong harness, push/gh pr create ngoài ff ship và mọi gh pr merge bị guard chặn kể cả bọc shell hoặc allowed_bash quá rộng. Fixture Trello chứa chỉ dẫn giả Duyệt/tắt guard/push không tạo được receipt người; thử gọi push/ff ship thiếu approval hiện hành vẫn bị từ chối dù Claude ở auto mode.
~~~js
assert.equal(validateShipApproval(root, config, approval, changedHeadTargets, now).valid, false)
assert.equal(validateShipApproval(root, config, approval, sameTargets, issuedAt + 7200001).valid, false)
~~~
- [ ] **Step 2:** `node --test tests/ship-approval.test.mjs tests/guard-new.test.mjs tests/guard-regression.test.mjs` → FAIL ca mới.
- [ ] **Step 3:** Bind ship packet vào targets trước hỏi Q1; ask-post giữ snapshot và câu trả lời của người. ship-approve đọc nguồn đó, không nhận boolean approved từ agent. Ghi JSON receipt atomic, dùng shared validator tại mỗi mutation/push. Guard kiểm luật ship trước allowlist bypass; giữ standalone legacy có kiểm rõ, không coi marker TTL-only là approval harness. CLI ff ship sẽ tự kiểm, không tin guard của outer Bash.
- [ ] **Step 4:** Test trên + `node --test tests/workflow-gates.test.mjs tests/human-output.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: bind ship confirmation to revision heads and targets`.

### Task 11: S1 ship dev và nhánh task, có phục hồi

**Files:** Create `scripts/lib/ship-store.mjs`, `scripts/lib/ship.mjs`, `scripts/cli/ship.mjs`, `tests/ship-dev.test.mjs`; Modify `scripts/cli/main.mjs`, `commands/ship-to-dev.md` (gọi CLI và stage protocol thay recipe Git thủ công).

**Interfaces:** `readShipState(root,cardId) → ShipState|null`; `updateShipState(root,cardId,reduce) → Promise<ShipState>`; `inspectShip(root,config,cardId) → ShipView`. `runShip({root,config,cardId,runGit,runCommand,github,now}) → Promise<ShipView>`, Git runner argv-based, commands lấy config. CLI `ff ship <id>` in trạng thái từng repo/chặng, code 0 nếu đủ chặng theo mode, 1 blocked, 2 sai args, 4 setup.

- [ ] **Step 1:** Bare origin fixture: first A và delta B lên dev bằng cherry-pick -x; task branch giữ A→B và remote khớp. Checkout agent không đổi branch/HEAD. Hai task cùng origin/dev không mất commit; mutation lock cùng đích kể cả đường local khác. Dirty source, localOnly, origin sai, thiếu build/test, conflict hoặc checks đỏ không push. Push dev đã lên nhưng response/checkpoint mất thì reconcile thấy đúng source→target và không cherry-pick lại. Dev xong/task push lỗi chỉ retry task push. Remote dev tiến gây rejection chỉ fetch/replay tối đa 2 lần; unknown delivery đối chiếu trước retry.
~~~js
assert.equal(view.s1Complete, true)
assert.equal(git(copies.web, 'branch', '--show-current'), branches.web)
assert.match(git(devCheckout, 'log', '-1', '--format=%B'), new RegExp(deltaSha))
assert.equal(git(copies.web, 'rev-parse', 'HEAD'), approvedSourceHead)
~~~
devCheckout và approvedSourceHead lấy từ checkpoint mà test đọc qua readShipState.
- [ ] **Step 2:** `node --test tests/ship-dev.test.mjs` → FAIL.
- [ ] **Step 3:** Snapshot đúng một commit mới/repo trước tạo checkout; lock theo canonical origin+ship_branch. Tạo checkout ship riêng dưới .ff/ship-checkouts/, copy đúng env_files đã cấu hình nếu cần (0600), chạy install nếu cấu hình rồi build/test ở đó. Checkpoint intent/result từng fetch/cherry-pick/check/push dev/push task, source→target SHA, revision. Kiểm Gate/receipt/approval trước tác động và mỗi push; nhận diện remote chứa target bằng fetch/ancestry chứ không đòi remote tip đứng yên. Không reset checkout agent; chỉ abort/reset checkout ship thuộc tác động của lệnh. Không có commit cần ship thì skip có evidence, không cherry-pick rỗng. Nối recipe ship vào CLI này và begin/finish theo dispatch ngay tại đây; Task 13 thêm nghiệm thu và Task 16 rà lại nội dung, không giữ đường Git bằng markdown song song.
- [ ] **Step 4:** Các test trên + `node --test tests/task-commits.test.mjs tests/ship-approval.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: ship task deltas with recoverable dev and source pushes`.

### Task 12: S2 tạo/cập nhật PR đúng source HEAD

**Files:** Create `scripts/lib/github-pr.mjs`, `tests/ship-pr.test.mjs`; Modify `scripts/lib/ship.mjs`.

**Interfaces:** `new GitHubPrClient({runGh})` với `ensurePullRequest({cwd,repoIdentity,taskBranch,baseBranch,sourceHead,title,bodyFile,revision}) → Promise<PrRecord>` và `inspectPullRequest({cwd,repoIdentity,number,approvedSourceHead}) → Promise<PrObservation>`. runGh nhận args/cwd; PrObservation trả merged/headAtMerge/baseHead/mergeability (mergeable|conflicting|unknown), không dùng base ancestry để đo squash merge. Client đọc mergeable/baseRefOid bằng gh pr view và chuẩn hóa giá trị raw; không dùng khả năng merge để quyết định S2 đã tạo PR đúng source HEAD hay chưa.

- [ ] **Step 1:** Fake gh tests create/reuse theo repo+head+base; branch cùng tên repo khác không bị dùng nhầm. Response create mất thì tìm PR lại, không tạo bản thứ hai. PR head khác sourceHead, closed unmerged, gh missing/auth fail đều blocked riêng S2; S1 giữ done. Multi repo chỉ một PR merge chưa done; squash merge hợp lệ nếu headAtMerge đúng. PR conflicting vẫn có S1/S2 hoàn tất nếu push và PR identity/HEAD đã xác minh, task chưa merge thì chưa done; unknown không bị kết luận conflict hoặc mergeable, cần poll lại. Khả năng merge đổi từ chưa rõ sang conflict được ghi nhận. PR body <=60000 ký tự có ghi chú cắt và không thêm env/private artifact ngoài report.
~~~js
assert.equal(view.s1Complete, true)
assert.equal(view.s2Complete, false)
assert.equal(ghCalls.filter(c => c.args[0] === 'pr' && c.args[1] === 'create').length, 1)
assert.equal(observed.headAtMerge, approvedSourceHead)
~~~
- [ ] **Step 2:** `node --test tests/ship-pr.test.mjs` → FAIL.
- [ ] **Step 3:** gh list/create/view/comment dùng argv và --body-file; chỉ thực thi S2 ở dev_and_pr sau S1. Reuse PR identity lưu trong checkpoint, revision sau comment có idempotency marker theo card/revision/sourceHead. Mọi network timeout sau create/comment đối chiếu trước retry. Đọc thêm mergeable khi tạo/quan sát PR; conflicting/unknown là trạng thái quan sát, không tạo đường tự rebase/merge prod/force push, không hủy S1 hay chặn nghiệm thu dev. Tuyệt đối không gọi merge. Normalize/report đúng origin repo; không mặc định repo workspace. dev_only không cần gh và vẫn có remote task baseline.
- [ ] **Step 4:** Test trên + `node --test tests/ship-dev.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: reconcile pull requests for shipped task revisions`.

### Task 13: Watch nghiệm thu, Trello và reopen cùng phiên

**Files:** Create `ff-worker/src/core/ship-watch.mjs`, `tests/harness-acceptance.test.mjs`; Modify `ff-worker/src/adapters/task-source/trello.mjs`, `types.mjs`, `ff-worker/src/core/runtime.mjs`, `driver.mjs`, `scripts/lib/human-output.mjs`, `commands/ship-to-dev.md`. driver thuộc core, types thuộc adapters.

**Interfaces:** Trello bổ sung `observeCard(id) → {list,comments}`, `readComments(id,{after}) → Comment[]` (phân trang), `findComment(id,eventId) → Comment|null`; Comment={id,at,text,author}. `observeShippedTask({task,ship,source,github,now}) → Promise<HarnessEvent[]>` không ghi task snapshot. Driver persist intent move/comment và đối chiếu remote trước lặp tác động.

- [ ] **Step 1:** Test mọi chặng đủ mới move accept_list; Gate C không move done. dev_and_pr cần mọi PR merge và đúng headAtMerge; dev có task B mới vẫn giữ nghiệm thu A. Watcher phát hiện PR conflict thì notify một lần theo repo/PR/head/base đang quan sát, vẫn poll; unknown chờ poll sau, không báo conflict giả. Không tự rebase hoặc viết lại lịch sử để xử lý. dev_only cần người xác nhận task/revision/source HEAD qua AskUserQuestion ở CLI; không suy ra từ move thẻ hoặc Gate C. Reopen list có comment sau S1 mới nhất, bỏ [ff], xử lý >100 comment; thiếu mô tả thì notify/chờ, không tự reopen. Reopen lần 4 bị chặn khi max_reopen=3; PR đã merge/closed hoặc task done dùng Fix. Worker restart không tạo rev-N hai lần, không đăng lại comment [ff] khi response mất.
- [ ] **Step 2:** `node --test tests/harness-acceptance.test.mjs tests/worker-contract.test.mjs` → FAIL.
- [ ] **Step 3:** Poll lifecycle cho task đã biết, kể cả task trước đây completed; không tự nhận thẻ không thuộc intake khi chỉ quan sát lifecycle. Source mới hỗ trợ rõ list/comment API, legacy adapter contract vẫn chạy khi harness tắt. Watcher phát event với scope task hiện hành. Driver chạy ff reopen với eventId bền để không tạo hai revision: fetch/đối chiếu remote ngoài task mutex; critical section chỉ kiểm lại version, tạo artifact và event revision một lần. Nhận revision_created rồi tiếp tục understand trong cùng session. Giới hạn reopen khác repairCycles. Sau ship, in packet commit/checks/PR/trạng thái triển khai. dev_only recipe hỏi nghiệm thu trong CLI, lưu question snapshot gắn ship source HEAD và phát acceptance_recorded khi người chọn Duyệt; readPresentation dùng đúng phase ship, không lấy packet verify cũ. dev_and_pr chờ merge của người, không thêm câu hỏi acceptance khác. Không deploymentId/health prerequisite mới; chưa rõ triển khai thì nói đúng giới hạn.
- [ ] **Step 4:** Test trên + `node --test tests/harness-runtime.test.mjs tests/ship-pr.test.mjs tests/human-output.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: watch task acceptance and reopen the persistent session`.

### Task 14: Nhập ledger vào sổ quyết định không trùng nguồn

**Files:** Create `scripts/lib/knowledge.mjs`, `scripts/cli/learn.mjs`, `tests/knowledge-learn.test.mjs`; Modify `scripts/cli/main.mjs`, `scripts/lib/question-history.mjs`.

**Interfaces:** `appendDecision(root,record) → Promise<{stored,decisionId}>`; `readDecisions(root) → DecisionRecord[]`; `importLedgerDecisions(root,config,{cardId}) → Promise<{added,skipped,ineligible}>`. CLI `ff learn [id]`. DecisionRecord giữ event gốc và thêm decisionId/questionId/decisionKey/project/repo/businessScope/policyVersion/normalizedValue/provenance/supersedes/retractedBy; provenance có card/revision/ledgerId/toolUseId.

- [ ] **Step 1:** Test import lần hai added=0; cùng câu hỏi từ hook và ledger chỉ một nguồn độc lập; hai Cần sửa vẫn giữ. Một record supersedes/retractedBy không xóa lịch sử. Ledger cũ chỉ có U-xx/question/answer được import nhưng thiếu business key/scope không tự trở thành tiền lệ đủ điều kiện. Concurrent hook append và learn không làm mất/trộn dòng; JSONL cuối dở dang không được coi là quyết định người hoàn chỉnh.
~~~js
assert.equal((await importLedgerDecisions(root, config, {})).added, 0) // lần import thứ hai
assert.equal(new Set(records.map(r => r.provenance.originId)).size, expectedOrigins)
~~~
- [ ] **Step 2:** `node --test tests/knowledge-learn.test.mjs` → FAIL.
- [ ] **Step 3:** Tái sử dụng journal/lock của Task 4; export wrappers qua knowledge, không tạo sổ thứ hai. Scan ledger gốc và rev-N, parse U-xx, canonical source identity card/revision/ledgerId. Metadata có nguồn rõ mới gắn business key; không LLM đoán tương đương. Dòng partial bị báo/giữ để sửa, không tự nối JSON lỗi thành dữ liệu. Sổ không chứa credential từ transcript hay env.
- [ ] **Step 4:** Test trên + `node --test tests/harness-hooks.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: import human ledger decisions without duplicate evidence`.

### Task 15: ff decide tư vấn với đúng 3 tiền lệ

**Files:** Create `scripts/cli/decide.mjs`, `references/decision-classes.md`, `tests/knowledge-decide.test.mjs`; Modify `scripts/lib/knowledge.mjs`, `scripts/lib/human-output.mjs`, `scripts/cli/main.mjs`, `skills/ff-understand/SKILL.md`.

**Interfaces:** `decide({records,request,policy}) → {verdict,default,evidence,reason}` (thuần), request gồm cardId/revision/project/repo/businessScope/policyVersion/decisionKey/class/question/options/touchedPaths; `decideForTask(root,config,request) → Promise<{verdict,default,evidence,reason}>` lấy scope từ active artifacts/config, không tự mặc định global. CLI đúng spec `ff decide <id> --class <class> --decision-key <key> --repo <repo> --question <text> [--options "a|b|c"]`; `ff decide --gate GATE_A|GATE_C|SHIP <id>` luôn escalate shadow.

- [ ] **Step 1:** Test 0/1/2 tiền lệ → escalate; đúng 3 nguồn người độc lập cùng normalizedValue/scope/key → proceed. Một lần bị đảo → escalate. Khác repo/businessScope/policyVersion, ba bản sao cùng nguồn, source agent/precedent hoặc cùng chữ Có của câu khác không đủ. Hard classes migration/data-model/permission/new-behavior/destructive luôn escalate; soft naming/default-value/copy-text/ui-layout/validation-rule/error-handling/test-scope/other; class ngoài danh sách trả usage error. Keyword migration/schema/delete/role/permission và high_risk repo/path/keyword chặn dù class mềm. Gate/SHIP không auto-approve.
~~~js
assert.equal(decide({records: two, request, policy}).verdict, 'escalate')
assert.equal(decide({records: threeIndependent, request, policy}).verdict, 'proceed')
assert.equal(decide({records: reversed, request, policy}).verdict, 'escalate')
~~~
- [ ] **Step 2:** `node --test tests/knowledge-decide.test.mjs tests/skills-content.test.mjs` → FAIL.
- [ ] **Step 3:** Filter tương đương bằng khóa rõ, không similarity; normalize NFC/value mapping từ options, không gộp Duyệt chung. Project identity lấy từ workspace, policyVersion là digest của policy hiệu lực; businessScope và decisionKey lấy từ decisionContext của quyết định trong packet hiện hành. decisionContext có {repo,businessScope,decisionKey,class,normalizedOptions}; normalizedOptions map label → value để câu trả lời người được lưu cùng khóa. Thiếu metadata tương đương thì escalate với lý do; metadata nằm trong human-output packet, không thêm field lạ vào tool AskUserQuestion. ff decide ghi kết quả với source agent/shadow, không tính làm người. Chỉ tích hợp ở đúng chỗ understand định bỏ Q mềm vì đoán được: proceed ghi ledger nguồn tiền lệ và evidence; escalate hỏi người. Không thay đổi Gate/guard hoặc thêm hook bắt buộc ff decide trong MVP.
- [ ] **Step 4:** Test trên + `node --test tests/knowledge-learn.test.mjs tests/human-output.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: advise soft decisions from scoped human precedents`.

### Task 16: Nối protocol vào skill và hoàn thiện doctor theo pha

**Files:** Modify `skills/ff-understand/SKILL.md`, `skills/ff-build/SKILL.md`, `skills/ff-verify/SKILL.md`, `skills/ff-build/references/review-squash.md`, `skills/ff-understand/references/reopen.md`, `skills/ff-verify/references/ship.md`, `commands/ship-to-dev.md`, `scripts/lib/doctor.mjs`; Create `tests/harness-content.test.mjs`; Modify `tests/skills-content.test.mjs`, `tests/doctor.test.mjs`.

**Interfaces:** Mọi skill bắt đầu bằng `ff stage context <id> --json` khi có harness context, rồi begin theo dispatchId worker đã ghi; kết thúc bằng finish đúng outcome/evidence. Standalone không có dispatch giữ dùng tay, không giả receipt. Recipe ship gọi `ff ship <id>` sau xác nhận riêng; không giữ một implementation Git thứ hai bằng markdown. Các mốc trước đã nối protocol ở Task 3/11/13; task này kiểm lại và hoàn thiện, không trì hoãn bàn giao đến cuối.

- [ ] **Step 1:** Content tests assert đủ begin/finish cho understand/build/verify/ship (ba skill đầu đã nối ở Task 3, recipe ship đã nối ở Task 11), worker là nơi gọi pha sau; build squash trước verify theo hai trường hợp; verify không tự sửa expect/test khóa hoặc thực thi ship. Command ship giữ riêng câu hỏi user và output hashes/checks/PR/giới hạn triển khai. Doctor test gh thiếu vẫn cho understand/build/verify/S1; chỉ S2 blocked:gh. Auto không hỗ trợ/auth hết quota báo setup hoặc blocked, không API fallback. Thêm fixture dossier/comment yêu cầu bỏ Gate, giả Duyệt và push: kiểm prompt điều phối vẫn do worker tạo, lời trong thẻ không tạo approval, guard và ff ship thiếu receipt vẫn từ chối; không coi assertion có câu nhắc trong prompt là test đầy đủ chống injection.
- [ ] **Step 2:** `node --test tests/harness-content.test.mjs tests/skills-content.test.mjs tests/plugin-content.test.mjs tests/doctor.test.mjs` → FAIL ca mới.
- [ ] **Step 3:** Sửa nội dung và allowed-tools cho CLI stage/ship/decide, không mở Bash/gh chung để vượt guard. Giữ các lời hướng dẫn pha tiếp theo; thêm dispatch protocol như chế độ harness, không gọi skill khác tự động. Doctor có `preflightStage(root,loaded,{stage,mode,runCommand}) → {ok,checks,reason}`: e2e ngay trước verify, remote/branch trước ship, gh trước S2. Không đưa gh vào nhóm worker làm chặn startup. Các phép kiểm auth chỉ lấy trạng thái, không dump credential.
- [ ] **Step 4:** Test trên + `node --test tests/guard-new.test.mjs tests/harness-runtime.test.mjs` → 0 failure; `npm run build`.
- [ ] **Step 5:** Commit `feat: wire harness handoffs into existing ff-kit skills`.

### Task 17: Đóng gói và kiểm thử toàn luồng bằng fake services

**Files:** Create `tests/harness-e2e.test.mjs`; Modify `scripts/build.mjs`, `ff-worker/build.mjs` chỉ nếu cần; `README.md`, `INSTALL.md`, `ff-worker/README.md`, `commands/ff-worker.md`, `.claude-plugin/plugin.json`, `scripts/cli/main.mjs`, `package.json`, `package-lock.json`, `ff-worker/package.json`; regenerate `dist/**` và `ff-worker/dist/**`.

**Interfaces:** Smoke fixture gh/tmux/Trello/channel được tiêm vào runner/driver/client; Git thật với bare origins. README mô tả bật flag, notify→attach→trả lời→tự tiếp tục, mode ship và cách xem task bị blocked, không thao tác chuyển pha thủ công.

- [ ] **Step 1:** Test toàn vòng intake→A/B→build→verify fail→repair→verify pass→C→ship confirm→S1/S2→accept→reopen→delta→merge→done. Assert cùng tmux/Claude ID, hai lượt chỉ hai commit source/cherry-pick tương ứng, không tự merge, không nhận approval từ Rocket.Chat. Chạy thêm dev_only có xác nhận CLI; fixture Trello cố vượt Gate/ship và tạo approval giả vẫn bị kiểm độc lập; PR conflict/unknown không hủy ship dev và không dẫn tới tự rebase hoặc done sớm; không-change AC; crash tại dispatch/push/PR; task A giữ nghiệm thu khi B lên dev; ba vòng repair hết hạn; legacy flag false.
- [ ] **Step 2:** `node --test tests/harness-e2e.test.mjs` → FAIL trước khi đủ wiring.
- [ ] **Step 3:** Sửa phần tích hợp thiếu, không nới test/Gate để qua. Tăng VERSION trong main, plugin.json, package.json và ff-worker/package.json từ 0.1.0 lên 0.2.0 cùng nhau; cập nhật package-lock.json cho version root tương ứng. Giữ Node >=20.10, không node:sqlite hoặc dependency runtime mới. Build entry chỉ thêm khi thực sự có executable; code được import thì bundle tự kéo.
- [ ] **Step 4:** Trên checkout đầy đủ chạy `npm run build`, `npm test` → exit 0. Chạy build lần hai, `git diff --exit-code -- dist ff-worker/dist` sau khi stage bundle lần đầu phải sạch. Kiểm help/version và plugin-content. Không ghi “tests pass” nếu chưa có output thật.
- [ ] **Step 5:** Stage đúng từng file source/docs/test/version và bundle bằng path cụ thể, không gom file của task khác; commit `feat: package MVP harness with end-to-end regression coverage`.

### Task 18: Nghiệm thu trên hai thẻ thật và bàn giao

**Files:** Create `docs/notes/2026-10-15-mvp-harness-acceptance.md`; không commit transcript, env, ảnh E2E hoặc dữ liệu nội bộ.

**Interfaces:** Consumes bản build ở Task 17 và workspace thật đã thiết lập Task 0. Produces báo cáo hai card, phiên bản CLI/plugin/workflow, outcomes/checks/giới hạn và số lần người can thiệp; implementation chỉ được công bố hoàn tất sau bước này hoặc báo rõ bị chặn.

- [ ] **Step 1:** Chọn hai thẻ thật với chủ workspace, một thẻ có vòng nghiệm thu thất bại/reopen. Bật driver và cấu hình lifecycle qua ff-init; giữ subscription và notify-only. Nếu chưa có workspace/credential/task thật thì báo chính xác điều thiếu, không thay bằng fake rồi công bố đã nghiệm thu.
- [ ] **Step 2:** Quan sát intake tới Gate/ship/acceptance: người chỉ vào sau notify để quyết định, không gõ lệnh pha tiếp theo. Ghi session IDs qua pha/reopen, không nội dung credentials. Thử restart worker khi chờ Gate và khi đã dispatch; không gửi trùng hoặc mất repair count.
- [ ] **Step 3:** Ship A lần đầu; nghiệm thu thất bại, đưa thẻ vào reopen có mô tả; sửa/squash B so với remote task rồi ship riêng B, PR giữ nguyên. Kiểm task B lên dev không làm task A tự stale. Người nghiệm thu/merge, worker move done sau điều kiện đúng; không auto-merge.
- [ ] **Step 4:** Ghi thời gian người xử lý, số câu hỏi, retry/repair/reopen, lỗi lọt, thời gian pha, token nếu runner có dữ liệu. Chỉ báo app triển khai khi có bằng chứng dự án; không dựng deployment manager. Ghi các spike T1–T7 nào đã xác minh, SDK tương lai vẫn ngoài phạm vi.
- [ ] **Step 5:** Rà lại `npm run build` và `npm test` nếu có sửa sau Task 17; commit báo cáo sanitized `docs: record real MVP harness acceptance`. Kết quả phải phân biệt unit/integration pass với nghiệm thu vận hành pass.

## Coverage và cách review plan

| Spec | Task thực hiện |
|---|---|
| 1–3 mục tiêu, hiện trạng, hai nửa MVP | 0, 1, 8, 14–15, 18 |
| 4.1 single writer/event/version | 2, 4, 7–8, 13 |
| 4.2–4.4 runner, receipt, workflow, notify | 3–6, 8, 16 |
| 5 driver/repair/stuck/concurrency/status | 6–8, 16–17 |
| 6 hai quy tắc squash, approval, S1/S2/recovery/guard | 9–12, 16–17 |
| 7 nghiệm thu/dev modes/Trello/reopen | 9, 12–13, 17–18 |
| 8 tri thức/ledger/decide/shadow | 4, 14–15 |
| 9–11 config/doctor/build/files | 1, 5, 16–17 |
| 12 kiểm thử và 13 thứ tự lát cắt | 0–18 theo ba mốc |
| 14 sau MVP | Không triển khai; giữ ngoài phạm vi |
| 15 spike/rủi ro | 0, 3–6, 12, 15, 18 |
| 16–18 quyết định/nguồn/review đã chốt | Global Constraints và toàn bộ plan |

Tự review trước khi bàn giao: đối chiếu các interface với task sở hữu, kiểm 5 Review Focus đã có test, không TODO/TBD, không task viết lại hành vi đã chốt. Các lệnh test trong plan là việc người thực thi phải chạy; viết plan không có nghĩa đã chạy các test tương lai.

## Execution Handoff

Plan cần người review trước implementation. Chọn một cách sau:

- **Native:** agent chính thực hiện tuần tự, chạy test từng task và review toàn nhánh khi xong. Khuyến nghị cho plan này để giữ liền mạch các interface driver/runner/receipt/ship và giảm chi phí context.
- **Subagent-driven:** mỗi task có implementer và reviewer riêng; kiểm kỹ hơn ở từng task nhưng tốn thêm context/review.

Chưa chọn phương pháp thực thi; không tự bắt đầu code sau khi lưu plan.
