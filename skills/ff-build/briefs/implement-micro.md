# Brief — Thực thi 1 micro-task (ff-implementer-haiku / ff-implementer)

Bạn code **đúng một micro-task** của `04-plan.md` trong **bản copy** `worktrees/<id>-<slug>/`.
(Nếu bạn là `ff-implementer`: nhiệm vụ của bạn là file này, thay cho brief mặc định trong mô tả agent.)

## Đầu vào (người giao điền — sự kiện đã verify)
- Bản copy: `worktrees/<id>-<slug>/` · nhánh `<branch>`
- Task: `<N.M>` trong `<cards_dir>/<id>-<slug>/[task-N-*/]04-plan.md` (đọc **mục Global Constraints + task của bạn**, không cần task khác)
- File duy nhất được ghi: `<đường dẫn trong bản copy>` (nằm trong allowlist đợt)
- Lỗi lần trước (chỉ khi giao lại): `<đầu ra lệnh kiểm>`

## Làm
1. Đọc precedent của task trước khi viết; viết giống nó (đặt tên, cấu trúc, API client, phân quyền).
2. Tìm vị trí bằng **đoạn mã duy nhất** ở ô Neo (không tin số dòng).
3. Giữ đúng chữ ký ở Interfaces (Produces là thứ task khác dựa vào). Dùng Consumes đúng như ghi.
4. Làm đúng bảng hành vi, gồm ca rỗng/lỗi/role khác; theo skeleton chỗ có.
5. Chạy **lệnh kiểm cơ học** của task; sửa tới khi đạt kỳ vọng. Không xanh sau nỗ lực hợp lý → báo KẸT kèm đầu ra, không bịa.
6. Codegraph trước, grep sau (`codegraph sync` trong repo bản copy nếu index cũ).

## Cấm (guard chặn cứng, đừng tìm đường vòng)
- Ghi file khác ô File (guard: "file ngoài allowlist") — cần file khác → báo, không tự thêm.
- Sửa `e2e/`, `02-spec.md`, `03-design.md`, `04-plan.md`, `brief.md`.
- `git push` · `git add -A`/`.`/`-u` · `git commit` · `git stash` · `kill`/`pkill` · migration ngoài bản copy · sửa repo gốc · lệnh lint tự sửa (`--fix`).
- Thêm thứ ngoài task (hàm/prop/biến thể "cho chắc"), đổi chữ ký ngoài Produces, mục KHÔNG làm của task.
- `.first()`/`catch → []` im lặng/hằng chép tay của dữ liệu đã có nguồn — dùng nguồn thật theo Brief.

## Báo cáo
```
Task: <N.M> — XONG | KẸT
File đã sửa: <đường dẫn>
Interfaces: giữ đúng | đổi — <đổi gì, vì sao; task nào bị ảnh hưởng>
Kiểm: <lệnh + kết quả nguyên văn>
Lệch plan/design: không | <chỗ lệch + lý do>
```
