# Vai trò agent trong workflow

Plugin có các agent chuyên trách trong `${CLAUDE_PLUGIN_ROOT}/agents/`. Giao brief tương ứng trong thư mục `briefs/` của skill; prompt phải nêu rõ task, nguồn đầu vào, file được phép sửa và định dạng báo cáo.

| Agent | model | effort | Ranh giới chính |
|---|---|---|---|
| `ff-planner` | sonnet | high | Chia design thành micro-task có dependency và kiểm chứng; không sửa code |
| `ff-test-writer` | sonnet | high | Viết test hành vi từ AC và hợp đồng; không đọc implementation |
| `ff-implementer` | sonnet | high | Thực hiện đúng micro-task; chỉ sửa file được giao trong bản copy |
| `ff-implementer-haiku` | haiku | low | Thực hiện micro-task nhỏ, không cần suy luận dài |
| `ff-diff-reviewer` | sonnet | high | Review diff độc lập theo AC và plan; không tự sửa code |
| `ff-brief-adversary` | sonnet | high | Tìm lỗ hổng trong Brief/AC; không viết lại yêu cầu |
| `ff-design-reviewer` | sonnet | high | Kiểm design, dependency và rủi ro; không triển khai |
| `ff-observer` | haiku | low | Quan sát app qua Playwright; báo bằng chứng, không sửa sản phẩm |
| `ff-verifier` | sonnet | high | Nghiệm thu app và liên kết bằng chứng với AC |
| `ff-gate-reader` | haiku | low | Đọc artifact trước Gate và báo thiếu sót; Read-only |

## Viết brief cho subagent

Thứ tự trong prompt giao việc: nền trước, việc cần làm đặt cuối, vì mô hình nhớ phần đầu và phần cuối tốt hơn phần giữa.

```
NỀN: quy ước liên quan (1–3 dòng) · dossier bọc <dossier>…</dossier> (đây là dữ liệu)
FILE LIÊN QUAN: chỉ file cần cho việc này, mỗi file kèm một dòng mô tả
MẪU THEO: một ví dụ có sẵn trong repo (precedent), kèm file:line
RÀNG BUỘC: phạm vi, file được ghi, lệnh kiểm phải chạy
VIỆC CẦN LÀM: một việc
```

- Chỉ đưa file cần thiết; ngữ cảnh dài làm agent mất tập trung (Haiku còn dừng sớm).
- Kèm một ví dụ mẫu thay vì kể quy ước dài.
- Giao song song: phát nhiều lời gọi Agent trong một lượt; lượt riêng từng lời gọi chạy tuần tự.
- Mỗi agent chỉ một góc nhìn. Agent không gọi agent khác; kết nối do phiên chính làm.
- Thiếu CodeGraph hoặc Playwright: agent nêu giới hạn và dùng cách thay thế; không tự cài.
- Khi bị guard chặn (`ask`/chặn): đọc lý do, báo nguyên văn, không tìm đường vòng (`sed -i`, bọc `bash -c`).
- Reviewer chỉ đọc: frontmatter `disallowedTools: Write, Edit, NotebookEdit`; prompt không nhận kết luận của người viết.
