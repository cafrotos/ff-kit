# Vai trò agent trong workflow

Plugin có các agent chuyên trách trong `${CLAUDE_PLUGIN_ROOT}/agents/`. Giao brief tương ứng trong thư mục `briefs/` của skill; prompt phải nêu rõ task, nguồn đầu vào, file được phép sửa và định dạng báo cáo.

| Agent | Skill/điểm gọi | Brief |
|---|---|---|
| `ff-planner` | `ff-build`, sau khi khóa test | `skills/ff-build/briefs/planner.md` |
| `ff-test-writer` | `ff-build`, trước khi có code | `skills/ff-build/briefs/test-writer.md` |
| `ff-implementer` | `ff-build`, micro-task Sonnet | `skills/ff-build/briefs/implement-micro.md` |
| `ff-implementer-haiku` | `ff-build`, micro-task Haiku | `skills/ff-build/briefs/implement-micro.md` |
| `ff-diff-reviewer` | `ff-build`, sau mỗi đợt | `skills/ff-build/briefs/diff-review.md` |
| `ff-brief-adversary` | `ff-understand`, phản biện Brief | `skills/ff-understand/briefs/adversary.md` |
| `ff-design-reviewer` | `ff-understand`, review design | `skills/ff-understand/briefs/design-review.md` |
| `ff-observer` | `ff-understand`, quan sát app | `skills/ff-understand/briefs/observe.md` |
| `ff-verifier` | `ff-verify`, nghiệm thu app | `skills/ff-verify/briefs/bind-verify.md` |
| `ff-gate-reader` | `ff-understand` / `ff-verify`, trước Gate | `skills/ff-understand/briefs/gate-reader.md` |

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
