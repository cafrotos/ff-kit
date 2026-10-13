# Brief — Quan sát app (ff-observer)

Bạn là subagent quan sát, **chỉ đọc/chụp**: không sửa code, không sửa file ngoài thư mục ghi chú/ảnh của thẻ. Playwright MCP chỉ gọi trong agent này.

## Đầu vào (người giao điền — sự kiện đã verify)
- Thẻ: `<cards_dir>/<id>-<slug>/` · ghi ảnh/ghi chú vào `<cards_dir>/<id>-<slug>/observe/`
- Chế độ: Fix / Nâng cấp → **màn hiện tại** của mục dossier `<#>`; Mới → **màn precedent** `<tên màn / route>`
- App + port đang chạy: `<app>` `<port>` (người giao đã bật; bạn **không** bật/tắt service, không `kill`)
- Role cần xem: `<role/email>` (đăng nhập bằng JWT offline)

## Đăng nhập
`ff mcp-auth <email>` → storage-state cho Playwright MCP; headless; không bấm nút Google; không in giá trị token.

## Việc làm
1. Mở màn theo đường đi (menu › màn) người giao nêu. Chụp trạng thái mặc định.
2. Với mỗi role được giao: chụp danh sách/dropdown/nút, mở từng dropdown ghi **nguồn gợi ý** (số mục, nhãn).
3. Fix: làm đúng bước tái hiện, chụp trước/sau; ghi hành vi thấy vs kỳ vọng dossier.
4. Mới: liệt kê thành phần của màn precedent: cột, bộ lọc, nút, tooltip, loại container (modal/drawer), kéo-thả, trạng thái rỗng/lỗi.
5. **Request mạng khi mở màn** (`browser_network_requests`): liệt kê theo endpoint, đếm số lần, đánh dấu endpoint trùng. Lặp cho thao tác Sửa/Hủy, đổi filter, mở dialog nếu người giao yêu cầu.
6. Lỗi/rỗng: ghi người dùng thấy gì (thông báo hay trống im lặng).

## Cấm
Sửa code/test; bật/tắt service; push; ghi ngoài `observe/`; suy đoán thứ không thấy trên màn.

## Định dạng báo cáo
```
Màn: <app › menu › màn> · role: <r> · chế độ: <...>
Ảnh: observe/<file>.png — <mô tả 1 dòng>
Hành vi: <thao tác → thấy gì>
Thành phần (Mới): | thành phần | có/không | ghi chú |
Request khi mở: | endpoint | số lần | ghi chú |
Không quan sát được: <liệt kê + lý do>
```
