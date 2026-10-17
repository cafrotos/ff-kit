# P2b — Test hành vi viết trước, hai lớp, khóa

Test viết từ **AC + hợp đồng UI/API**, trước khi có code. Người viết (`ff-test-writer`) **không được thấy code implement** → test không "đẻ" từ code sai. Hai lớp (spec §8.1):

| Lớp | File | Viết khi | Ai sửa |
|---|---|---|---|
| Hành vi | `<e2e.tests_dir>/<slug>/<cụm>-behavior.spec.ts` | P2b (trước code) | **Khóa** hash; chỉ user quyết (`relock`) |
| Locator | `<e2e.tests_dir>/<slug>/<cụm>.locators.ts` | P2b khai chữ ký; `ff-verify` điền sau implement | verifier (chỉ locator) |

`<cụm>` = tên cụm (thẻ lớn) hoặc `task-N` (thẻ tách task con; **cần** tiền tố `task-N-` để `ac-matrix <id> task-N` lọc đúng). Thẻ nhỏ/vừa: `main-behavior.spec.ts` + `main.locators.ts`.

## Khuôn file hành vi
Gọi locator qua hàm, không viết selector trong file này:
```ts
import { test, expect } from '@playwright/test'
import * as L from './main.locators'

test('AC-01: role được giao chọn bộ lọc, chuyển trang, bộ lọc giữ nguyên', async ({ page }) => {
  await loginAs(page, roleFromBrief) // Helper công khai và role từ Brief/project_docs.roles_file
  await page.goto('/<route trong hợp đồng UI>')
  await L.statusFilter(page).selectOption(statusFromContract)
  await L.nextPageButton(page).click()
  await expect(L.statusFilter(page)).toHaveValue(statusFromContract)
})
```
`loginAs`, `roleFromBrief` và `statusFromContract` lấy từ helper công khai/hợp đồng đã cung cấp; đây là khuôn, người viết phải điền import và dữ liệu thật trước type-check. Với dữ liệu nghiệp vụ tạo mới, dùng seed động ở phần dưới.

- **Tiêu đề bắt đầu `AC-xx:` trên cùng dòng `test(`** (hoặc dòng ngay sau) — `ff ac-matrix` chỉ đọc kiểu này. Nhiều AC: `AC-01, 02: …`.
- 1 test = 1 câu "Role R mở màn X, thao tác, thấy Y" + `expect` cụ thể. Không `test.skip`, `waitForTimeout`, `force:true`, `.catch(()=>{})`.
- Tiền đề/seed (dữ liệu, role, email đăng nhập) nằm trong file hành vi để bị khóa cùng `expect`.

## Quy chuẩn Dynamic Seed Data (cần)
- **Không hardcoded ID tĩnh**: Không bao giờ viết test dựa vào ID cố định (như `id=1`, `id=123`, hoặc email/mã cố định không kiểm tra tồn tại). ID tĩnh gây xung đột khi chạy lại test, làm bẩn DB và dễ vỡ khi dữ liệu seed ban đầu thay đổi.
- **cần tiền tố động duy nhất `TEST_AUTO_<slug>_<timestamp>`**:
  Mọi bản ghi dữ liệu mới do test tạo ra hoặc tìm kiếm (tên khách hàng, ứng viên, hợp đồng, email, title...) cần gắn tiền tố động:
  ```ts
  const uniqueTag = `TEST_AUTO_${slug}_${Date.now()}`
  const dynamicName = `Khách hàng ${uniqueTag}`
  const dynamicEmail = `${uniqueTag.toLowerCase()}@test.local`
  ```
- **Tài khoản Role đăng nhập**:
  Chỉ tài khoản đăng nhập để xác thực quyền mới lấy từ tài khoản chuẩn đã cấu hình trong `project_docs.roles_file` (role/email do Brief nêu). Không nhầm lẫn giữa tài khoản đăng nhập (cố định theo env) và dữ liệu nghiệp vụ (cần động).
- **Tính cô lập & Idempotence**:
  Mỗi ca test phải tự chủ về dữ liệu, có thể chạy lại nhiều lần liên tiếp độc lập mà không bị lỗi do dữ liệu sót lại từ lần chạy trước.

## Khuôn file locator (lúc P2b)
Chỉ chữ ký + throw — `ff-verify` thay thân hàm bằng locator thật theo hợp đồng UI:
```ts
import type { Page, Locator } from '@playwright/test'
export const saveButton = (page: Page): Locator => { throw new Error('chưa gắn locator') }
```
Mỗi hàm một phần tử có tên trong hợp đồng UI (nhãn/role). Tên hàm ổn định — file hành vi đã khóa tham chiếu chúng.

## cần phủ (nếu Brief/design nêu)
1. **Ma trận role:** mỗi chức năng ≥2 role (role có quyền + role không có quyền theo Brief); role không quyền → không thấy/không gọi được.
2. **Nguồn dropdown == nguồn dữ liệu trong Brief:** đọc danh sách thật từ API/kho theo Brief, so với option hiển thị (không chép tay hằng).
3. **Ngân sách request:** `page.on('request', …)`, đếm theo endpoint, `expect(count).toBeLessThanOrEqual(<trần trong Brief>)` cho từng kịch bản Brief liệt kê (mở màn, Sửa/Hủy, đổi filter, mở dialog, chuyển tab).
4. Bất biến trong Brief (mục "Bất biến"), trạng thái rỗng/lỗi, ≥1 AC hồi quy mỗi chức năng bị chạm.

## Khóa
```bash
ff e2e-lint <e2e.tests_dir>/<slug>/     # đọc: không có force/skip/timeout
ff lock-tests <slug> <e2e.tests_dir>/<slug>/<cụm>-behavior.spec.ts [file hành vi khác…]
```
- Chỉ liệt kê file hành vi (không `*.locators.ts`). Không truyền file → script khóa mọi `*.spec.ts` trong thư mục — vẫn đúng vì locator không đuôi `.spec.ts`.
- In **8 ký tự hash manifest** cho user. Đã khóa mà cần thêm cụm sau → `ff relock <slug> --reason "<thêm cụm>" --add <files...>` (cần user), không `lock-tests` lại. Revision thêm `--revision rev-N`. `--add` chỉ thêm file mới, từ chối nếu test cũ đã đổi hash.
- Thẻ lớn: viết + khóa test của cụm ngay trước build cụm đó, không chờ cả thẻ.

## Khóa revision riêng

`ff reopen` tạo placeholder; phải điền AC/spec/design và lấy Gate A/B hiện tại trước khi khóa test. Với `activeRevision: rev-N`, tạo test revision mới trong `e2e.tests_dir` (ví dụ `rev-N-main-behavior.spec.ts` cùng locator riêng), không sửa file hành vi cũ đã khóa. Test mới gắn AC hiện tại; test cũ liên quan vẫn chạy hồi quy.

```bash
ff lock-tests <slug> --revision rev-N <files-hành-vi-revision...>
```

Manifest revision là `.ff-test-lock.rev-N`; manifest gốc `.ff-test-lock` giữ nguyên. Lấy đường dẫn manifest từ `testLock` trong `ff state <id> --json`; không đoán manifest active bằng tên gốc. Nếu user đã cho đổi test revision, dùng `ff relock <slug> --revision rev-N --reason "<lý do>"`; giữ lịch sử và hash của test gốc.

## Test sai
Không sửa. Ghi đề xuất vào "Cần bạn quyết" (diff `expect` + lý do + trích AC/spec). Code chưa khớp test là lỗi implement.
