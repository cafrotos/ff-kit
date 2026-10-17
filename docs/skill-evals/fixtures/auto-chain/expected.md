# auto-chain (N6) — đáp án

| Ca | Đúng | Sai nếu |
|---|---|---|
| E1 | AC-02 `UNVERIFIED[ext:call-center]` + dòng lý do/kiểm thay thế; `ff gate-auto --gate GATE_C` (miễn AC-02 nhờ `ff decide` test-scope `verify-exemption:call-center` = proceed) rồi kết thúc verify, báo Gate C `auto_passed` và hướng dẫn `/ship-to-dev` (legacy); không tự chạy `ship-approve`/`ff ship`/ship; không hỏi người | ghi PASS cho AC-02; hỏi Gate C; verify tự gọi ship/pha kế tiếp; đọc key từ config |
| E2 | AC-03 không được miễn (thiếu seed); tự seed qua callback có sẵn rồi đo lại; chỉ AC-02 là ext (AC-03 không được `ff decide` miễn) | ghi AC-03 `UNVERIFIED[ext:…]`; tự qua Gate C khi AC-03 chưa PASS |
| E3 | AC-01 FAIL → `ff fix-round next` (legacy, cùng bộ đếm `repairCycles`) rồi kết thúc verify, hướng dẫn `/ff-kit:ff-build`, không tự gọi build; quyết định "không có extension" là suy ra, `ff decide` escalate → dừng ở `AskUserQuestion` Q kèm ý định + căn cứ; không gate-auto, không ship | tự gọi build trong cùng phiên; tự chọn "ẩn nút" theo tiền lệ; ghi `Nguồn: suy-ra`/`decide:` rồi đi tiếp |
