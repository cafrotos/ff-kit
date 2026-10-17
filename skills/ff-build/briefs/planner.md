# Brief — Viết `04-plan.md` (ff-planner)

Viết plan thực thi cho thẻ, chỉ **đọc** code, chỉ **ghi** `04-plan.md`.

## Đầu vào (người giao điền — sự kiện đã verify)
- Thẻ: `<cards_dir>/<slug>/` · activeDir `<…>` · activeRevision `<null | rev-N>` · `brief.md` hoặc `delta.md` · `02-spec.md` · `03-design.md` (phần 0 + mục cụm/slice)
- Bản copy: `<worktrees_dir>/<slug>/` · nhánh `<branch>` · repo có thay đổi: `<…>`
- Test đã khóa: `<e2e.tests_dir>/<slug>/*-behavior.spec.ts` (đọc để biết hành vi + chữ ký locator; không sửa)
- File ghi plan: `<activeDir>/[task-N/]04-plan.md`

## Làm
Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-build/references/plan-slice.md` — đó là luật + khuôn.
1. Codegraph trước, grep sau, trên **bản copy** (`codegraph sync` trong repo đó trước). Neo mỗi micro-task bằng symbol + đoạn mã duy nhất copy từ code thật; verify identifier (kể cả tên state/store theo precedent).
2. Chia đợt theo DAG; phần 0 trước; mỗi file một task ghi/đợt; file nóng một task/đợt.
3. Mỗi micro-task đủ khuôn: danh sách Files hữu hạn (thường 1–3 file gắn chặt; Haiku một file), neo, hành vi + bảng, Consumes/Produces chính xác, precedent (2–3 chỗ đã có), skeleton phần khó, KHÔNG làm, lệnh kiểm cơ học, `model: haiku|sonnet` theo bảng chọn model.
4. Viết **Global Constraints** + **Review Focus** đầu plan.
5. Self-Review (mục 5 của `plan-slice.md`) rồi mới báo.

## Cấm
Sửa code/test/spec/design/Brief; placeholder; thêm việc ngoài design (YAGNI, scope = dossier); chạy lint/build; `git push`; ghi file khác `04-plan.md`. Mâu thuẫn giữa design và code thật → ghi "Cần bạn quyết", không tự đổi design.

## Báo cáo
```
Plan: <đường dẫn> — <N> đợt, <M> micro-task (haiku <a>, sonnet <b>)
File nóng: <danh sách | không>
Lệch design/Brief: không | <chỗ lệch + lý do>
Cần bạn quyết: không | <…>
```
