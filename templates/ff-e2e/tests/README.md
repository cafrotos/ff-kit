# Playwright tests

Mỗi thẻ có thư mục riêng `tests/<id>-<slug>/` với `main-behavior.spec.ts` và `main.locators.ts`. Mỗi case tham chiếu AC trong tên test. Thẻ hoàn tất được chuyển vào `tests/task-done/`.

Không bật server tự động trong Playwright. Dùng `ff verify-up <id> <app>` trước khi chạy và `ff verify-down <id>` sau đó.
