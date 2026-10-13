# Gắn locator (spec §8.1–8.2)

Hai lớp file (xem `${CLAUDE_PLUGIN_ROOT}/skills/ff-build/references/test-first.md`):
- `e2e/tests/<slug>/<cụm>-behavior.spec.ts` — **khóa**, verifier không đụng.
- `e2e/tests/<slug>/<cụm>.locators.ts` — thân hàm ban đầu `throw new Error('chưa gắn locator')`; verifier thay bằng locator thật. **Chỉ file này được sửa.**

## Làm
1. Đọc hợp đồng UI trong `03-design.md` (nhãn, role, vùng). Đọc file behavior để biết hàm nào được gọi và dùng thế nào (`.click()`, `toBeVisible()`, `toHaveCount`…). Tên hàm + chữ ký giữ nguyên.
2. Thu hẹp **vào vùng có tên trước**: dialog/region → `page.getByRole('dialog', { name })` / `getByRole('region', { name })`, rồi mới `.getByRole(role, { name })` bên trong.
3. Ưu tiên `getByRole` + `name`, rồi `getByLabel`/`getByText`; tránh class CSS Antd (giòn).
4. Mỗi locator **phải khớp đúng 1 phần tử** (`toHaveCount(1)`), trừ hàm hợp đồng ghi rõ là danh sách (khi đó trả locator của tập, không `.first()`).
5. Kiểm từng locator trên app thật (subagent dùng Playwright MCP: snapshot, đếm). Chụp ảnh có đánh dấu phần tử (outline bằng `evaluate` tạm, không ghi vào file) vào `<cards_dir>/<slug>/verify/<role>/`.
6. Không thêm file test mới (e2e/ chung, không git). Kết quả đếm `toHaveCount(1)` từ phiên MCP ghi vào báo cáo.

## Phần tử thật khác hợp đồng UI
Nhãn/role/vị trí khác hợp đồng, hoặc không có phần tử → **lỗi implement**, không phải lỗi test. Ghi vào mục "Lỗi implement": hợp đồng nói gì (trích `03-design.md`) · app thật có gì (ảnh) · slice/file nghi ngờ. **Không** sửa locator cho khớp phần tử sai, không bắt theo class/vị trí để "cho chạy".

## Cấm
- Sửa file hành vi đã khóa (guard chặn; `chmod`/`chflags` cũng bị chặn). Không tìm đường vòng.
- Trong locator: `.first()` / `.nth()` khi chưa thu hẹp vào vùng có tên · `force: true` · `dispatchEvent` · `waitForTimeout` · `.catch(()=>{})` · `test.skip`.
- Sửa `e2e/helpers/`, `e2e/fixtures/`, `e2e/playwright.config.ts`, `e2e/global-setup.ts` — cần thì dừng, báo user.
- Hardcode email/tên/SĐT người thật.
- Báo PASS khi chưa chạy; skip tính PASS; "PASS một phần" tính đạt.

## Được làm
- Sửa `*.locators.ts` (chỉ dòng locator); thêm hàm helper nội bộ trong file đó nếu thuần locator.
- Chạy lại test bao nhiêu lần cũng được (đúng path, `workers: 1`).
- `verify-down/up` của đúng bản copy; `$(ff cfg get repos.<repo-name>.commands.migrate)` trong bản copy.

## Test nghi sai → đề xuất, không sửa
Ghi vào "Cần bạn quyết", đủ 4 phần:
```
Test: <file>:<dòng> · AC-xx
Đề xuất: - expect(...)   + expect(...)
Lý do: <quan sát thực tế, ảnh>
Trích AC/spec: "<nguyên văn>" (<02-spec.md:dòng>)
```
User duyệt → `ff relock <id> --reason "<lý do + AC>"` (user sẽ được hỏi quyền), rồi chạy lại. Không tự relock, không vòng lặp hỏi.

## Diff locator cuối phải sạch
Trước báo cáo, đọc lại `*.locators.ts`: mọi dòng đổi là locator. Dòng ngoài locator = vi phạm, hoàn tác.
