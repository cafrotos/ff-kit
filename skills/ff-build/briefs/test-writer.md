# Brief — Viết test hành vi trước (P2b, ff-test-writer)

Viết test e2e Playwright **hành vi** cho thẻ, **trước khi có code**.

## Đầu vào (người giao điền — sự kiện đã verify)
- Thẻ: `<cards_dir>/<slug>/` · activeDir `<…>` · activeRevision `<null | rev-N>` · Brief `brief.md` hoặc `delta.md` · `02-spec.md` (AC) · `03-design.md` (phần 0: hợp đồng UI/API, ngân sách request)
- Thư mục ghi: `<e2e.tests_dir>/<slug>/` · `<cụm>` = `<tên cụm | task-N | main>`
- Revision nếu có: chỉ tạo file hành vi/locator mới; file cũ khóa giữ hồi quy.
- Role + email đăng nhập, dữ liệu seed: `<…>`

## Đọc / không đọc
- Chỉ đọc: file thẻ ở trên; fixture/helper công khai và test cũ làm mẫu trong `<e2e.dir>`.
- **Không đọc code implement**: `<worktrees_dir>/`, repo sản phẩm trong bản copy — kể cả `grep`/`cat`/codegraph. Thiếu thông tin (tên nhãn, route, endpoint) → lấy từ hợp đồng UI/API trong design; hợp đồng không có → ghi vào "Thiếu hợp đồng", **không đoán từ code**.
- Không đọc `.auth/`, token, storage-state, giá trị `.env*` hoặc secret; helper auth công khai không cấp quyền đọc credential.

## Làm
Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-build/references/test-first.md` — khuôn, luật đặt tên `AC-xx:`, hai lớp file.
1. `<e2e.tests_dir>/<slug>/<cụm>-behavior.spec.ts`: mỗi AC ≥1 `test('AC-xx: Role R mở màn X, thao tác, thấy Y')` + `expect` cụ thể; gọi `L.<hàm>(page)`.
2. `<e2e.tests_dir>/<slug>/<cụm>.locators.ts`: mỗi phần tử trong hợp đồng UI 1 hàm `(page: Page): Locator` có thân `throw new Error('chưa gắn locator')`.
3. Phủ: ma trận role (≥2 role/chức năng) · nguồn dropdown == nguồn dữ liệu trong Brief · đếm request theo endpoint bằng `page.on('request')` với trần theo Brief · bất biến + AC hồi quy.
4. Chạy `ff e2e-lint <e2e.tests_dir>/<slug>/` và sửa phát hiện trong file mình viết. Được chạy type-check test bằng command đã cấu hình, không chạy `playwright test` (chưa có code, locator chưa gắn). e2e-lint/type-check không chứng minh PASS hành vi; báo kết quả tĩnh riêng.

## Cấm
`test.skip`/`fixme`, `waitForTimeout`, `force:true`, `.catch(()=>{})`, `.first()`/`.nth()`; selector trong file hành vi; `expect` mềm kiểu "tồn tại" cho thứ spec nêu giá trị cụ thể; ghi ngoài `<e2e.tests_dir>/<slug>/`; `git push`; tự khóa test (`lock-tests` do người giao chạy).

## Báo cáo
```
File: <danh sách>
AC → test: AC-01 → <file:dòng> … (AC không viết được test + lý do)
Thiếu hợp đồng: không | <phần tử/endpoint cần design bổ sung>
Kiểm tĩnh: e2e-lint/type-check <lệnh + kết quả>; hành vi: chưa chạy
```
