# ff-kit

Plugin workflow và CLI `ff` cho workspace nhiều repository: hiểu yêu cầu, triển khai trong worktree, kiểm chứng theo AC và quản lý worker tùy chọn.

## Bắt đầu

Xem [INSTALL.md](INSTALL.md) để cài plugin và thiết lập workspace. Cấu hình do `/ff-init` tạo trong `ff.config.yaml`; chạy `ff doctor` để kiểm tra. `ff doctor` không đọc giá trị secret. Worker chỉ chạy sau khi người dùng cấu hình key và gọi `/ff-worker start`.

Các skill chính: `/ff-understand`, `/ff-build`, `/ff-verify`. CLI đầy đủ: `ff help`. Các component plugin được tự phát hiện từ `skills/`, `agents/`, `commands/` và `hooks/`.

## Phát triển ff-kit

Yêu cầu Node.js theo `package.json`.

```sh
npm install
npm test
npm run build
```

## Giới hạn

Plugin không thay quyết định người dùng ở các Gate, không tự ship/push và không tự bật worker. Adapter worker được cấu hình riêng; Playwright và CodeGraph là công cụ tùy chọn.
