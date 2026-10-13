# Brief — Gắn locator + chạy test + đo (ff-verifier, ff-verify)

Bạn verify một thẻ trên môi trường **đã bật sẵn** từ bản copy, độc lập với người code. Không sửa code sản phẩm. Chỉ được sửa `e2e/tests/<slug>/*.locators.ts` (chỉ dòng locator). Cấm push.

## Đầu vào (người giao điền — sự kiện đã verify)
- Thẻ: `<cards_dir>/<id>-<slug>/` · `brief.md` (ngân sách request) · `02-spec.md` (AC) · `03-design.md` (hợp đồng UI)
- Bản copy: `worktrees/<slug>/` · nhánh `<branch>`
- Test: `e2e/tests/<slug>/` (`<cụm>-behavior.spec.ts` đã khóa, `<cụm>.locators.ts` cần gắn)
- Môi trường: BE `http://<e2e.health_urls>`, FE `<app>` `http://localhost:<port>`, home `<e2e.apps[].base_url>` (do `ff verify-up` bật)
- Role → email đăng nhập: `<role: email, …>`; storage-state MCP ký bằng `ff mcp-auth <email>`
- Chế độ: `<thường | Reopen rev-N, phiếu …>`

## Làm
1. Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-verify/references/bind-locators.md`, rồi gắn locator từng hàm trong `*.locators.ts` theo hợp đồng UI (dò app thật bằng Playwright MCP, đăng nhập sẵn, không bấm Google). Chụp ảnh có đánh dấu phần tử vào `<cards_dir>/<slug>/verify/<role>/`.
2. Chạy đúng path, từ `e2e/`: `npx playwright test tests/<slug>/ --reporter=list`. Không lệnh trần, không `--workers`, không `webServer`.
3. Đo request theo `${CLAUDE_PLUGIN_ROOT}/skills/ff-verify/references/measure.md` cho từng kịch bản trong ngân sách của `brief.md`; đo số truy vấn DB nếu bật được theo tài liệu đó.
4. Chụp ảnh màn mới theo từng role cạnh màn precedent (đường dẫn precedent trong `03-design.md`).

## Cấm
- Sửa file hành vi đã khóa, `.ff-test-lock*`, `chmod`/`chflags`. Muốn đổi `expect`/tiền đề → ghi đề xuất (diff + lý do + trích AC), không tự sửa.
- Trong locator: `.first()`/`.nth()` chưa thu hẹp vùng có tên, `force: true`, `dispatchEvent`, `waitForTimeout`, `.catch(()=>{})`.
- Sửa locator cho khớp phần tử sai: phần tử thật khác hợp đồng UI = **lỗi implement**, báo lại.
- Sửa code trong bản copy; sửa `e2e/helpers|fixtures|playwright.config.ts|global-setup.ts`; hardcode email/tên người thật.
- `kill`/`pkill`; đụng service/repo gốc/task khác; đọc giá trị `.env*`; in token.
- Báo PASS khi chưa chạy (mỗi PASS trích output lệnh); skip = NOT RUN; "PASS một phần" = chưa đạt.
- Được phép: `ff verify-down <id>` rồi `verify-up <id> <app>` của đúng bản copy (ghi output ra file, không pipe); `$(ff cfg get repos.<repo-name>.commands.migrate)` trong `worktrees/<slug>/<repo-name>` (cấm `migration:revert`). **Không** tự ghi `NODE_ENV=development` (đổi hành vi PDF/email, xem `references/measure.md`); số truy vấn DB ghi "chưa đo" trừ khi orchestrator nói user đã đồng ý.

## Báo cáo (trả về cho người giao)
```
Locator đã gắn: <n>/<tổng> · file: e2e/tests/<slug>/<cụm>.locators.ts · toHaveCount(1): <đạt/không + hàm lỗi>
Test: <n> pass / <n> fail / <n> skip — trích output lệnh cuối
  AC-xx: PASS|FAIL|NOT RUN — <bằng chứng: tên test + lỗi>
Lỗi implement: <hợp đồng nói gì · thực tế (ảnh) · slice/file nghi> | không
Request theo kịch bản: <bảng kịch bản|endpoint|số lần|trần|đạt/ĐỎ>
Truy vấn DB: <bảng> | chưa đo (<lý do>)
Ảnh: <đường dẫn theo role + precedent>
Đề xuất sửa test: <diff expect + lý do + trích AC> | không
Env đã thêm: <không | biến>
Dữ liệu còn lại (nếu giữ): <điều kiện lọc + id>
```
