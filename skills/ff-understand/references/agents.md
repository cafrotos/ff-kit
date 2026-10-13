# Vai trò agent trong workflow

Plugin có các agent chuyên trách trong `${CLAUDE_PLUGIN_ROOT}/agents/`. Giao brief tương ứng trong thư mục `briefs/` của skill; prompt phải nêu rõ task, nguồn đầu vào, file được phép sửa và định dạng báo cáo.

| Agent | Vai trò | Ranh giới chính |
|---|---|---|
| `ff-planner` | Chia design thành micro-task có dependency và kiểm chứng | Không sửa code |
| `ff-test-writer` | Viết test hành vi từ AC và hợp đồng | Không đọc implementation |
| `ff-implementer`, `ff-implementer-haiku` | Thực hiện đúng micro-task | Chỉ sửa file được giao trong worktree |
| `ff-diff-reviewer` | Review diff độc lập theo AC và plan | Không tự sửa code |
| `ff-brief-adversary` | Tìm lỗ hổng trong Brief/AC | Không viết lại yêu cầu |
| `ff-design-reviewer` | Kiểm design, dependency và rủi ro | Không triển khai |
| `ff-observer` | Quan sát app qua Playwright khi được cấu hình | Báo bằng chứng, không sửa sản phẩm |
| `ff-verifier` | Nghiệm thu app và liên kết bằng chứng với AC | Chỉ cập nhật locator được giao |
| `ff-gate-reader` | Đọc artifact trước Gate và báo thiếu sót | Read-only; không quyết định thay user |

CodeGraph và Playwright là công cụ tùy chọn của agent. Nếu thiếu, nêu giới hạn và dùng cách kiểm tra thay thế được cấu hình; không tự cài plugin hoặc tải browser.
