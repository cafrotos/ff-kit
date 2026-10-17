# Verify trên nhánh ship và Remote Control song song với tmux

Trạng thái: **đã được người dùng duyệt ngày 2026-10-17**. Bổ sung cho [spec 2026-10-15](2026-10-15-mvp-harness-design.md); phần không nêu ở đây giữ nguyên.

## A. Remote Control + tmux (giữ cả hai)

- Launcher khởi động Claude của mỗi thẻ với `--remote-control "ff-<id> <slug>"` (config `worker.driver.remote_control`, mặc định `true` khi harness bật), vẫn chạy trong tmux.
- `ff doctor` kiểm tra bản `claude` có hỗ trợ cờ này.
- Mọi notify Gate/câu hỏi/attention nêu hai đường vào phiên: (1) Claude app hoặc claude.ai/code, phiên Remote Control tên `ff-<id> <slug>`; (2) `tmux attach -t <session>`. tmux là bắt buộc cho các lệnh `!` người phải tự chạy (ví dụ `ff worker resolve`, Remote Control không chạy được).
- Channels chỉ để notify (một chiều).
- Không có lệnh "giữ": worker vẫn tự dispatch sau 15 giây yên lặng; người ngắt bằng Esc trong app.
- **Việc mở:** hành vi Remote Control với `--session-id`/`--resume` và hooks phải được kiểm bằng spike trong sandbox trước khi triển khai.

## B. Verify trên nhánh ship

### Quyết định của người dùng

- Mỗi lần verify test lại từ trạng thái sạch (không tái dùng checkout cũ).
- Lúc push chỉ re-check nhẹ (build + test unit), không chạy lại e2e.

### Luồng

1. **Chuẩn bị.** Verify bắt đầu bằng việc, trong checkout ship riêng đã có (`scripts/lib/ship.mjs`: mutex theo repo, checkpoint), tạo nhánh test **cục bộ** `ff-test/<cardId>` reset về `origin/<ship_branch>` rồi cherry-pick `-x` commit squash duy nhất của nhánh feature. Conflict thì kết quả pha là `needs_human` (chặn + notify), không bao giờ tự giải quyết. `verify-up` và e2e chạy từ checkout test này, không chạy từ worktree feature.
2. **Fail.** Vòng sửa hiện có quay về build trên nhánh feature. Trước lần push đầu, nhánh feature luôn đúng **một** commit squash (re-squash/amend ở mỗi lần sửa; được phép vì chưa push). Lần verify kế dựng lại nhánh test từ `origin/<ship_branch>` mới. Tối đa 3 vòng sửa, không đổi.
3. **Pass → Gate C → xác nhận ship → S1.** Nếu `origin/<ship_branch>` vẫn bằng base đã test: push đúng commit cherry-pick đã test. Nếu đã tiến: cherry-pick lên tip mới, chạy lệnh repo `build` + `test` (unit); sạch và xanh thì push; conflict/đỏ thì chặn `needs_human`. Sau đó push nhánh feature. S2 (PR) không đổi.
4. **Receipt verify** ràng buộc ba SHA: commit squash feature, base ship-branch đã test, commit cherry-pick đã test. Bất kỳ thay đổi nào làm bằng chứng mất hiệu lực.
5. **Sau lần push đầu** (reopen `rev-N`) quy tắc cũ giữ nguyên: mỗi lần sửa là commit mới, không viết lại lịch sử đã push.
6. **Guard không đổi:** agent không bao giờ push; nhánh `ff-test/*` chỉ ở máy.

## Thay đổi so với spec 2026-10-15

Luồng cũ verify ngay trên worktree feature và chỉ cherry-pick sang `ship_branch` ở bước ship. Nay cherry-pick xảy ra **trước verify**, nên conflict lộ sớm, và thứ được e2e chạy chính là commit sẽ được push khi base không đổi. Bước ship tái dùng commit đã test thay vì cherry-pick lại; chỉ khi base đã tiến mới cherry-pick lại và re-check nhẹ.
