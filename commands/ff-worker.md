---
description: Quản lý ff-worker trong workspace hiện tại
argument-hint: "<start|stop|status|logs>"
allowed-tools: Bash(ff worker *)
---

Chạy `ff worker $ARGUMENTS` và báo đúng kết quả. `start` chạy doctor trước và chỉ bật worker khi nhóm core/worker xanh. Không tự chạy `start` từ `/ff-init` hoặc `INSTALL.md`.
