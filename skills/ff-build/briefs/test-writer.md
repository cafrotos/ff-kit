# Brief — Viết test hành vi trước (P2b, ff-test-writer)

Bạn viết test e2e Playwright **hành vi** cho thẻ Trello, **trước khi có code**.

## Đầu vào (người giao điền — sự kiện đã verify)
- Thẻ: `<cards_dir>/<id>-<slug>/` · Brief `brief.md` · `02-spec.md` (AC) · `03-design.md` (phần 0: hợp đồng UI/API, ngân sách request)
- Thư mục ghi: `e2e/tests/<id>-<slug>/` · `<cụm>` = `<tên cụm | task-N | main>`
- Role + email đăng nhập, dữ liệu seed: `<…>`

## Đọc / không đọc
- Chỉ đọc: file thẻ ở trên, `e2e/` (fixture/helper, `.auth/`, test thẻ cũ làm mẫu).
- **Không đọc code implement**: `worktrees/`, `<repo-name>/`, `<repo-name>/` — kể cả `grep`/`cat`/codegraph. Thiếu thông tin (tên nhãn, route, endpoint) → lấy từ hợp đồng UI/API trong design; hợp đồng không có → ghi vào "Thiếu hợp đồng", **không đoán từ code**.
- Không đọc giá trị `.env*`.

## Làm
Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-build/references/test-first.md` — khuôn, luật đặt tên `AC-xx:`, hai lớp file.
1. `e2e/tests/<slug>/<cụm>-behavior.spec.ts`: mỗi AC ≥1 `test('AC-xx: Role R mở màn X, thao tác, thấy Y')` + `expect` cụ thể; gọi `L.<hàm>(page)`.
2. `e2e/tests/<slug>/<cụm>.locators.ts`: mỗi phần tử trong hợp đồng UI 1 hàm `(page: Page): Locator` có thân `throw new Error('chưa gắn locator')`.
3. Phủ: ma trận role (≥2 role/chức năng) · nguồn dropdown == nguồn dữ liệu trong Brief · đếm request theo endpoint bằng `page.on('request')` với trần theo Brief · bất biến + AC hồi quy.
4. Chạy `ff e2e-lint e2e/tests/<id>-<slug>/` và sửa phát hiện trong file mình viết. **Không chạy** `playwright test` (chưa có code, locator chưa gắn).

## Cấm
`test.skip`/`fixme`, `waitForTimeout`, `force:true`, `.catch(()=>{})`, `.first()`/`.nth()`; selector trong file hành vi; `expect` mềm kiểu "tồn tại" cho thứ spec nêu giá trị cụ thể; ghi ngoài `e2e/tests/<id>-<slug>/`; `git push`; tự khóa test (`lock-tests` do người giao chạy).

## Báo cáo
```
File: <danh sách>
AC → test: AC-01 → <file:dòng> … (AC không viết được test + lý do)
Thiếu hợp đồng: không | <phần tử/endpoint cần design bổ sung>
e2e-lint: <kết quả>
```
