---
name: ff-verify
description: Dùng sau khi task đã squash và test hành vi đã khóa; chạy nghiệm thu trên app cấu hình, đếm vòng sửa khi FAIL (tối đa 3 mỗi revision), ghi báo cáo Gate C (tự duyệt khi đủ điều kiện tất định, ngược lại hỏi user); ship do worker hoặc /ship-to-dev.
argument-hint: "[id | slug]"
allowed-tools: Bash(ff stage *), Bash(sha256sum *), Bash(git rev-parse *), Bash(ff present *), Read, Edit, Write, Grep, Glob, Agent, Bash(ff cfg get *), Bash(ff state *), Bash(ff trace-check *), Bash(ff doctor *), Bash(ff squash-check *), Bash(ff e2e-auth-check *), Bash(ff ship-test *), Bash(ff verify-up *), Bash(ff verify-down *), Bash(ff verify-lock *), Bash(ff ac-matrix *), Bash(ff e2e-lint *), Bash(ff db-query *), Bash(ff ship-request *), Bash(ff mcp-auth *), Bash(ff gate-auto *), Bash(ff fix-round *), Bash(ff decide *), Bash(npx playwright test *)
---

Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/rules.md` trước khi làm.

Mọi câu hỏi cho người dùng phải dùng `AskUserQuestion`; không bao giờ kết thúc lượt bằng câu hỏi dạng văn bản thường (worker không nhận ra và phiên sẽ treo).

# ff-verify

Kiểm tra điều kiện → chạy môi trường → nghiệm thu AC bằng bằng chứng → Gate C (tự duyệt nếu đủ điều kiện, không thì hỏi user). Skill dừng ở cuối pha verify; pha kế tiếp do worker (`nextStage`) gọi.
Không sửa code sản phẩm hoặc `expect` trong test khóa; FAIL do implement thì theo "Vòng sửa" dưới đây.

## P0 — Điều kiện vào

Đọc `${CLAUDE_PLUGIN_ROOT}/references/stage-protocol.md`, chạy `ff stage context <id> --json`; có pending verify thì `ff stage begin <id> --dispatch <dispatchId>` trước làm việc. Không có dispatch thì giữ cách dùng thủ công. Chạy doctor preflight ngay trước verify; worker điều phối pha kế tiếp sau finish (driver `nextStage` là nơi duy nhất gọi pha); skill không tự gọi.

Chạy `ff doctor` và `ff state <id> --json`. Lấy `activeDir`, `activeRevision` và full `<slug>`; Gate A cần `approved`, Gate B cần `approved` hoặc `auto_passed`. Trạng thái `pending`/`stale` thì quay lại pha tương ứng; không suy ra duyệt từ marker. Truyền thư mục hiện tại cho verifier và đọc spec/design/plan trong đó, không dùng report revision cũ. Nhóm core/e2e phải xanh; task phải qua Gate A/B, có worktree/squash-check và test lock. Nếu thiếu, hướng dẫn `/ff-build` hoặc sửa config qua `/ff-init`.

Lấy `testLock` từ state làm manifest hiện tại; đối chiếu hash test revision và chạy cả test cũ liên quan làm hồi quy. Không dùng manifest gốc thay cho manifest activeRevision.

Lấy app, URL, auth, repo lệnh và query từ `ff.config.yaml`. User test và role lấy từ Brief; không dùng tài khoản hay URL mặc định.

## P1 — Môi trường và xác thực

**Verify chạy trên nhánh ship.** Trước mọi thứ khác, chạy `ff ship-test <id>`: dựng lại từ trạng thái sạch nhánh cục bộ `ff-test/<id>` = `origin/<ship_branch>` + commit squash duy nhất của nhánh feature, trong checkout ship riêng (không bao giờ push). Exit 1 do conflict thì **dừng**: ghi finish `needs_human` (kèm file conflict), không tự giải quyết; lỗi `squash` nghĩa là nhánh feature chưa đúng một commit, quay lại build. `ff verify-up` và e2e sau đó chạy từ checkout test (env `FF_REPO_DIR_<REPO>` chỉ tới nó), không từ worktree feature. Mỗi lần verify (kể cả sau vòng sửa) chạy lại `ff ship-test`. Khi lưu evidence verify, thêm `.ff/ship-test/<id>/<revision|root>.json` vào `artifactHashes`: receipt ràng buộc ba SHA (commit feature, base ship đã test, commit cherry-pick đã test); đổi bất kỳ cái nào thì bằng chứng mất hiệu lực. Chạy `ff ship-test` lại sau khi receipt đã lưu cũng làm mất hiệu lực, nên không chạy lại sau khi finish.

Chạy `ff e2e-auth-check --email <email-theo-brief>`. Nếu cần, dùng `ff mcp-auth --email <email>` theo cấu hình auth. Không đọc hoặc in token/storage-state.

Khởi động môi trường bằng `ff verify-up <id> <app>`; xác nhận health check và lock. Nếu cần verify lock từ thao tác khác, dùng `ff verify-lock acquire|release <slug>`. Không force-release lock đang thuộc task khác.

Giao `ff-verifier` theo `briefs/bind-verify.md` để gắn locator, chạy lượt test chẩn đoán locator và đo app thật. Lượt test này giúp agent tìm locator sai; nó không thay lượt nghiệm thu cuối của phiên chính. Chỉ cho phép sửa locator theo `references/bind-locators.md`.

## P2 — Chạy và đo

Sau khi verifier trả kết quả và không còn sửa locator, phiên chính chạy lại Playwright test theo `e2e.tests_dir` và `e2e.playwright_config`; đây là kết quả nghiệm thu cuối. Lệnh lấy từ config. Chạy `ff ac-matrix <id>` và `ff e2e-lint <path> --strict`.

Theo `references/proof-discipline.md` và `references/measure.md`: mỗi AC ghi UI, network, console và DB khi có thể kiểm. DB chỉ truy vấn SELECT/EXPLAIN bằng `ff db-query`; query mẫu nằm trong `project_docs.verification_queries_dir`. Tín hiệu không áp dụng ghi `N/A` và lý do; tín hiệu bắt buộc thiếu điều kiện ghi `UNVERIFIED`, không đổi thành FAIL nếu chưa có bằng chứng.

**UNVERIFIED.** Kiểm kỹ nguyên nhân. Chỉ được tự chấp nhận khi nguyên nhân là hạ tầng không thể tái hiện cục bộ: không thể viết docker compose / mock / seed để kiểm, hoặc phụ thuộc hệ thống ngoài thật (vd gọi điện thật qua tổng đài/SIP). Khi đó ghi verdict `UNVERIFIED[ext:<hạ-tầng>]` (`<hạ-tầng>` là tên ngắn dạng `[A-Za-z0-9_.-]`, vd `call-center`), kèm một dòng lý do vì sao compose/mock không khả thi và đã kiểm gì thay thế (vd payload request gửi nhà cung cấp). Chỉ khi `ff decide` trả `proceed` cho lớp `test-scope`, decisionKey `verify-exemption:<hạ-tầng>` (tri thức từ quyết định của người, xem `${CLAUDE_PLUGIN_ROOT}/references/decision-classes.md`) thì `ff gate-auto` mới coi AC đó được miễn; escalate/thiếu tiền lệ → AC vẫn UNVERIFIED, Gate C trình user kèm lý do. Không dùng danh sách cấu hình. Thiếu data, seed, tài khoản, env chập chờn, "không đủ thời gian" KHÔNG phải ngoại lệ: tự sửa (viết seed/compose/mock) hoặc dừng và hỏi user. `OBSERVATION` chỉ là UX, không thay PASS kỹ thuật.

Thực hiện Neighborhood Sweep và đánh giá UX/i18n theo report template. Không sửa `expect`; nếu test có vẻ sai, nêu bằng chứng và chờ user quyết định.

## Gate C

Ghi `<activeDir>/05-verify-report.md` theo `references/report.md`, liên kết AC với `D-xx`/`U-xx`, lưu bằng chứng và phần chưa kiểm. Chạy lại `ff trace-check <id>`.

Đọc `${CLAUDE_PLUGIN_ROOT}/references/human-output.md`. Tạo packet `phase: verify` từ spec/design/report hiện tại, chạy `ff present <id> --file <activeDir>/human-output.json --gate GATE_C` và in văn bản render trong chat. Giao reader mới theo `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/briefs/gate-reader.md`, chỉ nhận bản render và pha `verify`: phải hiểu lời hứa so với thực tế, bằng chứng, hồi quy, giới hạn và kết luận.

Hỏi các quyết định còn lại bằng `AskUserQuestion` header `Q<n>` trước; mỗi Q là một quyết định trong packet `ff present` phase verify có decisionContext {repo,businessScope,decisionKey,class,normalizedOptions}, hỏi đúng câu và nhãn của packet (công thức Q ở `${CLAUDE_PLUGIN_ROOT}/references/decision-classes.md`), nếu không câu trả lời thành `unscoped`. Quyết định tự suy ra trong verify: ghi ledger `D-xx (verify) … Nguồn: <nguồn>`; nguồn là suy luận thì chạy `ff decide` (chỉ lớp mềm; chế độ bóng ghi dự đoán), chỉ `proceed` mới `Nguồn: decide:<bằng chứng>` và liệt kê ở Gate C (Tự quyết), ngược lại hỏi `Q<n>` và ghi U-xx; không ghi `Nguồn: suy-ra` rồi đi tiếp.

**Vòng sửa (AC FAIL do implement).** Không trình Gate C ngay. Bộ đếm duy nhất là `repairCycles` theo revision, giới hạn `worker.driver.max_repair_cycles` (tối đa 3, bền qua restart). Có driver dispatch (xem P0): không gọi `ff fix-round`; finish `implementation_failed`, driver tự tăng bộ đếm và dispatch build lại. Không có dispatch (legacy/thủ công): chạy `ff fix-round <id> next --reason "<lý do>"` (cùng bộ đếm), kết thúc verify và hướng dẫn user chạy `/ff-kit:ff-build <id>` để sửa, squash lại rồi verify lại từ `ff ship-test`; không tự gọi build. `ff fix-round` thoát mã 3 khi hết vòng: dừng, trình Gate C cho user (header `GATE_C`), nêu các vòng đã thử và vì sao từng vòng thất bại. Bản sửa cần quyết định tự suy ra chưa được chốt cũng trình user.

**Gate C tự duyệt.** Cuối verify, sau khi `ff trace-check` sạch và report đã ghi, chạy `ff gate-auto <id> --gate GATE_C --reason "<căn cứ>"`. CLI kiểm tất định: mọi AC PASS (hoặc `UNVERIFIED[ext:<hạ-tầng>]` được `ff decide` cho miễn, xem mục UNVERIFIED), không FAIL hồi quy, ship-test sạch, test lock nguyên vẹn, không còn Q pending, mọi D-xx gắn `(build)`/`(verify)` có `Nguồn: dossier|brief|design|U-xx|decide:<bằng chứng>`. Exit 0 → Gate C là `auto_passed` (không phải user duyệt), sang "Ship". Exit 1 → trình Gate C cho user như dưới, kèm nguyên văn lý do CLI từ chối.

Trình Gate C riêng bằng header `GATE_C`, câu hỏi `[#<id>]` (revision: `[#<id>] [rev-N]`, tùy cụm thêm `[task-N]`), lựa chọn `Duyệt`/`Cần sửa`. Hook giữ bản ghi và hash; không tự ghi marker duyệt.

Kết thúc môi trường bằng `ff verify-down <id>`. Nếu đã begin dispatch, lưu evidence với report hiện tại, HEAD, checks, AC, review và test lock theo protocol; gọi `ff stage finish <id> --dispatch <dispatchId> --outcome <outcome> --evidence <file>`. Chỉ pass khi bằng chứng nghiệm thu đủ; lỗi môi trường là `environment_blocked`, lỗi implementation là `implementation_failed`, cần quyết định người là `needs_human`. Receipt không thay Gate C. Nếu Gate C chưa `auto_passed` hoặc được user duyệt, báo cáo kết quả và dừng. Nếu finish `needs_human`/`environment_blocked`/`implementation_failed` rồi user xử lý nguyên nhân ngay trong phiên này: chạy lại các check của pha và ghi finish thay thế `ff stage finish <id> --dispatch <đúng dispatchId cũ> --outcome pass --evidence <file>` (chỉ thay được receipt lỗi, không thay được pass); tuyệt đối không tự chạy `ff worker resolve` — đó là lệnh của user.

## Ship

Verify không tự ship. Đọc lại `ff state <id> --json`; chỉ khi Gate C của `activeRevision` là `auto_passed` hoặc `approved` với hash report hiện tại mới có thể ship, và chỉ qua pha ship:

- Có driver dispatch: worker dispatch pha ship riêng sau Gate C (`nextStage`); verify không tự gọi ship/push ở cuối verify. `ff ship-request` là thông báo tùy chọn.
- Không có dispatch (legacy/thủ công): verify kết thúc ở báo cáo Gate C và hướng dẫn user `/ship-to-dev`. Gate C `auto_passed` → `/ship-to-dev` tự chạy `ff ship-approve <slug> --auto` (chỉ hợp lệ với Gate C `auto_passed`), `ff ship <id>` rồi CLI báo user (AC được miễn, quyết định tự làm, commit đã lên). Gate C `approved` bởi user → vẫn cần xác nhận ship riêng (`ff ship-approve <slug>`, user được hỏi), không dùng `--auto`.

Không push ngoài `ff ship`.
