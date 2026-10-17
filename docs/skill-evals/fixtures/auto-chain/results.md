# auto-chain — kết quả (2026-10-20, phiên Claude, Sonnet effort low, 1 lần/ca, skill bản làm việc N6)

| Ca | Kết quả | Quan sát |
|---|---|---|
| E1 | Đạt | AC-02 `UNVERIFIED[ext:call-center]`, gate-auto → ship-approve --auto → ff ship; không AskUserQuestion |
| E2 | Đạt | AC-03 không miễn; tự seed qua `POST /api/calls/callback`. Lưu ý: `curl` không có trong allowed-tools → sẽ bật hộp xin quyền |
| E3 | Đạt | fix-round 1/3 → build → Q1 "[#501] Nhân viên chưa có extension…" kèm căn cứ CRM + 2 thẻ cũ; dừng, không gate-auto |

Lưu ý (R1/R2, 2026-10-23): kết quả trên là của bản N6 cũ (skill tự chuyển pha, miễn theo `verify.unverifiable_external`). Fixture/expected đã đổi theo hành vi mới (không tự chuyển pha, miễn qua `ff decide`); CHƯA chạy lại eval, cần chạy lại E1-E3.

Chỉ có bản mới (tính năng mới, không có bản cũ để so cặp).

# Bảng nhãn chuẩn

Tính năng mới, chưa có bản A để so cặp và CHƯA chạy lại sau R1/R2 → chưa gắn nhãn.

| Ca | A (hiện tại) | B (vá) | Nhãn |
|---|---|---|---|
| E1 | — | (chưa chạy lại) | — |
| E2 | — | (chưa chạy lại) | — |
| E3 | — | (chưa chạy lại) | — |
