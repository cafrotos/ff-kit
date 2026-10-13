---
name: ff-verify
description: Dùng sau khi task đã squash và test hành vi đã khóa; chạy nghiệm thu trên app cấu hình, ghi báo cáo Gate C và chỉ ship sau khi user xác nhận.
argument-hint: "[id | slug]"
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(ff cfg get *), Bash(ff state *), Bash(ff doctor *), Bash(ff squash-check *), Bash(ff e2e-auth-check *), Bash(ff verify-up *), Bash(ff verify-down *), Bash(ff verify-lock *), Bash(ff ac-matrix *), Bash(ff e2e-lint *), Bash(ff db-query *), Bash(ff ship-request *), Bash(ff mcp-auth *)
---

Đọc `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/rules.md` trước khi làm.

# ff-verify

Kiểm tra điều kiện → chạy môi trường → nghiệm thu AC bằng bằng chứng → Gate C → dừng chờ user xác nhận ship.
Không sửa code sản phẩm hoặc `expect` trong test khóa.

## P0 — Điều kiện vào

Chạy `ff doctor` và `ff state <id>`. Nhóm core/e2e phải xanh; task phải qua Gate A/B, có worktree/squash-check và test lock. Nếu thiếu, hướng dẫn `/ff-build` hoặc sửa config qua `/ff-init`.

Lấy app, URL, auth, repo lệnh và query từ `ff.config.yaml`. User test và role lấy từ Brief; không dùng tài khoản hay URL mặc định.

## P1 — Môi trường và xác thực

Chạy `ff e2e-auth-check --email <email-theo-brief>`. Nếu cần, dùng `ff mcp-auth --email <email>` theo cấu hình auth. Không đọc hoặc in token/storage-state.

Khởi động môi trường bằng `ff verify-up <id> <app>`; xác nhận health check và lock. Nếu cần verify lock từ thao tác khác, dùng `ff verify-lock acquire|release <slug>`. Không force-release lock đang thuộc task khác.

Giao `ff-verifier` theo `briefs/bind-verify.md` để gắn locator và đo app thật. Chỉ cho phép sửa locator theo `references/bind-locators.md`.

## P2 — Chạy và đo

Chạy Playwright test theo `e2e.tests_dir` và `e2e.playwright_config`; lệnh lấy từ config. Chạy `ff ac-matrix <id>` và `ff e2e-lint <path> --strict`.

Theo `references/proof-discipline.md` và `references/measure.md`: mỗi AC ghi UI, network, console và DB khi có thể kiểm. DB chỉ truy vấn SELECT/EXPLAIN bằng `ff db-query`; query mẫu nằm trong `project_docs.verification_queries_dir`. Ghi `UNVERIFIED` khi thiếu điều kiện, không đổi thành FAIL nếu chưa có bằng chứng.

Thực hiện Neighborhood Sweep và đánh giá UX/i18n theo report template. Không sửa `expect`; nếu test có vẻ sai, nêu bằng chứng và chờ user quyết định.

## Gate C

Ghi `05-verify-report.md` theo `references/report.md`, liên kết AC với `D-xx`/`U-xx`, lưu bằng chứng và phần chưa kiểm. Chạy lại `ff trace-check <id>`.

Hỏi các quyết định còn lại bằng `AskUserQuestion` header `Q<n>` trước. Sau đó trình Gate C riêng bằng header `GATE_C`, câu hỏi `[#<id>]`, lựa chọn `Duyệt`/`Cần sửa`. Hook giữ bản ghi và hash; không tự ghi marker duyệt.

Kết thúc môi trường bằng `ff verify-down <id>`. Nếu Gate C chưa được user duyệt, báo cáo kết quả và dừng.

## Ship

Chỉ sau khi có Gate C `Duyệt`, trình tóm tắt qua `ff ship-request` rồi làm theo `/ship-to-dev`. Lệnh `ff ship-approve` cần xác nhận riêng từ user. Không push trước khi user xác nhận.
