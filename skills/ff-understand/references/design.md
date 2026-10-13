# P2 — Design (sau Gate A)

Spec nói *cái gì*; design nói *đặt vào đâu trong code*. Mọi identifier (field, store, endpoint, `file:line`) phải verify bằng codegraph trên repo gốc vừa `sync` — tên đoán là nguồn bug phổ biến nhất.

## 1. Spec/AC sinh từ Brief
`<cards_dir>/<slug>/02-spec.md` (thẻ có task con: `task-N/02-spec.md`): YC-xx, AC-xx kiểm được ("thao tác X → thấy Y"), mỗi YC/AC có cột **Nguồn** (dòng Brief / trích dossier / quyết định user). AC không nguồn → chuyển "Cần bạn quyết" hoặc bỏ. Mỗi trạng thái rỗng/lỗi/khác quyền có AC; mỗi chức năng bị ảnh hưởng có ≥1 AC hồi quy. Spec ở tầng nghiệp vụ, không tên file/code. Mục "Ngoài phạm vi" + "Quyết định đã chốt" (trích nguyên văn) giữ như spec cũ.

## 2. `03-design.md`
**Phần 0 — Hợp đồng** (viết trước mọi phần khác; `ff-build` khóa chữ ký theo đây):
- Type, DTO, entity, chữ ký API (`/api/v1/<controller-path>`; controller không tự lặp `api`/`v1`), hằng số.
- **Hợp đồng UI:** mỗi phần tử trong AC → tên hiển thị / role / nhãn. **Không** cần `data-testid` (dùng khi cần). Màn mới dùng cùng nhãn với màn precedent.
- **Ngân sách request:** ai tải, ai cache, trần mỗi kịch bản (mở màn, Sửa/Hủy, đổi filter, mở dialog, chuyển tab) — cho màn mới **và** màn cũ bị chạm. Chặn hiệu năng từ thiết kế, không chỉ đo cuối.
- **Mục 0.5: Hợp đồng kiểm chứng Database (DB Verification Contract)** (cần cho mọi nghiệp vụ đọc/ghi dữ liệu):
  - Tham khảo và kế thừa các câu truy vấn mẫu trong thư mục `project_docs.verification_queries_dir/` (`auth.sql`, `crm.sql`, `recruit.sql`).
  - Lập bảng chỉ định rõ câu lệnh SQL SELECT kiểm chứng (chế độ READ-ONLY) và kết quả mong đợi trên DB sau mỗi thao tác người dùng:
    | Thao tác người dùng / API Trigger | Bảng & Cột bị tác động | SQL SELECT kiểm chứng (READ-ONLY) | Kết quả mong đợi trên DB |
    |---|---|---|---|
    | Vd: Admin cập nhật trạng thái Lead | `crm_customers` (`leadStatus`, `updatedAt`) | `SELECT id, "leadStatus", "deletedAt" FROM "crm_customers" WHERE id = :id;` | `leadStatus = 'QUALIFIED'`, `deletedAt IS NULL` |
  - Kiểm chứng chặt chẽ cả: soft-delete (`deletedAt`), audit timestamp, quan hệ foreign key và trạng thái dữ liệu ngầm.
- Biến env mới/đã có (mới → `.env.example` trong commit task).

**Các mục tiếp:**
1. Kiến trúc — repo/module/màn, luồng dữ liệu chính, ngắn.
2. **Mapping AC → field/file** kèm `file:line`.
3. **Deviation Register** — mở bằng Bảng Precedent (2–3 màn + quy ước app); mỗi lệch: lệch gì · precedent làm thế nào · vì sao đáng lệch (không điền được → bỏ, theo precedent). Dòng MỚI nêu nguồn.
4. Cách kiểm tra tay — 1 dòng/AC (API thuần hay qua UI) + 1 dòng hồi quy/chức năng bị ảnh hưởng.
5. **Cụm/slice** (xem 3).
6. Sau triển khai — để trống (điền hash khi ship).

## 3. Cụm/slice theo chủ file
- Slice là DAG theo phụ thuộc; phần 0 trước.
- **Quy tắc chủ file:** trong một đợt song song, mỗi file chỉ một task ghi; nhiều chỗ sửa cùng file → một agent làm tuần tự.
- **File nóng** (nhiều task đụng, rất dài, vd `JobOfferTab.tsx`): mỗi đợt một task, ghi "sonnet".
- Mỗi slice: danh sách file ghi, symbol neo, phụ thuộc (Consumes/Produces), `model` đề xuất `haiku|sonnet`.
- Thẻ Lớn: cụm theo `references/big-task.md`.

## 4. Kiểm cơ học + review
```bash
ff design-check <id> [task-N]   # file:line + identifier trong backtick có tồn tại
```
Rồi spawn `ff-design-reviewer` (sonnet; brief `${CLAUDE_PLUGIN_ROOT}/skills/ff-understand/briefs/design-review.md`, truyền spec + design + repo). Tự đối chiếu kết luận, sửa design.

## 5. Gate B
Dừng chỉ khi: có dòng MỚI trong bảng đối chiếu · lệch precedent · "Cần bạn quyết" chưa xử lý. Không thì tự ghi `> Trạng thái: GATE B TỰ QUA <ngày>` (không dùng "ĐÃ DUYỆT" — chỉ user mới duyệt) lên đầu `03-design.md` rồi bàn giao `/ff-build <id>`.
