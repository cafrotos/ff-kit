# Plan: slice, chủ file, micro-task, model

Plan = `<cards_dir>/<slug>/04-plan.md` (thẻ task con: `task-N-*/04-plan.md`). Do `ff-planner` viết, **cả đợt một lần**. Spec ≠ design ≠ plan: plan nói làm từng bước, không đổi quyết định đã chốt.

## 1. Slice và chủ file
- Slice là DAG theo phụ thuộc; **phần 0 (hợp đồng: type/DTO/chữ ký API)** làm trước.
- **Chủ file:** trong một đợt song song, mỗi file chỉ **một** task ghi. Nhiều chỗ sửa cùng file → gộp thành một task, một agent làm tuần tự.
- **File nóng** (nhiều task đụng, rất dài, vd `JobOfferTab.tsx` >3000 dòng): mỗi đợt chỉ một task, `model: sonnet`.
- Allowlist của đợt = hợp các file ghi của mọi task trong đợt (đã đủ nhờ quy tắc chủ file).
- Plan ghi sẵn từng đợt: số đợt, task, file ghi, phụ thuộc đợt trước.

### 1.1. Kiểm tra cơ học Probe Slice (`probe-slice`) sau mỗi đợt
- Sau khi toàn bộ micro-task trong đợt hoàn tất, trước khi tiến hành review diff đợt:
  **cần chạy lệnh kiểm tra cơ học** để phát hiện file drift và vi phạm allowlist:
  ```bash
  ff probe-slice <slug> [task]
  ```
- Ý nghĩa trạng thái:
  * `DRIFT_CLEAN` / `NO_CHANGES` (exit code 0): 100% file thay đổi thực tế nằm trong allowlist của đợt. Đủ điều kiện chuyển sang review diff.
  * `ALLOWLIST_VIOLATION` (exit code 1): Phát hiện file thay đổi nằm ngoài allowlist (`.ff-allow`).
- **Quy tắc xử lý vi phạm allowlist**:
  * Không bỏ qua hoặc cố squash khi đang có vi phạm allowlist.
  * Nếu là file rác / format thừa / chạm nhầm file ngoài đợt: hoàn tác ngay (`git checkout` / `git clean`) trong bản copy.
  * Nếu là file phát sinh hợp lý do interface thay đổi: cập nhật allowlist bằng `ff allow <id> <file>` và cập nhật lại plan.
  * Lặp lại `probe-slice` cho đến khi đạt `DRIFT_CLEAN` (exit code 0).

## 2. Plan cả đợt vs JIT
Mặc định viết **toàn bộ plan một lần**, neo bằng tên symbol (không phụ thuộc số dòng). **JIT** (viết plan đợt sau ngay trước đợt đó) chỉ khi đợt sau có `Consumes` là thứ **chưa tồn tại** lúc plan — vì hợp đồng phần 0 đã khóa chữ ký, JIT làm mất song song. Implementer báo "Interfaces: đổi" → planner sửa **riêng task bị ảnh hưởng** (và task Consumes nó), không viết lại plan.

## 3. Đầu plan
```markdown
# <Thẻ> — Plan
Spec: `03-design.md` · Brief: `brief.md` · Test khóa: `e2e/tests/<slug>/*-behavior.spec.ts`

## Global Constraints
<ràng buộc toàn dự án chép nguyên văn từ Brief/design, 1 dòng/ràng buộc: nhãn UI, tên route, trần request, quy ước app (API client, MobX store dùng `name`), không `--fix`…>

## Review Focus
<≤5 dòng: đầu vào/tình huống spec ngầm có mà test chưa phủ, dễ gây lỗi nhất, kèm hành vi hợp lý. Mỗi dòng gắn vào micro-task chủ code đó (thêm ca vào bảng input→output của task)>

## Đợt 1 — <tên> (file ghi: a, b, c)
```
Ví dụ Review Focus: effect gọi API có deps đổi cùng lúc khi khởi tạo (`isLoading`, null → có giá trị); danh sách rỗng; user không quyền gọi tay endpoint.

## 4. Khuôn micro-task (một file/task)
```markdown
### Task <N.M>: <tên> — model: haiku|sonnet
**File (duy nhất được ghi):** `<đường dẫn trong bản copy>`
**Neo:** symbol `<tên hàm/component>`; tìm bằng đoạn duy nhất `<chuỗi chép nguyên từ code>` (`file:line` chỉ để tham khảo)
**Hành vi:** <1–3 câu>
| Input / trạng thái | Output / kết quả |
|---|---|
| <ca thường> | <...> |
| <ca rỗng / lỗi / role khác> | <...> |
**Interfaces:**
- Consumes: `<chữ ký chính xác, file nguồn>` (task nào/đã có sẵn)
- Produces: `<chữ ký chính xác>` (task nào dùng)
**Precedent:** `<file:symbol>` — bắt chước đặt tên, cấu trúc, cách phân quyền
**Skeleton (chỉ phần khó):**
<code fence — phần logic không hiển nhiên; phần còn lại để implementer theo precedent>
**KHÔNG làm:** <vd: không đổi chữ ký ngoài Produces; không đụng file khác; không thêm prop/hàm "cho chắc">
**Kiểm cơ học:** `<lệnh hẹp: tsc/test/grep>` → kỳ vọng `<kết quả>`
```
- Implementer chỉ thấy task của mình → chữ ký trong Consumes/Produces phải **đủ**, không "xem task khác".
- **Cấm placeholder:** `TBD`, `TODO`, "xử lý lỗi phù hợp", "tương tự task N", tham chiếu kiểu/hàm không định nghĩa ở task nào.
- Không commit từng bước (luồng này squash cuối); không chạy tuần tự từng bước 2–5 phút — task là đơn vị giao, bên trong tự quyết.
- Mỗi task có **lệnh kiểm cơ học** chạy được (vd `cd worktrees/<slug>/<repo-name> && $(ff cfg get repos.<repo-name>.commands.typecheck) -p apps/<app>` hoặc test cụ thể); không có lệnh kiểm → task chỉ giao sonnet.

## 5. Self-Review của planner (trước khi báo xong)
1. Mỗi AC/YC có ≥1 micro-task; 2. grep plan tìm placeholder; 3. tên/chữ ký ở task sau khớp task trước; 4. mỗi dòng Review Focus có ca kiểm trong task chủ; 5. không file nào có 2 task ghi trong cùng đợt.

## 6. Chọn model
| Điều kiện | Model |
|---|---|
| **Cả 4**: 1 file · có skeleton · có lệnh kiểm cơ học · không file nóng — **và allowlist đang bật** (`ff allow` đã chạy cho đợt) | `haiku` → `ff-implementer-haiku` |
| Logic mới phức tạp, file nóng, không skeleton, hoặc allowlist chưa bật | `sonnet` → `ff-implementer` |

**Leo thang:** haiku báo xong mà lệnh kiểm không xanh **2 lần** → giao lại đúng task đó cho `ff-implementer` (sonnet), kèm lỗi 2 lần trước. `model` cố định trong frontmatter agent, nên "leo thang" = đổi agent. Năng lực haiku trên repo này **chưa pilot** → đợt đầu của thẻ đầu tiên: haiku ≤2 task, đọc diff kỹ.
