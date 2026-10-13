# Kỷ luật Bằng chứng (Proof Discipline) & Tam giác đạc (Triangulation)

> Tài liệu chuẩn mực phương pháp luận kiểm thử và nghiệm thu trong chu trình Feature-Flow (`ff-verify`), kế thừa trực tiếp từ `manual-tester` của repository `agent-skills`.

---

## 1. Triết lý cốt lõi: UI là bản kết xuất của sự thật

> **"Giao diện người dùng (UI) chỉ là một bản kết xuất (rendering) của sự thật, không phải bản thân sự thật."**

Trong hệ thống phần mềm phân tầng:
- Giao diện có thể hiển thị thông báo "Thành công", nhưng thực chất request ngầm đã thất bại (silently failed), hoặc dữ liệu chưa hề được ghi vào cơ sở dữ liệu.
- Ngược lại, một bài test UI Playwright bị lỗi timeout hoặc không tìm thấy phần tử không đồng nghĩa với việc mã nguồn bị hỏng — nguyên nhân có thể do phiên đăng nhập sai vai trò (role), dữ liệu hạt giống (seed data) chưa sẵn sàng, hoặc trang đang chuyển động animation.

Do đó, **mọi khẳng định về tính đúng đắn của tính năng cần phải dựa trên bằng chứng đa tầng độc lập**, không bao giờ được phép chỉ nhìn vào màn hình hiển thị để đưa ra phán quyết.

---

## 2. Tam giác đạc 4 tín hiệu (Triangulation Engine)

Để kết luận một Tiêu chí chấp nhận (AC) hoặc kịch bản kiểm thử, agent cần phải đối chiếu đồng thời **4 tín hiệu độc lập**:

```
                  [ 1. UI State ]
                 (Playwright / DOM)
                       /      \
                      /        \
                     /          \
   [ 2. DB State ] ------------- [ 3. Network Status ]
 (PostgreSQL db-query)           (HTTP Status & Payloads)
                     \          /
                      \        /
                    [ 4. Console ]
                 (Browser & BE Logs)
```

### Tín hiệu 1: UI State (Playwright / DOM)
- Kiểm tra trạng thái trực quan trên trình duyệt: phần tử hiển thị (`toBeVisible`), nội dung văn bản (`toHaveText`), giá trị form input, mở/đóng modal, trạng thái disabled của nút bấm.
- Xác thực URL route và tiêu đề trang sau mỗi thao tác.

### Tín hiệu 2: DB State (PostgreSQL query qua `ff db-query "<sql>"`)
- Xác thực sự thật lưu trữ vĩnh viễn trên cơ sở dữ liệu PostgreSQL (`auth_db`).
- Chạy truy vấn an toàn (chỉ đọc):
  ```bash
  ff db-query "SELECT id, status, updated_at FROM candidate WHERE email = 'test@local' LIMIT 1"
  # hoặc nạp từ file mẫu:
  ff db-query --file project_docs.verification_queries_dir/recruit.sql
  ```
- Kiểm tra số dòng thay đổi, trạng thái các trường nghiệp vụ cốt lõi (`status`, `is_active`, `deleted_at`, foreign keys) so với hợp đồng dữ liệu trong `03-design.md`.

### Tín hiệu 3: Network Status (HTTP Traffic & API Payloads)
- Giám sát mã phản hồi HTTP: 2xx (thành công), 4xx (lỗi phân quyền/dữ liệu client), 5xx (lỗi server sập).
- Soát body response: Đảm bảo payload trả về đúng schema và **không chứa thông báo lỗi ngụy trang trong mã HTTP 200 OK**.
- Đo số lượng request theo kịch bản so với trần ngân sách quy định trong `brief.md` (theo `references/measure.md`).

### Tín hiệu 4: Console Log & Error Monitoring
- **Browser Console**: Không có Uncaught TypeError, React hydration/render error, 404 tài nguyên tĩnh, MobX state invariant warning.
- **Backend Log** (`worktrees/<slug>/.dev-logs/backend.log`): Không có lỗi unhandled rejection, TypeORM query syntax error, NestJS HTTP 500 stack trace.

---

## 3. Hệ phân loại kết luận chuẩn 5 trạng thái (Verdict Taxonomy)

Mọi AC trong ma trận nghiệm thu cần phải được gán đúng 1 trong 5 trạng thái chuẩn sau:

| Trạng thái | Điều kiện xác lập | Yêu cầu bằng chứng cần |
|---|---|---|
| **`PASS`** | Tính năng hoạt động hoàn hảo trên cả 4 tín hiệu. | **Đòi hỏi bằng chứng khẳng định (Positive Evidence).**<br>*Quy tắc thép:* **"Không thấy lỗi" KHÔNG PHẢI là PASS.** Phải có bằng chứng chứng minh hành vi mong đợi đã xảy ra (UI đổi + DB cập nhật + HTTP 2xx + Console sạch). |
| **`FAIL`** | Tính năng bị lỗi logic, sai hợp đồng UI/API hoặc gây sập hệ thống. | Tái hiện $\ge 2$ lần độc lập + Runner state đã xác thực + Bằng chứng cụ thể (Screenshot + Trích dòng lỗi Network/Console/DB sai lệch). Đã hoàn thành Self-check checklist. |
| **`PARTIAL`** | Hoạt động ở luồng chính (happy path) nhưng gãy ở điều kiện biên (edge cases). | Nêu rõ biên nào đạt, biên nào gãy, dữ liệu đầu vào và thông báo lỗi phát sinh. |
| **`UNVERIFIED`** | Không thể kiểm thử do thiếu role, thiếu seed data, hoặc phụ thuộc môi trường bên thứ ba. | **Không suy diễn "không test được = code lỗi" ("Could not test it != it is broken").** Ghi rõ lý do và điều kiện thiếu vào báo cáo để User quyết định. |
| **`OBSERVATION`** | Tín hiệu cảm quan cho con người (UX, vỡ layout responsive, text tràn viền, dịch thuật gượng gạo). | Ghi nhận quan sát trực quan kèm ảnh chụp, **KHÔNG gán nhãn lỗi kỹ thuật (FAIL)**. Đưa vào mục UX Assessment để User/PO đánh giá. |

---

## 4. Self-check Checklist trước khi kết luận FAIL

Trước khi kết luận một AC là **`FAIL`** (lỗi implement của lập trình viên), agent cần phải tự rà soát và trả lời đủ 5 câu hỏi sau:

1. **Am I logged in as expected role?**
   - Tôi có đang thực thi dưới đúng role yêu cầu trong kịch bản AC không? (Kiểm tra email JWT ký qua `ff mcp-auth <email>`, đối chiếu bảng role trong `_project/environment.toml`).
2. **Right route / element?**
   - Tôi có đang ở đúng đường dẫn URL và chọn đúng vùng selector (region/dialog) không? Có phần tử con nào che khuất hoặc popup chưa đóng không?
3. **Page finished loading?**
   - Trang và mạng đã nạp hoàn tất chưa (`networkidle` / animation kết thúc)? Có bấm nút khi DOM chưa gắn listener không?
4. **Reproduce twice?**
   - Lỗi này đã được tái hiện độc lập ít nhất 2 lần chưa, hay chỉ là flakiness ngẫu nhiên do độ trễ mạng tạm thời?
5. **Seed data artifact?**
   - Sự cố có phải do dữ liệu test rác còn sót lại từ lần chạy trước (trùng email, thiếu bản ghi khóa ngoại) gây ra lỗi giả không?

> Nếu vi phạm 1 trong 5 câu trên $\rightarrow$ Điều chỉnh lại điều kiện runner và chạy lại trước khi phán quyết.

---

## 5. Hai vòng kiểm tra mở rộng (Extended Sweep)

Sau khi hoàn tất kịch bản kiểm thử cho các AC chính, agent cần phải thực hiện thêm 2 vòng kiểm tra mở rộng:

### Vòng 1: Neighborhood Sweep (Quét vùng lân cận)
- **Mục tiêu**: Phát hiện hiện tượng hồi quy tác dụng phụ (side-effect regression) trên cùng màn hình hoặc thực thể liên quan.
- **Hành động**: Thao tác từ 2 đến 3 tính năng liền kề:
  1. Chuyển qua lại các tab chức năng liền kề trên màn hình.
  2. Mở một drawer hoặc modal bên cạnh xem có bị ảnh hưởng state không.
  3. Thử nghiệm 1 bộ lọc khác hoặc thao tác phân trang xem có bị văng lỗi không.
  4. Kiểm tra các nút hành động (Edit, Delete, Export) lân cận xem có còn phản hồi bình thường không.

### Vòng 2: UX / i18n Assessment (Đánh giá giao diện & đa ngôn ngữ)
- **Mục tiêu**: Bắt các lỗi trực quan thô thiển trước khi đưa ra người dùng cuối.
- **Hành động kiểm tra**:
  1. **i18n Naked Keys**: Rà soát xem có key đa ngôn ngữ trần dạng `crm.contract.title`, `recruit.candidate.status.label`, `common.btn.save` lọt ra giao diện không.
  2. **Text Overflow & Layout Break**: Nhập text dài hoặc co giãn cửa sổ để phát hiện chữ tràn viền, đè lên icon, hoặc vỡ layout flex/grid.
  3. **Loading & Empty States**: Khi danh sách chưa có dữ liệu, kiểm tra xem có hiển thị Empty state chỉn chu không (hay để bảng trống toác), và khi gọi API có hiển thị skeleton/spinner mượt mà không.
