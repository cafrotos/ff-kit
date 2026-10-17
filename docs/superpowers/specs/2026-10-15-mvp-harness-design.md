# MVP harness cho ff-kit: Trello → quy trình ff-kit → dev + PR

Trạng thái: **đã cập nhật theo các điều chỉnh và phản biện được duyệt ngày 2026-10-15; đã có [implementation plan](../plans/2026-10-15-mvp-harness-implementation.md), chưa triển khai code**. Nhánh: `feat/mvp-harness`.

Phạm vi cập nhật: Rocket.Chat chỉ notify; người trả lời Gate/câu hỏi và xác nhận ship trong CLI. **Một task dùng một phiên tmux và một cuộc hội thoại Claude xuyên suốt các pha và vòng reopen**. MVP giữ TmuxClaudeRunner + send-keys, khởi động/resume bằng `claude --permission-mode auto` với subscription của chủ máy. Agent SDK/native background/channels là hướng nghiên cứu sau, không phải điều kiện triển khai MVP. Người chỉ attach khi nhận notify cần quyết định; worker gọi pha tiếp theo. Tối đa 3 vòng sửa code → verify lại cho mỗi revision. Ship lần đầu squash từ mốc tách prod; lần sau chỉ squash phần sửa mới so với nhánh task trên remote, rồi cherry-pick commit mới sang dev.

## 1. Mục tiêu

Biến ff-kit từ bộ công cụ "có người ngồi điều khiển từng pha" thành harness tự chạy hết vòng đời một thẻ Trello. Người chỉ xuất hiện ở các điểm quyết định có chủ đích: Gate A, Gate B (khi dừng), Gate C, xác nhận ship, nghiệm thu, merge PR.

**Tiêu chí xong (kịch bản nghiệm thu duy nhất của MVP).** Một thẻ Trello thật đi từ cột đầu vào đến `done`, trong đó người dùng chỉ:

1. trả lời Gate/câu hỏi khi được báo,
2. xác nhận ship,
3. nghiệm thu trên dev,
4. bấm merge PR.

Không phải gõ lệnh chuyển pha, không phải `tmux attach` chỉ để chuyển pha. Thẻ bị nghiệm thu hỏng quay về `reopen_list`, harness tự mở `rev-N`, chạy lại quy trình, cập nhật cùng PR và cùng dev. Kịch bản phải chạy thật trên **ít nhất hai thẻ của dự án thật**, một thẻ có đủ vòng re-open.

### Ngoài phạm vi MVP (xem mục 14)

Dreaming bằng LLM, wiki tự cập nhật, SQLite/FTS5/vector, gói ngữ cảnh, `cswap` và điều phối quota, làn model miễn phí, tiến hóa skill, tự duyệt Gate thật, merge PR, ship test e2e, re-open thẻ đã merge (đó là thẻ Fix mới), nhận câu trả lời hoặc duyệt qua Rocket.Chat, chuyển toàn bộ runtime sang Agent SDK.

## 2. Hiện trạng đã kiểm chứng trong mã (ff-kit HEAD `6c401bb`)

| Sự thật | Nguồn |
|---|---|
| Worker poll Trello, ghi `01-dossier.md`, mở **một** phiên tmux chạy `claude`, dán prompt "bắt đầu với `/ff-kit:ff-understand`", rồi không điều khiển gì nữa | `ff-worker/src/core/worker.mjs` (`launchAgentTask`), `tmux.mjs` |
| Mỗi skill làm **một pha rồi dừng** và in dòng bàn giao ("gọi `/ff-kit:ff-build <id>`", "Không tự code"). Người phải gõ lệnh pha kế | `skills/*/SKILL.md` |
| `ff state <id> --json` trả `gates.GATE_A/B/C.status` (`approved`/`auto_passed`/`pending`/`stale`, ràng buộc hash) và `readyForBuild` | `scripts/cli/state.mjs` (`inspectCard`) |
| Worker chuyển thẻ sang `done_list` **ngay khi Gate C duyệt**, đặt `shipState: not_shipped`; không nhặt lại thẻ đã `completed` | `runtime.mjs` (`checkCompletedTasks`), `worker.mjs` (`processTasks`) |
| `/ship-to-dev` là hướng dẫn markdown cho agent: cherry-pick `-x` lên `ship_branch`, build, test, push. Không có CLI, không tạo PR | `commands/ship-to-dev.md` |
| `git push` bị `guard` chặn trừ khi có marker `.ff-ship-approved` (TTL 2 giờ) do `ff ship-approve` tạo sau khi hỏi người. `gh` chưa có luật nào | `scripts/lib/guard-rules.mjs` |
| `ff reopen <id> --reason` tạo `rev-N/`, yêu cầu Gate C revision trước đã duyệt, ghi `bases`. Chỉ chạy khi người yêu cầu | `scripts/cli/reopen.mjs`, `skills/ff-understand/references/reopen.md` |
| `ff copy`: repo gốc phải ở `base_branch` (mirror); `git clone --local` vào `worktrees_dir/<id>-<slug>/<repo>`; `origin` = upstream thật, repo gốc = remote `ff-local`; nhánh feature tách từ `ff-local/<base_branch>`. `ff sync` cập nhật mirror | `scripts/cli/copy.mjs`, `sync.mjs` |
| `verify-lock` là khóa toàn workspace: mỗi lúc chỉ một thẻ verify | `scripts/lib/verify-lock.mjs`, `ff-worker/src/core/http.mjs` |
| `ff e2e-scaffold` copy `templates/ff-e2e` vào `e2e.dir`, `npm install`. `ff doctor` có nhóm `e2e` riêng; đỏ thì `ff-verify` không chạy | `scripts/cli/e2e-scaffold.mjs`, `scripts/lib/doctor.mjs` |
| Bản ghi Gate (`storeReceipt`) **ghi đè** cùng một file cho mỗi (Gate, phạm vi): chỉ còn câu trả lời cuối, lịch sử "Cần sửa" mất | `scripts/lib/gates.mjs` |
| Ledger `01b-ledger.md` có bảng `\| U-01 \| câu hỏi \| trả lời \| ngày \|` (câu trả lời của người) và `D-xx` (comment nghiệp vụ) | `skills/ff-understand/references/brief.md`, `gates.mjs` |
| Quy tắc dừng hỏi: bốn ranh giới cứng luôn hỏi dù đoán được; còn lại agent tự quyết, ghi "Cần bạn chọn" kèm mặc định. Quy tắc "dừng hỏi khi đoán được phản ứng người duyệt" chỉ dựa vào đoán trong phiên | `skills/ff-understand/SKILL.md` (mục "Ranh giới dừng hỏi", "Gate A") |
| Plugin chạy từ `dist/` đã commit (esbuild, "không cần npm install"); `hooks/hooks.json` gọi `${CLAUDE_PLUGIN_ROOT}/dist/...`; CLI `ff` cài riêng bằng `npm i -g git+...` | `scripts/build.mjs`, `hooks/hooks.json`, `INSTALL.md` |
| `tests/plugin-content.test.mjs` cấm tên riêng workspace (`tiniweb`, `oe-hrm`, `system-service`, `origin/prod|dev`, `/home/...`) trong `skills/`, `agents/`, `commands/`, `references/` | `tests/plugin-content.test.mjs` |
| Máy hiện **chưa có** `ff.config.yaml` cho workspace, `gh` chưa cài, ff-kit chưa `npm install` (dev-only: build và test) | kiểm tra trực tiếp |

## 3. Vấn đề cốt lõi

Bộ điều khiển pha cơ học một mình chỉ bỏ được việc gõ lệnh chuyển pha và `tmux attach`. Số lần người phải *kiểm* không giảm, vì các quyết định "đi tiếp hay hỏi người" bên trong skill chỉ dựa vào đoán trong một phiên, không có trí nhớ về những lần người đã quyết trước đó. MVP vì thế gồm hai nửa:

- **Nửa cơ học:** harness điều khiển pha, ship hai chặng, vòng đời Trello có re-open.
- **Nửa tri thức tối thiểu:** ghi lại mọi quyết định của người từ ngày đầu, và một lệnh `ff decide` để skill dùng ở đúng chỗ nó đang phải đoán. Khởi động lạnh = luôn hỏi người = hành vi hiện tại, nên an toàn.

## 4. Kiến trúc tổng thể

```
Trello ──poll──▶ ff-worker
                  │  driver: mỗi chu kỳ, mỗi thẻ
                  │    state = inspectCard(+ task + ship + PR)
                  │    stage  = understand | build | verify | ship | acceptance | done
                  │    waitingOn = null | GATE_A | GATE_B | GATE_C | ship_confirm
                  │               | verify_lock | setup:e2e | stuck | needs_human
                  ▼
        tmux: một phiên cho mỗi task, giữ context xuyên pha và rev-N
                  │  Claude --permission-mode auto; worker gửi lệnh pha bằng send-keys
                  │  hooks (đã có): guard, ask-pre (báo kênh), ask-post (ghi Gate)
                  │  hooks (sửa):   ask-pre/ask-post phát sự kiện câu hỏi;
                  │                 ask-post ghi nối thêm .ff/decisions.jsonl
                  ▼
        ff ship <id>:  S1 dev + push task (cherry-pick, build, test, push)  ‖  S2 PR (gh pr create/update)
                  ▼
        ship-watch: quan sát PR/Trello → sự kiện → driver quyết định done hoặc reopen
```

Nguyên tắc: **mọi trạng thái nằm trên đĩa** (dossier, ledger, receipt Gate, `.ff/tasks/<id>.json`, `.ff/ship/<id>.json`). Nếu tiến trình bị mất, ưu tiên resume đúng Claude session ID của task và đọc lại trạng thái. Chỉ khi transcript không thể resume mới mở cuộc hội thoại khôi phục từ artifacts; ghi rõ mất context trong history, không coi là restart bình thường. Prompt khôi phục hiện có là nền tảng; chưa đủ để bảo đảm phục hồi mọi tác động Git/GitHub nếu thiếu checkpoint và đối chiếu remote.

### 4.1 Chủ sở hữu trạng thái và sự kiện

- **Driver là nơi duy nhất quyết định và ghi chuyển trạng thái vòng đời task**: `stage`, `waitingOn`, trạng thái thực thi, revision hiện hành và history. `runtime` chỉ lên lịch; không giữ một đường hoàn tất độc lập ngoài driver.
- Runner thực thi pha, phát kết quả/câu hỏi/lỗi; hooks kiểm chính sách và ghi receipt Gate; `ff ship` sở hữu checkpoint tác động ship; ship-watch quan sát Trello/PR. Các thành phần gửi sự kiện cho driver, không tự ghi đè snapshot task.
- `ff reopen` giữ chức năng tạo hợp đồng revision; khi harness bật, gửi sự kiện revision đã tạo để driver cập nhật task. Cần sửa đường ghi trực tiếp hiện có của lệnh này.
- Sự kiện lưu bền trước khi xử lý, có `eventId`, `cardId`, `revision`, `runId`, loại, thời điểm và dữ liệu tham chiếu. Driver bỏ sự kiện trùng và từ run/revision cũ; không xóa pending question chỉ vì một hook cũ kết thúc muộn.
- Giữ file-based state cho MVP. Snapshot có `stateVersion`; cập nhật dưới khóa task và kiểm phiên bản dự kiến. Atomic rename chống file dở dang, không thay khóa chống lost update. Event inbox và checkpoint dùng cơ chế ghi nguyên tử hiện có; không yêu cầu queue hoặc event-sourcing framework.

### 4.2 Runner adapter: một phiên tmux cho mỗi task

Driver gọi adapter `start/inspect/sendStage/resume/stop`; adapter bọc giao tiếp tmux, driver không tự phân tích pane. Runner phát trạng thái `working|waiting_human|idle|blocked|failed|exited` cùng runId/heartbeat và tham chiếu kết quả. Hoàn tất pha cần receipt khớp revision/commit; thấy prompt không phải bằng chứng hoàn tất.

MVP dùng `TmuxClaudeRunner` bọc Tmux hiện có, giữ cơ chế `send-keys` để gửi prompt/lệnh pha vào **cùng một phiên của task**. Pane hỗ trợ chẩn đoán, phát hiện kẹt và kiểm tra input trống trước khi gửi; hook/sự kiện và receipt quyết định tính hợp lệ của chuyển pha. Không coi parsing terminal là giao thức bảo đảm chắc chắn; trạng thái không rõ thì giữ phiên và báo người.

Bình thường người không attach; worker và Claude tự chạy. Khi gặp Gate, xác nhận ship hoặc vấn đề không thể tự quyết theo quy tắc, hệ thống giữ câu hỏi đang chờ và gửi notify để người attach trả lời. Worker không gửi lệnh pha khi còn câu hỏi/permission, Claude đang xử lý hoặc input chưa trống. Trả lời xong, Claude tiếp tục pha hiện tại; chỉ khi pha kết thúc và kết quả hợp lệ thì worker gọi pha tiếp theo. Không có bước bàn giao quyền nhập thủ công sau câu trả lời. Receipt và state trên đĩa vẫn là nguồn quyết định, không suy ra phê duyệt từ lời nói trong context.

Agent SDK, native background và Channels chỉ là ứng viên sau MVP. Mẫu SDK ↔ CLI handoff của Happy và hợp đồng input/events/resume của NanoClaw là tài liệu tham khảo, không chặn đường tmux hiện tại. Bất kỳ thay runner nào phải giữ một cuộc hội thoại cho mỗi task, subscription, khả năng can thiệp CLI, plugin/hooks/Gate và phục hồi; chưa chốt chuyển sang SDK.

**Xác thực/billing (đối chiếu docs chính thức ngày 2026-10-15):** không mặc định rằng SDK bắt buộc PAYG trong mọi trường hợp. Docs legal nhắc ordinary individual use của Claude Code và Agent SDK trong giới hạn Pro/Max; docs authentication hỗ trợ đăng nhập subscription và `claude setup-token` cho scripts. SDK chạy Claude Code binary. Tuy nhiên quickstart SDK hướng dẫn API key, và sản phẩm/dịch vụ bên thứ ba phải dùng phương thức được Anthropic cho phép, không trung gian credential/quota subscription thay người dùng. ff-kit tự dùng tài khoản của chủ máy phải xác minh thực tế bằng spike; không hứa bảo đảm tương thích mọi bản SDK. Nếu cấu hình subscription, không tự fallback sang API/PAYG khi hết quota hoặc lỗi auth; chuyển sang blocked và notify. Không chép credential vào task log.

### 4.3 Receipt và phiên bản workflow

Mọi kết quả dùng để chuyển pha phải có `cardId`, `revision`, `runId`, commit SHA từng repo và hash artifact liên quan. Bằng chứng cũ không được áp dụng cho revision hoặc source HEAD mới.

Build completion là receipt do lệnh ff kiểm và ghi sau khi pha build kết thúc, gồm HEAD từng repo, test-lock hash, checks và tham chiếu review/AC matrix. Không dùng riêng sự tồn tại testLock, `squash-check` hay marker rỗng làm bằng chứng. Trường hợp không có thay đổi code phải có kết luận no-change rõ ràng và kiểm chứng theo AC; 0 commit tự nó không chứng minh đã xong.

Task ghi lại phiên bản/digest workflow, CLI, plugin và skills đã dùng. Snapshot giữ cả `bin/ff` (executable) và `dist/cli.mjs` với cấu trúc thư mục gốc; launcher nạp plugin từ snapshot qua `--plugin-dir` và đặt `<snapshot>/bin` lên đầu PATH của tiến trình Claude. SessionStart giữ PATH này cho các lệnh Bash qua `CLAUDE_ENV_FILE`; kiểm ngay trong Bash của Claude rằng `command -v ff` và `ff --version` thuộc bản đã ghim, cả tạo mới và resume. Không sửa CLI global; không tìm thấy snapshot thì blocked, không chạy nhầm ff global. Driver resume bằng bản đã ghim; thiếu bản tương thích thì blocked và báo người, không âm thầm đổi quy trình giữa task. Bản vá skill mới áp dụng cho task mới; đổi bản của task đang chạy cần quyết định tường minh và làm stale bằng chứng bị ảnh hưởng.

### 4.4 Kênh người dùng

Rocket.Chat **chỉ gửi notify**, không nhận lệnh, câu trả lời, phê duyệt hoặc credential. Người chỉ attach khi được notify cần quyết định. Gate, câu hỏi, relock và xác nhận ship vẫn thực hiện trong Claude CLI. Thông báo kèm card/revision và cách attach. Sau câu trả lời, quy trình tiếp tục tự động khi đủ điều kiện; người không gõ lệnh chuyển pha hoặc bàn giao quyền nhập.

## 5. Bộ điều khiển pha (driver)

File mới: `ff-worker/src/core/driver.mjs`. `runtime.mjs:cycle()` thu thập sự kiện/quan sát và gọi driver. Khi bật harness, thay đường hoàn tất trong `checkCompletedTasks` bằng chuyển trạng thái của driver; không chạy logic cũ chuyển done ở Gate C trước driver.

### 5.1 Suy ra pha

Hàm thuần `nextStage({ state, task, ship, pr })` (dễ test bằng bảng đầu vào/đầu ra):

| Điều kiện (theo thứ tự) | Pha | waitingOn |
|---|---|---|
| Có pause/lỗi chưa xử lý/câu hỏi hợp lệ đang treo | giữ pha hiện hành | nguyên nhân cụ thể; phản hồi xong mới suy ra tiếp |
| Revision mới đã tạo hoặc bằng chứng cũ không khớp revision/HEAD | suy ra từ bằng chứng revision hiện hành | không tái sử dụng ship.complete hoặc receipt revision trước |
| `dev_and_pr`: mọi PR bắt buộc đã merge, head SHA tại thời điểm merge khớp source HEAD của task đã duyệt và đã ship | `done` | — |
| `dev_only`: người xác nhận nghiệm thu revision/source HEAD của task đã ship trong CLI | `done` | — |
| S1 đã xác minh cho mọi repo bị ảnh hưởng, và S2 xong cho mọi repo cần PR nếu mode yêu cầu | `acceptance` | `acceptance` (người nghiệm thu) |
| Gate C hiện hành approved và các chặng ship bắt buộc chưa xong | `ship` | ship_confirm hoặc lý do blocked cụ thể |
| Verify có bằng chứng lỗi implementation hoặc phản hồi Gate C yêu cầu sửa code trong phạm vi đã duyệt | `build` | vô hiệu hóa build receipt; giữ lịch sử; không sửa test khóa |
| `readyForBuild`, build receipt hợp lệ, Gate C chưa duyệt | `verify` | GATE_C/verify_lock/setup:e2e khi tương ứng |
| `readyForBuild`, chưa có build receipt hợp lệ | `build` | — |
| còn lại | `understand` | GATE_A/GATE_B khi có câu hỏi treo |

Bảng áp dụng sau khi driver đã xử lý sự kiện được nhận diện và xác minh scope; không tự xóa blocked bằng cách suy lại từ artifact. Verify lỗi môi trường/auth đi setup; nghi sai test khóa hoặc thay đổi yêu cầu quay về quyết định người. Nếu phản hồi chưa đủ rõ để phân loại thì hỏi trong CLI, không lặp verify mù. Mỗi revision có tối đa `max_repair_cycles: 3` vòng **sửa code → verify lại**, sau lượt verify ban đầu. `max_repair_cycles` có mặc định 3; `repairCycles` khởi tạo bằng 0 cho revision mới. Tăng `repairCycles` và lưu xuống task trước khi bắt đầu mỗi vòng sửa; lượt verify lại vẫn lỗi sau vòng thứ 3 thì `needs_human`, gửi notify và không mở vòng thứ 4. Worker restart/resume không đặt lại bộ đếm; chỉ revision mới có bộ đếm mới. Giữ lỗi verify cũ trong lịch sử nhưng không dùng lại để kích hoạt sửa khi đã có kết quả mới. Lỗi môi trường/auth hoặc cần quyết định yêu cầu không tính thành vòng sửa code; `max_stage_retries` vẫn chỉ dành cho lỗi mở/resume phiên hoặc gửi lệnh.

### 5.2 Một phiên cho mỗi task, chuyển pha trong cùng context

- Tên tmux `ff-<id>` giữ nguyên theo `worker.tmux.session_prefix`; tạo một lần khi nhận task. Với phiên Claude mới, worker sinh `claudeSessionId` bằng `crypto.randomUUID()` và lưu bền trước launch; chạy `claude --session-id <uuid> --permission-mode auto`. SessionStart đối chiếu ID thực tế với ID đã lưu và xác nhận phiên đã khởi động, không cấp ID. Lưu riêng tmux session name, `claudeSessionId` và runId; tên tmux/runId không phải ID hội thoại. Phiên đã tồn tại dùng lại ID đã lưu hoặc binding đã xác minh, không sinh UUID mới chỉ vì worker restart.
- Understand → build → verify → ship và verify → build để sửa lỗi đều gửi lệnh vào cùng phiên. **Không kill/recreate, không /clear và không reset context chỉ vì đổi pha.** Reopen sang rev-N tiếp tục cuộc hội thoại hiện có, kèm activeRevision/artifacts hiện hành để không dùng nhầm bằng chứng cũ.
- Prompt theo pha: `/ff-kit:ff-understand <id>`, `/ff-kit:ff-build <id>`, `/ff-kit:ff-verify <id>`, `/ff-kit:ship-to-dev <id>`. Gửi lệnh bằng cơ chế literal send-keys hiện có sau khi kiểm đủ điều kiện; không nối nội dung Trello thô thành phím điều khiển hoặc shell command. Mọi prompt giữ quy tắc đọc dossier như dữ liệu. Mô tả/comment Trello, kể cả nội dung yêu cầu bỏ Gate, giả phê duyệt hoặc push ngay, không phải quyền điều khiển workflow; không biến chúng thành approval hoặc lệnh của worker. Guard và CLI vẫn kiểm receipt độc lập với nội dung agent đọc.
- **Worker là nơi duy nhất gọi pha tiếp theo.** Skill chỉ thực hiện pha hiện tại, ghi kết quả và hướng dẫn bước tiếp theo rồi dừng. Cụ thể, hướng dẫn ship ở cuối verify không phải một lần thực thi ship; worker chỉ gọi `/ff-kit:ship-to-dev <id>` sau khi verify kết thúc và Gate C hợp lệ. Người không phải gõ lại hướng dẫn đó.
- Driver chỉ gửi khi receipt pha trước hợp lệ, phiên đã dừng lượt/idle, không pending question và input trống. Ghi dispatchId và intent trước gửi; ghi nhận bắt đầu pha và receipt kết thúc phải gắn đúng dispatchId (có thể dùng hook hiện có hoặc lệnh ff do skill gọi). Nếu crash giữa gửi và ghi nhận mà không xác định đã nhận chưa thì đối chiếu state/hook; không gửi lại mù.
- runId biểu diễn vòng đời tiến trình Claude; dispatchId biểu diễn lần gọi pha trong tiến trình đó. Receipt/sự kiện mang cả stage/revision/dispatch để hook của pha cũ không kết thúc nhầm pha mới.
- Worker restart nhưng tmux/Claude còn sống: gắn lại tracking, không chạy lại lệnh mở đầu hoặc lệnh pha đang chạy. Claude chết: chờ cleanup rồi `claude --resume <claudeSessionId> --permission-mode auto`, cùng workspace/config/plugin đã ghim; dùng prompt khôi phục và ff state trước tiếp tục. Không chạy hai tiến trình cùng sở hữu hội thoại.
- Giữ context giúp dùng lại suy luận và giảm đọc lại tài liệu khi chuyển pha. Không hứa tổng token luôn thấp hơn vì lịch sử vẫn tăng; cho phép cơ chế auto-compaction sẵn có của Claude khi cần, không ép compact/clear tại ranh giới pha.

### 5.2.1 Auto mode khi khởi động và resume

- Launcher thêm rõ `--permission-mode auto` khi tạo hoặc resume tiến trình Claude, thay vì phụ thuộc mặc định của phiên bản CLI hay chỉnh user settings toàn máy. Cấu hình engine vẫn giữ executable/model/flags của workspace; hợp nhất permission-mode thành một giá trị hiệu lực, không thêm flag mâu thuẫn.
- Auto mode giảm permission prompts cho thao tác thường lệ bằng classifier. Nó **không phải bypassPermissions** và không bảo đảm không bao giờ hỏi. Theo docs hiện hành, auto từ project `.claude/settings.json` không đủ để ép starting mode; dùng flag launcher.
- Giữ các Gate A/B/C, câu hỏi làm rõ, relock, ship confirmation và guard hiện có. Skill phải tiếp tục gọi AskUserQuestion ở các điểm này dù auto mode khuyến khích tự làm. Worker không tự trả lời thay người; Rocket.Chat chỉ notify.
- Nếu classifier/explicit ask/permission khiến phiên chờ, đặt waitingOn theo lý do và notify một lần; không tự bấm Yes, không đổi sang bypass/dontAsk hoặc tắt AskUserQuestion để vượt điểm chờ.
- Doctor kiểm phiên bản/khả năng auto mode, xác thực subscription và hiệu lực settings/model; startup smoke xác minh mode thực tế. Nếu CLI/policy khiến auto không khả dụng thì báo rõ setup:permission, không âm thầm công bố đã chạy auto hoặc hạ/rộng quyền.

### 5.3 Thẻ kẹt và thử lại

- `stuck`: không đổi `inspectCard`, không đổi nội dung pane và `waitingOn` rỗng trong `stuck_after_minutes` (mặc định 90): báo kênh một lần, đặt `waitingOn: stuck`, **không** tự kill.
- Mỗi pha có `max_stage_retries` (mặc định 3) cho lỗi mở/resume phiên hoặc gửi lệnh đã xác định chưa được nhận; lỗi không rõ đã gửi hay chưa phải đối chiếu trước retry. Quá số lần thì `needs_human`, báo và dừng. Đồng hồ `max_session_lifetime_hours` (24) chỉ tính thời gian ở trạng thái `working`, không tính lúc chờ người ở Gate (hôm nay một thẻ chờ Gate qua đêm sẽ bị đánh `failed` oan).
- Không bao giờ vượt `worker.max_concurrent_tasks`; thẻ chờ khóa verify không chiếm chỗ làm việc của thẻ khác (chỉ tính thẻ ở `working`).

### 5.4 `waitingOn` và lịch sử

- `.ff/tasks/<id>.json` thêm: `stage`, `waitingOn`, `history[]` (mỗi mục: `{at, from, to, reason}`), `stageRetries`, `repairCycles` theo revision, `tmuxSession`, `claudeSessionId`, `runId`, `dispatchId` và trạng thái pending dispatch. Cùng task/revision không tự đổi Claude session ID vì chuyển pha.
- Hook `ask-pre` phát sự kiện question-opened theo header (`GATE_A|GATE_B|GATE_C|Q`), `ask-post` ghi receipt và phát question-answered. Driver đặt/xóa `waitingOn` theo đúng questionId, revision và runId; hỗ trợ một lượt có nhiều câu hỏi. Không để hook ghi trực tiếp snapshot task.
- `history[]` ghi mọi chuyển pha. Đây là dữ liệu thô cho học sau MVP, không tốn thêm kiến trúc.

### 5.5 Quan sát

`ff worker status` liệt kê từng thẻ:

```
#123  understand  chờ: GATE_A (bạn)         từ 14:10   rev gốc
#124  verify      chờ: verify_lock (#123)  từ 14:32
#125  acceptance  chờ: nghiệm thu          PR #88 mở  dev: ab12cd3
#126  build       đang chạy                từ 14:41
#127  —           needs_human: build lỗi 3 lần (xem .ff/tasks/127.json)
```

## 6. Ship hai chặng: `ff ship <id>`

Files mới: `scripts/cli/ship.mjs`, `scripts/lib/ship.mjs`. Thay phần agent tự làm trong `ship-to-dev.md`; xác nhận ship của người **giữ nguyên**.

**Điều kiện đầu vào** (kiểm trong CLI, không chỉ trong guard): Gate C của `activeRevision` `approved` theo hash; `ff squash-check` xanh; receipt build/verify khớp HEAD; phê duyệt ship còn hạn và khớp card/revision, source HEAD từng repo, remote và branch đích; mọi repo không `ff.localOnly`; `origin` đúng remote thật. Marker timestamp cũ cần nâng thành receipt ràng buộc các giá trị này; thay HEAD/đích thì phải xác nhận lại.

**Squash cho từng lần ship** (mỗi repo có thay đổi tạo đúng một commit cho lượt đó):

| Lần ship | Mốc squash | Commit đưa sang dev |
|---|---|---|
| **Lần đầu** | Commit của `base_branch` (prod theo cấu hình dự án) tại thời điểm tách nhánh task; không lấy đầu prod mới nhất lúc ship | Squash toàn bộ phần làm task thành commit `A`, rồi cherry-pick riêng `A` sang dev |
| **Lần thứ N sau nghiệm thu thất bại** | Đầu nhánh task trên `origin` đã push ở lượt ship trước | Giữ nguyên lịch sử đã push; squash riêng phần sửa mới thành commit `B`, rồi cherry-pick riêng `B` sang dev; các lần sau tương tự |

Ví dụ: lần đầu nhánh task có `P → A`; sửa sau nghiệm thu có `P → A → B`; vòng tiếp có `P → A → B → C`. Mỗi lượt chỉ cherry-pick commit mới của lượt đó. Mốc so sánh từ lần thứ hai là **nhánh task trên remote**, không phải dev vì dev còn chứa task khác. Sau mỗi lượt ship, đẩy nhánh task lên `origin` và xác minh remote để có mốc cho lượt sau, kể cả `dev_only` không tạo PR. Với `dev_and_pr`, PR hiện có tự nhận commit mới.

Squash thuộc bước hoàn tất build, trước verify/Gate C và xác nhận ship để mọi bằng chứng cùng chỉ tới commit cuối cùng. `ff ship` kiểm và sử dụng commit đó, không squash lại sau khi đã duyệt. Tái sử dụng mốc Git hiện có cho lần đầu; không thêm một hệ thống baseline mới. Với repo đã ship, khi reopen fetch đúng nhánh task trên `origin`, kiểm HEAD local khớp commit đã push của lượt trước rồi lưu mốc đó vào `revision.json.bases[repo.name]` trước khi sửa code. Repo chưa từng ship giữ mốc ban đầu và áp dụng quy tắc lần đầu khi phát sinh thay đổi. Repo đã ship mà thiếu nhánh remote hoặc không khớp thì dừng và báo rõ; không tự reset/force push hoặc dùng dev/prod thay thế.

**Hai chặng có checkpoint riêng** cho từng repo có commit cần ship:

| Chặng | Bước | Xác minh |
|---|---|---|
| **S1 · Dev và lưu mốc task** | snapshot commit đã squash → khóa theo repo → chuẩn bị checkout ship riêng → `git fetch origin` → checkout ship_branch theo remote → `cherry-pick -x` commit mới của lượt này → build/test → push origin ship_branch → push origin task_branch (không force) | remote ship_branch chứa commit cherry-pick; remote task_branch khớp source HEAD đã duyệt; ghi kết quả build/test |
| **S2 · PR** (chỉ dev_and_pr) | nhánh task đã được push ở S1 → `gh pr list --head <branch> --base <base_branch> --state open --json number,url`; có rồi thì dùng lại, chưa có thì `gh pr create --base <base_branch> --head <branch> --title "<tiêu đề thẻ> (#<id>)" --body-file <file>`; revision N giữ cùng PR và `gh pr comment` tóm tắt | `gh pr view --json number,url,headRefOid` khớp source HEAD đã duyệt |

`<file>` thân PR sinh từ `05-verify-report.md` (tóm tắt, AC, giới hạn), thêm dòng `Trello: #<id>` và liên kết thẻ; cắt ở 60.000 ký tự kèm ghi chú. Không đưa ảnh, token, đường dẫn nội bộ ngoài những gì báo cáo đã có.

**Máy trạng thái** `.ff/ship/<id>.json`: tách theo revision, repo, sourceHead và chặng, có `steps[]`, `status: pending|done|blocked:<lý do>`, source commits, target remote/branch, head trước/sau, ánh xạ source commit → cherry-pick commit và PR identity. `ship.complete` chỉ đúng với revision và HEAD hiện hành. Push dev và push nhánh task có checkpoint riêng: nếu dev đã lên nhưng push task lỗi, báo rõ kết quả từng bước và chỉ thử tiếp bước còn thiếu, không cherry-pick lại commit đã lên dev.

Trước switch branch, snapshot source HEAD và danh sách commit từ task branch; không tính lại `bases..HEAD` bằng HEAD đang ở dev. Ghi intent trước tác động, ghi kết quả sau xác minh. Khi restart, đối chiếu local Git, remote và PR trước khi lặp tác động: push đã lên nhưng chưa ghi done thì nhận diện từ remote; cherry-pick đang dở thì phục hồi theo checkpoint; PR đã tạo nhưng response mất thì tìm theo repo/head/base và kiểm SHA. Không coi việc có steps[] là đã bảo đảm idempotent.

Dùng checkout ship riêng biệt với checkout agent để không đổi branch dưới một phiên agent còn hoạt động; khóa theo repo và remote/ship_branch. Khóa này là mutex chống hai lượt ship cùng đích chạy đồng thời; không dùng `scripts/lib/lock.mjs` vì file đó chỉ kiểm nguồn cấu hình. Mọi lỗi khôi phục không xác định được đều blocked và giữ bằng chứng, không reset thay đổi ngoài phần ship sở hữu.

Hai chặng được ghi độc lập. Nếu S1 xong nhưng S2 blocked, báo dev đã cập nhật nhưng chưa sẵn sàng nghiệm thu theo mode dev_and_pr; chỉ chuyển accept_list khi mọi chặng bắt buộc đã xác minh.

**Lỗi: dừng sạch, không đoán.**

| Tình huống | Hành vi |
|---|---|
| Cherry-pick xung đột | `cherry-pick --abort`, S1 `blocked:conflict`, báo kèm danh sách file. Không tự giải quyết |
| Build/test đỏ sau cherry-pick | reset nhánh dev cục bộ về `origin`, không push, `blocked:checks` |
| Push dev bị từ chối vì dev đã tiến | fetch lại, cherry-pick lại tối đa 2 lần, sau đó `blocked:diverged` |
| `gh` thiếu hoặc chưa đăng nhập | S2 `blocked:gh`; S1 không bị ảnh hưởng |
| PR conflict với `base_branch` | Ghi trạng thái và notify một lần khi phát hiện conflict; tiếp tục theo dõi, chưa merge thì chưa done. Không hủy S1, không chặn nghiệm thu dev, không tự rebase/merge prod/force push |
| GitHub chưa xác định được khả năng merge | Giữ trạng thái chưa rõ và kiểm lại ở lượt poll sau; không coi là conflict hoặc tự cho là merge được |
| Marker hết hạn giữa chừng | dừng trước lần push kế tiếp, yêu cầu xác nhận lại; bước đã xong giữ nguyên |
| Hai thẻ cùng lên dev của một repo | tuần tự hóa bằng khóa theo repo |
| Nhiều repo, xong một phần | trạng thái theo repo; mốc cấp thẻ chỉ đạt khi mọi repo đạt |

**Guard** (`guard-rules.mjs`): agent không tự gọi `gh pr create` hoặc push ngoài luồng ship. `ff ship` chỉ được push task_branch và ship_branch đã cấu hình, không push base_branch, không force. `gh pr merge` luôn bị chặn với agent và ff ship. **Không có chặng nào merge PR.** CLI ship tự kiểm điều kiện, không dựa vào tên lệnh ff để cấp quyền rộng.

## 7. Vòng đời Trello và re-open

Cấu hình mới: bật `worker.driver.enabled: true` để dùng harness; mặc định false để giữ tương thích ngược. Khi bật phải có các list lifecycle hợp lệ.

```yaml
worker:
  driver: { enabled: true }
  task_source:
    trello:
      accept_list: "Nghiệm thu"
      reopen_list: "Re-open"
ship:
  mode: dev_and_pr          # mặc định dev_only
  max_reopen: 3
```

```
poll_lists → (làm việc) → Gate C ✓ → ship_confirm → mọi chặng bắt buộc xong ─▶ accept_list
                                                                  │
            nghiệm thu đạt ─▶ bạn merge mọi PR bắt buộc ─▶ ship-watch xác minh ─▶ done_list
            nghiệm thu hỏng ─▶ reopen_list ─▶ rev-N (Gate A/B/C) ─▶ mọi chặng bắt buộc lại ─▶ accept_list
```

Worker đăng comment Trello có tiền tố `[ff]` sau S1 (hash dev) và khi mở PR (URL). Comment mang eventId để đối chiếu, tránh đăng trùng sau timeout. Mốc S1 và mốc đủ điều kiện nghiệm thu được phân biệt.

**Nghiệm thu trên dev:** sau khi mọi repo cần thiết đã ship theo mode, báo source commit của task, commit cherry-pick trên dev, kết quả build/test, PR URL nếu có và trạng thái triển khai thực tế nếu dự án cung cấp thông tin. Không dựng cơ chế quản lý deployment riêng hoặc bắt buộc có deploymentId. Nếu chưa xác minh app đã triển khai, nói rõ “đã push dev, chưa xác minh triển khai”, không báo app đã sẵn sàng chỉ từ kết quả push.

Watcher đọc thêm `mergeable` của PR so với `base_branch` để báo conflict hoặc trạng thái chưa rõ theo mục 6. Đây là thông tin cần xử lý trước merge của người, không phải điều kiện để tạo PR hoặc ship dev thành công. Không tự sửa lịch sử đã push để giải quyết conflict; nếu source HEAD của task thay đổi thì cần bằng chứng/duyệt tương ứng cho code mới.

Dev có thêm commit của task khác không tự hủy kết quả nghiệm thu hoặc bắt nghiệm thu lại task này. Kết quả của task vẫn gắn với revision/source HEAD đã duyệt và đã ship; code của chính task thay đổi thì bằng chứng cũ không còn áp dụng.

`dev_only` bỏ bước tạo PR (S2); vẫn push nhánh task ở S1 để lưu mốc cho vòng sửa sau, và hoàn tất khi người xác nhận nghiệm thu task đã ship trong CLI. `dev_and_pr` hoàn tất khi mọi PR bắt buộc đã merge và head SHA của từng PR tại merge khớp source HEAD đã duyệt và đã ship; không yêu cầu source commit là ancestor của base_branch vì cho phép squash merge. Thao tác merge của người là xác nhận nghiệm thu trong mode này. PR head đổi so với bằng chứng đã duyệt thì chờ xử lý revision/code mới; đóng PR chưa merge là blocked, không done. Không cấu hình accept_list/reopen_list và không bật harness thì giữ hành vi legacy; bật harness phải validate cấu hình lifecycle cần thiết, không âm thầm rơi về legacy.

**Re-open tự động** (`ship-watch.mjs`): watcher chỉ gửi quan sát, driver quyết định reopen với thẻ ở `reopen_list` đã có task đã ship dev:

1. Với dev_and_pr: nếu bất kỳ PR liên quan đã merge hoặc đã đóng, không reopen; báo "tạo thẻ mới loại Fix". Với dev_only: cho reopen trước khi nghiệm thu hoàn tất; thẻ đã done cần thẻ Fix mới.
2. Lấy các comment **sau mốc S1 gần nhất**, bỏ comment tiền tố `[ff]`. **Không có comment nào thì không reopen**: báo "thẻ về re-open nhưng chưa có mô tả lỗi" rồi chờ (ngả D, không đoán).
3. Số lần reopen ≥ `max_reopen`: `needs_human`, báo, dừng.
4. Còn lại: chạy `ff reopen <id> --reason "<tóm tắt, trích nguồn comment>"` (lệnh có sẵn; bổ sung kiểm HEAD local khớp nhánh task trên remote theo mục 6 trước khi lưu bases) → phát revision-created cho driver, vô hiệu hóa kết quả của revision cũ đối với vòng mới, chuyển `stage: understand`. Driver gửi lệnh understand vào phiên task hiện có; chỉ resume nếu tiến trình mất. Skill `ff-understand` định tuyến theo `ff state`. Gate A trên `delta.md` do người duyệt.
5. Pha build squash riêng phần sửa mới kể từ mốc nhánh task trên remote đã lưu; sau verify/Gate C và xác nhận ship, S1 cherry-pick **chỉ commit sửa mới** và push thêm cùng nhánh task. S2 dùng lại PR (tự cập nhật) và comment tóm tắt revision.

## 8. Tri thức tối thiểu

### 8.1 Sổ quyết định `.ff/decisions.jsonl` (nối thêm, không sửa)

Mỗi dòng là một sự kiện:

```json
{"at":"…","repo":"system-service","card":"123","rev":"","kind":"gate|question|decide",
 "gate":"GATE_A","class":"naming","question":"…","options":["…"],"answer":"Duyệt",
 "approved":true,"source":"human","ledgerId":"U-03"}
```

- **Ghi ở đâu:** hook `ask-post` (câu trả lời Gate và `Q<n>`, kể cả "Cần sửa" mà `storeReceipt` ghi đè mất) và `ff decide` (kết quả của nó, để so với câu trả lời của người sau này).
- **Nạp ngược:** `ff learn` đọc `01b-ledger.md` của mọi thẻ trong `cards_dir` (các dòng `U-xx`) và thêm vào sổ với `source: "ledger"`, bỏ qua dòng đã có (khóa theo thẻ, revision, id). Không LLM.
- Đây cũng là dữ liệu đo "độ khớp" khi sau MVP muốn bật tự duyệt.

### 8.2 Phân loại quyết định

Danh sách **đóng** các lớp, đặt trong `references/decision-classes.md` (nội dung chung, không có tên dự án):

- Lớp cứng (luôn `escalate`, bốn ranh giới của skill): `migration`, `data-model`, `permission`, `new-behavior`, `destructive`.
- Lớp mềm: `naming`, `default-value`, `copy-text`, `ui-layout`, `validation-rule`, `error-handling`, `test-scope`, `other`.

Agent gắn nhãn; `ff decide` **từ chối nhãn ngoài danh sách**. Vì nhãn do agent đặt nên có thể sai, `ff decide` còn quét thêm: từ khóa cứng chung (`migration`, `schema`, `delete`, `role`, `permission`) và `knowledge.high_risk` trong cấu hình workspace. Khớp là `escalate` bất kể nhãn.

### 8.3 `ff decide`

```
ff decide <id> --class <lớp> --decision-key <key> --repo <repo> --question "<text>" [--options "a|b|c"]
→ {"verdict":"proceed|escalate","default":"…","evidence":["U-03","U-07","U-12"],"reason":"…"}
```

`proceed` chỉ khi **tất cả**: lớp mềm; không khớp từ khóa/đường dẫn rủi ro; trong cùng dự án/repo, decisionKey, phạm vi nghiệp vụ, policy version và lớp có ≥ `min_precedents` (mặc định 3) quyết định độc lập của người; **cùng một giá trị lựa chọn chuẩn hóa** ở mọi lần (không so các nhãn chung như Có/Duyệt giữa những câu hỏi khác nghĩa); chưa lần nào bị đảo/sửa sau đó (`approved:false` sau cùng một câu). Còn lại `escalate` kèm `reason` cụ thể ("repo này chưa có tiền lệ lớp `naming`", "tiền lệ không nhất quán: 2 lần A, 1 lần B"). Kèm lý do để lần kiểm của người rẻ hơn.

Decision record bổ sung `decisionId`, `questionId`, `decisionKey`, project/repo scope, normalizedValue, provenance và supersedes/retractedBy khi bị sửa. Quyết định hook và bản nhập ledger có cùng nguồn chỉ được tính một lần. Dữ liệu agent suy ra hoặc `source: precedent` không được tính làm quyết định của người. Thiếu khóa tương đương rõ ràng thì escalate; không dùng LLM similarity để tự cấp quyền trong MVP.

Tách ba lớp: event gốc bất biến; tri thức có phạm vi và nguồn chứng minh; policy cho phép hành động. Tiền lệ hoặc wiki không thay receipt Gate/ship, không nới bốn ranh giới cứng. Bài học dự án không tự thành luật plugin toàn cục.

`ff decide --gate GATE_A|GATE_C|SHIP <id>` trong MVP **luôn trả `escalate (shadow)`** và ghi vào sổ các đặc trưng (trace-check xanh/đỏ, số "Cần bạn chọn" còn mở, số lớp cứng, số vòng gate-reader). Mục đích là thu bằng chứng; độ chính xác của dự đoán Gate là việc sau MVP.

### 8.4 Chỗ tích hợp trong skill

Sửa **một chỗ** ở `skills/ff-understand/SKILL.md` (quy tắc "đoán được phản ứng người duyệt"): khi định bỏ một câu `Q<n>` mềm vì "đoán được", gọi `ff decide`; `proceed` thì dùng `default` và ghi `U-xx` với nguồn "tiền lệ" kèm id; `escalate` thì hỏi như cũ. Trong MVP `ff decide` chỉ **tư vấn** (skill phải gọi); chưa chặn cứng bằng hook.

Tên riêng dự án và danh sách rủi ro của HRM (lương, dữ liệu cá nhân, phân quyền) nằm ở `knowledge.high_risk` trong `ff.config.yaml`, **không** nằm trong plugin (ràng buộc của `plugin-content.test.mjs`). Mặc định rộng, thu hẹp dần khi tin cậy.

## 9. Cấu hình bổ sung (schema)

```yaml
worker:
  task_source: { trello: { accept_list, reopen_list } }
  driver: { enabled: false, stuck_after_minutes: 90, max_stage_retries: 3, max_repair_cycles: 3 }
ship: { mode: dev_only | dev_and_pr, max_reopen: 3 }
knowledge:
  min_precedents: 3
  high_risk:
    - repo: oe-hrm-fe
      keywords: [salary, payroll, lương, cccd, role, quyền]
      paths: ["src/**/payroll/**"]
```

Tất cả tùy chọn, có mặc định; `max_repair_cycles` chỉ nhận số nguyên 1–3, mặc định 3 (không mở vòng sửa thứ 4). `worker.max_concurrent_tasks` giữ mặc định 2 từ loader hiện có; schema kiểm config sau khi merge defaults, không yêu cầu thêm default thứ hai trong schema. `ff doctor` kiểm `schema` như hiện nay. Với TmuxClaudeRunner, starting permission mode mặc định là auto qua flag launcher; không cần thêm cơ chế SDK hoặc cấu hình user-global để đáp ứng MVP.

## 10. Doctor, guard, đóng gói

- **Doctor (nhóm worker):** kiểm Claude CLI/subscription và khả năng auto mode; startup smoke phải phân biệt flag đã truyền với mode thực tế. `gh` thiếu hoặc chưa đăng nhập không chặn understand/build/verify hoặc S1.
- **Preflight theo pha:** driver kiểm nhóm `e2e` **ngay trước khi mở pha `verify`**; đỏ thì `waitingOn: setup:e2e`, báo một lần, không kẹt im lặng ở Gate C. Kiểm remote/base_branch/ship_branch trước ship; chỉ kiểm `gh` trong PATH và `gh auth status` trước S2 khi `ship.mode: dev_and_pr`. Thiếu `gh` thì riêng S2 `blocked:gh`.
- **Lệch phiên bản:** hook `session-start` so version trong `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (nếu biến môi trường có) với `VERSION` của CLI; lệch thì cảnh báo cập nhật cả plugin lẫn `npm i -g`.
- **Đóng gói:** mọi thay đổi trong `scripts/` và `ff-worker/src/` kèm `npm run build` và commit `dist/` và `ff-worker/dist/`. Rà entry của `scripts/build.mjs` để các file mới được đóng gói. Ưu tiên hook hiện có: sửa `ask-pre`, `ask-post`, `session-start`, và `stop`/`notification` khi cần phát sự kiện; chỉ sửa `hooks/hooks.json` nếu wiring thực tế cần thay đổi, không thêm hook chỉ để có hook bắt đầu pha. Tăng version `plugin.json` và `VERSION` trong `main.mjs` cùng lúc.

## 11. Danh sách thay đổi so với ff-kit gốc

**Mới:** runner adapter và backend TmuxClaudeRunner, event inbox/dedupe và hợp đồng completion receipt; `ff-worker/src/core/driver.mjs`, `ff-worker/src/core/ship-watch.mjs`, `scripts/cli/ship.mjs`, `scripts/lib/ship.mjs`, `scripts/cli/decide.mjs`, `scripts/lib/knowledge.mjs`, `scripts/cli/learn.mjs`, `references/decision-classes.md`, các file test tương ứng.

**Sửa:** `ff-worker/src/core/runtime.mjs`, `worker.mjs`, `task-store.mjs`; `ff-worker/src/adapters/task-source/trello.mjs`; `scripts/cli/worker.mjs` (`status`); `scripts/hooks/ask-pre.mjs`, `ask-post.mjs`, `session-start.mjs`, `stop.mjs`/`notification.mjs` khi cần phát sự kiện; `scripts/lib/guard-rules.mjs`, `doctor.mjs`; `schema/ff.config.schema.mjs`; `scripts/cli/main.mjs`; `skills/ff-understand/SKILL.md` (điểm tư vấn tiền lệ), `skills/ff-build/SKILL.md`, `skills/ff-verify/SKILL.md` (receipt/bàn giao và định tuyến sửa lỗi); `commands/ship-to-dev.md`, `scripts/cli/reopen.mjs`, `skills/ff-understand/references/reopen.md`, `skills/ff-build/references/review-squash.md` và logic chọn khoảng commit của `squash-check` khi cần để thống nhất mục 6, `INSTALL.md`, `README.md`; `.claude-plugin/plugin.json`; `dist/**`, `ff-worker/dist/**`.

**Giữ nguyên về ý nghĩa:** cơ chế Gate bằng hash, vai trò các skill/agent, template ff-e2e, copy/sync và kiểm chứng. Cần sửa điểm bàn giao để phát receipt/sự kiện và định tuyến sửa lỗi, không giữ nguyên code nếu mâu thuẫn với quyền sở hữu trạng thái ở §4.1. Rocket.Chat giữ notify-only. Tmux giữ làm backend sau runner adapter. Có thể sửa notification/stop để phát sự kiện vòng đời; Stop không phải bằng chứng xong pha. Không tự thêm hook mới nếu chưa cần.

## 12. Kiểm thử

Theo quy ước hiện có: `node --test`, tiêm phụ thuộc giả (`source`, `channel`, `tmux`, `ctx.runCommand`), workspace tạm bằng `tests/helpers/fixture.mjs`. Git thật trong thư mục tạm (repo bare làm `origin`), `gh` giả bằng runner tiêm vào.

- **Driver/runner:** bảng nextStage; worker lưu UUID trước launch, truyền --session-id khi tạo mới và --resume khi phục hồi; SessionStart chỉ đối chiếu, ID lệch thì blocked; cùng tmux/Claude session ID xuyên mọi pha/reopen; chỉ send-keys khi idle/input trống/không pending question; không kill/clear khi đổi pha; notify → người trả lời → tiếp tục tự động, không cần bàn giao quyền nhập; chỉ worker gọi pha tiếp theo, hướng dẫn cuối verify không tự thực thi ship; dispatch không bị gửi trùng sau restart; resume đúng session khi mất tiến trình; tối đa 3 vòng sửa → verify lại/revision, không mở vòng thứ 4 và restart không reset bộ đếm; lỗi verify cũ không kích hoạt sửa lại sau kết quả mới; thẻ kẹt/retries/đồng hồ không tính chờ Gate/max_concurrent_tasks/verify_lock.
- **Ship:** lần đầu squash từ mốc tách prod; lần sau squash riêng phần sửa so với nhánh task trên remote, mỗi lượt đúng một commit mới; giữ nguyên commit đã push, không force push; squash trước verify/Gate C; chỉ cherry-pick commit của lượt hiện tại; push dev và task đều được xác minh kể cả dev_only; dev đã push nhưng task push lỗi thì chỉ phục hồi bước thiếu; chạy lại idempotent; xung đột, checks đỏ, push bị từ chối, PR đã có, PR conflict/chưa rõ mergeability vẫn giữ kết quả ship dev và không done trước merge, marker hết hạn, nhiều repo xong một phần; khóa theo repo/đích.
- **Re-open:** PR mở thì reopen đúng; merge/đóng thì từ chối; không có comment mới thì không reopen; comment `[ff]` bị lọc; chạm `max_reopen`; kiểm HEAD local khớp nhánh task trên remote trước lưu bases, thiếu/lệch thì dừng; chỉ commit sửa mới được cherry-pick.
- **Trello:** mốc chuyển cột đúng theo cấu hình; tương thích ngược khi thiếu `accept_list`/`reopen_list`; thẻ `completed` không còn bị bỏ qua khi về `reopen_list`.
- **Tri thức:** `ask-post` ghi nối thêm kể cả "Cần sửa" liên tiếp; `ff learn` idempotent; `ff decide` từ chối nhãn ngoài danh sách, luôn `escalate` ở lớp cứng/từ khóa rủi ro, `escalate` khi sổ trống, `proceed` đúng ở ≥ 3 tiền lệ nhất quán, `escalate` khi có một lần bị đảo.
- **Guard/Doctor:** các luật mới và ca hồi quy; thẻ/comment Trello yêu cầu bỏ Gate/giả approval/push không tạo được quyền ship và không trở thành lệnh worker; kiểm payload literal riêng với kiểm guard/receipt, không coi test câu chữ prompt là bằng chứng model miễn nhiễm injection; gh/version; snapshot giữ bin/ff và PATH ưu tiên đúng CLI, kiểm command -v ff/ff --version trong Bash của Claude ở cả start/resume, không fallback ff global; thiếu gh chỉ chặn S2, understand/build/verify/S1 vẫn chạy; launcher mới và resume có auto flag đúng một lần; vẫn hỏi Gate/relock/ship; permission prompt không bị worker tự duyệt; báo đúng khi auto không hiệu lực.
- **Gói:** `npm run build` sinh `dist/` khớp nguồn (test kiểm chênh lệch); `plugin-content.test.mjs` xanh.
- **Nghiệm thu thật:** chạy kịch bản mục 1 trên hai thẻ thật; đây là smoke test vận hành, chưa phải bằng chứng đủ cho tự duyệt hoặc hiệu quả học.
- **Kiến trúc/phục hồi:** event trùng/cũ, lost update, hook kết thúc muộn, crash trước/sau push và create PR, resume giữa cherry-pick, reopen không dùng ship.complete cũ, multi-repo merge một phần, dev_only, dev nhận thêm task khác không tự hủy nghiệm thu task hiện tại, báo rõ khi chưa xác minh triển khai, runner không rõ trạng thái và không tự fallback PAYG.
- **Đo vận hành:** số lần hỏi và thời gian người phải xử lý, thời gian chờ, retry, reopen, lỗi lọt, thời gian/token mỗi pha nếu runner cung cấp. Không coi giảm câu hỏi là thành công khi tổng công sức review tăng.

## 13. Thứ tự xây (lát cắt dọc, mỗi lát chạy được)

| Lát | Nội dung | Chạy được gì |
|---|---|---|
| **0** | Cài `gh`, `npm install` ff-kit, `/ff-kit:ff-init` cho hai repo, `ff e2e-scaffold`, cấu hình Trello và kênh; chạy **một thẻ thật bằng tay** với ff-kit hiện tại, ghi sổ ma sát | Nền tảng và danh sách ma sát thật |
| **1** | Driver single-writer, event inbox/dedupe + stateVersion/khóa, TmuxClaudeRunner adapter, receipt build, vòng verify → sửa, waitingOn/history/status, ask-post ghi decisions | Thẻ tự đi understand → build → verify → chờ ship; restart có bằng chứng |
| **2** | `ff ship` theo hai quy tắc squash, checkout riêng/checkpoint/approval gắn HEAD, push dev và nhánh task, mốc Trello, comment `[ff]`, guard `gh` | Thẻ lên dev và có PR |
| **3** | `ship-watch`, re-open tự động | Vòng nghiệm thu hỏng |
| **4** | `ff learn`, `ff decide`, tích hợp một chỗ trong skill | Tri thức tối thiểu hoạt động (khởi động lạnh = hỏi) |
| **5** | Đóng gói, doctor, cảnh báo lệch phiên bản, chạy hai thẻ thật | Hoàn tất MVP |

## 14. Sau MVP (đã bàn, chưa thiết kế chi tiết)

- **Dreaming** theo mốc, không chạy bừa: D1 khi thẻ vào trạng thái cuối (PR merge), D2 hợp nhất wiki khi đủ N thẻ mới và ≥ 7 ngày; `PreCompact`/`SessionEnd` chỉ thu bằng chứng (hook `SessionEnd` chỉ có 1,5 giây nên chỉ được xếp hàng, không chạy LLM). Tri thức chỉ vào wiki **sau khi biết kết quả**, kèm sha của `base_branch`.
- **Chạy trong cửa sổ rảnh:** không thẻ nào ở `working`, và quota: **5h < 50%, 7 ngày < 70%** (cấu hình được).
- **`cswap`:** `cswap list --json` làm nguồn quota toàn bộ tài khoản; `cswap run N` ghim tài khoản cho phiên tmux.
- **Ba làn:** tất định (không LLM); miễn phí qua `opencode`/Gemini Flash cho chắt lọc (đầu ra không đáng tin, kiểm chứng bằng máy; chỉ gửi gói bằng chứng đã lọc bí mật, bật theo repo vì rủi ro dữ liệu công ty); Claude dự phòng cho đề xuất vá skill và eval.
- **Tiến hóa skill:** task đang chạy ghim bản workflow/skill; bản vá chỉ áp dụng task mới. Tách bài học dự án khỏi nguyên tắc dùng chung; eval gồm tình huống hồi quy không chỉ ca sinh bản vá, đo tổng công sức người và lỗi lọt. Mốc = cùng loại "vì sao lọt" (ngả A/B/C/D của re-open) ở ≥ 2 thẻ; mỗi skill tối đa một lần mỗi tuần, mỗi lần một thay đổi; bản vá phải qua eval (có skill và không có skill, trigger eval) và không tệ hơn baseline ở ca nào; kết quả là PR vào ff-kit. Quy trình lấy từ `revfactory/harness` (`evolve`).
- **Wiki, gói ngữ cảnh, `ff recall`:** khóa tìm bằng file/symbol đã chạm, thêm SQLite và FTS5.
- **Tự duyệt thật** theo từng repo, chỉ khi chế độ bóng cho thấy độ khớp đủ cao.
- Sao lưu bộ hồi quy e2e (đang chỉ giữ cục bộ), `ff self-update`, PR đã merge thì mở thẻ Fix mới tự động.

## 15. Rủi ro và điều chưa xác minh (thử nghiệm ở lát 1)

| # | Điều chưa chắc | Cách xác minh | Nếu sai |
|---|---|---|---|
| T1 | Receipt hoàn tất build bao phủ đúng checks/review và stale khi đổi HEAD | Chạy thẻ thật, thử thiếu receipt/0 commit/đổi HEAD/test lock | Chặn chuyển pha, sửa hợp đồng receipt; không fallback về squash-check + file tồn tại |
| T2 | Auto mode thực sự hiệu lực và giảm hỏi quyền thường lệ, nhưng giữ Gate/ship/relock | Chạy mới + resume bằng --permission-mode auto; kiểm thao tác thường lệ và AskUserQuestion thật | Báo setup:permission hoặc pending permission theo nguyên nhân; không tự bypass/tắt Gate |
| T3 | Send-keys chuyển pha trong cùng phiên không gửi trùng hoặc đè input người | Test tmux giả + thẻ thật qua nhiều pha/reopen, attach trả lời sau notify, tự tiếp tục sau câu trả lời, worker restart và hook đến muộn | Giữ phiên/chờ người; không kill/clear để chuyển pha hoặc gửi lại mù |
| T4 | `CLAUDE_PLUGIN_ROOT` có trong môi trường hook `session-start` | Thử trực tiếp | Truyền đường dẫn qua tham số lệnh trong `hooks.json` |
| T5 | Agent có gọi `ff decide` đúng chỗ (phụ thuộc văn bản skill) | Kiểm bằng `skills-content.test.mjs` và quan sát thẻ thật | Thêm kiểm tra bằng hook `AskUserQuestion` (thay đổi lớn hơn, để sau) |
| T6 | `gh` cần quyền gì với repo thật; cách PR đặt tên và nhãn của đội | Hỏi bạn khi thiết lập lát 0 | Thêm `ship.pr.title_template`, `ship.pr.labels` |
| T7 | Phương án runner tương lai (SDK/background/channels) giữ được một hội thoại/task và can thiệp CLI | Spike riêng sau MVP, không phải điều kiện nghiệm thu MVP | Tiếp tục TmuxClaudeRunner + send-keys + auto; không ép PAYG |

## 16. Quyết định đã chốt trong quá trình thiết kế

| Quyết định | Lý do |
|---|---|
| Không dùng Hermes làm runtime | ff-kit đã có workflow riêng; chỉ mượn ý tưởng (review nền có tín hiệu, vòng đời skill, sổ ghi, rollback) |
| Hướng A: mở rộng chính ff-kit | Gate và bộ nhớ ở cùng nơi, không lệch phiên bản |
| Mức tự chủ ban đầu: người duyệt Gate; sau đó học dần theo từng repo | Yêu cầu của chủ dự án |
| Bản vá skill đi qua PR vào ff-kit kèm eval | Nhất quán với luồng PR, có lịch sử git để rollback |
| Ship = S1 dev + S2 PR, checkpoint độc lập | Có thể phục hồi từng chặng; chỉ công bố nghiệm thu khi mọi chặng theo mode đã đạt |
| PR đã merge thì không re-open; là thẻ Fix mới | Dùng lại nhánh đã merge làm hỏng lịch sử |
| Test e2e chỉ giữ cục bộ, không ship | Quyết định của chủ dự án; ghi nhận rủi ro mất bộ hồi quy |
| JSONL cho MVP, SQLite để sau | Dữ liệu vài trăm dòng; SQLite đòi nâng `engines` (`node:sqlite` cần Node 22+) |
| Nhóm rủi ro cao mặc định rộng, thu hẹp dần | `oe-hrm-fe` là HRM (lương, dữ liệu cá nhân, phân quyền) |
| MVP trước, học và quota sau | Cần harness dùng ff-kit thật trước khi tính chuyện học |


## 17. Nguồn tham khảo và phạm vi áp dụng

Đối chiếu ngày 2026-10-15. Docs web có thể thay đổi; khi spike/implementation phải ghi phiên bản CLI/SDK và commit nguồn thực dùng.

| Nguồn | Ý tưởng áp dụng | Giới hạn |
|---|---|---|
| [Hermes architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture) | Tách core, gateway, runner/session và bộ nhớ | Không đưa toàn bộ Hermes runtime vào ff-kit |
| [Hermes persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) và [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) | Bộ nhớ xuyên phiên, thu bài học, kiểm soát thay đổi tri thức/skill | Không đồng nhất nhớ được với được quyền tự duyệt; dreaming cụ thể là thiết kế ff-kit |
| [revfactory/harness](https://github.com/revfactory/harness) và [evolve](https://github.com/revfactory/harness/blob/main/skills/evolve/SKILL.md) | Đọc dấu vết, tổng quát hóa phản hồi, đổi từng điểm, kiểm chứng thay đổi | Tần suất/ngưỡng trigger, PR và acceptance là policy riêng của ff-kit |
| [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [user input](https://code.claude.com/docs/en/agent-sdk/user-input) | Runner có sự kiện, đưa câu hỏi/approval tới host, resume | Tham khảo sau MVP; chưa thay tmux/send-keys |
| [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) | Worker cấp UUID trước launch qua --session-id; resume đúng ID và ghim plugin bằng --plugin-dir | Hook xác minh session, không cấp ID; kiểm CLI thực tế ở preflight |
| [Claude hooks](https://code.claude.com/docs/en/hooks) | SessionStart đối chiếu session_id, CLAUDE_ENV_FILE giữ PATH cho Bash | Kiểm ff được resolve từ snapshot cả start và resume |
| [GitHub CLI pr view](https://cli.github.com/manual/gh_pr_view) | Theo dõi mergeable để báo PR conflict/chưa rõ | Không tự merge/rebase và không biến mergeable thành điều kiện ship dev |
| [Claude permission modes](https://code.claude.com/docs/en/permission-modes) | Launcher --permission-mode auto cho tạo mới/resume; phân biệt classifier với bypass | AskUserQuestion, explicit ask và các Gate vẫn cần người |
| [Claude authentication](https://code.claude.com/docs/en/authentication) và [legal/compliance](https://code.claude.com/docs/en/legal-and-compliance) | Phân biệt subscription cá nhân với API/product billing; dùng luồng xác thực chính thức | Không suy ra mọi cách trung gian OAuth đều được phép; không tự fallback PAYG |
| cswap | Ý tưởng đọc quota và ghim tài khoản sau MVP | Chưa định danh repo/version trong spec; chưa coi interface là hợp đồng đã kiểm chứng |

## 18. Quyết định sau review kiến trúc

- Rocket.Chat notify-only; mọi quyết định người vẫn qua CLI.
- Giữ Claude Code + ff-kit, dùng subscription của chủ máy. **Một task = một phiên tmux + một cuộc hội thoại Claude**, giữ context qua pha và reopen. MVP dùng send-keys, khởi động/resume --permission-mode auto; không clear/kill theo pha. SDK/background/channels để sau, không mặc định chuyển PAYG.
- Driver sở hữu vòng đời; hooks/watchers/commands phát sự kiện theo scope, snapshot cập nhật có khóa/version.
- Receipt gắn revision, run và source commit; tối đa 3 vòng sửa code → verify lại cho mỗi revision, restart không reset bộ đếm; ship phục hồi bằng checkpoint và đối chiếu remote.
- Người chỉ attach khi notify cần quyết định; trả lời xong tự tiếp tục, không có bàn giao quyền nhập thủ công. Worker gọi pha tiếp theo; verify chỉ báo kết quả và hướng dẫn.
- Ship lần đầu squash phần task kể từ mốc tách prod thành một commit; lần sau squash phần sửa mới so với nhánh task trên remote thành một commit mới. Chỉ cherry-pick commit mới sang dev; giữ lịch sử đã push và cập nhật cùng PR.
- Báo commit đã ship, kết quả build/test và trạng thái triển khai nếu có; không quản lý deployment riêng hoặc tự bắt nghiệm thu lại vì task khác lên dev. Giữ dev_only và dev_and_pr với cách xác nhận nghiệm thu tương ứng.
- Bộ nhớ không cấp quyền; tiền lệ có khóa nghiệp vụ, provenance/dedupe và không tự củng cố từ quyết định agent.
- Ghim phiên bản workflow theo task, bao gồm bin/ff và PATH của Bash trong Claude; cải tiến qua PR/eval, theo dõi tổng công sức người.
- Worker sinh và lưu UUID trước khi mở Claude mới, resume cùng ID; hook chỉ xác nhận. PR conflict thì notify và chờ người xử lý, không tự viết lại lịch sử. Bổ sung regression case nội dung Trello cố vượt Gate/ship.
