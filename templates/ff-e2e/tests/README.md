# Playwright tests

Mỗi thẻ có thư mục riêng `tests/<id>-<slug>/` với `main-behavior.spec.ts` và `main.locators.ts`. Mỗi case tham chiếu AC trong tên test. Test của thẻ hoàn tất thuộc thư mục `e2e.done_tests_dir` (đọc bằng `ff cfg get e2e.done_tests_dir`; mặc định `<tests_dir>/task-done`).

Không bật server tự động trong Playwright. Dùng `ff verify-up <id> <app>` trước khi chạy và `ff verify-down <id>` sau đó.
