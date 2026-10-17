# ff-kit — Đặc tả yêu cầu phần mềm (SRS)

> Theo cấu trúc SRS của ISO/IEC/IEEE 29148:2018 (§9.6).
> Đây là **nguồn duy nhất** về mục tiêu, yêu cầu, hiện trạng và việc còn lại của ff-kit. Các spec/plan trước 2026-10-20 đã gộp vào đây và bị xóa khỏi cây làm việc; bản gốc xem bằng `git show bd06b4c:<đường dẫn>` (cột Nguồn).
> Phiên bản tài liệu: 1.0 (2026-10-20). Phiên bản ff-kit tại thời điểm viết: 0.2.4 (+ thay đổi chưa commit, xem §5.3).

## Quy ước

- **Mã yêu cầu** `<NHÓM>-<số>`; không tái sử dụng mã đã xóa.
- **Câu yêu cầu** dùng "phải" (bắt buộc), "nên" (khuyến nghị), "có thể" (tùy chọn).
- **Kiểm chứng** (29148 §6.5): T = test tự động, I = kiểm tra tài liệu/mã, D = chạy thử trên workspace thật, A = phân tích.
- **Trạng thái** (§4):
  - `KT` đã kiểm thật: có code + test và đã chạy trên task thật (có bằng chứng trên đĩa hoặc nhật ký).
  - `ĐC` đã code: có code + test tự động, chưa có bằng chứng chạy thật.
  - `TK` mới thiết kế: có trong đặc tả, chưa có code.
  - `ĐX` đề xuất: chưa được người dùng duyệt.
- **Nguồn**: mã ngắn ở Phụ lục A, kèm số dòng hoặc mục; `QĐ <ngày>` = quyết định của người dùng trong phiên làm việc.
- Thuật ngữ chung theo cấu hình (`base_branch`, `ship_branch`, `repos[]`…); không dùng tên dự án cụ thể.

---

## 1. Giới thiệu

### 1.1 Mục đích

Tài liệu mô tả ff-kit cần làm gì, vì sao, đã làm được đến đâu và còn lại gì, để mọi quyết định tiếp theo dựa trên một nguồn có truy vết thay vì nhiều spec/plan chồng chéo.

### 1.2 Phạm vi sản phẩm

**ff-kit** là plugin Claude Code + CLI `ff` + tiến trình `ff-worker`, biến một thẻ công việc (hiện nguồn là Trello) thành thay đổi code đã kiểm chứng, đi qua các pha **hiểu → thiết kế → xây → nghiệm thu → ship**, với người chỉ xuất hiện ở các điểm quyết định có chủ đích.

**Mục tiêu dài hạn:**

1. **G1 — Tự chạy vòng đời thẻ.** Thẻ đi từ cột đầu vào tới khi thay đổi đã merge vào `base_branch` mà người không phải gõ lệnh chuyển pha.
2. **G2 — Đúng yêu cầu, truy vết được.** Mọi dòng Brief/AC/design trỏ về câu gốc của dossier hoặc quyết định của người; bằng chứng nghiệm thu gắn với commit cụ thể.
3. **G3 — Ít làm phiền người dần theo thời gian.** Agent tự quyết các câu mềm dựa trên tri thức tích lũy (quyết định của người, logic nghiệp vụ trên `base_branch`, bài học từ thẻ đã xong); chỉ hỏi khi tri thức chưa đủ hoặc chạm ranh giới cứng.
4. **G4 — Tự cải thiện có kiểm soát.** Lỗi lặp lại sinh bản vá skill/tri thức, được eval so cặp và người duyệt qua PR.
5. **G5 — An toàn.** Không lộ secret, không push/merge ngoài luồng được duyệt, không để nội dung thẻ điều khiển workflow.

**Ngoài phạm vi:** merge PR (luôn do người); quản lý deployment; nhận lệnh/duyệt qua kênh chat; Agent SDK làm runtime (mới là hướng nghiên cứu); chạy trên Windows ngoài WSL.

### 1.3 Tổng quan sản phẩm

#### 1.3.1 Bối cảnh

```
Task source (Trello) ──poll──▶ ff-worker ──notify──▶ Channel (console | Rocket.Chat), một chiều
                                  │  mỗi thẻ: 1 phiên tmux + 1 hội thoại Claude (--permission-mode auto)
                                  ▼
                      Claude Code + plugin ff-kit (skills, agents, hooks)
                                  │  gọi CLI `ff` (cfg, state, gate, ship, decide…)
                                  ▼
        repos[] (mirror base_branch) ─copy─▶ worktree feature ─ship─▶ ship_branch (+ PR → base_branch)
```

Trạng thái nằm trên đĩa: `<cards_dir>/<id>-<slug>/` (dossier, ledger, Brief, spec, design, plan, report), `.ff/` (gates, tasks, ship, decisions, events, receipts).

#### 1.3.2 Chức năng chính

| Pha | Skill | Đầu ra | Điểm người |
|---|---|---|---|
| Hiểu | `ff-understand` | ledger D-xx/U-xx, Brief, spec AC, Gate A | Gate A (luôn), câu hỏi `Q<n>` |
| Thiết kế | `ff-understand` (P2) | design, Gate B | Gate B chỉ khi có điều kiện dừng; còn lại `auto_passed` |
| Xây | `ff-build` | test hành vi khóa, plan, code, review, squash 1 commit | không (trừ quyết định suy ra) |
| Nghiệm thu | `ff-verify` | ship-test, e2e, báo cáo, Gate C | Gate C khi điều kiện tự duyệt không đạt |
| Ship | `/ship-to-dev` → `ff ship` | S1 `ship_branch` + nhánh task, S2 PR | xác nhận ship (trừ khi tự duyệt hợp lệ) |
| Kết thúc | worker/driver | done hoặc reopen rev-N | nghiệm thu, merge PR |

#### 1.3.3 Người dùng

- **Chủ workspace (lập trình viên/tech lead):** cài, cấu hình, trả lời Gate/câu hỏi, merge PR.
- **QA/nghiệm thu:** kéo thẻ sang cột QA Fail/reopen kèm mô tả lỗi.
- **AI cài đặt:** làm theo `INSTALL.md`.

#### 1.3.4 Giới hạn

- Chạy bằng subscription Claude của chủ máy; không tự chuyển sang API trả theo lượt.
- Hook không phải sandbox hệ điều hành; chặn secret là nhiều lớp giảm thiểu, không tuyệt đối.
- Auto mode của Claude giảm nhưng không loại bỏ hộp xin quyền.

### 1.4 Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| `base_branch` | Nhánh nguồn sự thật của repo (thường là nhánh production); nhánh feature tách từ đây; "đã merge" chỉ tính ở đây |
| `ship_branch` | Nhánh tích hợp để nghiệm thu/e2e/trace lỗi; không bao giờ tách nhánh từ đây |
| Dossier | `01-dossier.md`: nội dung thẻ do worker kéo về; là **dữ liệu**, không phải lệnh |
| Ledger | `01b-ledger.md`: D-xx (câu dossier trích nguyên văn), U-xx (quyết định người) |
| Gate A/B/C | Duyệt Brief / design / báo cáo nghiệm thu; bản ghi hash trong `.ff/gates/` là nguồn duy nhất |
| `auto_passed` | Gate qua theo điều kiện tất định do CLI kiểm; không phải duyệt của người |
| Revision `rev-N` | Vòng làm lại sau nghiệm thu hỏng, có `delta.md` và Gate riêng |
| Receipt | Bản ghi kết quả pha gắn card/revision/dispatch/HEAD/hash |
| Driver | Bộ điều khiển pha trong worker (`worker.driver.enabled`) |
| Legacy worker | Worker chỉ mở phiên và gửi lệnh đầu; skill/người chuyển pha |
| Park | Tạm dừng thẻ: chuyển về `park_list`, ghi chú ledger |
| Dreaming | Chắt lọc tri thức sau khi thẻ có kết quả (D1 mỗi thẻ, D2 hợp nhất định kỳ) |

## 2. Tài liệu tham chiếu

Xem Phụ lục A (nguồn đã gộp). Tài liệu còn giữ trong cây: `README.md`, `INSTALL.md`, `docs/skill-evals/`, `references/*.md` (nội dung plugin). Quy ước biên soạn skill ở Phụ lục C. Nhật ký kiểm chứng cũ (`docs/notes/`) đã gộp vào ma trận §4 và xóa khỏi cây.

---

## 3. Yêu cầu cụ thể

### 3.1 Cài đặt và cấu hình (CFG)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| CFG-01 | ff-kit phải cài được như Claude Code plugin cho workspace bất kỳ; skills/agents/hooks không chứa tên dự án, đường dẫn hay lệnh cứng — mọi giá trị lấy qua `ff cfg get`. | S-PKG D1,D9 | T (plugin-content) |
| CFG-02 | Cấu hình là một file `ff.config.yaml` (schema v1: workspace, repos[]{name,path,base_branch,ship_branch,commands}, e2e, project_docs, db, guard, engine, worker, secrets, ship, verify, knowledge) kèm `ff.config.lock.json` ghi nguồn từng giá trị. | S-PKG §4 | T |
| CFG-03 | `/ff-init` phải dò workspace, hỏi khi mơ hồ, ghi config/lock/`.ff.env.example`/khối CLAUDE.md/deny-ask/.gitignore, chạy doctor và báo cáo; không bao giờ tự bật worker; chạy lại chỉ hỏi phần đổi. | S-PKG §4.3 | I, D |
| CFG-04 | LLM chỉ dùng lúc init; runtime chỉ đọc YAML đã qua validator tất định. | S-PKG D3 | I |
| CFG-05 | Secret chỉ nằm trong `.ff.env`; YAML không chứa token; mọi công cụ chỉ báo có/thiếu key. | S-PKG §4.4 | T |
| CFG-06 | `INSTALL.md` phải đủ để một AI tự cài (tiền kiểm, tmux, plugin, công cụ agent, CLAUDE.md, e2e, ff-init), chạy lại an toàn, không sudo ngầm, không bật worker. | S-PKG §8 | D |
| CFG-07 | CLI `ff` phân giải từ snapshot đã ghim của task; không fallback sang `ff` global. | S-MVP §4.3 | T |
| CFG-08 | Mã nguồn Node ESM, bundle esbuild vào `dist/` được commit; build tất định; runtime deps chỉ `yaml`, `ajv`. | P-P1; N-ACC | T |
| CFG-09 | Mỗi lần phát hành tăng version ở `.claude-plugin/plugin.json`, `package.json`, `ff-worker/package.json` cùng lúc (CLI đọc version từ `package.json`); repo giữ một commit squash trên main. | S-MVP §10; QĐ 2026-10-19 | I |
| CFG-10 | Thông báo người dùng bằng tiếng Việt; exit code CLI: 0 ok, 1 kiểm đỏ, 2 sai cách dùng/guard chặn, 3 thiếu key, 4 config chưa sẵn sàng. | P-P1 | T |
| CFG-11 | Khối CLAUDE.md và quy tắc permissions do `/ff-init` ghi phải sinh từ config: nhánh nói theo `base_branch`/`ship_branch`, trạng thái worker/driver theo `worker.*`, file chặn đọc theo `secrets`. `ff doctor` phải cảnh báo kèm cách sửa khi khối này lệch config hiện tại (ví dụ ghi "worker chưa cấu hình" trong khi có `worker.task_source`, hoặc ghi nhánh làm việc khác `base_branch`). | QĐ 2026-10-20 (rà workspace thật) | T |

### 3.2 Doctor (DOC)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| DOC-01 | `ff doctor` tất định, kiểm ba nhóm: core (schema, repo, nhánh, lệnh, nguồn), worker (key adapter), e2e (Playwright, chromium, auth); ghi `.ff/doctor.json`. Core đỏ → `ff cfg get` từ chối; worker đỏ → không start worker; e2e đỏ → không verify. | S-PKG §4.2 | T |
| DOC-02 | Doctor kiểm khả năng của Claude CLI (auto mode, `--remote-control`) và cảnh báo thiếu `codegraph`/plugin Playwright. | S-VER A; S-PKG | T |
| DOC-03 | Mỗi lỗi doctor phải nói rõ cách sửa. | P-RM19 0.3.0 (N5) | T |
| DOC-04 | Hook SessionStart chạy doctor, đưa kết quả vào ngữ cảnh, không chặn phiên; cảnh báo lệch phiên bản plugin/CLI. | S-PKG; S-MVP §10 | T |

### 3.3 Pha hiểu và thiết kế (UND)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| UND-01 | Trước khi đọc code, agent lập ledger: mỗi câu dossier thành D-xx trích nguyên văn; quyết định người thành U-xx. | S-PKG D10 | T (trace) |
| UND-02 | Mọi dòng Brief/AC/design phải có cột Nguồn trỏ D-xx/U-xx; `ff trace-check` đỏ thì không trình được Gate. Chỉ kiểm tài liệu của revision hiện tại (rev-N lớn nhất; chưa có revision thì mọi tài liệu); tài liệu revision trước/gốc là lịch sử đóng băng, chỉ được tính là đã phủ D-xx, không bị kiểm lại theo luật mới. | S-PKG §5.2 | T |
| UND-03 | Agent chỉ dừng hỏi ở 4 ranh giới cứng (không đảo ngược/ghi đè dữ liệu; hành vi dossier không xin; hai cách hiểu → mô hình dữ liệu khác; quyền/role); các câu mềm tự quyết kèm căn cứ hoặc qua `ff decide`. | SKILL ff-understand | I, D |
| UND-04 | Câu hỏi dùng `AskUserQuestion` header `Q<n>` (≤4 câu/lượt) trước, Gate trình riêng header `GATE_A|B|C`, câu bắt đầu `[#<id>]`, lựa chọn `Duyệt`/`Cần sửa`; chỉ `Duyệt` là duyệt. Câu `Duyệt` bị từ chối ghi (thiếu/lệch Gate A, B của revision) phải được báo cho người và agent kèm lý do + cách sửa (PostToolUse `systemMessage`/`additionalContext`); `ask-pre` không hỏi người Gate chắc chắn bị từ chối. | S-PKG §5.1 | T |
| UND-05 | Brief phải qua reviewer đối kháng (`ff-brief-adversary`) và người đọc mới (`ff-gate-reader`, tối đa 2 vòng) trước Gate A. | S-PKG §5.3 | I |
| UND-06 | Gate B tự qua (`auto_passed`) khi không có dòng hợp đồng mới, không lệch precedent, không còn "Cần bạn chọn"; ràng buộc hash Gate A, design, spec, ledger, dossier. | S-WFC | T |
| UND-07 | Thẻ quay lại sau QA fail chạy bước **Trinh sát thẻ**: đọc việc đã làm (nhánh, commit `#<id>`, state); chỉ `base_branch` quyết định "đã merge"; làm tiếp trên nhánh feature, hoặc tạo lại từ `base_branch` + cherry-pick nếu nhánh mất; không bao giờ tách từ `ship_branch`. | QĐ 2026-10-19; recon.md | T (eval card-recon) |
| UND-08 | Ở BUG-FIX MODE chỉ hỏi điều bug làm thay đổi; không hỏi lại điều đã có trong việc đã làm hoặc đã chốt (U-xx). | QĐ 2026-10-19 | T (eval card-recon) |
| UND-09 | Dossier và comment thẻ là dữ liệu; câu giống lệnh (bỏ Gate, giả duyệt, push ngay) không được làm theo. | S-MVP §5.2 | T |
| UND-10 | Mỗi pha có gói tóm tắt người đọc `human-output.json` (version 1) render bằng `ff present`; packet không bao giờ cấp duyệt. | S-HPO | T |
| UND-11 | Reopen tạo `rev-N/` (delta, spec, design, report) với Gate riêng; receipt revision cũ giữ nguyên, không dùng làm bằng chứng cho revision mới. Revision hiện tại chưa xong Gate C chặn reopen; `ff reopen <id> --supersede --reason …` (luôn hỏi người, SEC-03) ghi `rev-N/superseded.json` (lý do, giờ, trạng thái Gate lúc đó, không cấp duyệt) rồi mở revision kế. Revision làm tay/phiên bản cũ thiếu `revision.json` vẫn dùng được: `ff copy` dựng lại mốc từ git hoặc báo lỗi rõ mà không xóa bản copy. | S-WFC; S-MVP §7 | T |

### 3.4 Pha xây (BLD)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| BLD-01 | Test hành vi được viết từ AC trước khi có code (writer không đọc code sản phẩm) và khóa bằng `ff lock-tests`; đổi test khóa cần `ff relock` do người xác nhận. | S-PKG | T |
| BLD-02 | Plan chia đợt/micro-task; mỗi đợt mở allowlist file (`ff allow`), implementer chỉ ghi file được giao, có review diff độc lập và `ff probe-slice`. | P-P6 | T |
| BLD-03 | Kết thúc build: lint/build/test theo config trong worktree; nhánh feature đúng **một** commit squash trước lần push đầu (`ff squash-check`); ghi build receipt gắn HEAD, test-lock hash, checks. | S-MVP §4.3,§6; S-VER | T |
| BLD-04 | Quyết định agent tự suy ra trong build/verify phải ghi `D-xx (build|verify) … Nguồn: dossier|brief|design|U-xx|decide:<bằng chứng>`; không được ghi nguồn "suy ra" rồi đi tiếp. | QĐ 2026-10-20 (N6) | T |

### 3.5 Pha nghiệm thu (VER)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| VER-01 | Verify chạy trên nhánh cục bộ `ff-test/<id>` = `origin/<ship_branch>` + commit squash của feature (`ff ship-test`), trong checkout riêng; conflict → `needs_human`. | S-VER B | T |
| VER-02 | Receipt verify ràng buộc ba SHA (feature, base ship đã test, cherry-pick đã test); đổi bất kỳ → mất hiệu lực. | S-VER | T |
| VER-03 | Môi trường bật/tắt bằng `ff verify-up/down`; một thẻ verify một lúc (`verify-lock`). | S-PKG; S-WFC | T |
| VER-04 | `e2e.services` để ff-kit tự bật dịch vụ theo repo (thay `up_cmd/down_cmd`). | N-RUN | T, D |
| VER-05 | Mỗi AC ghi bằng chứng UI/network/console/DB (DB chỉ SELECT/EXPLAIN qua `ff db-query`); phân biệt `N/A` và `UNVERIFIED`; quan sát UX không thay PASS. | S-PKG; S-HPO | I |
| VER-06 | AC FAIL do implement → quay build sửa trong cùng phiên rồi verify lại; tối đa 3 vòng mỗi revision, restart không reset bộ đếm; hết vòng → escalate cho người. | S-MVP §5.1; QĐ 2026-10-20 | T |
| VER-07 | Gate C tự qua (`auto_passed`) chỉ khi CLI kiểm tất định: mọi AC PASS (hoặc UNVERIFIED do hạ tầng ngoài được tri thức cho phép — VER-08), không FAIL hồi quy, ship-test sạch, test lock nguyên, không câu hỏi treo, mọi D-xx build/verify có nguồn hợp lệ. Không đạt → trình Gate C cho người kèm lý do. | QĐ 2026-10-20 (N6) | T |
| VER-08 | AC không kiểm được vì hạ tầng ngoài không tái hiện cục bộ chỉ được miễn khi **tri thức** cho phép (quyết định của người qua `ff decide`, sau này wiki); không dùng danh sách cấu hình cứng. Thiếu seed/data/tài khoản/env không phải ngoại lệ. | QĐ 2026-10-20 | T |
| VER-09 | Test hành vi của thẻ đã kết thúc (WRK-10/12) phải được chuyển vào một thư mục duy nhất `e2e.done_tests_dir` (mặc định `<tests_dir>/task-done`) và tiếp tục chạy như bộ hồi quy; skill, template và CLI chỉ tham chiếu thư mục này qua `ff cfg get`, không viết tên cứng. | QĐ 2026-10-20 (rà workspace thật) | T |

### 3.6 Ship và nhánh (SHP)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| SHP-01 | Nhánh feature tách từ `base_branch`; `ship_branch` chỉ để nghiệm thu, e2e, trace lỗi. Nghiệm thu hỏng thì sửa tiếp trên nhánh feature. | S-PKG D22; QĐ 2026-10-19 | I |
| SHP-02 | `ff ship <id>` S1: cherry-pick `-x` commit của lượt lên `ship_branch` trong checkout riêng, build/test, push `ship_branch` và nhánh task (không force); dùng lại commit đã test nếu `ship_branch` chưa tiến. S2 (chỉ `dev_and_pr`): tạo/cập nhật PR vào `base_branch`. | S-MVP §6; S-VER | T |
| SHP-03 | Lần ship đầu squash từ mốc tách `base_branch`; lần sau squash riêng phần sửa mới so với nhánh task trên remote; không viết lại lịch sử đã push. | S-MVP §6 | T |
| SHP-04 | Máy trạng thái `.ff/ship/<id>.json` theo revision/repo/chặng; phục hồi sau crash bằng đối chiếu remote, không lặp tác động. | S-MVP §6 | T |
| SHP-05 | Ship cần phê duyệt ràng buộc card/revision/HEAD/đích (TTL 2 giờ): do người (`ff ship-approve`, luôn hỏi) hoặc tự động (`--auto`) chỉ khi Gate C `auto_passed` khớp hash. | S-MVP §6; QĐ 2026-10-20 | T |
| SHP-06 | Agent và `ff ship` không bao giờ merge PR, push `base_branch`, force push, tự rebase khi PR conflict. | S-MVP §6 | T |
| SHP-07 | Sau ship tự động phải notify người (AC được miễn, quyết định tự làm, commit đã lên). | QĐ 2026-10-20 | T |

### 3.7 Worker, driver, vòng đời thẻ (WRK)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| WRK-01 | Worker poll task source theo `poll_lists`, kéo dossier về `<cards_dir>/<id>-<slug>/`, chuyển cột, notify; skill không gọi API task source. | S-PKG §6 | T, D |
| WRK-02 | Adapter: TaskSource `trello`; Channel `console`, `rocketchat`; kênh chỉ một chiều, lỗi gửi không chặn task. | S-PKG D5,D6 | T |
| WRK-03 | `ff worker start|stop|status|logs|resolve|park`; chạy trong tmux có supervisor (restart có giới hạn), tự reload khi config/`.ff.env` đổi; HTTP local chỉ 127.0.0.1 + token. | S-PKG §6 | T, D |
| WRK-04 | Mỗi task một phiên tmux + một hội thoại Claude (`--session-id` do worker cấp, `--resume` khi mất tiến trình, `--permission-mode auto`, `--remote-control` mặc định bật) xuyên mọi pha và revision; không kill/clear khi đổi pha. | S-MVP §5.2; S-VER A | T, D |
| WRK-05 | `ff worker status` hiện từng thẻ: pha, đang chờ ai (người: câu hỏi/quyền; agent), bao lâu, cách vào phiên. | S-MVP §5.5; QĐ 2026-10-19 (N1) | T |
| WRK-06 | Lifetime phiên chỉ tính thời gian agent làm việc, không tính lúc chờ người. | S-MVP §5.3; N1 | T |
| WRK-07 | Thẻ fail do hệ thống (quá lifetime, launch lỗi ≥3) → **park**: chuyển `park_list`, ghi chú ledger, không comment; người dừng thẻ qua chat → park + comment; tiếp tục = người kéo thẻ về cột làm việc. Không có trạng thái "failed" chết. | QĐ 2026-10-19 | T |
| WRK-08 | **Driver** (`worker.driver.enabled`) là nơi duy nhất ghi vòng đời task và gọi pha kế tiếp (`nextStage`); hooks/ship/watcher chỉ phát sự kiện; sự kiện bền, dedupe; receipt gắn dispatch. Thẻ làm tay/phiên bản cũ khi driver thấy lần đầu được **nhận** từ thư mục thẻ (revision hiện tại, Gate nào có receipt khớp hash, artifact nào có): không bao giờ tạo duyệt hay receipt pha; Gate thiếu/lệch thành pending để người được hỏi; ghi `adoption`, lịch sử `adopted` và một thông báo. | S-MVP §4.1,§5 | T |
| WRK-09 | Driver đặt `waitingOn` (Gate, ship_confirm, verify_lock, setup, stuck, needs_human), notify một lần; `stuck` sau 90 phút không đổi; `max_stage_retries` 3. | S-MVP §5.3-5.4 | T |
| WRK-10 | **Kết thúc thẻ** (khi bật driver): `dev_and_pr` → done khi mọi PR bắt buộc đã merge và head lúc merge khớp source HEAD đã duyệt (ship-watch qua forge); `dev_only` → done khi người xác nhận nghiệm thu trong CLI. Legacy worker: thẻ xong khi nằm ở `done_list` (mới giao nghiệm thu, chưa merge); riêng khi `ship.done_on` là `base_branch|either` và mọi repo đã ship (S1) có thay đổi đã vào `base_branch` (WRK-12, cùng ngữ nghĩa driver) thì đóng task, chuyển thẻ sang `done_list`, ghi `doneVia=base_branch`; nội dung `edited` hoặc chưa đủ bằng chứng thì không tự đóng. | S-MVP §7 | T, D |
| WRK-11 | Reopen tự động khi thẻ về cột reopen/QA fail có mô tả lỗi mới (bỏ comment `[ff]`), tối đa `max_reopen`; PR đã merge/đóng hoặc task done → thẻ Fix mới. | S-MVP §7 | T |
| WRK-12 | Phát hiện "thay đổi của task đã vào `base_branch`" phải hoạt động cả khi không dùng PR/forge (merge tay, squash, cherry-pick). | QĐ 2026-10-20 | TK |
| WRK-13 | Adapter task source có thể cung cấp thao tác đọc cột/thẻ và tạo thẻ (`ff task …`), lấy board và secret từ config, để workspace không phải tự viết script đọc file secret. Câu hỏi mở: có thuộc phạm vi ff-kit không. | QĐ 2026-10-20 (rà workspace thật) | T |
| WRK-14 | **Đối chiếu task với cột Trello** (`ff task reconcile [--apply] [--json]`; mặc định chỉ in bảng kế hoạch): thẻ ở `done_list`/`accept_list` → đóng task là "đã giao, chờ QA" (nhả slot, chưa coi là nghiệm thu); thẻ ở cột sau QA và có bằng chứng đã giao (Gate C/acceptance) → đóng "đã nghiệm thu" (`doneVia=task_source`); task giữ slot mà thẻ đã rời `poll_lists` và không còn phiên tmux → nhả slot; thẻ ở `park_list` khớp task tạm dừng → giữ nguyên; thẻ không thấy trên board hoặc cột lạ không bằng chứng → chỉ báo. Chỉ ghi state cục bộ (khóa task, bỏ qua nếu task đổi giữa chừng); không bao giờ move/comment thẻ, xóa worktree/nhánh (chỉ nhắc "có thể dọn") hay đụng Gate receipt; đóng tmux chỉ khi không ai attach. Worker chạy cùng logic (chỉ nhả slot/đóng) khi khởi động và mỗi vòng poll. Chuyển test sang `e2e.done_tests_dir` (VER-09) vẫn là việc tay. | QĐ 2026-10-24 (workspace thật: thẻ 134/136/93/186) | T |

### 3.8 Tri thức và tự quyết (KNW)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| KNW-01 | Sổ `.ff/decisions.jsonl` nối thêm, ghi mọi câu trả lời Gate/Q (kể cả "Cần sửa") kèm câu hỏi, lựa chọn, provenance; `ff learn` nạp ngược U-xx từ ledger, idempotent. (Class/decisionKey: KNW-04.) | S-MVP §8.1 | T |
| KNW-02 | `ff decide` chỉ `proceed` khi: lớp mềm (danh sách đóng), không khớp từ khóa rủi ro cứng (`migration`, `schema`, `delete`, `role`, `permission`) hay `knowledge.high_risk`, ≥ `min_precedents` (3) quyết định độc lập của người cùng phạm vi/khóa/giá trị, chưa bị đảo. Dữ liệu agent/tiền lệ không tính là người. | S-MVP §8.2-8.3 | T |
| KNW-03 | Tri thức không cấp quyền Gate/ship và không nới 4 ranh giới cứng; `ff decide --gate` luôn escalate (chế độ bóng, ghi đặc trưng để đo). | S-MVP §8.3 | T |
| KNW-04 | Mọi câu trả lời được ghi có cấu trúc (class/decisionKey) ngay từ hook, để dùng được làm tiền lệ. | P-RM19 GĐ3; N3 | TK |
| KNW-05 | Ghi kết quả thẻ: sự kiện `outcome_recorded` (QA pass/fail, merge) và `escape_recorded` ("vì sao lọt" A/B/C/D, skill, bằng chứng, người xác nhận ngả lỗi ở Gate A của revision). | P-RM19 GĐ3; N2 | TK |
| KNW-06 | **Tri thức nền** là logic nghiệp vụ đọc từ code trên `base_branch` của từng repo (quy tắc, trạng thái, quyền, ràng buộc dữ liệu), mỗi mục trỏ `file:line@sha`; cập nhật theo phần code bị chạm khi `base_branch` đổi. | QĐ 2026-10-20 | ĐX |
| KNW-07 | **Dreaming D1** chạy khi thẻ kết thúc (WRK-10/12): bồi/sửa tri thức từ diff đã merge, Brief, U-xx, kết quả QA; mâu thuẫn với code `base_branch` thì code thắng và ghi để người xem. **D2** hợp nhất wiki khi đủ N thẻ mới và ≥7 ngày. Chỉ chạy trong cửa sổ rảnh theo quota (5h <50%, 7 ngày <70%). | S-MVP §14; QĐ 2026-10-20 | TK |
| KNW-08 | Wiki dự án là markdown người đọc/sửa được; chỉnh sửa của người là chỉ dẫn mới nhất; `ff recall` truy xuất theo file/symbol đã chạm. | S-MVP §14 | TK |
| KNW-09 | `ff decide` tra cả tiền lệ và wiki; agent tự quyết câu mềm ở mọi pha (kể cả understand) khi `proceed`, ghi nguồn, liệt kê ở Gate kế tiếp. | QĐ 2026-10-20 | ĐX |
| KNW-10 | Tin dần theo lớp: mỗi lớp câu hỏi chạy chế độ bóng (vẫn hỏi, ghi dự đoán) đến khi độ khớp đủ ngưỡng mới tự quyết; người trả lời ngược → lớp về chế độ bóng. | S-MVP §14 | TK |

### 3.9 Tiến hóa skill và eval (EVO)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| EVO-01 | Mỗi thay đổi skill kèm bảng so cặp chạy trên fixture (`docs/skill-evals/fixtures/<suite>/`: dossier, git-facts, expected, results) trước khi phát hành; nhãn `sửa được`/`không đổi`/`tệ đi`/`nhiễu`; đề xuất khi ≥1 sửa được và 0 tệ đi. Bộ fixture hiện chưa thống nhất định dạng và nhãn (xem R9). | S-MVP §14.1; P-RM19 GĐ2 | I |
| EVO-02 | Bộ fixture bồi từ thẻ thật (mỗi lỗi lọt thành một ca hồi quy). | P-RM19 (N4) | TK |
| EVO-03 | Runner `ff eval run|grade|report` chạy không người (worktree theo ref, `claude -p`, grader mù A/B). Hoãn tới khi cần eval không người. | S-E0 | ĐX |
| EVO-04 | Cùng skill + cùng ngả "vì sao lọt" ở ≥2 thẻ → soạn hai ứng viên vá (plugin chung / tri thức dự án), eval, mở PR nháp; người duyệt, không tự merge; ghi `EXPERIENCE.md`. | S-MVP §14.1 | TK |

### 3.10 An toàn (SEC)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| SEC-01 | `.ff.env` và file secret trong config bị chặn đọc bằng ba lớp (permissions.deny, guard hook, luật CLAUDE.md); không công cụ nào in token. | S-PKG §4.4 | T |
| SEC-02 | Guard chặn: ghi `.ff/**` và metadata; marker duyệt giả; ghi artifact Gate bằng Bash; `git push` không có phê duyệt ship hợp lệ; `git add -A`, `commit -a`, `stash`; `gh pr create/merge` ngoài luồng ship. | S-PKG §5.4; S-MVP §6 | T |
| SEC-03 | `ff ship-approve` (không `--auto`), `ff relock`, `ff worker resolve`, `ff reopen … --supersede` luôn bắt người xác nhận; skill không được cấp các lệnh này. | S-PKG D23 | T |
| SEC-04 | `ff db-query` chỉ SELECT/EXPLAIN trong transaction read-only có timeout. | S-WFC | T |
| SEC-05 | Đường dẫn từ config/người nhập phải chặn path traversal; Git/tmux nhận tham số qua argv, không nội suy shell. | P-P2; P-MVP | T |
| SEC-06 | `ff doctor` phải cảnh báo khi `permissions.allow` trong `.claude/settings*.json` của workspace bao trùm lệnh SEC-03 (ví dụ `Bash(ff worker *)` gồm cả `ff worker resolve`) hoặc file secret khai trong config; quy tắc allow do `/ff-init` ghi chỉ liệt kê lệnh chỉ đọc. | QĐ 2026-10-20 (rà workspace thật) | T |

### 3.11 Yêu cầu phi chức năng (NFR)

| ID | Yêu cầu | Nguồn | KC |
|---|---|---|---|
| NFR-01 | Bền sau restart: mọi trạng thái trên đĩa, ghi nguyên tử, khóa + stateVersion; không thực thi hai lần, không retry mù khi không rõ đã gửi. | S-MVP §4.1 | T |
| NFR-02 | Không vượt `max_concurrent_tasks`; task chờ người/khóa không chiếm suất. | S-MVP §5.3 | T |
| NFR-03 | Nền tảng: macOS, Linux; Node ≥ 20.10. | S-PKG | I |
| NFR-04 | Đo vận hành: số lần hỏi, thời gian người xử lý, thời gian chờ, retry, reopen, lỗi lọt; không coi giảm câu hỏi là thành công nếu tổng công sức review tăng. | S-MVP §12 | TK |

---

## 4. Kiểm chứng và truy vết

Bảng trạng thái được kiểm bằng code và test ở commit hiện tại; trạng thái `KT` cần bằng chứng chạy thật. Cột "Bằng chứng" ghi file code/test hoặc dữ kiện chạy thật.

<!-- MATRIX:BEGIN -->
Kiểm chứng ngày 2026-10-20 trên working tree (gồm N1/N6 chưa commit). Các file test liên quan đều pass khi chạy riêng. Bằng chứng chạy thật chỉ lấy từ `.ff/` và thư mục thẻ của một workspace thật (không đọc secret).

| ID | Trạng thái | Bằng chứng code | Test | Bằng chứng chạy thật | Ghi chú |
|---|---|---|---|---|---|
| CFG-01 | KT | `hooks/hooks.json:1-26` (hook dùng `${CLAUDE_PLUGIN_ROOT}`); `scripts/lib/config.mjs:143` (getKey); `scripts/cli/cfg.mjs:52` | `tests/plugin-content.test.mjs:13` "plugin content has no workspace-specific paths or names"; `skills-content.test.mjs:98,103` | tiniweb có `.ff/` do hook/CLI plugin tạo (gates/, tasks/, decisions.jsonl, doctor.json) | Plugin chạy thật trên workspace khác ff-kit. |
| CFG-02 | KT | `schema/ff.config.schema.mjs` (properties: version, workspace, repos, e2e, project_docs, db, guard, engine, worker, secrets, ship, verify, knowledge; required: version, workspace, repos, worker, secrets); `scripts/lib/lock.mjs:1`; `scripts/lib/schema.mjs:8` | `tests/config.test.mjs` "validate bắt thiếu repos, khóa lạ…", "validate khối e2e…"; `tests/lock.test.mjs`; `doctor.test.mjs:146` "thiếu lock → đỏ" | tiniweb có `ff.config.yaml` + `ff.config.lock.json` (chỉ kiểm tồn tại); `.ff/doctor.json` ok=true | Chỉ xác nhận lock tồn tại, không đọc nội dung nguồn. |
| CFG-03 | KT | `skills/ff-init/SKILL.md:9-33` (dò, ghi config/lock, `ff env-example`, doctor, báo cáo); `references/{detect,env-keys,report}.md` | `tests/skills-content.test.mjs:233` "ff-init infers e2e.services…"; `env.test.mjs:34,44` (mergeEnvExample) | tiniweb có config + lock + `.ff.env` + CLAUDE.md và doctor xanh | Không kiểm được từng bước init (khối CLAUDE.md, deny/ask, .gitignore) từ phía thật; không có test tự động cho "không tự bật worker". |
| CFG-04 | KT | `scripts/lib/config.mjs:75-94` (YAML → merge DEFAULTS), `scripts/lib/schema.mjs:8-41` (validator Ajv tất định); runtime không gọi LLM | `tests/config.test.mjs` (toàn bộ); `doctor.test.mjs:137` "schema sai → chỉ báo schema" | doctor.json xanh trên tiniweb | Yêu cầu kiểu I; chứng cứ gián tiếp qua validator. |
| CFG-05 | KT | `scripts/lib/env.mjs:62-79` (chỉ trả tên key); `doctor.mjs:212-222` (báo thiếu key, không in giá trị) | `tests/env.test.mjs:57` "ff env-example không đọc .ff.env"; `doctor.test.mjs:31` "…không lộ secret"; `doctor.test.mjs:110` | doctor.json groups.worker=true với `.ff.env` có mặt (không đọc file) | Không kiểm YAML-không-chứa-token ngoài schema. |
| CFG-06 | ĐC | `INSTALL.md:8-9,45-53` (tiền kiểm, tmux, ff-init, doctor; worker chỉ bật tay) | `tests/plugin-content.test.mjs:32` "plugin docs state secret and worker boundaries" (chỉ kiểm ranh giới secret/worker) | không tìm thấy (không có log AI tự cài) | KC=D chưa có phiên cài-bằng-AI nào làm chứng; "không sudo ngầm" chưa có test. |
| CFG-07 | ĐC | `scripts/lib/stage-receipts.mjs:42` (validateWorkflowPin); `scripts/lib/workflow-snapshot.mjs:55-104` (requirePin, PATH = pinned binDir trước); `doctor.mjs:87-96` | `tests/stage-receipts.test.mjs:200` "…missing workflow pins fail closed"; `harness-e2e-repair.test.mjs:149`; `doctor.test` workflow pin | không tìm thấy: tiniweb không có `.ff/workflows/`, `tasks/*.json` không có khóa `workflow` | Driver thật chưa chạy với snapshot đã ghim. PATH vẫn nối PATH hệ thống phía sau (`workflow-snapshot.mjs:104`) — fallback bị chặn bởi thứ tự, không bị loại bỏ. |
| CFG-08 | ĐC | `scripts/build.mjs:1-30` (esbuild bundle → dist/); `package.json` deps chỉ `ajv`,`yaml` (+ esbuild dev); `git ls-files dist` có dist/cli.mjs, guard.mjs, hooks/* | không tìm thấy test kiểm dist mới/tất định/deps (KC ghi T) | `dist/` đang chạy qua `bin/ff` + hooks trên tiniweb | Thiếu test dist-fresh/deterministic. dist đang `M` trong working tree. |
| CFG-09 | ĐC | `.claude-plugin/plugin.json` version 0.2.4; `package.json` 0.2.4; `ff-worker/package.json` 0.2.4; CLI VERSION lấy từ package.json (`scripts/cli/main.mjs:33`) | không có test (KC=I); `doctor.test.mjs:255` chỉ kiểm lệch plugin/CLI | `git log` chỉ 1 commit bd06b4c | Không có file `VERSION` riêng như SRS ghi; thực tế "VERSION của CLI" = package.json. ff-worker/package.json là nơi thứ 3 phải bump nhưng SRS không nêu. N1/N6 chưa commit nên chưa bump. |
| CFG-10 | KT | Exit code: `cfg.mjs:56,64,70,78,85` (2/4/4/4/3); `doctor.mjs (cli):14,38` (4, 0/1); `main.mjs:73-75` (2); thông báo tiếng Việt khắp nơi | `tests/cfg.test.mjs:38,46,52,89`; `doctor.test.mjs:151-190`; `main.test.mjs:24` | doctor.json do CLI ghi trên tiniweb | Mã 3 trong code = thiếu **key cấu hình** (`ff cfg get`), còn thiếu key secret ở doctor trả 1; SRS nói "3 thiếu key" mơ hồ. Mã 2 "guard chặn" chưa xác minh riêng ở đây (guard-cli.test). |
| CFG-11 | ĐX | không tìm thấy (doctor không đọc CLAUDE.md của workspace) | không tìm thấy | Workspace thật: CLAUDE.md ghi "worker chưa cấu hình" và nhánh làm việc khác `base_branch` dù config đã có (đã sửa phía workspace 2026-10-20) | Giữ ĐX. |
| DOC-01 | KT | `scripts/lib/doctor.mjs:48-226` (nhóm core/worker/e2e, finish() line 53); `scripts/cli/doctor.mjs:26`; `scripts/lib/state.mjs:23` (doctorStatus); `cfg.mjs:71-75`; `worker.mjs` import runDoctor; `doctor.mjs:229-244` (preflight verify chặn e2e đỏ) | `tests/doctor.test.mjs:31,64,76,87,151-190,214`; `cfg.test.mjs:52-80` | `tiniweb/.ff/doctor.json`: ok=true, groups core/worker/e2e = true, at 2026-10-20T07:09Z | Chặn thật (cfg get/ worker start/ verify khi đỏ) chỉ có bằng chứng test, không có log thật khi đỏ. |
| DOC-02 | ĐC | `doctor.mjs:73-86` (assertClaudeLaunchCapabilities + `--remote-control`, chỉ khi `worker.driver.enabled`); `doctor.mjs:99` (cảnh báo codegraph); `doctor.mjs:100` (cảnh báo Playwright cố định) | `doctor.test.mjs` (stage preflight 198; không tìm thấy test riêng cho cảnh báo codegraph/Claude capability) ; `harness-config.test.mjs` | doctor.json groups.worker=true, nhưng không thấy dòng check cụ thể | Playwright plugin không được dò, luôn in cảnh báo cố định; kiểm Claude CLI chỉ khi driver bật. Test trực tiếp: không tìm thấy. |
| DOC-03 | ĐC | `doctor.mjs:43` (lệnh sửa version), `:71`, `:137`, `:142`, `:158` (có hướng dẫn); nhiều lỗi khác không có cách sửa (`:104,116,117,122,130,197`); đuôi CLI `cli/doctor.mjs:34` chỉ nói chung "sửa bằng /ff-init" | `doctor.test.mjs:255` (chỉ version) | không tìm thấy | **SAI (một phần)**: SRS "Mỗi lỗi phải nói rõ cách sửa" nhưng nhiều thông báo (thiếu repo, nhánh, cards_dir, project_docs…) không kèm cách sửa riêng. Nguồn SRS ghi N5 (0.3.0) — chưa hoàn tất. |
| DOC-04 | ĐC / **SAI** (R6) | `scripts/hooks/session-start.mjs:36-54` (chạy doctor, in vào stdout, `writeDoctorState`); `doctor.mjs:32-44` (checkPluginVersion); `hooks/hooks.json` SessionStart | `tests/hooks.test.mjs:64` "session-start: xanh và đỏ, luôn exit 0"; `doctor.test.mjs:255`; `harness-hooks.test.mjs` | không tìm thấy log riêng của SessionStart; hook khác (ask-pre/post) thật có (`.ff/runner/*/questions`) | **SAI (hai chỗ)**: (1) lệch version plugin/CLI trả `bad` → làm **core đỏ** (`doctor.mjs:66`) nên `ff cfg get` từ chối, không chỉ "cảnh báo" như SRS; (2) `session-start.mjs:55` `exit(2)` khi harness binding bị chặn, trái "không chặn phiên" (test tên "luôn exit 0" chỉ phủ ca không-bind). |
| UND-01 | KT | `skills/ff-understand/SKILL.md:48` (lập ledger trước khi đọc code); `references/brief.md` khuôn; `scripts/lib/trace.mjs:45-95` (dossierUnits, parseLedger) | `tests/trace.test.mjs:54,60,75,88,108,115,133` | `tiniweb/trellocards/{84,134,135,136,186}/01b-ledger.md` (cả 5 thẻ) | Ledger quote nguyên văn được trace-check kiểm (`trace.test:75`). |
| UND-02 | KT | `scripts/lib/trace.mjs:130-196` (traceCheck, line 148 phaseSource); `scripts/hooks/ask-pre.mjs:43-48` (chặn exit 2 khi đỏ) | `tests/trace.test.mjs:60,65,70,103,199,218`; `tests/hooks.test.mjs:90` "ask-pre: trace-check đỏ → exit 2" | `tiniweb/.ff/gates/136-GATE_A.json`, `136-GATE_B.json`, `186-*` (Gate chỉ được ghi sau ask-pre xanh) | Chỉ áp cho GATE_A/B (không GATE_C) — khớp "Gate" ở mức A/B; Gate C không qua trace-check ở hook. |
| UND-03 | ĐC | `skills/ff-understand/SKILL.md:88`, `rules.md:48` (4 ranh giới); `scripts/cli/decide.mjs`, `scripts/lib/knowledge.mjs:53-92` (HARD/SOFT classes) | `tests/skills-content.test.mjs:225` "soft question skipping requires scoped precedent advice"; `tests/knowledge-decide.test.mjs:13` | `tiniweb/.ff/decisions.jsonl` có các Q1–Q4 thẻ 136 (hỏi người) | Chưa có cách xác minh "chỉ dừng ở 4 ranh giới" trên chạy thật; không có test hành vi agent. |
| UND-04 | KT | `skills/ff-understand/rules.md:50`; `SKILL.md:65`; `scripts/hooks/ask-pre.mjs:26-36` (bắt `[#id]`, nhãn đúng `Duyệt`/`Cần sửa`); `scripts/lib/gates.mjs:36-50,78` | `tests/hooks.test.mjs:84,154`; `gates.test.mjs:28,48,70` | `tiniweb/.ff/decisions.jsonl` (header Q1..Q4, GATE_A, GATE_B, câu bắt đầu `[#136]`); `.ff/gates/136-GATE_A.json` answer="Duyệt" approved=true | "≤4 câu/lượt" chỉ ở skill, hook không cưỡng chế. |
| UND-05 | ĐC | `skills/ff-understand/SKILL.md:58` (ff-brief-adversary), `:66` (ff-gate-reader, tối đa 2 vòng); `agents/ff-brief-adversary.md`, `agents/ff-gate-reader.md` | `tests/skills-content.test.mjs:124`; `human-output-content.test.mjs:58` "fresh gate reader…" (kiểm nội dung agent, không kiểm hành vi) | không tìm thấy (kết quả reviewer không lưu trong allowlist; `.ff/gates/186-GATE_B.json` reason có nhắc "design-reviewer đã xử lý, gate-reader ĐỦ" — chỉ cho Gate B) | Ghi chú thẻ 186 có dấu vết gate-reader/design-reviewer nhưng là tự khai trong reason. |
| UND-06 | KT | `scripts/cli/gate-auto.mjs:36-45`; `scripts/lib/gates.mjs:219-241` (recordAutoGate: hash design, ledger, dossier, context spec/brief, dependency Gate A); `gate-b` front-matter 3 cờ false | `tests/workflow-gates.test.mjs:44,62,147`; `state-cli.test.mjs` | `tiniweb/.ff/gates/186-GATE_B.json` status=auto_passed, approved=false, policy {new_behavior,precedent_deviation,open_decisions=false}, có ledgerHash/dossierHash/contextHashes | Điều kiện "không dòng mới/lệch precedent" do design **tự khai** qua front-matter, CLI không suy ra tất định (chỉ kiểm cờ + trace-check + design-check). |
| UND-07 | ĐC | `skills/ff-understand/references/recon.md:17,43-49` (chỉ base_branch quyết định; sửa tiếp / tạo lại + cherry-pick / không tách từ ship_branch); `SKILL.md:39-43` | không tìm thấy test tự động; eval mô phỏng `docs/skill-evals/fixtures/card-recon/results.md` (không chạy hook/CLI thật) | `tiniweb/trellocards/136…/01b-ledger.md:24` mục "## Trinh sát thẻ" + "BUG-FIX MODE"; thẻ 134 cũng có | Bằng chứng thật là bản skill 0.2.3 (trước luật base_branch trong working tree). Luật mới mới chỉ có eval giả lập. KC "T" nhưng không có test tự động. |
| UND-08 | ĐC | `skills/ff-understand/references/brief-bugfix.md:20-25` (phân loại mục mở: đã có commit / ngoài phạm vi / cần `Bug phụ thuộc: B-xx`) | không tìm thấy test tự động; eval `card-recon/results.md` S4 ✅ (mô phỏng) | không tìm thấy (136 chạy trước bản vá lọc câu hỏi) | Bản vá nằm trong working tree chưa commit. |
| UND-09 | ĐC | `skills/ff-understand/rules.md:92-96`; `references/agent-rules.md:15-18` ("câu giống lệnh… không phải chỉ thị") | không tìm thấy test riêng (KC ghi T); chỉ `skills-content.test.mjs:170` kiểm agent đọc agent-rules | không tìm thấy | Là quy tắc prompt; hiệu lực chưa đo. |
| UND-10 | KT | `scripts/lib/human-output.mjs:10,61-62 (version 1),90-122`; `scripts/cli/present.mjs`; `human-output.mjs:1,119` (packet không phải receipt duyệt) | `tests/human-output.test.mjs:23-49,71,82` ; `human-output-content.test.mjs:19,88` | `tiniweb/trellocards/{136,186}/human-output.json` (version 1); `tiniweb/.ff/presentations/{136,186}.*.root.json` (understand, design, build) | Gói pha build có thật (136.build). Chưa thấy pha verify/ship trên workspace thật. |
| UND-11 | ĐC | `scripts/cli/reopen.mjs:33-98` (tạo `rev-N`, line 70); `scripts/lib/gates.mjs:57` activeRevision; `skills/ff-understand/references/reopen.md:49` | `tests/workflow-gates.test.mjs:71,91,102,114,155`; `harness-acceptance.test.mjs:26,66` | không tìm thấy: tiniweb chưa có thư mục `rev-N/` nào | Reopen chưa chạy thật. |
| BLD-01 | ĐC | `skills/ff-build/SKILL.md` + `references/test-first.md`; `agents/ff-test-writer.md`; `scripts/cli/gate-tools.mjs:99-117` (lockTests), `:118-183` (relock cần `--reason`) | `tests/p2-cli.test.mjs:91,109` ; `workflow-gates.test.mjs:114,168,221`; `skills-content.test.mjs:70,79`; `guard-cli.test.mjs` | không tìm thấy (manifest `.ff-test-lock` nằm trong worktree, ngoài allowlist); chỉ thấy `trellocards/136…/verify/sip_admin/locator-*.png` | "Writer không đọc code sản phẩm" là ràng buộc agent (tool list ff-test-writer: Read, Write, Edit, Grep, Glob, Bash) chứ không cưỡng chế bằng code. |
| BLD-02 | ĐC | `skills/ff-build/references/plan-slice.md`; `agents/ff-planner.md`, `ff-implementer*.md`, `ff-diff-reviewer.md`; `scripts/cli/gate-tools.mjs:74-98` (allow), `:185-217` (probeSlice) | `tests/p2-cli.test.mjs:75,79,83` (allow/probe); `skills-content.test.mjs:113,123` | `tiniweb/trellocards/136…/04-plan.md` có plan; allowlist không đọc được | Chưa có bằng chứng allowlist/probe-slice chạy thật. |
| BLD-03 | ĐC | `scripts/cli/squash-check.mjs:54-60` (đúng 1 commit, dòng `Trello: #id`); `scripts/lib/stage-receipts.mjs:256` (finishStage), `:231` (validate HEAD/test-lock/checks); `ship.mjs:249-256` | `tests/operational-regression.test.mjs:132,143`; `stage-receipts.test.mjs:83,93,132`; `ship-test.test.mjs:35` | `tiniweb/.ff/ship-test/136/root.json` (ship-test chỉ tạo khi feature đúng 1 commit squash); **không có** build receipt (`.ff/harness/receipts/…` không tồn tại) | Squash chạy thật qua gián tiếp; biên nhận build chưa thấy trên đĩa. |
| BLD-04 | ĐC | `scripts/lib/trace.mjs:101-129` (PHASE_TAG_RE, SOURCE_OK_RE, phaseSourceProblems); `trace.mjs:148`; `scripts/lib/auto-verify.mjs:116-120`; `skills/ff-build/SKILL.md:54` | `tests/gate-auto-c.test.mjs:48` "(g) D-xx pha build tự suy ra", `:54`, `:60` "trace-check báo D-xx pha build thiếu Nguồn" | không tìm thấy: ledger tiniweb không có dòng `(build)`/`(verify)` | N6 mới, chưa có thẻ nào chạy qua. |
| VER-01 | KT | `scripts/lib/ship.mjs:220-284` (ff-test/<id> từ origin/ship_branch + cherry-pick squash; checkout riêng; conflict → `ok:false`, reset, không ghi record, `ship.mjs:262`); `scripts/cli/ship-test.mjs:5` | `tests/ship-test.test.mjs:17,28,35,39,49,108` | `tiniweb/.ff/ship-test/136/root.json` (repos oe-hrm-fe & system-service: featureSha/baseSha/testSha, testBranch "ff-test/136", checkout `worktrees/136-….test/`); thư mục `worktrees/136-….test` tồn tại | Chuỗi "needs_human" chỉ có ở comment (`ship.mjs:221`); code trả `{ok:false, reason:'conflict', files}`. |
| VER-02 | ĐC | `scripts/lib/ship-test-record.mjs:13-30` (validate featureSha/baseSha/testSha, checkout HEAD/branch/parent); `scripts/lib/stage-receipts.mjs:197-200` (receipt verify ràng buộc record) | `tests/ship-test.test.mjs:83` "verify receipt must bind the ship-test record (3 SHAs)", `:49`; `stage-receipts.test.mjs:132` | record 3 SHA có thật (`.ff/ship-test/136/root.json`); **không có** verify receipt/ Gate C trên đĩa | Nửa vế "receipt verify" chưa chạy thật. |
| VER-03 | KT | `scripts/cli/verify-up.mjs`, `verify-down.mjs`; `scripts/lib/verify-lock.mjs:15-38`; `scripts/cli/verify-lock.mjs:6` (lock qua worker) | `tests/verify-cli.test.mjs:43,62,74,96,106,119,127`; `e2e-services.test.mjs:126,152,163` | `tiniweb/.ff/services/136/*.log` (verify-up thật: backend, crm, home, recruit, system + prepare-*) | Lock hiện không còn trên đĩa (đã trả hoặc xóa) nhưng không thấy log verify-down; KT dựa trên verify-up thật. |
| VER-04 | KT | `scripts/lib/services.mjs:25-140` (loadServiceEnv, applyEnvOverrides, startService, killTree); `scripts/cli/verify-up.mjs`; `doctor.mjs:156-172` | `tests/e2e-services.test.mjs:59,71,86,110,117,126,163,173,184` | `tiniweb/.ff/services/136/`: 5 service log + `prepare-oe-hrm-fe.log`, `prepare-system-service.log` | Dịch vụ do ff-kit tự bật (không phải up_cmd). |
| VER-05 | ĐC | `skills/ff-verify/SKILL.md:40-46`; `references/{proof-discipline,measure,report}.md`; `scripts/cli/db-query.mjs` (SELECT/EXPLAIN) | `tests/p2-cli.test.mjs:14,20` (db-query); `human-output-content.test.mjs:78` "verification never uses UX observations…"; `db-readonly.test.mjs` | `trellocards/136…/verify/sip_admin/locator-1..6*.png` (ảnh gắn locator) — **không có** `05-verify-report.md` | Chưa có báo cáo verify thật trên đĩa; phân biệt N/A vs UNVERIFIED chỉ ở skill/report template. |
| VER-06 | ĐC | `scripts/lib/fix-rounds.mjs:6-30` (file `.ff/fix-rounds/<id>.json`, mặc định 3, theo revision, bền qua restart); `scripts/cli/fix-round.mjs:22-30` (exit 3 khi hết); `skills/ff-verify/SKILL.md:55`; `skills/ff-build/SKILL.md:56` | `tests/fix-round.test.mjs:13,21,28` | không tìm thấy: không có `.ff/fix-rounds/` trên tiniweb | Chỉ gọi từ skill (không ai trong driver/worker gọi `fix-round`); khi driver dispatch skill nói "finish implementation_failed để worker điều phối" — vòng sửa của driver dùng bộ đếm khác (`max_repair_cycles`), chưa hợp nhất. |
| VER-07 | ĐC | `scripts/cli/gate-auto.mjs:28-34`; `scripts/lib/auto-verify.mjs:61-122` (a-g: Gate A/B, build receipt, ship-test, AC PASS, hồi quy, test-lock, câu hỏi mở, D-xx nguồn); `gates.mjs:243-275` (recordAutoGateC, gateCAuto) | `tests/gate-auto-c.test.mjs:23-60` (17 test); `ship-approve-auto.test.mjs:26-79` | không tìm thấy: tiniweb chưa có `*-GATE_C.json` | N6 chưa chạy thật. Điều kiện UNVERIFIED-ext dùng danh sách cấu hình, xem VER-08. |
| VER-08 | ĐC | `scripts/lib/auto-verify.mjs` (exemptByDecide: `ff decide` lớp `test-scope`, khóa `verify-exemption:<hạ tầng>`); `references/decision-classes.md` | `tests/gate-auto-c.test.mjs` (proceed → miễn; escalate/lỗi → không miễn; schema từ chối khóa cũ) | không tìm thấy | Đã sửa R2 (0.2.5, chưa phát hành). Chưa có tiền lệ nên thực tế luôn escalate. |
| VER-09 | ĐX | `schema/ff.config.schema.mjs:128` có `done_tests_dir` nhưng không code nào đọc; `templates/ff-e2e/tests/README.md:3` ghi `tests/task-done/`, `skills/ff-understand/references/brief.md:107` grep `task-dones/` | không tìm thấy | Workspace thật: thẻ đã nghiệm thu (accepted) vẫn để test ở thư mục thẻ; `task-done/` chỉ có `.gitkeep` | R13. |
| SHP-01 | ĐC | scripts/lib/ship.mjs (cherry-pick từ feature lên ship_branch); skills/ff-verify/references/ship.md | tests/ship-dev.test.mjs (dựng workspace base/ship) | không tìm thấy (`.ff/ship/` rỗng) | Yêu cầu quy tắc (KC=I); chưa thấy lần ship thật. |
| SHP-02 | ĐC | scripts/lib/ship.mjs:48,136,209; scripts/cli/ship.mjs | ship-dev.test.mjs:62; ship-dev-cli.test.mjs:51 (dev_and_pr); ship-pr.test.mjs:7 | không tìm thấy; chỉ có `.ff/ship-test/136/root.json` (ff ship-test, không phải ship) | S2 PR có test; chưa chạy thật. |
| SHP-03 | ĐC | scripts/lib/ship.mjs, scripts/lib/task-commits.mjs | ship-dev.test.mjs:54 (task/second); ship-dev-inspect.test.mjs:57; task-commits.test.mjs | không tìm thấy | |
| SHP-04 | ĐC | scripts/lib/ship-store.mjs; ship.mjs (refresh/delivered :136) | ship-dev-recovery.test.mjs:62,80; ship-dev-replay.test.mjs:61,67 | không tìm thấy | Phục hồi/đối chiếu remote có test. |
| SHP-05 | ĐC | scripts/lib/ship-approval.mjs:50-62,71,79 (TTL 7200000ms; v2 auto binding revision/gateC/heads/shipBranches); scripts/lib/auto-ship.mjs:24,33 | ship-approve-auto.test.mjs:26,30,35,43,56; ship-approval.test.mjs; guard-new.test.mjs:186 (ship-approve luôn ask) | không tìm thấy | Khớp text. Lưu ý "đích" = ship_branch+HEAD (binding), repo đích remote nằm ở `targets`. |
| SHP-06 | ĐC | scripts/lib/ship.mjs, github-pr.mjs (không có merge/--force/rebase); scripts/lib/guard-rules.mjs:382,427 (chặn git push) | ship-pr.test.mjs:21 (conflict chỉ là quan sát); ship-dev-recovery.test.mjs:49; guard.test.mjs:35 | không tìm thấy | Vắng code merge/force/rebase; test phủ gián tiếp, không có test "không bao giờ merge" riêng. |
| SHP-07 | ĐC | scripts/cli/ship.mjs:22 (trường "AC miễn", "D-xx nguồn decide", "Commit dev"); scripts/lib/auto-ship.mjs:14 | ship-approve-auto.test.mjs:43 (title 'Đã tự ship #123 lên dev', báo một lần) | không tìm thấy | Khớp. "Quyết định tự làm" = D-xx từ decide; test chỉ assert tiêu đề + Commit dev, không assert hai trường kia. |
| WRK-01 | KT | ff-worker/src/core/worker.mjs, runtime.mjs; scripts/lib/cards.mjs | worker-runtime.test.mjs:14,58; trello-assigned.test.mjs | tiniweb .ff/tasks/{134,135,136,84,186}.json (trelloCardId, lastPull); trellocards/ có 5 thẻ + dossier (01-dossier.md...) | worker.task_source=trello, poll_lists Doing/QA Fail. |
| WRK-02 | KT | ff-worker/src/adapters (trello, rocketchat, console); scripts/lib/notify.mjs | rocketchat-channel.test.mjs; notify.test.mjs; worker-runtime.test.mjs:199 | tiniweb `channel.adapter: rocketchat`; `.ff/channel/threads/{134,135,136,186,84}.json`; task park `notified:true` | Gửi thật qua RC có thread; không đọc nội dung. |
| WRK-03 | KT | scripts/cli/worker.mjs; ff-worker/src/core/supervisor, http; runtime.mjs | worker-supervisor.test.mjs:5,13,26; worker-reload.test.mjs:8,24; worker-http.test.mjs:9; worker-stop.test.mjs:27 | tasks/134.json updatedAt 2026-10-20T07:34 phase running (worker đang sống); `.ff/runner/` tồn tại | `.ff/worker.json` không được đọc (cấm); bind 127.0.0.1+token dựa vào test. |
| WRK-04 | KT | ff-worker/src/core/worker.mjs:95; tmux runner | tmux-claude-runner.test.mjs:113 (resume), :26 (cờ --session-id --resume --permission-mode auto --remote-control); worker-tmux.test.mjs:65 | tasks/*.json có `session: ff-<id>`, `startedAt`, `launchAttempts:0` | Phiên tmux theo thẻ có thật; chưa thấy bằng chứng resume hay `--remote-control` thật. Chế độ legacy, không xuyên pha qua driver. |
| WRK-05 | ĐC | scripts/lib/attention.mjs; scripts/lib/card-status.mjs:20; scripts/cli/worker.mjs:147 | attention.test.mjs:15-72; card-status.test.mjs | không tìm thấy: tasks/*.json thật không có trường `attention` (N1 chưa chạy trên tiniweb) | Mã mới chưa commit. |
| WRK-06 | ĐC | ff-worker/src/core/worker.mjs:20-39 (attention.agentMs, lifetime theo agentMs) | worker-system-park.test.mjs:39,99; attention.test.mjs:19,23 | không tìm thấy: park thật 135/136/84 ghi "Session lifetime vượt thời hạn 24 giờ" (tính đồng hồ cũ, chưa phải giờ làm việc) | Bằng chứng thật là hành vi trước N1. |
| WRK-07 | KT | ff-worker/src/core/park.mjs; worker.mjs:39 (systemParkTask) | worker-system-park.test.mjs:39,89; worker-park.test.mjs:60,75,132; worker-park.guard.test.mjs | tasks/135,136,84.json: `phase:parked, parked.reason:failed, list:Todo, moved:true, notified:true` lúc 2026-10-20T04:31 | Thẻ thật đã park về Todo. `reason:"failed"` chứ không phải mã mới; chưa thấy chat-park/ghi chú ledger. |
| WRK-08 | ĐC | ff-worker/src/core/driver.mjs (nextStage, reduceEvent, receipts); scripts/lib/stage-receipts.mjs | harness-driver.test.mjs:67,117,137,258,272; stage-receipts.test.mjs:110; harness-store.test.mjs | không tìm thấy: tiniweb không bật `worker.driver` (có harness/inbox, presentations nhưng task không có stateVersion/stage) | Hook harness chạy độc lập, driver chưa chạy thật. |
| WRK-09 | ĐC | ff-worker/src/core/driver.mjs:36,114,258 (stuck, waitingOn); config.mjs:34 (stuck_after_minutes 90, max_stage_retries 3) | harness-driver.test.mjs:196; harness-runtime.test.mjs:50,163; harness-final-integration.test.mjs:47,138 | không tìm thấy | |
| WRK-10 | ĐC (câu yêu cầu đã sửa theo kết quả này) | Chỉ driver: ff-worker/src/core/driver.mjs:73-82 (merged + headAtMerge==approvedSourceHead -> done; dev_only + CLI acceptance -> done); ship-watch.mjs:20; scripts/lib/ship.mjs:209 (allPrsMerged) | harness-runtime.test.mjs:186 (hoàn tất khi merged đúng source); ship-pr.test.mjs:7 | không tìm thấy | **SAI**: yêu cầu không điều kiện, nhưng chế độ legacy (driver.enabled=false, đang dùng ở tiniweb) không phát hiện merge PR: worker.mjs:344 `closeShippedLegacyTasks` chỉ đóng thẻ khi Trello list ∈ done/accept/reopen (task 186 done = "Ready For QA"); thoát sớm khi driver bật. Cần ghi rõ "chỉ khi bật driver". |
| WRK-11 | ĐC | scripts/cli/reopen.mjs; ff-worker/src/core/ship-watch.mjs:14-31; driver.mjs:370-385 | harness-runtime.test.mjs:106,118,130; harness-driver.test.mjs; operational-regression.test.mjs | tasks/134.json `qaFailCount:1, qaReopenedAt` (QA Fail legacy mở lại); không có revision/max_reopen thật | Reopen tự động theo revision/`[ff]`/max_reopen chỉ trong driver; legacy chỉ resume QA Fail. |
| WRK-12 | TK | không tìm thấy (không có logic merge-base/ancestor cho base_branch ngoài PR; ship.mjs:136 `merge-base --is-ancestor` chỉ kiểm dev) | không tìm thấy | không tìm thấy | Đúng với SRS (TK). |
| WRK-13 | ĐX | không tìm thấy | không tìm thấy | Workspace thật tự viết script Trello (board id cứng, tự đọc file secret, tạo thẻ) | Giữ ĐX; chờ người quyết phạm vi. |
| KNW-01 | ĐC (câu yêu cầu đã sửa; class/decisionKey → KNW-04) | Ledger: scripts/lib/knowledge.mjs:8-39 (appendDecision/importLedgerDecisions); hook: scripts/lib/question-history.mjs:129-135,253 (decisionContext=snapshot + explicitDecisionContext chỉ khi decision packet có), scripts/hooks/ask-post.mjs:19; scripts/cli/learn.mjs | knowledge-learn.test.mjs:9 (import idempotent), :10, :12, :13, :14 | `.ff/decisions.jsonl` thật: 18 bản ghi, tất cả provenance.source=cli, status answered, KHÔNG có `class`/`decisionKey` (decisionContext chỉ có header/question/options/multiSelect/presentationId); không có bản ghi từ `ff learn` | **SAI**: ask-post KHÔNG ghi class/decisionKey/phạm vi (chỉ khi presentation packet mang decisionContext tường minh; ledger import "explicit metadata only"). Mâu thuẫn nội bộ SRS với KNW-04 (TK). Các câu "Cần sửa" của Gate có ghi (GATE_A/GATE_B answered). |
| KNW-02 | ĐC | scripts/lib/knowledge.mjs:53-70,92-110 (HARD/SOFT_CLASSES, risk keyword, high_risk, min_precedents, origin người) | knowledge-decide.test.mjs:6,13,23,32 | không tìm thấy (không bản ghi source=agent/shadow trong decisions.jsonl; `ff decide` chưa chạy thật) | Từ khóa rủi ro cứng trong code (migration|schema|delete|role|permission) ngoài `knowledge.high_risk` — SRS chưa nêu. |
| KNW-03 | ĐC | knowledge.mjs:61 (`request.gate` -> escalate, shadow); :105 provenance.source 'shadow' | knowledge-decide.test.mjs:18 | không tìm thấy | Test gate chỉ một assert; "ghi đặc trưng để đo" nằm ở decideForTask append. |
| KNW-04 | TK | không tìm thấy (hook không sinh class/decisionKey, xem KNW-01) | không tìm thấy | decisions.jsonl thật không có class/decisionKey | Đúng với SRS. |
| KNW-05 | TK | không tìm thấy `outcome_recorded`/`escape_recorded` trong scripts, ff-worker/src | không tìm thấy | không tìm thấy | Đúng với SRS. |
| KNW-06 | ĐX | không tìm thấy | không tìm thấy | không tìm thấy | Giữ ĐX. |
| KNW-07 | TK | không tìm thấy | không tìm thấy | không tìm thấy | Đúng. |
| KNW-08 | TK | không tìm thấy (`ff recall` không có trong scripts/cli) | không tìm thấy | không tìm thấy | Đúng. |
| KNW-09 | ĐX | không tìm thấy (decide chỉ tra tiền lệ ledger, không tra wiki) | không tìm thấy | không tìm thấy | Giữ ĐX. |
| KNW-10 | TK | không tìm thấy (chế độ bóng theo lớp chưa có; chỉ shadow cho gate) | không tìm thấy | không tìm thấy | Đúng. |
| EVO-01 | ĐC | docs/skill-evals/fixtures/card-recon/{S1..S5,expected.md,results.md}; fixtures/gap-decisions; fixtures/auto-chain | tests/skills-content.test.mjs (tham chiếu skill-evals; không kiểm bảng so cặp) | docs/skill-evals/fixtures/card-recon/results.md dùng nhãn "sửa được", "sửa được một phần" (9 lần) | **SAI nhẹ**: quy ước nhãn chỉ thấy ở card-recon; gap-decisions/results.md dùng TU/HOI/❓ + RED, auto-chain/results.md không có nhãn; fixture không đồng nhất tên file (git-facts.md vs gap.md/repo). Không có nhãn "không đổi/tệ đi/nhiễu" được kiểm. "Chạy thật" = eval của chính repo, không thuộc tiniweb. |
| EVO-02 | TK | không tìm thấy cơ chế bồi fixture từ thẻ thật (card-recon/S4 dựng tay từ thẻ 136) | không tìm thấy | không tìm thấy | Đúng. |
| EVO-03 | ĐX | không tìm thấy `ff eval` trong scripts/cli/main.mjs | không tìm thấy | không tìm thấy | Giữ ĐX. |
| EVO-04 | TK | không tìm thấy | không tìm thấy | không tìm thấy | Đúng. |
| SEC-01 | ĐC | scripts/lib/guard-rules.mjs (secret paths, .ff.env); scripts/lib/env.mjs; plugin deny rules | guard-new.test.mjs:32,40,47,59; guard-regression.test.mjs:101; env.test.mjs:57; plugin-content.test.mjs:32 | không tìm thấy (không được phép đọc .ff.env) | |
| SEC-02 | ĐC | guard-rules.mjs:111 (stash), :382,427 (git push), :430,432 (add -A, commit -a); ask-pre.mjs:33 | guard.test.mjs:35,49; guard-new.test.mjs:66,74,85,96; guard-regression.test.mjs | không tìm thấy (không có log guard trong .ff) | `gh pr create/merge` ngoài luồng ship: chưa xác minh dòng cụ thể (grep gh pr trong guard-rules không ra); coi là một phần. |
| SEC-03 | ĐC | guard-new.test.mjs:186 (ask cho ship-approve/relock); ff-worker resolve; human-resolution.mjs | guard-new.test.mjs:186,197; harness-resolve.test.mjs:75,121 | không tìm thấy | `--auto` được miễn xác nhận (SHP-05), khớp "không --auto". Việc skill không được cấp lệnh: kiểm qua plugin-content (không chạy riêng). |
| SEC-04 | ĐC | scripts/cli/db-query.mjs | db-readonly.test.mjs:7,27,39,52,93,106,119,131 | không tìm thấy (tiniweb `driver: postgres` nhưng không có dấu vết chạy) | |
| SEC-05 | ĐC | scripts/lib/paths.mjs:7-13 (realpath); scripts/lib/shell.mjs | worker-tmux.test.mjs:40 (argv); human-output.test.mjs:30 (scope '../outside'); shell.test.mjs | không tìm thấy | Test traversal chỉ thấy cho scope presentation; các đường dẫn config khác chưa thấy test riêng. |
| SEC-06 | ĐX | không tìm thấy | không tìm thấy | Workspace thật có allow `Bash(ff worker *)` (đã thu hẹp phía workspace 2026-10-20) | Giữ ĐX. Chưa kiểm guard `ask` có thắng `allow` của settings không. |
| NFR-01 | ĐC | scripts/lib/file-mutex.mjs; ff-worker/src/core/task-store.mjs; harness-store | harness-store.test.mjs:123,248,260; worker-startup-recovery.test.mjs; harness-driver.test.mjs:117 | không tìm thấy bằng chứng restart (tasks thật là legacy, không có stateVersion) | |
| NFR-02 | ĐC | ff-worker/src/core/worker.mjs:188; runtime.mjs:259,368 | worker-runtime.test.mjs:45; worker-park.test.mjs:106; harness-final-integration.test.mjs:47 | tiniweb `max_concurrent_tasks: 2`; tại 07:34 chỉ 134 running (135/136/84 parked) — không chứng minh giới hạn | |
| NFR-03 | ĐC | package.json `engines.node >=20.10` | không tìm thấy test nền tảng | Linux là nền chạy thật; macOS không có bằng chứng | I; chưa thấy kiểm tra macOS. |
| NFR-04 | TK | một phần: attention.agentMs/since (scripts/lib/attention.mjs); chưa có báo cáo đo vận hành | attention.test.mjs (chỉ thời gian chờ/làm) | không tìm thấy | Đúng TK; chỉ đo chờ người/agent, chưa đo số lần hỏi/retry/reopen/lỗi lọt. |
<!-- MATRIX:END -->

---

## 5. Hiện trạng, sai lệch đã biết và lộ trình

### 5.1 Tóm tắt hiện trạng

83 yêu cầu: **20 KT**, **45 ĐC**, **2 ĐC nhưng code trái yêu cầu** (VER-08, DOC-04), **9 TK**, **7 ĐX** (§4).

- **Đã chạy thật:** cài đặt và cấu hình, doctor, pha hiểu với ledger/trace-check/Gate A/B, ship-test và `verify-up`/`e2e.services`, worker legacy (poll Trello, kéo dossier, phiên tmux, notify Rocket.Chat, park).
- **Có code nhưng chưa chạy thật:** toàn bộ driver (chuyển pha tự động, receipt, kết thúc thẻ khi PR merge, reopen tự động), `ff ship` S1/S2, Gate C tự duyệt và ship tự động (N6), `ff decide`.
- **Chưa có code:** kết thúc thẻ không qua PR (WRK-12), dữ liệu tri thức có cấu trúc và kết quả thẻ (KNW-04/05), toàn bộ dreaming/wiki/tự quyết theo tri thức (KNW-06..10), tiến hóa skill (EVO-02..04), đo vận hành (NFR-04).
- **MVP (G1) chưa nghiệm thu:** chưa thẻ nào đi trọn tới merge.

### 5.2 Sai lệch và rủi ro đã biết

| # | Mô tả | Ảnh hưởng | Hướng xử lý |
|---|---|---|---|
| R1 | N6 (chưa commit) cho skill tự gọi pha kế tiếp khi chạy legacy, trái WRK-08 (driver là nơi duy nhất gọi pha). | Hai cơ chế chuyển pha song song. | **Đã sửa (0.2.5, chưa phát hành):** skill build/verify không tự gọi pha kế; verify dừng sau Gate C, ship qua driver hoặc `/ship-to-dev`. |
| R2 | N6 (chưa commit) thêm `verify.unverifiable_external` vào config, trái VER-08. | Miễn kiểm dựa cấu hình cứng. | **Đã sửa (0.2.5, chưa phát hành):** bỏ `verify.unverifiable_external`; miễn kiểm qua `ff decide` lớp `test-scope`, khóa `verify-exemption:<hạ tầng>` (`auto-verify.mjs` exemptByDecide). Thực tế vẫn escalate tới khi có tiền lệ (KNW-04). |
| R3 | Driver chưa từng chạy trên thẻ thật; nhật ký nghiệm thu MVP (2026-10-17) ghi BLOCKED và khuyến nghị giữ driver tắt. | WRK-08..11 chỉ ở mức ĐC; không có cơ chế kết thúc thẻ ở workspace chạy legacy. | GĐ1: bật driver + `dev_and_pr` trên workspace thật, chạy ≥2 thẻ tới merge. |
| R4 | Sổ quyết định ở workspace thật không có class/decisionKey (bản ghi không dùng được làm tiền lệ). | `ff decide` luôn escalate. | KNW-04 (N3). |
| R6 | Doctor: lệch phiên bản plugin/CLI làm nhóm core đỏ (`ff cfg get` từ chối), không chỉ cảnh báo; hook SessionStart thoát mã 2 khi binding harness bị chặn. Trái DOC-04. | Phiên có thể bị chặn. | Quyết định giữ hay sửa yêu cầu; nếu giữ yêu cầu thì sửa code. |
| R7 | Nhiều lỗi doctor chưa có hướng dẫn sửa (repo/nhánh, `cards_dir`, `project_docs`). | DOC-03 mới một phần. | N5. |
| R8 | Guard chặn `gh pr create/merge` chỉ khi bật driver. | Legacy không có lớp chặn này (SEC-02 một phần). | Bật cho mọi chế độ. |
| R9 | Fixture eval chưa đồng nhất: `gap-decisions` dùng nhãn RED kiểu cũ, `auto-chain` chưa có nhãn; tên file khác nhau. | EVO-01 khó áp dụng máy móc. | Chuẩn hóa khi làm N4. |
| R10 | `ff fix-round` (N6) chưa nối với `repairCycles` của driver; không ai gọi nó ngoài skill. | Hai bộ đếm vòng sửa. | **Đã sửa (0.2.5, chưa phát hành):** một bộ đếm `repairCycles[revision]` trong task, giới hạn `worker.driver.max_repair_cycles`; legacy chưa có task dùng file tạm `.ff/repair-cycles/<id>.json`, driver nhận lại khi tạo task. |
| R11 | Thẻ thật đã park bằng code N1 (đang chạy qua CLI symlink) nhưng chưa có dấu vết `attention`/lifetime theo giờ làm việc. | WRK-05/06 chưa kiểm thật. | Quan sát sau khi khởi động lại worker. |
| R12 | `INSTALL.md:64` nêu tên workspace mẫu, trái quy ước thuật ngữ chung và CFG-01. | Tài liệu bám một dự án. | **Đã sửa (0.2.5, chưa phát hành):** INSTALL.md chỉ dùng tên khóa config. |
| R13 | Tên thư mục test thẻ đã xong không thống nhất (`task-done` ở template, `task-dones` ở brief); `e2e.done_tests_dir` có trong schema nhưng không ai dùng; không bước nào chuyển test khi thẻ xong. | Bộ hồi quy không lớn dần; brief tra tiền lệ sai chỗ. | **Đã sửa (0.2.5, chưa phát hành):** template dùng `e2e.done_tests_dir` (mặc định `<tests_dir>/task-done`). `brief.md` grep `<cards_dir>/task-dones/` là kho tài liệu thẻ cũ, khác thư mục test — giữ, chờ quyết có cấu hình hóa không. Chuyển test khi thẻ xong (VER-09) chưa làm. |
| R14 | Rà workspace thật (2026-10-20) thấy: khối CLAUDE.md lệch config (worker, nhánh), allow quá rộng `ff worker *`, script workspace tự đọc file secret để thao tác task source. Đã sửa phía workspace; ff-kit chưa có cơ chế phát hiện. | Agent theo hướng dẫn cũ; lệnh SEC-03 có thể bị allow sẵn. | CFG-11, SEC-06 (doctor); WRK-13 (chờ quyết phạm vi). |
| R15 | Rocket.Chat bỏ sự kiện hook "Claude needs your permission / waiting for your input / Phiên agent đã dừng" vì không có `taskId`: phiên legacy chạy ở gốc workspace, không có `FF_CARD_ID`, nên `inferCardId` (chỉ theo env + cwd worktree) trả rỗng, rồi kênh bỏ sự kiện. | Mất cảnh báo cần người; thẻ chờ lâu không ai biết. | **Đã sửa (0.2.7 dự kiến):** hook tra thêm theo session id Claude và tên phiên tmux, đính `session_id/tmux/cwd` vào sự kiện; worker tra lại khi thiếu `taskId`; kênh không còn bỏ — không rõ thẻ thì gửi ra kênh chính kèm session/cwd. |
| R16 | Rocket.Chat/console bị ngập tin giá trị thấp (vd Stop hook "Phiên agent đã dừng" hàng chục lần) nên người dùng sẽ tắt kênh. | Mất cảnh báo thật vì mute. | **Đã sửa (0.2.6):** chính sách chung `ff-worker/src/core/notify-policy.mjs` bọc mọi channel: chỉ đẩy việc cần người (quyền, chờ nhập, Gate, needs_human/stuck, park, lỗi, Gate C); tin info chỉ ghi log + `.ff/notify-info.jsonl`; chống trùng 30 phút/thẻ; tối đa 10 tin/giờ (dư gom 1 tin tóm tắt); thẻ chờ người >24h nhắc 1 lần/ngày; `worker.channel.notify_level: action\|all`. State ở `.ff/notify-policy.json`. |
| R5 | Nhiều câu chữ spec cũ dùng tên nhánh cụ thể thay cho `base_branch`/`ship_branch`. | Dễ thiết kế bám một dự án. | Tài liệu này chỉ dùng thuật ngữ cấu hình. |

### 5.3 Thay đổi chưa commit (đến 2026-10-20)

- **N1:** `ff worker status` từng thẻ (WRK-05), lifetime theo thời gian agent (WRK-06), fail → park (WRK-07); eval card-recon S1–S5 cho UND-07/08.
- **N6:** `ff gate-auto --gate GATE_C`, `ff ship-approve --auto`, `ff fix-round`, notify sau ship tự động; sửa skill build/verify (có sai lệch R1, R2).

### 5.4 Lộ trình (thứ tự phụ thuộc)

| Bước | Nội dung | Yêu cầu | Xong khi |
|---|---|---|---|
| 1 | Sửa N6 theo R1, R2; sửa R12, thống nhất tên thư mục R13; commit N1 + N6 (0.2.5) | VER-06..08, SHP-05/07, WRK-05..07 | Test xanh; eval N6 chạy lại đạt |
| 2 | GĐ1 nghiệm thu MVP: bật driver, `dev_and_pr`, chạy ≥2 thẻ tới merge, ≥1 thẻ qua reopen | WRK-08..11, SHP-02..04 | 2 thẻ done theo WRK-10; sổ ma sát không còn mục chặn |
| 3 | Kết thúc thẻ không phụ thuộc PR | WRK-12 | Test với merge tay/squash/cherry-pick |
| 4 | Dữ liệu tri thức: ghi có cấu trúc, outcome, "vì sao lọt" (N3, N2) | KNW-04, KNW-05 | `ff decide` dùng được bản ghi thật |
| 5 | Eval bắt buộc + fixture từ thẻ thật (N4); doctor nói cách sửa (N5), phát hiện khối CLAUDE.md lệch config và allow quá rộng | EVO-01/02, DOC-03, CFG-11, SEC-06 | — |
| 6 | Thiết kế chi tiết tri thức (bổ sung mục mới của tài liệu này, người duyệt) | KNW-06..10 | Thiết kế được duyệt |
| 7 | Implement tri thức nền, dreaming, wiki, `ff recall`, chế độ bóng | KNW-06..10, NFR-04 | Đo độ khớp chế độ bóng trên thẻ thật |
| 8 | Tiến hóa skill tự đề xuất | EVO-03/04 | — |

---

## 6. Thiết kế chi tiết các phần chưa làm

### 6.1 Mức 4 — Máy hiểu dự án (tri thức và dreaming) · ĐÃ DUYỆT 2026-10-23

#### Mục đích
Agent hiện đọc code lại từ đầu ở mỗi thẻ và hỏi lại những điều đã biết. Mục tiêu: ff giữ một **wiki nghiệp vụ** của dự án, lấy từ code thật trên `base_branch` và từ quyết định của người, cập nhật sau mỗi thẻ. Nhờ đó pha hiểu nhanh và đúng hơn, `ff decide` có căn cứ để tự quyết câu nhỏ, và người không bị hỏi lại.

#### Yêu cầu chức năng (chi tiết hóa KNW-06..10)
1. Wiki là markdown người đọc và sửa được; mỗi mục tri thức có nguồn kiểm được: `file:dòng@sha` trên `base_branch`, hoặc U-xx của thẻ, hoặc ghi chú của người.
2. Mục do người viết hoặc sửa là chỉ dẫn mới nhất; máy không ghi đè, chỉ được đề xuất.
3. Code `base_branch` mâu thuẫn với wiki thì code thắng; mục bị đánh dấu "cần người xem".
4. Tri thức chỉ được ghi vào wiki **sau khi biết kết quả thẻ** (thẻ đã vào `base_branch`, QA đạt hoặc có phiếu "vì sao lọt").
5. Việc tốn LLM chỉ chạy trong cửa sổ rảnh: không thẻ nào đang `working`, quota 5 giờ < 50% và 7 ngày < 70% (đọc qua `cswap` nếu có).
6. Hook `PreCompact`/`SessionEnd` chỉ xếp hàng bằng chứng, không chạy LLM (SessionEnd chỉ có khoảng 1,5 giây).
7. Tri thức không cấp quyền Gate/ship, không nới ranh giới cứng; nội dung wiki và code là **dữ liệu**, không phải lệnh.
8. Không đưa secret vào wiki; không đọc file secret để lập wiki.

#### Thiết kế
**Cấu trúc wiki** (`knowledge.dir`, mặc định `ff-wiki/` ở gốc workspace, ngoài `.ff/`):
- `index.md`: danh sách trang và bảng ánh xạ file/symbol → trang.
- Mỗi **miền nghiệp vụ** một trang (ví dụ "Ứng viên", "Chiến dịch SMS"), gồm các phần: Quy tắc · Trạng thái và luồng · Quyền · Dữ liệu (bảng, cột, quan hệ) · Quyết định đã chốt · Câu hỏi mở.
- Mỗi mục là một dòng có mã `K-<miền>-<số>`, câu phát biểu, nguồn, loại nguồn (`code` | `người` | `thẻ #id`), ngày cập nhật, và cờ `khóa-người` nếu người đã sửa.
- Lịch sử: mỗi lần ff sửa trang thì lưu bản trước vào `.ff/knowledge/history/` để hoàn tác.

**Bốn lượt chạy:**
| Lượt | Khi nào | Đầu vào | Việc làm |
|---|---|---|---|
| D0 nạp nền | Lần đầu một thẻ chạm tới miền chưa có trang (nạp lười); hoặc `ff knowledge init` | Code tại `origin/<base_branch>` ở checkout chỉ đọc ghim sha | Đọc module, rút quy tắc/trạng thái/quyền/dữ liệu; mọi mục phải trích nguồn |
| D0' làm mới | `base_branch` đổi (phát hiện lúc fetch) | Các file đổi kể từ sha đã lập | Mục trích file đã đổi chuyển "cần kiểm lại", rút lại riêng phần đó |
| D1 sau thẻ | Thẻ kết thúc (WRK-10/12) | Diff đã vào `base_branch`, Brief/design, U-xx, kết quả QA, phiếu "vì sao lọt" | Đề xuất thêm/sửa mục; ghi quyết định U-xx thành mục loại `người` kèm phạm vi |
| D2 hợp nhất | Đủ N thẻ mới (mặc định 5) và ≥ 7 ngày | Toàn wiki | Gộp trùng, bỏ mục mồ côi, báo tóm tắt cho người qua kênh |

**Kiểm chứng tất định trước khi ghi** (không cần LLM): file và dòng trích dẫn tồn tại ở đúng sha; dòng đó chứa symbol/từ khóa mà mục nhắc tới; mục không chứa giá trị giống secret; mục không ghi đè mục `khóa-người`. Mục không qua được bị loại và ghi lý do.

**Chạy LLM:** worker mở một phiên `claude -p` riêng trong tmux, thư mục làm việc là checkout chỉ đọc, chỉ cho phép công cụ đọc. Đầu ra là JSON đề xuất; ff kiểm chứng rồi mới ghi markdown. Làn model rẻ (opencode) mặc định tắt, chỉ bật theo repo vì rủi ro dữ liệu.

**Tra cứu `ff recall`:** `ff recall [--files …] [--symbols …] [--query …] [--card <id>]` trả các mục liên quan, xếp theo: khớp file/symbol trước, sau đó từ khóa. Chỉ mục là file JSON trong `.ff/knowledge/index.json`, dựng lại khi wiki đổi. Không dùng SQLite để giữ runtime deps chỉ `yaml`, `ajv` (khác ý tưởng cũ SQLite/FTS5).

**Dùng tri thức ở đâu:**
- Pha hiểu: recon gọi `ff recall` theo file dự kiến chạm và từ khóa dossier; Brief được trích `K-…@sha` làm nguồn hợp lệ cho `trace-check`, ngang D-xx/U-xx.
- `ff decide` (KNW-09): ngoài tiền lệ, nếu có mục loại `người` cùng phạm vi trả lời trực tiếp câu hỏi, hoặc mục `code` xác định hành vi hiện có, thì trả `proceed` kèm nguồn. Chỉ áp dụng lớp mềm; lớp cứng và từ khóa rủi ro vẫn escalate.
- **Chế độ bóng (KNW-10):** với mỗi lớp câu hỏi và mỗi repo, máy vẫn hỏi người nhưng ghi dự đoán của nó. Chỉ được tự quyết khi 10 lần gần nhất khớp người ≥ 9. Người trả lời ngược → lớp đó quay về chế độ bóng.

#### Xong khi
- Trên workspace thử nghiệm và ít nhất một workspace thật: D0 lập được wiki với 100% mục qua kiểm chứng trích dẫn.
- Sau 3 thẻ, D1 thêm hoặc sửa mục đúng với diff; người đọc thấy đúng.
- Chế độ bóng có số liệu khớp/lệch theo lớp; ít nhất một lớp đạt ngưỡng tự quyết trên dữ liệu thật.

#### Quyết định đã chốt (QĐ 2026-10-23)
1. Wiki ở `ff-wiki/` gốc workspace, ff giữ lịch sử để hoàn tác.
2. Sau mỗi thẻ: tự áp dụng phần đã qua kiểm chứng và gửi tóm tắt cho người; mục `khóa-người` không bị ghi đè.
3. Nạp nền lười theo miền mà thẻ chạm; `ff knowledge init` là tùy chọn.
4. Ngưỡng tự quyết của chế độ bóng: 9/10 lần gần nhất (`knowledge.shadow_window`, `knowledge.shadow_min_match`).

### 6.2 Mức 3 — Máy bớt hỏi (tóm tắt, chưa cần duyệt thiết kế)
Ghi mọi câu trả lời Gate/câu hỏi kèm `class`/`decisionKey`/phạm vi ngay từ hook (KNW-04); ghi kết quả thẻ và phiếu "vì sao lọt" (KNW-05); `ff decide` dùng được tiền lệ thật; chế độ bóng ghi dự đoán cho mọi câu.

### 6.3 Mức 5 — Máy tự cải thiện skill · ĐÃ DUYỆT 2026-10-23

#### Mục đích
Khi cùng một kiểu lỗi lọt lặp lại ở nhiều thẻ, ff tự soạn bản vá cho skill (hoặc cho tri thức dự án), chứng minh bằng eval rằng bản vá sửa được mà không làm tệ đi, rồi đưa người duyệt. Người không phải tự đọc transcript để tìm nguyên nhân lặp.

#### Yêu cầu chức năng (chi tiết hóa EVO-01..04)
1. **Tín hiệu chỉ từ kết quả thật:** phiếu "vì sao lọt" đã được người xác nhận (`escape_recorded`, mức 3), câu "Cần sửa" ở Gate kèm lý do, QA fail. Không dùng tự chấm của agent.
2. **Ngưỡng kích hoạt:** cùng skill + cùng ngả lọt ở ≥ 2 thẻ khác nhau; mỗi skill tối đa 1 đề xuất mỗi tuần, mỗi đề xuất một thay đổi.
3. **Fixture từ thẻ thật (EVO-02):** mỗi phiếu lọt đã xác nhận sinh một ca hồi quy: dossier đã lọc secret, sha các repo lúc đó, kết quả đúng mà người đã chốt. Ca chứa dữ liệu dự án nằm trong workspace (`.ff/evals/`), không chép vào plugin.
4. **Hai ứng viên cho mỗi bài học:** (a) vá skill plugin — chỉ khi bài học không chứa tên/miền dự án (kiểm bằng luật nội dung plugin hiện có); (b) tri thức dự án — một mục wiki loại `người` đề xuất (đi qua kiểm chứng mức 4). Eval cả hai.
5. **Eval so cặp (EVO-01, EVO-03):** mỗi ca chạy bằng skill hiện tại và skill vá, cùng model, workspace dựng lại từ fixture; lặp N lần (mặc định 2) cho ca lệch giữa hai lần chạy cùng bản. Grader chấm mù A/B so với kết quả đúng, gắn nhãn `sửa được` / `không đổi` / `tệ đi` / `nhiễu` kèm dòng bằng chứng. Bộ ca gồm ca sinh ra bài học và ca hồi quy cũ.
6. **Quy tắc quyết định:** đề xuất khi ≥ 1 `sửa được` và 0 `tệ đi`; thiếu hoặc mâu thuẫn bằng chứng → `giữ nguyên`, vẫn ghi lý do.
7. **Ranh giới:** bản vá chỉ sửa văn bản skill/reference; không sửa code guard/hook/CLI, không nới quyền hay ranh giới cứng; không tự áp dụng. Task đang chạy giữ bản skill đã ghim (CFG-07), bản vá chỉ áp cho task mới.
8. **Bài học** ghi `EXPERIENCE.md` (tình huống, bài học, bằng chứng thẻ/revision/commit/QA, phạm vi, kết quả eval); thiếu bằng chứng thì không ghi.

#### Thiết kế
- **Bộ đếm lỗi lặp:** đọc `.ff/knowledge.jsonl` (`escape_recorded`), gom theo (skill, ngả); đủ ngưỡng → tạo việc `evolve` trong hàng chờ, chạy trong cửa sổ rảnh như dreaming (mức 4).
- **Soạn bản vá:** phiên `claude -p` chỉ đọc, đầu vào là các phiếu lọt, transcript liên quan (đã lọc secret), skill hiện tại; đầu ra là diff skill + mục wiki đề xuất + lời giải thích.
- **Runner `ff eval run <suite> --variant <dir>`:** với mỗi ca dựng workspace tạm từ fixture (git worktree ở sha đã ghi, config tối thiểu), chạy `claude -p --plugin-dir <bản cần thử>` với prompt cố định, thu transcript/state/artifact; `ff eval grade` chạy grader mù; `ff eval report` ra bảng so cặp.
- **Gói đề xuất** `.ff/evolve/<id>/`: diff, bảng so cặp, đường dẫn bằng chứng, mục `EXPERIENCE.md`; thông báo người. Người duyệt bằng `ff evolve apply <id>` (áp vào checkout ff-kit hoặc wiki) hoặc `ff evolve reject <id> --reason`.
- **Chi phí:** tối đa 5 ca × 2 lần lặp mỗi đề xuất (cấu hình được); dừng sớm khi đã có `tệ đi`.

#### Xong khi
Trên sandbox: tạo có chủ đích 2 thẻ lọt cùng ngả ở cùng skill → ff sinh fixture, soạn bản vá, eval so cặp ra bảng có nhãn và bằng chứng, gửi đề xuất; người áp dụng được bằng một lệnh; thẻ mới dùng skill đã vá.

#### Quyết định đã chốt (QĐ 2026-10-23)
1. Đề xuất là gói cục bộ `.ff/evolve/<id>/`; người áp bằng `ff evolve apply <id>` (giữ quy ước một commit trên main).
2. Fixture có dữ liệu dự án chỉ nằm ở workspace; chỉ đưa vào plugin bản đã lọc khi người duyệt.
3. Ngân sách eval: tối đa 5 ca × 2 lần lặp mỗi đề xuất.
4. Kích hoạt khi ≥ 2 thẻ cùng skill + cùng ngả lọt; ≤ 1 đề xuất mỗi skill mỗi tuần.

### 6.4 Chế độ tự lái — ff tự làm trọn thẻ · ĐÃ DUYỆT 2026-10-24 · ĐÃ LÀM 0.2.6 (chưa chạy thật)

#### Mục đích
Người chỉ đưa thẻ lên Trello, đọc báo cáo, thử tay trên dev những phần máy không tự chứng minh được (gọi điện, SMS, thông báo điện thoại…) và trả lời khi **đầu vào mơ hồ**. Mọi bước còn lại ff tự làm, kể cả duyệt Gate và ship lên `ship_branch`. Không mất code: nghiệm thu hỏng thì sửa tiếp trên nhánh feature và ship lại.

#### Đã có (không làm lại)
Gate B tự qua (`ff gate-auto`, ba cờ `false`); Gate C tự qua bằng kiểm tất định (VER-07); ship tự động khi Gate C `auto_passed` (SHP-05 `--auto`); câu hỏi mềm tự quyết theo chế độ bóng (KNW-10); QA fail qua Trello → reopen, sửa trên nhánh feature (WRK-11); `dev_only` chỉ đóng khi người xác nhận (WRK-10); ranh giới ship cứng (SHP-06).

#### Yêu cầu chức năng
1. **Công tắc** `autopilot` trong config, mặc định tắt; bật theo từng workspace. Tắt → mọi thứ như hiện nay.
2. **Gate A tự qua** khi CLI kiểm được từ dữ kiện (không dựa vào AI tự đánh giá): người phản biện Brief không có phát hiện chặn; không còn câu hỏi treo; mọi AC kiểm được (có giá trị cụ thể); dossier không có mục mâu thuẫn; người đọc thử hiểu đúng; Brief không chạm vùng rủi ro cứng (`delete` dữ liệu không khôi phục được, `role`, `permission`, thanh toán, gửi email/SMS/tin thật cho khách, `knowledge.high_risk`); thẻ không thuộc cỡ **Lớn** (`ff-understand/rules.md` §7: >6 mục dossier hoặc >5 quyết định chốt) — thẻ Lớn luôn hỏi Gate A. Migration (schema/dữ liệu) **không** phải lý do dừng khi bật autopilot (mục 12). Receipt ghi `auto_passed` kèm căn cứ, không bao giờ gọi là người duyệt.
3. **Đầu vào mơ hồ → hỏi người** đúng một lần cho mỗi điểm mơ hồ: câu hỏi ngắn, kèm phương án ff đề xuất và lý do, gửi qua kênh và comment Trello; người trả lời bằng cơ chế Gate hiện có.
4. **Ship tự động lên `ship_branch`** khi bật autopilot: driver tự chạy `ship-approve --auto` khi Gate C `auto_passed`. Giữ nguyên: chỉ push nối tiếp, không force, không đụng `base_branch`/production, không merge PR; `ship_branch` đã tiến so với lúc test → test lại trước khi push.
5. **Danh sách thử tay**: AC đánh dấu cần thiết bị/dịch vụ thật (gọi điện, SMS, push, thanh toán…) hoặc `UNVERIFIED` được gom thành checklist trong thông báo sau ship. Thẻ ở trạng thái "đã lên dev, chờ người thử" cho tới khi người xác nhận (WRK-10) hoặc báo lỗi qua Trello (WRK-11).
6. **Báo cáo tiếng Việt** `ff report [--today]` và thông báo sau mỗi thẻ: thẻ xong / chờ người thử / kẹt và vì sao; những gì ff đã tự quyết (Gate, câu hỏi) kèm căn cứ; những gì đã học. `ff decide --stats` và `ff knowledge status` in dạng đọc được, `--json` cho máy.
7. **Rút lại khi sai** (đã nối tự động từ sau 0.2.6): Gate A tự qua ngay khi bật (lớp `gate_a_auto` chưa từng bị rút lại = tin cậy). Với repo của thẻ có Gate A `auto_passed`, ff tự ghi mâu thuẫn (reset) lớp `gate_a_auto` — kèm lý do và mã thẻ — khi: (a) thẻ bị mở lại (`ff reopen`, kể cả đường QA fail của worker); (b) có `escape_recorded` chỉ về Gate A; (c) người trả lời "Cần sửa" ở Gate B/C của cùng revision. Bảo thủ: không phán đoán nguyên nhân, trigger nào cũng tính; gửi một thông báo "Gate A tự duyệt bị rút lại cho repo … — từ giờ hỏi người cho tới khi khớp lại 9/10". Sau đó `ff gate-auto --gate GATE_A` dù cấu hình `on` vẫn chạy như `shadow` (ghi dự đoán, từ chối, hỏi người; thông báo "đang học lại sau lần duyệt sai: x/9") cho tới khi ≥ `shadow_min_match` khớp trong `shadow_window` lần gần nhất. Khi người trả lời Gate A: dự đoán "tự duyệt" + "Duyệt" và Brief không đổi = khớp; + "Cần sửa" = lệch (cũng reset); dự đoán "từ chối" không được ghi nên không tính. `ff report` và `ff decide --stats` hiện từng repo: tin cậy / đang học lại x/9 / đã rút lại lúc … vì ….

8. **Đã có trong skill, giữ nguyên:** khuôn `MƠ HỒ`/`THIẾU YÊU CẦU` và 4 ranh giới dừng hỏi (`ff-understand/rules.md` §8, `references/brief.md`); `ff-brief-adversary` bắt "hai cách hiểu"; Trước→Sau + `ff-observer` chụp màn hiện tại/precedent; bảng Precedent, codegraph tìm component tái dùng, Deviation Register, `ff-design-reviewer` kiểm "theo mẫu" và dòng hồi quy cho chức năng bị ảnh hưởng; phạm vi = dossier, "Ngoài phạm vi", "Thấy nhưng không sửa", allowlist + `ff-diff-reviewer` bắt hunk thừa.
9. **Lỗ hổng khi bỏ người ở Gate A:** skill hiện dựa vào người ở Gate A làm lưới cuối — "Tự quyết" là danh sách giả định "để user sửa ở Gate", và `brief.md` cho agent tự "đổi yêu cầu mơ hồ thành tiêu chí kiểm được". Khi Gate A tự qua, không ai xem lại. Bổ sung:
   - Giả định nào làm đổi điều người dùng thấy (màn, câu chữ, con số, luồng, ai thấy gì) → không được "Tự quyết", phải thành "Cần bạn chọn" kèm phương án + đề xuất. "Tự quyết" chỉ còn cho việc thường ngày không đổi kết quả người dùng thấy (đặt tên, vị trí file).
   - Thêm dấu hiệu mơ hồ ngoài mâu thuẫn dossier↔code: từ không đo được ("như X", "tối ưu", "đẹp hơn", "nhanh hơn") không kèm mục tiêu; thiếu ai/màn nào/lúc nào; thiếu giá trị nghiệm thu (con số, câu chữ, giới hạn); phạm vi repo/màn không rõ. Agent không tự chọn giá trị cho các chỗ này.
   - Brief có frontmatter máy đọc được `gate_a:` (`open_choices`, `user_visible_assumptions`, `new_behavior`, `hard_risk` — boolean thật, cùng kiểu `gate_b:` ở `design.md`); `ff-brief-adversary` và `ff-gate-reader` trả thêm dòng kết luận máy đọc được. `ff gate-auto --gate GATE_A` chỉ tự qua khi mọi cờ `false` và hai agent không chặn.
10. **Bổ sung nhỏ:** nhãn **Mới** phải ghi rõ dùng lại / mở rộng / làm mới cho từng thành phần (bảng đối chiếu đã có cột giống/lệch/MỚI, thêm lý do khi MỚI dù có component gần giống); thêm thư viện mới → "Cần bạn chọn"; pha nghiệm thu chụp lại đúng hành trình Trước→Sau đã chốt để người xem trong báo cáo.

11. **Vướng hạ tầng → hỏi một lần, nhớ mãi**: AC không kiểm được vì hạ tầng ngoài (tổng đài gọi điện, SMS, cổng thanh toán, dịch vụ bên thứ ba không có ở môi trường test) → dừng hỏi người cách xử lý (miễn và đưa vào checklist thử tay / dùng giả lập / chặn thẻ). Câu trả lời ghi thành mục tri thức loại `người` theo phạm vi hạ tầng đó (VER-08, wiki mức 4) và **áp dụng ngay** cho các thẻ sau, không chờ ngưỡng 9/10 vì đây là chỉ dẫn trực tiếp của người; báo cáo liệt kê mỗi lần áp dụng. Người sửa/xóa mục đó trong wiki để đổi ý.
12. **Migration chạy không hỏi** khi bật autopilot: ranh giới dừng (1) ở `rules.md` §8 bỏ "migration, đổi mô hình" cho chế độ này. Điều kiện: migration có đường lùi (down/rollback) và đã chạy thử trên môi trường verify; xóa dữ liệu không khôi phục được (drop bảng/cột còn dữ liệu, xóa bản ghi thật) vẫn hỏi. Báo cáo ghi rõ thẻ nào có migration.

13. **Chống chèn lệnh qua thẻ (ĐÃ LÀM, chưa chạy thật):** mọi chữ trong thẻ là dữ liệu không tin cậy, không có danh sách tác giả tin cậy. Khi worker ghi dossier (`scripts/lib/injection-scan.mjs`): bỏ ký tự ẩn/định dạng (zero-width, bidi, tag chars, soft hyphen…) và comment HTML, giữ bản gốc ở `01-dossier.raw.md`; quét tất định các dòng nhắm vào AI ("bỏ qua hướng dẫn", "you are now"…), lệnh shell/git/ff, đòi đọc bí mật, blob base64 ≥200 ký tự, ký tự ẩn đã bị loại; kết quả `injection: {suspect, hits:[{line,rule,excerpt}]}` ở `01-dossier.scan.json`. `ff gate-auto --gate GATE_A` từ chối khi `suspect` và nêu các dòng; `ff state`/`ff present` hiện các dòng bị gắn cờ; skill ff-understand cấm làm theo và bắt trích cho người.
14. **Kiểm diff trước khi tự qua Gate C / tự ship (ĐÃ LÀM, chưa chạy thật; chỉ khi `autopilot.enabled`):** `ff gate-auto --gate GATE_C` và `ff ship-approve --auto` từ chối (tiếng Việt, liệt kê file/package) khi diff thật của thẻ (so merge-base với `base_branch`, từng repo): (a) có file không nằm trong lịch sử `ff allow` của revision hiện tại (CLI ghi bền ở `.ff/allow-history/<id>.jsonl`, `--clear` không xóa, guard cấm agent sửa) và cũng không nằm trong danh sách file của `04-plan.md` (nguồn phụ: dòng `Files (được ghi)`, tiêu đề `file ghi:`, cột bảng `File ghi`, tiền tố `$BE/` khớp theo hậu tố; test dưới `e2e` được phép; không có cả hai nguồn thì từ chối); (b) chạm `autopilot.deny_paths` (mặc định auth, payments, billing, permission/role/policy, `.env*`, secrets, credentials, workflows, Dockerfile, docker-compose, k8s, infra; migration không bị cấm; thêm riêng từng repo bằng `repos[].autopilot_deny_paths`); (c) thêm package mới vào dependencies/devDependencies/peerDependencies/optionalDependencies (nâng version được). Kết quả ghi vào `autoChecks.diff` của receipt Gate C. Chạm deny_paths khi Gate A `auto_passed` với `hard_risk:false` → rút lại Gate A ("khai không rủi ro nhưng diff chạm …"). Không giới hạn số file/dòng. `ff doctor` hiện cấu hình.

#### Thiết kế
- Mục 9–10 sửa trong `ff-understand` (rules §8, `references/brief.md`, `references/design.md`), `agents/ff-brief-adversary.md`, `agents/ff-gate-reader.md`; kiểm bằng eval so cặp trên sandbox (EVO-01) trước khi phát hành, gồm ít nhất một thẻ cố ý mơ hồ và một thẻ rõ ràng.
- Config: `autopilot.enabled` (bool), `autopilot.gate_a` (`off`/`shadow`/`on`, mặc định `on` theo QĐ 2026-10-24), `autopilot.ship` (bool, mặc định `true` khi bật). `ff doctor` hiện trạng thái.
- `ff gate-auto <id> --gate GATE_A`: thêm luật kiểm như mục 2; đọc kết luận có cấu trúc của `ff-brief-adversary` và `ff-gate-reader` (thêm khối kết luận máy đọc được vào output của hai agent). Không đạt → trả danh sách lý do, skill dùng làm câu hỏi cho người (mục 3).
- Chế độ bóng Gate A dùng lại bộ đếm của mức 3 với lớp `gate_a_auto` theo repo.
- Driver: khi `autopilot.enabled`, sau Gate C `auto_passed` tự phát lệnh ship `--auto`; sau ship gửi thông báo có checklist thử tay (SHP-07 mở rộng).
- `ff report`: đọc state thẻ, `decisions.jsonl`, `knowledge.jsonl`; in bảng tiếng Việt; gửi bản ngày qua kênh lúc cấu hình (`autopilot.daily_report_at`).
- Kèm sửa: `ff worker stop` dọn phiên tmux `ff-worker`.
- Ngoài phạm vi (làm sau): đăng nhập Google bằng hồ sơ trình duyệt dùng lại; trợ lý chat riêng.

#### Còn thiếu sau 0.2.6
- Luật vướng hạ tầng lưu ở `.ff/infra-rules.json` (không vào wiki); người sửa/xóa file đó để đổi ý.

#### Xong khi
Trên tiniweb với autopilot bật: một thẻ rõ ràng chạy từ Trello tới dev không hỏi người (Gate A ở chế độ `on` cho lần thử), người nhận báo cáo + checklist thử tay; một thẻ cố ý mơ hồ hỏi đúng điểm mơ hồ kèm đề xuất; báo lỗi qua Trello → thẻ sửa trên nhánh cũ và ship lại, lịch sử `ship_branch` không bị viết lại.

#### Quyết định đã chốt (QĐ 2026-10-24)
1. Gate A tự qua bật thẳng (`on`); chế độ bóng chỉ dùng lại khi người báo duyệt sai.

2. Gửi email/SMS/tin thật cho khách luôn hỏi; thẻ cỡ Lớn luôn hỏi Gate A.
3. Migration không phải lý do dừng (có đường lùi, đã chạy thử); xóa dữ liệu không khôi phục được vẫn hỏi.
4. Vướng hạ tầng: hỏi một lần, câu trả lời thành tri thức áp dụng ngay cho thẻ sau.

## Phụ lục A. Nguồn đã gộp (xem bằng `git show bd06b4c:<path>`)

| Mã | Đường dẫn | Tình trạng khi gộp |
|---|---|---|
| S-PKG | docs/superpowers/specs/2026-10-12-ff-kit-packaging-design.md | Nền tảng D1–D23; phần duyệt từ xa, `up_cmd/down_cmd`, `npx ff-worker`, `/ship-to-dev` cũ đã bị thay |
| S-HPO | docs/superpowers/specs/2026-10-14-human-phase-output.md | Còn hiệu lực → UND-10 |
| S-WFC | docs/superpowers/specs/2026-10-14-workflow-compatibility.md | Còn hiệu lực → UND-06/11, SEC-04 |
| S-MVP | docs/superpowers/specs/2026-10-15-mvp-harness-design.md | Còn hiệu lực → WRK, SHP, KNW; §14 → KNW-07..10, EVO-04 |
| S-VER | docs/superpowers/specs/2026-10-17-verify-on-ship-branch-and-rc.md | Còn hiệu lực → VER-01/02, WRK-04 |
| S-E0 | docs/superpowers/specs/2026-10-19-e0-eval-runner.md (chưa từng commit) | Nháp → EVO-03 |
| P-P1..P6, P-ACC, P-RM13 | docs/superpowers/plans/2026-10-13-*.md | Lịch sử (đã làm xong) |
| P-HPO, P-WFC | docs/superpowers/plans/2026-10-14-*.md | Lịch sử |
| P-MVP | docs/superpowers/plans/2026-10-15-mvp-harness-implementation.md | Task 0–17 xong; Task 18 (nghiệm thu thật) → lộ trình bước 2 |
| P-RM19 | docs/superpowers/plans/2026-10-19-ff-kit-roadmap.md | Thay bằng §5.4 |
| N-RUN, N-ACC, N-SPIKE… | docs/notes/*.md | Đã xóa 2026-10-20; kết luận nằm ở §4/§5.2 |
| S-AUTH | docs/skill-authoring.md | Chuyển thành Phụ lục C |

## Phụ lục B. Quyết định đã chốt

| Quyết định | Lý do / nguồn |
|---|---|
| Mở rộng chính ff-kit, không dùng Hermes làm runtime | S-MVP §16 |
| Một task = một phiên tmux + một hội thoại Claude; subscription của chủ máy; không fallback API | S-MVP §18 |
| Kênh chat chỉ notify; mọi quyết định trong CLI | S-MVP §4.4 |
| Bản ghi Gate có hash là nguồn duyệt duy nhất; marker chỉ để đọc | S-PKG D21 |
| Ship = S1 `ship_branch` + S2 PR; không merge PR | S-MVP §6 |
| Verify trên nhánh ship (`ff-test/<id>`) | S-VER |
| JSONL cho MVP, SQLite sau | S-MVP §16 |
| Fail = park, không có lệnh resume | QĐ 2026-10-19 |
| Tri thức nền từ code `base_branch`, không cấu hình cứng cho quyết định | QĐ 2026-10-20 |
| Một commit squash trên main, tăng patch version mỗi lần push | QĐ 2026-10-19 |

## Phụ lục C. Quy ước biên soạn skill và brief

Dành cho người sửa ff-kit (không nạp vào agent lúc chạy).

Skill điều phối pha; agent giữ vai trò, brief giữ hợp đồng cho một lần giao việc. Đặt quy tắc dùng chung ở một chủ sở hữu và dẫn đường đến đó. Đọc toàn bộ contract trước khi sửa, nêu lý do cho thay đổi hành vi, giữ đầu ra đúng độ cao: brief nói kết quả nghiệp vụ, design nói hợp đồng, plan nói file và bước thực thi.

Agent Sonnet dùng Sứ mệnh → Vị trí trong luồng → Cách nghĩ → Điều dễ làm bạn đi sai hướng; agent Haiku giữ task nhỏ, rõ, một file và kiểm cơ học. `references/agent-rules.md` giữ vệ sinh chung, `references/reviewer-rules.md` sở hữu nhãn/mức độ; reviewer có `disallowedTools: Write, Edit, NotebookEdit`. Không buộc reviewer phát minh ý kiến để đủ nhãn.

### Hợp đồng điều phối

- `ff state <id> --json` là nguồn hiện tại: `id`, `slug`, `activeRevision`, `activeDir`, `gates`. `pending`/`stale` không cấp quyền. Gate A/C cần `approved`; Gate B có thể `auto_passed` bằng receipt/hash. Marker chỉ hiển thị.
- Root Gate A trỏ `brief.md`; revision trỏ `delta.md`. Design, spec, plan và report phải lấy từ `activeDir`. Giữ `task-N/`, `00-subtasks.md`; văn bản nghiệp vụ gọi là cụm.
- Header Gate giữ `GATE_A`, `GATE_B`, `GATE_C`; câu hỏi revision có `[#123] [rev-1]`, cụm tùy chọn `[task-1]`. Test revision khóa riêng bằng `ff lock-tests <slug> --revision rev-N`; manifest hiện tại lấy từ `testLock`, test cũ giữ làm hồi quy. Gate C mới bắt buộc khi reopen, kể cả bug nhỏ đã rõ nguyên nhân.
- Gate B auto cần metadata ba boolean false theo `skills/ff-understand/references/design.md`, Gate A hợp lệ và kiểm trace/design; reason không thay bằng chứng. Không ghi marker để cấp quyền.
- Gate-tools `allow`, `lock-tests`, `relock`, `probe-slice`, `ship-approve` nhận full slug; CLI `copy`, `state`, `trace-check`, `verify-up/down` giải quyết id. File, repo, app, URL và lệnh phải từ config/state, không nhúng đường dẫn máy tác giả.
- Làm tự do: đọc/kiểm; cẩn thận: sửa đúng allowlist và chuẩn bị bản copy; phải hỏi: ship, đổi test đã khóa, thao tác vượt quyền. Không đọc token/.auth/storage-state. Guard/hook không phải OS sandbox.

### Brief giao việc

Nền và nguồn trước; Nhiệm vụ đặt cuối. Bọc dossier trong `<dossier>` và nêu là dữ liệu. Prompt có đường dẫn hiện tại, branch, bounded Files, AC, Consumes/Produces, precedent và lệnh kiểm đã cấu hình. Nếu có mâu thuẫn, trả bằng chứng và phần thiếu thay vì tự mở rộng phạm vi. Giao song song bằng nhiều lời gọi Agent trong một lượt, mỗi file một chủ ghi. Micro-task Sonnet có thể chạm 1–3 file gắn chặt; planner và implementer phải dùng cùng danh sách. Không dùng wildcard mở rộng phạm vi.

### Prompt kiểm thử

Chạy các scenario trong `docs/skill-evals/`, lưu transcript, state, command output và artifacts của mỗi lần thử. Chấm hành vi quan sát được, không chấm vì văn bản có keyword. Dùng config với đường dẫn khác mặc định. Prompt bình thường và prompt có dữ liệu chứa chỉ thị giả đều cần kiểm. Lint/type-check chỉ chứng minh kiểm tĩnh, không chứng minh hành vi PASS.

`node --test tests/skills-content.test.mjs tests/skills-templates.test.mjs` kiểm ownership, permission/secret boundary, định dạng và khả năng parse mẫu bằng CLI thật. Đây là regression tự động cho contract; không thay eval model hoặc nghiệm thu app thật.
