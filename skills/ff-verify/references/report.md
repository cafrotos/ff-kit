# Khuôn báo cáo cuối — `<activeDir>/05-verify-report.md`

Đây là gate nghiệm thu (spec §5.2). Báo cáo tuân thủ nghiêm ngặt **Kỷ luật Bằng chứng (Proof Discipline)** và **Tam giác đạc (Triangulation)** từ `references/proof-discipline.md`. Viết tiếng Việt, mỗi mục súc tích; mục không có nội dung ghi "không". Ảnh lưu trong `<activeDir>/verify/<role>/`, dẫn bằng đường dẫn tương đối.

```markdown
# Báo cáo verify — <id>-<slug> (<task-N nếu có>)
> Revision: <activeRevision: null hoặc rev-N> · Ngày <…> · bản copy `<worktrees_dir>/<slug>` · commit <hash ngắn mỗi repo> · app <app>
> Kết luận: ĐẠT | CHƯA ĐẠT (lý do 1 dòng)

## 1. Ma trận AC theo 4 tín hiệu (Triangulation Matrix)
<dán output `ff ac-matrix <id> [task-N]`>
- Manifest hiện tại: `<testLock từ state JSON>`; đối chiếu manifest gốc khi chạy hồi quy.
- Hash manifest: `<8 ký tự đầu>` (so với số đã in lúc ff-build)
- `<log tương ứng testLock hiện tại>`: <dán nguyên văn>. Có dòng không do user duyệt → **ĐỎ**.
- Kết quả chạy Playwright: `<lệnh Playwright từ config với test path e2e.tests_dir/slug>` → <n> pass / <n> fail / <n> skip (skip = NOT RUN).

| AC | UI State (Playwright) | DB Query Result (SQL) | Network Status (HTTP) | Console Log | Verdict |
|---|---|---|---|---|---|
| AC-01 | <phần tử hiển thị, text đúng> | <db-query: dòng/trường đúng> | <HTTP 200, payload sạch> | <console sạch, BE log sạch> | PASS |
| AC-02 | <phần tử không xuất hiện> | <db-query: không đổi> | <HTTP 500 / error> | <Uncaught TypeError> | FAIL |

*Hệ phân loại Verdict: `PASS` | `FAIL` | `PARTIAL` | `UNVERIFIED` | `OBSERVATION` (theo `references/proof-discipline.md`). "Không thấy lỗi" KHÔNG PHẢI là PASS.*

## 2. Neighborhood Sweep (Quét tính năng lân cận)
| Tính năng / Thao tác lân cận | Hành vi quan sát được | Trạng thái hồi quy (Đạt / Gãy) |
|---|---|---|
| Chuyển tab liền kề | Chuyển mượt mà, giữ nguyên dữ liệu | Đạt |
| Drawer / Modal bên cạnh | Mở/đóng bình thường, không xung đột state | Đạt |
| Bộ lọc / Phân trang | Lọc chính xác, phân trang không văng lỗi | Đạt |

## 3. UX & i18n Assessment (Đánh giá giao diện & đa ngôn ngữ)
- **i18n Naked Keys**: <Không phát hiện key trần | Danh sách key lọt: `crm.contract...`>
- **Text Overflow & Layout Break**: <Bố cục responsive nguyên vẹn | Phát hiện tràn viền tại:...>
- **Loading & Empty States**: <Skeleton/Spinner mượt mà, Empty state chỉn chu | Lỗi:...>
- **Quan sát cảm quan khác (OBSERVATION)**: <Ghi nhận nếu có (font, khoảng cách, dịch thuật gượng gạo)>

## 4. Ảnh màn mới theo role (cạnh precedent)
| Màn | Role | Màn mới | Màn precedent |
|---|---|---|---|

## 5. Đo lường Request & Truy vấn DB
### 5.1 Request theo kịch bản (so với trần ngân sách Brief)
| Kịch bản | Endpoint (method path) | Số lần | Trần Brief | Kết quả (Đạt/ĐỎ) |
|---|---|---|---|---|

### 5.2 Đối soát trạng thái DB (State Verification qua `db-query`)
| Thao tác | Câu truy vấn `db-query` | Trạng thái DB trước | Trạng thái DB sau | Kết quả đối soát |
|---|---|---|---|---|

### 5.3 Truy vấn DB ORM / Thời gian mỗi endpoint (nếu đo được theo `references/measure.md`)
<bảng: endpoint | số request | truy vấn/request (min–max) | ms (min–max)> hoặc "chưa đo số truy vấn DB (<lý do>)".

## 6. e2e-lint (`--strict`)
<dán output `ff e2e-lint <e2e.tests_dir>/<slug> --strict`; đếm force/dispatchEvent/skip/catch/waitForTimeout>

## 7. Lỗi implement
- <màn/AC> · hợp đồng nói (trích `03-design.md`) · thực tế (ảnh/log/DB) · slice/file nghi ngờ

## 8. Chưa kiểm (UNVERIFIED)
- <liệt kê rõ: role/AC/kịch bản không chạy được và vì sao: thiếu role, seed data, hay phụ thuộc dịch vụ ngoài>

## 9. Cần bạn quyết
- <mặc định đã chọn> · đề xuất sửa test (diff `expect` + lý do + trích AC) · quyết định về các mục UNVERIFIED · env đã thêm (`.env.local`: biến nào)
```

### Quy tắc kết luận tổng
**ĐẠT** chỉ khi đáp ứng đồng thời tất cả các điều kiện sau:
1. Mọi AC đều có verdict `PASS` (hoặc `OBSERVATION` đã ghi chú rõ), không có `FAIL` hay `PARTIAL`.
2. Mọi mục `UNVERIFIED` (nếu có) phải được giải trình rõ nguyên nhân khách quan và được User chấp thuận trong "Cần bạn quyết".
3. Không có test nào bị `skip` hoặc `NOT RUN`.
4. `ff e2e-lint --strict` sạch sẽ hoàn toàn.
5. Mọi kịch bản request $\le$ trần ngân sách quy định trong `brief.md`.
6. Hash manifest test khớp chính xác, log `<log tương ứng testLock hiện tại>` không có can thiệp trái phép.
7. Không có lỗi implement chưa giải quyết.
8. Neighborhood Sweep xác nhận không gây hồi quy tính năng lân cận.

*"PASS một phần" hoặc vi phạm bất kỳ điều kiện nào trên = **CHƯA ĐẠT**.*

---

## Biến thể Reopen (`rev-N/`, spec §5.4 R7)
Thêm sau mục 1, trước mục 2:

```markdown
## 1b. Theo từng phiếu
| # | Phiếu (nguồn/ngày) | Ngả | Test tái hiện (trước → sau) | Bộ hồi quy | Ảnh trước / sau |
|---|---|---|---|---|---|
```
- "Trước" = kết quả test tái hiện trên mốc đã ship (fail), "sau" = trên bản sửa (pass); kèm đường dẫn ảnh.
- Bộ hồi quy: các AC cũ liên quan — số pass/fail.
- Mục 5 đo lại request cho các kịch bản của màn bị chạm, so trước/sau.

### Phiếu ngả A (phạm vi đã duyệt trong delta hiện tại)
Liệt kê riêng để user quét nhanh:
| # | Câu AC trích nguyên văn (`task-N/AC-xx`) | Kết quả sau sửa có đúng câu đó? |
|---|---|---|
Hunk/hành vi vượt ngoài câu trích → phiếu chuyển B, ghi vào "Cần bạn quyết", báo CHƯA ĐẠT.
