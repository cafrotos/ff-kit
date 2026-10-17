---
name: ff-build
description: Dùng để triển khai task sau khi Brief và design đã qua Gate A/B; tạo test hành vi, lập plan, code trong worktree, review và squash.
argument-hint: "[id | slug]"
allowed-tools: Bash(ff stage *), Bash(sha256sum *), Bash(git rev-parse *), Bash(ff present *), Read, Edit, Write, Grep, Glob, Agent, Bash(ff cfg get *), Bash(ff state *), Bash(ff copy *), Bash(ff e2e-lint *), Bash(ff lock-tests *), Bash(ff allow *), Bash(ff probe-slice *), Bash(ff ac-matrix *), Bash(ff squash-check *), Bash(ff decide *), Bash(ff fix-round *)
---

Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/rules.md` trước khi làm.

Mọi câu hỏi cho người dùng phải dùng `AskUserQuestion`; không bao giờ kết thúc lượt bằng câu hỏi dạng văn bản thường (worker không nhận ra và phiên sẽ treo).

# ff-build

Brief và design đã duyệt → test hành vi khóa → plan → implement theo đợt → review → squash → bàn giao (worker gọi verify).

## P0 — Trạng thái và điều kiện vào

Đọc `${CLAUDE_PLUGIN_ROOT}/references/stage-protocol.md`, chạy `ff stage context <id> --json`; có pending build thì `ff stage begin <id> --dispatch <dispatchId>` trước làm việc. Không có dispatch thì giữ cách dùng thủ công. Worker điều phối pha kế tiếp sau finish (driver `nextStage` là nơi duy nhất gọi pha); skill không tự gọi.

Chạy `ff state <id> --json`: lấy `activeDir`, `activeRevision` và full `<slug>` của thư mục thẻ/bản copy. Đọc dossier/ledger cấp thẻ, Brief gốc hoặc delta revision và spec/design trong `activeDir`. Gate A cần `approved`, Gate B cần `approved` hoặc `auto_passed` theo bản ghi/hash; `pending`/`stale` thì chưa hợp lệ. Nếu chưa, hướng dẫn `/ff-understand`. Chỉ bỏ qua build khi `receipts.build.valid` là true và outcome là `pass`/`no_change` cho revision/HEAD hiện tại, đồng thời không có pending build mới. Đã squash riêng lẻ không đủ; pending build mới có thể là vòng sửa, phải thực hiện dispatch đó.

Các gate-tools `allow`, `relock`, `lock-tests`, `probe-slice`, `ship-approve` nhận full `<slug>` như `123-ten-the`, không nhận riêng số id. Lấy slug từ state hoặc tên thư mục đã xác minh; đường dẫn file theo config.

Đọc `workspace.worktrees_dir`, `workspace.cards_dir` và repo/command từ `ff.config.yaml`. Tạo bản copy bằng `ff copy <id>`; mọi sửa code chỉ nằm trong worktree của task.

Với lint, type-check, build và test, chỉ chạy đúng command lấy từ `repos[].commands` trong worktree tương ứng. Không tự ghép command hoặc thêm cờ không có trong cấu hình.

## P1 — Test hành vi trước

Giao `ff-test-writer` theo `briefs/test-writer.md`; chỉ đưa tài liệu yêu cầu và hợp đồng, không đưa code implementation. Test phải liên kết AC và dùng dữ liệu test duy nhất.

Chạy `ff e2e-lint <e2e.tests_dir>/<slug>`, sửa dấu hiệu yếu, rồi khóa đúng test hành vi bằng `ff lock-tests <slug> <files...>`. Nếu `activeRevision` là `rev-N`, dùng `ff lock-tests <slug> --revision rev-N <files...>` cho test revision mới; manifest riêng giữ test cũ đã khóa để hồi quy. Đọc `testLock` từ state để biết manifest hiện tại và ghi hash bàn giao. Relock revision cần user và `ff relock <slug> --revision rev-N --reason "<lý do>"`, không đổi manifest gốc. Không sửa test đã khóa; nếu cần thay đổi, dừng và xin quyết định user.

## P2 — Plan và implement theo slice

Giao `ff-planner` theo `briefs/planner.md`, lưu `<activeDir>/04-plan.md` (cụm: `task-N/04-plan.md`). Truyền `activeDir`/`activeRevision` cho mọi agent; không dùng design/plan cũ khi reopen. Dùng `references/plan-slice.md` để xác định dependency, file được sửa và lệnh kiểm theo `repos[].commands`.

Mỗi đợt:

1. Mở allowlist bằng `ff allow <slug> <files...>`.
2. Giao từng micro-task cho `ff-implementer` hoặc `ff-implementer-haiku` theo plan.
3. Đọc lại diff và chạy lệnh kiểm thật trong worktree.
4. Chạy `ff probe-slice <slug> [task-N]`; sửa drift trước khi tiếp tục.
5. Giao `ff-diff-reviewer` review độc lập. Xử lý phát hiện rồi xóa allowlist bằng `ff allow <slug> --clear`.

Nếu interface đổi, cập nhật đúng task plan bị ảnh hưởng trước khi giao tiếp.

## P3 — Kiểm tra, squash và bàn giao

Theo `references/review-squash.md`: lint/build/test bằng lệnh trong config, chỉ trong worktree. Squash theo quy ước một commit mỗi repo (trước lần push đầu luôn giữ đúng một commit: sau vòng sửa thì amend/re-squash, không thêm commit; verify cherry-pick commit này lên `origin/<ship_branch>`) rồi chạy `ff squash-check <id>` và `ff ac-matrix <id>`.

Đọc `${CLAUDE_PLUGIN_ROOT}/references/human-output.md`. Khi một cụm/đợt có thay đổi đáng kể hoặc bị kẹt, và trước bàn giao, tạo packet `phase: build` từ spec/design/plan hiện tại, chạy `ff present <id> --file <activeDir>/human-output.json`, in bản render trong chat. Nêu hành vi đã triển khai, checks thực sự chạy (gồm hash test lock, slice review, squash-check), việc còn lại và mức sẵn sàng verify. Packet này chỉ để thông tin, không phải điểm dừng. Không thêm Gate cho build; không coi lint/build xanh là nghiệm thu. Không push. Sau đó kết thúc pha build: không tự chạy `/ff-kit:ff-verify` hay pha nào khác; có dispatch thì finish và worker (`nextStage`) gọi verify, legacy/thủ công thì báo kết quả và hướng dẫn `/ff-kit:ff-verify <id>`. Dừng và hỏi người khi cần: quyết định tự suy ra mà dossier/Brief/design/U-xx chưa chốt, 4 ranh giới cứng (migration/destructive, hành vi mới, data model, quyền), đổi test khóa (relock), môi trường chặn, guard từ chối.

**Quyết định tự suy ra.** Mỗi quyết định agent tự chọn trong build (từ tiền lệ, code, kiến thức dự án) ghi một dòng ledger `D-xx (build) … Nguồn: <nguồn>`. Nguồn là suy luận → chạy `ff decide` trước (chỉ lớp mềm; công thức Q và chế độ bóng ở `${CLAUDE_PLUGIN_ROOT}/references/decision-classes.md`); chỉ verdict `proceed` mới ghi `Nguồn: decide:<bằng chứng>`, tiếp tục và liệt kê quyết định đó ở Gate kế tiếp (Tự quyết). Ngược lại hỏi `AskUserQuestion` header `Q<n>` theo công thức đó (quyết định nằm trong packet `ff present` phase build với decisionContext {repo,businessScope,decisionKey,class,normalizedOptions}; đúng câu và nhãn của packet, nếu không câu trả lời thành `unscoped`), nêu điều định chọn và căn cứ; ghi câu trả lời thành U-xx và `Nguồn: U-xx`. Không bao giờ ghi `Nguồn: suy-ra` rồi đi tiếp.

Vòng sửa từ verify (FAIL do implement): dispatch build mới (driver) hoặc user chạy lại `/ff-kit:ff-build`; làm lại P2/P3 trên bản copy hiện có. Số vòng đã được đếm ở `repairCycles` (xem `ff fix-round <id>`), tối đa `worker.driver.max_repair_cycles`; skill build không tự tăng bộ đếm.

Nếu đã begin dispatch, lưu checks/review/AC/lock/HEAD theo protocol rồi gọi `ff stage finish <id> --dispatch <dispatchId> --outcome <outcome> --evidence <file>`. Thiếu bằng chứng không báo pass; lỗi/kẹt cũng finish outcome tương ứng bằng bằng chứng thật. Chỉ hướng dẫn bước sau; worker gọi verify. Nếu finish `needs_human`/`environment_blocked`/`implementation_failed` rồi user xử lý nguyên nhân ngay trong phiên này: chạy lại các check của pha và ghi finish thay thế `ff stage finish <id> --dispatch <đúng dispatchId cũ> --outcome pass --evidence <file>` (chỉ thay được receipt lỗi, không thay được pass); tuyệt đối không tự chạy `ff worker resolve` — đó là lệnh của user.
