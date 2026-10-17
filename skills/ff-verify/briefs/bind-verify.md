# Brief — Gắn locator + chạy test + đo (ff-verifier, ff-verify)

Nghiệm thu một thẻ trên môi trường **đã bật sẵn** từ bản copy, độc lập với người code. Không sửa code sản phẩm. Chỉ được sửa `<e2e.tests_dir>/<slug>/*.locators.ts` (chỉ dòng locator). Cấm push.

## Đầu vào (người giao điền — sự kiện đã verify)
- Thẻ: `<cards_dir>/<slug>/` · activeDir `<…>` · activeRevision `<null | rev-N>` · `brief.md` hoặc `delta.md` (ngân sách request) · `02-spec.md` (AC) · `03-design.md` (hợp đồng UI)
- Bản copy: `<worktrees_dir>/<slug>/` · nhánh `<branch>`
- Test: `<e2e.tests_dir>/<slug>/` (`<cụm>-behavior.spec.ts` đã khóa, `<cụm>.locators.ts` cần gắn)
- Môi trường: health `<e2e.health_urls>`, app `<app>`, base URL `<e2e.apps[].base_url>` (do `ff verify-up` bật)
- Role → email đăng nhập: `<role: email, …>`; storage-state MCP ký bằng `ff mcp-auth --email <email>`
- Manifest hiện tại: `<testLock từ state>`; test revision mới và test cũ liên quan để hồi quy.
- Chế độ: `<thường | Reopen rev-N, phiếu …>`

## Làm
1. Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-verify/references/bind-locators.md`, rồi gắn locator từng hàm trong `*.locators.ts` theo hợp đồng UI (dò app thật bằng Playwright MCP, đăng nhập sẵn, không bấm Google). Chụp ảnh có đánh dấu phần tử vào `<activeDir>/verify/<role>/`.
2. Chạy đúng path, từ `<e2e.dir>` bằng command đã cấu hình, test path `<e2e.tests_dir>/<slug>/` và config `<e2e.playwright_config>`. Không lệnh trần, không `--workers`, không `webServer`.
3. Khi duyệt bằng Playwright MCP, kiểm danh sách request: request mang auth (Authorization/cookie/token) tới host không phải loopback hay `e2e.apps`/`e2e.allowed_hosts` = **lỗi an toàn môi trường**; dừng ngay, không chạy tiếp, báo host (không in token) cho phiên chính, không ghi PASS/FAIL cho AC. Test Playwright đã có egress guard sẵn trong fixture.
4. Đo request theo `${CLAUDE_PLUGIN_ROOT}/skills/ff-verify/references/measure.md` cho từng kịch bản trong ngân sách Brief/delta hiện tại; đo số truy vấn DB nếu bật được theo tài liệu đó.
5. Chụp ảnh màn mới theo từng role cạnh màn precedent (đường dẫn precedent trong `03-design.md`).
6. Đối chiếu lời hứa với hành vi thực tế, ghi bằng chứng/hồi quy/giới hạn cho phiên chính tổng hợp. Mỗi tín hiệu không áp dụng là `N/A` + lý do; tín hiệu bắt buộc chưa đo là `UNVERIFIED`. `OBSERVATION` chỉ cho UX, không thay PASS kỹ thuật. Agent trả artifact/bằng chứng; bản cho người dùng do phiên chính trình theo `${CLAUDE_PLUGIN_ROOT}/references/human-output.md`.

## Cấm
- Sửa file hành vi đã khóa, `.ff-test-lock*`, `chmod`/`chflags`. Muốn đổi `expect`/tiền đề → ghi đề xuất (diff + lý do + trích AC), không tự sửa.
- Trong locator: `.first()`/`.nth()` chưa thu hẹp vùng có tên, `force: true`, `dispatchEvent`, `waitForTimeout`, `.catch(()=>{})`.
- Sửa locator cho khớp phần tử sai: phần tử thật khác hợp đồng UI = **lỗi implement**, báo lại.
- Sửa code trong bản copy; sửa helper, fixture, config và setup trong `<e2e.dir>`; hardcode email/tên người thật.
- `kill`/`pkill`; đụng service/repo gốc/task khác; đọc giá trị `.env*`; in token.
- Báo PASS khi chưa chạy (mỗi PASS trích output lệnh); skip = NOT RUN; "PASS một phần" = chưa đạt.
- Được phép: `ff verify-down <id>` rồi `verify-up <id> <app>` của đúng bản copy (ghi output ra file, không pipe); migration chỉ do phiên chính chuẩn bị trước theo command cấu hình trong đúng repo bản copy, không tự chạy ở lượt verifier. **Không** tự ghi `NODE_ENV=development` (đổi hành vi PDF/email, xem `references/measure.md`); số truy vấn DB ghi "chưa đo" trừ khi orchestrator nói user đã đồng ý.

## Báo cáo (trả về cho người giao)
```
Locator đã gắn: <n>/<tổng> · file: <e2e.tests_dir>/<slug>/<cụm>.locators.ts · toHaveCount(1): <đạt/không + hàm lỗi>
Test: <n> pass / <n> fail / <n> skip — trích output lệnh cuối
  AC-xx: PASS|FAIL|PARTIAL|UNVERIFIED — <hợp đồng nói gì → thực tế, role/môi trường, bằng chứng; tín hiệu N/A + lý do>
Hồi quy: <phần hứa giữ nguyên + kết quả/bằng chứng>
Giới hạn: <AC/tín hiệu bắt buộc chưa đo + điều kiện còn thiếu> | không
UX OBSERVATION: <quan sát + ảnh, không tính PASS kỹ thuật> | không
Lỗi implement: <hợp đồng nói gì · thực tế (ảnh) · slice/file nghi> | không
Request theo kịch bản: <bảng kịch bản|endpoint|số lần|trần|đạt/ĐỎ>
Truy vấn DB: <bảng> | chưa đo (<lý do>)
Ảnh: <đường dẫn theo role + precedent>
Đề xuất sửa test: <diff expect + lý do + trích AC> | không
Env đã thêm: <không | biến>
Dữ liệu còn lại (nếu giữ): <điều kiện lọc + id>
```
