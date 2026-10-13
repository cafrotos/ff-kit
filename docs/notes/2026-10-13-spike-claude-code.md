# Spike Claude Code — 2026-10-13
Phiên bản: Claude Code 2.1.296. Spike chạy headless (`claude -p`, model haiku) + đọc docs `code.claude.com/docs/en/hooks`. Các bước cần trả lời tương tác (`AskUserQuestion`) **chưa chạy** — cần người dùng làm (xem cuối file).

| Câu hỏi | Kết quả | Nguồn | Hệ quả cho ff-kit |
|---|---|---|---|
| Schema `AskUserQuestion` | `tool_input.questions[]` (`question`, `header`, `options[{label,description}]`, `multiSelect`); `answers` = object `{ "<question text>": "<label>" }`, đa chọn nối bằng dấu phẩy | docs hooks, mục AskUserQuestion | `answerFor` đọc `answers` theo text câu hỏi |
| Câu trả lời nằm ở field nào trong `PostToolUse` | Docs không nêu `tool_response`; chỉ nêu `answers` ở `tool_input` (khi cấp qua `updatedInput`) | docs hooks | `recordGates` đọc `tool_response.answers`, không có thì `tool_input.answers` (Ruling Task 10). Fixture `ask-post.json` là **bản dựng từ docs**, chưa phải payload thật |
| PreToolUse trả `permissionDecision: "ask"` | Có: "`ask` prompts the user to confirm"; deny/ask rule vẫn được xét bất kể hook trả gì; trong auto mode `ask` vẫn ép hỏi | docs hooks | guard trả `ask` cho `ff ship-approve`/`ff relock` (D23) |
| Hook chặn được `AskUserQuestion` | PreToolUse áp cho mọi tool; exit 2 chặn tool (docs: "Exit with code 2 to block") | docs hooks | ask-pre chặn Gate khi trace-check đỏ |
| `AskUserQuestion` trong `-p` | Chỉ có khi có permission host (SDK `canUseTool`) | docs hooks | Worker chạy phiên tương tác trong tmux, không chạy `-p` cho thẻ |
| Notification payload | `message`, `title?`, `notification_type`; matcher gồm `permission_prompt`, `idle_prompt`, … | docs hooks | hooks.json matcher `permission_prompt\|idle_prompt` |
| `claude -p "/init"` | **Chạy được**: tạo `CLAUDE.md` (exit 0) | chạy thật trong thư mục tạm | INSTALL bước 4 chạy headless được |
| `permissions.deny Read(./.ff.env)` | Chưa kiểm được bằng chạy thật: model tự từ chối đọc vì luật secrets trong CLAUDE.md của người dùng, nên không phân biệt được deny hay model từ chối | thử `claude -p` | Dựa vào docs permissions; cần kiểm tay |
| Plugin `bin/` trong PATH, `${CLAUDE_PLUGIN_ROOT}` trong SKILL.md | Docs xác nhận cả hai (review độc lập vòng 1 đã trích) | docs plugins | Skill gọi `ff` trần được |
| Nạp plugin local | `claude --plugin-dir <path>` | `claude --help` | Task 12 smoke dùng cờ này |

## Cần người dùng kiểm tay (khoảng 10 phút)
1. Tạo thư mục thử có `.claude/settings.json` gắn `node <ff-kit>/scripts/dev/hook-dump.mjs ask-pre|ask-post` cho `PreToolUse`/`PostToolUse` matcher `AskUserQuestion`.
2. Chạy `claude`, nhờ hỏi 1 câu header `GATE_A`, câu hỏi `[#123] Duyệt Brief?`, trả lời `Duyệt`.
3. Đối chiếu `.ff-spike/ask-post.jsonl` với `tests/fixtures/hooks/ask-post.json`; khác thì sửa fixture + `answerFor`.
4. Thử `permissions.deny Read(./.ff.env)` trong phiên tương tác.

## Smoke plugin Plan 1 (2026-10-13, `claude -p --plugin-dir ~/Workspaces/ff-kit --model haiku --permission-mode bypassPermissions`, workspace fixture)
1. `git -C web stash` qua Bash → **bị chặn** bởi hook guard (cả ở `bypassPermissions`).
2. Write `trellocards/123-x/brief.md` với `> Trạng thái: ĐÃ DUYỆT …` → **bị chặn**, lý do nhắc "trả lời Duyệt qua GATE_A của thẻ #123"; file không được tạo.
3. `.ff/doctor.json` được hook SessionStart ghi: `{"ok":true,"groups":{"core":true,"worker":true,"e2e":true}}`.
4. Chưa kiểm: đọc `.ff.env` (model tự từ chối vì luật CLAUDE.md của người dùng) — phần kiểm tay ở trên.
