# Brief — Review diff một đợt (ff-diff-reviewer)

Review **diff thật** của một đợt trong bản copy, độc lập với người code. Chỉ đọc — không sửa file, không commit.

## Đầu vào (người giao điền — sự kiện đã verify)
- activeDir `<đường dẫn từ ff state --json>` · activeRevision `<null | rev-N>`; Brief gốc hoặc delta hiện tại, spec/design/plan lấy trong activeDir.
- Bản copy: `<worktrees_dir>/<slug>/` · nhánh `<branch>`
- `<activeDir>/`: `brief.md` hoặc `delta.md`, `02-spec.md`, `03-design.md`, `04-plan.md` (đợt `<k>`: các micro-task `<…>`)
- File của đợt: `<danh sách>`

## Lấy diff
```bash
cd <worktrees_dir>/<slug>/<repo>
codegraph sync
git diff $(git merge-base HEAD origin/<base_branch>) -- <file của đợt>
git status --short
```

## Quy tắc truy nguồn
**Mỗi hunk phải truy về một AC hoặc một micro-task** của đợt. Không truy được = **thừa** → báo.

## Kiểm
1. **Thiếu** — AC/micro-task của đợt chưa có code; ca trong bảng input→output chưa xử lý.
2. **Thừa** — hunk không truy được về AC/micro-task; file ngoài danh sách đợt.
3. **Lệch** — làm khác design/precedent/Interfaces mà Deviation Register không ghi; chữ ký khác Produces.
4. **Lỗi rõ ràng** — sai kiểu, null, quyền/scope bị bỏ, migration không khớp entity, env mới chưa vào `.env.example`, file không được commit (`.env*` trừ example, tsbuildinfo, log, `CLAUDE.md` repo con).
5. **Checklist cố định (cần trả lời từng mục, kể cả "không có")**:
   - (a) Effect mới gọi API: deps nào đổi cùng lúc lúc khởi tạo (`isLoading`, null → có giá trị) → gọi trùng?
   - (b) Có deps không liên quan tới tham số request (`isEditing`…) khiến gọi lại?
   - (c) Vòng `for … await` gọi cùng truy vấn/service (N+1)?
   - (d) `catch → []` im lặng (nuốt lỗi, hiện rỗng như thể không có dữ liệu)?
   - (e) Hằng số/bảng chép tay của dữ liệu đã có nguồn (so với bảng nguồn trong Brief)?

Việc ngoài phạm vi: ghi "Thấy nhưng không sửa" kèm lý do; không âm thầm sửa hoặc mở rộng task.

## Định dạng kết quả
```
Kết luận: PASS | CẦN SỬA
Checklist: (a) … (b) … (c) … (d) … (e) …   # mỗi mục: không có | <file:line — vấn đề>
- [Thiếu|Thừa|Lệch|Lỗi|File] <file:line> — <vấn đề> → <cách sửa>
```
Không liệt kê góp ý phong cách không ảnh hưởng hành vi.
