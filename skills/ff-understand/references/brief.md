# P1 — Hiểu yêu cầu → Brief

Đơn vị phân tích = **từng mục dossier** (Mô tả + từng dòng Checklist). Mỗi mục **một** nhãn. Không có nhãn "chuyển hardcode → config": nó tự lộ ra ở cặp Trước→Sau.

## Khuôn ledger

Tạo `01b-ledger.md` trước khi đọc code. Mỗi dòng/câu của dossier một mã `D-xx`.
Cột Ghi chú cho biết loại: `sự kiện` · `giả thuyết` · `giải pháp` · `quyết định` · `bỏ: <lý do>`.

```markdown
# Ledger thẻ 123
| Mã | Trích nguyên văn | Vị trí | Ghi chú |
|---|---|---|---|
| D-01 | Danh sách ứng viên mất bộ lọc khi chuyển trang. | Mô tả | sự kiện |
| D-02 | Chắc do state bị reset trong component danh sách. | Mô tả | giả thuyết |
| D-03 | Cần lưu bộ lọc vào URL. | Mô tả | giải pháp |
| D-04 | Giữ bộ lọc khi chuyển trang | Checklist #1 | quyết định |
| D-05 | 🔄 Sync từ sheet row 77 | Comment 1 | bỏ: bookkeeping |

## Quyết định của bạn
| Mã | Câu hỏi | Đáp án | Ngày |
|---|---|---|---|
| U-01 | Giữ bộ lọc khi tải lại trang? | Có | 2026-10-13 |

## Ngoài phạm vi
- D-05
```

Luật: trích trùng nguyên 1 dòng hoặc 1 câu dossier; mọi dòng/câu dossier có mặt (trừ mục Tiêu đề, Branch, Loại, Thông tin tiếp nhận, Comments); `bỏ:` chỉ cho các mục được miễn; mọi bảng trong artifact có cột `Nguồn` chứa `D-xx`/`U-xx` (trừ bảng dưới `## Phụ lục`).

## Tách sự kiện, giả thuyết, giải pháp

Dossier thường gói ba thứ vào một câu ("bán chậm vì giá cao, cần giảm giá"). Chỉ `sự kiện` làm nền cho Brief. `giả thuyết` đi vào Nhật ký giả thuyết (Phụ lục), nhãn `[chưa kiểm]` đến khi có bằng chứng. `giải pháp` đưa vào "Phương án có sẵn" của design để cân nhắc sau khi biết nguyên nhân gốc; không bỏ đi vì giải pháp của người giao thường đúng, chỉ không được chen hàng trước chẩn đoán.

## Nhật ký giả thuyết

Đặt trong Phụ lục của Brief. Chỉ ghi giả thuyết mà nếu sai thì Brief hoặc design đổi. Không ghi mọi điều nghi ngờ.

```markdown
| Mã | Giả thuyết | Nguồn | Độ chắc | Hệ quả nếu sai | Cách kiểm rẻ nhất | Trạng thái |
|---|---|---|---|---|---|---|
| A1 | State bị reset khi chuyển trang | D-02 | trung bình (0.55) | Sửa nhầm component | Đặt log ở `file:line` rồi chuyển trang | mở |
```

Nhãn trong cây chẩn đoán: `[đã kiểm — nguồn]` (user xác nhận từ hiểu biết trực tiếp, hoặc dữ liệu đã chạy) và `[chưa kiểm]`. Độ chắc dùng dải: rất cao 0.90–1.00 · cao 0.75–0.89 · trung bình 0.50–0.74 (vùng nguy hiểm, kiểm trước khi làm) · thấp 0.25–0.49 · rất thấp <0.25. Sau khi kiểm, ghi thêm dòng `Kết quả` dưới mục cũ, không tạo mục trùng; độ chắc giảm là tiến bộ. Giả thuyết user không muốn kiểm ghi thành "chấp nhận rủi ro" tường minh.

## 1. Đọc dossier
Đọc toàn bộ `01-dossier.md`. **Lọc comment:** mỗi comment tự hỏi "nêu quyết định/ràng buộc nghiệp vụ, hay chỉ ghi chú đồng bộ (sync sheet, ngày đồng bộ, mapping row)?" Bookkeeping → bỏ (vd `🔄 Sync từ sheet … row 77` — bookkeeping thuần). Chỉ comment quyết định thật (có ngày chốt, phương án đã chọn) mới vào Brief, trích nguyên văn kèm tác giả/ngày.

## 2. Nhãn theo từng mục
| Nhãn | Đầu vào bắt buộc | Cách thu thập | Đầu ra |
|---|---|---|---|
| **Fix bug** | Triệu chứng (Symptom), giả thuyết cạnh tranh nếu chưa rõ nguyên nhân, phép thử phản chứng | Tái hiện qua Playwright/browser; Tam giác đạc (Code - DB - Runtime); query `project_docs.verification_queries_dir` | Khung chẩn đoán xác nhận nguyên nhân gốc; test tái hiện (fail trước, pass sau); sửa tối thiểu |
| **Nâng cấp** | hiện trạng thật; chỗ khác đọc cùng dữ liệu | `ff-observer` chụp màn hiện tại; codegraph | Trước→Sau; bất biến "phần không đổi giữ nguyên"; AC hồi quy |
| **Mới** | 2–3 màn đã làm việc tương tự | `ff-observer` chạy màn precedent; codegraph tìm component tái dùng | bảng đối chiếu thành phần (giống / lệch / MỚI + nguồn) |

Task là tập các mục (thẻ 123 = Nâng cấp + Mới).

### Khung chẩn đoán lỗi cho nhãn "Fix bug" (Hypothesis Diagnosis Framework)
Bug Nhỏ đã tái hiện, nguyên nhân trực tiếp có bằng chứng thì ghi triệu chứng → nguyên nhân → test hồi quy. Khi nguyên nhân chưa rõ hoặc có nhiều cách giải thích, áp dụng ba bước sau trước khi chốt:
1. **Triệu chứng (Symptom)**:
   - *Role*: Người dùng thuộc role nào gặp lỗi (đối chiếu `project_docs.roles_file`).
   - *Bước tái hiện*: Trình tự thao tác chính xác từng bước dẫn đến lỗi.
   - *Dữ liệu*: Bản ghi cụ thể bị lỗi (ID, payload gửi đi, câu lệnh SQL SELECT kiểm tra trạng thái bảng liên quan từ `project_docs.verification_queries_dir`).
2. **Cây giả thuyết (Hypothesis Tree)**:
   - Xây dựng **ít nhất 2 giả thuyết độc lập** về nguyên nhân gốc rễ, phân loại theo các nhóm:
     * *Code logic*: Xử lý điều kiện sót, mapping sai field, promise/async thiếu `await`, lỗi tính toán.
     * *Data state*: Dữ liệu DB bẩn/null, foreign key không hợp lệ, enum cũ chưa migrate, soft-delete chưa lọc.
     * *Race condition / Timing*: Hai request đồng thời ghi đè, debounce thiếu, re-render cycle trong React.
     * *Config / Env*: Thiếu biến môi trường, sai cấu hình CORS/cookie, lệch quyền hạn trong JWT.
3. **Thử nghiệm phản chứng (Falsification Check)**:
   - Thiết kế phép thử nhanh để cố gắng **bác bỏ** từng giả thuyết (kiểm tra log server, query SQL SELECT kiểm tra trạng thái DB, đặt breakpoint hoặc so khớp code).
   - Chỉ kết luận nguyên nhân gốc khi đã loại trừ các giả thuyết khác bằng bằng chứng rõ ràng (Proof Discipline).

**Khoanh vùng Là / Không là** trước khi dựng cây: bảng 4 dòng Ở đâu / Khi nào / Ai hoặc cái gì / Dạng nào, hai cột Là và Không là. Khác biệt giữa hai cột là ứng viên nguyên nhân; thay đổi trùng thời điểm khởi phát cũng là ứng viên. Bảng chỉ khoanh vùng, chưa kết luận.

**Bảng kiểm** cho mỗi ứng viên: `Nếu đúng thì sẽ thấy…` · `Cách kiểm rẻ nhất` · `Kết quả`. Khi chưa rõ nguyên nhân, giữ ít nhất hai ứng viên cạnh tranh; ưu tiên phép thử phân biệt giữa hai ứng viên hơn phép thử chỉ xác nhận một.

**Phép thử dừng:** "sửa nguyên nhân này thì lỗi có hết tái diễn không?". Không chắc có thì đó mới là nguyên nhân góp phần; đi tiếp.

**Nguyên nhân gốc dừng ở quy trình, không dừng ở người.** Chuỗi kết thúc ở "ai đó quên" thì hỏi thêm vì sao một lần quên gây hậu quả lớn vậy.

**Mỗi phương án sửa nêu nguyên nhân gốc nó xử lý.** Phương án chỉ chữa triệu chứng thì gắn nhãn "chữa triệu chứng" và đi kèm một phương án xử lý nguyên nhân; không trình như bản sửa.

**Điều kiện quay lại:** ghi sẵn "nếu sau khi sửa mà chỉ số X vẫn chưa đổi thì chẩn đoán sai; quay lại các giả thuyết còn `[chưa kiểm]`", để ff-verify biết quay về đâu thay vì vá thêm.

- Không bịa sự thật về hệ thống của user: thiếu dữ kiện thì hỏi hoặc ghi `[chưa kiểm]`.

## 3. Cặp Trước → Sau
Mỗi mục: "**Trước:** X do *ai/cái gì* quyết định. **Sau:** X do *ai/cái gì* quyết định." Vd: Trước: mẫu HĐ theo chức danh do `if` trong code quyết. Sau: admin cấu hình, lưu DB. Fix: Trước = hành vi sai, Sau = đúng.

## 4. Bảy câu hỏi (mọi mục)
1. Dữ liệu nào đổi vai trò; nguồn **duy nhất** của nó ở đâu?
2. Chỗ nào khác đang đọc cùng dữ liệu?
3. Thứ gì đã làm đúng việc này ở nơi khác (để mirror)?
4. Kịch bản role × thao tác nào chạy qua nó?
5. Mỗi lần mở màn/thao tác, dữ liệu tải mấy lần, từ đâu (dùng chung/cache)?
6. Dữ liệu cần quyền gì để đọc; lỗi/rỗng thì người dùng thấy gì? **Không dùng `catch → []` im lặng.**
7. Có bản chép tay nào ở FE/BE không (hằng số, bảng map)?

Task không có dữ liệu cấu hình/dropdown → ghi "không áp dụng" từng câu kèm lý do ngắn.

## 5. Khảo sát code (Codegraph trước)
- Màn dossier nhắn = app › menu › màn nào, component nào, endpoint nào. Tìm theo nhãn tiếng Việt; nhiều màn khớp → liệt kê, chọn 1, ghi "Tự quyết".
- Ai gọi/đọc/ghi mỗi symbol sẽ sửa (cả app khác, FE↔BE). Symbol dùng chung → mặc định thêm lựa chọn opt-in.
- Bảng Precedent: (a) 2–3 màn tương tự (hành vi + `file:line`); (b) quy ước app: API client, nơi đặt hằng số, phân quyền/scope.
- Thẻ cũ: `git -C <repo> log --format=%B -- <file> | grep -o 'Trello: #[0-9]*'`; `grep -l '<tên>' <cards_dir>/task-dones/*/0[23]-*.md`; chỉ đọc "Quyết định đã chốt" + "Ngoài phạm vi". Tài liệu cũ lệch code → theo code, ghi chênh lệch vào "Tự quyết"/phụ lục.
- Hiểu sai màn thì mọi AC phía sau sai: tìm màn theo nhãn tiếng Việt của dossier, không đoán theo keyword.
- Dossier không đủ để suy và đoán sai gây rework lớn → hỏi 1 câu ngắn (bằng chứng + khuyến nghị), nhưng **chỉ sau khi** khảo sát xong, kể cả tra thẻ cũ. Còn lại cứ viết Brief; Gate A là chỗ user sửa. Khoảng trống dossier không nói thì đi theo khuôn THIẾU YÊU CẦU bên dưới, không theo cỡ rework.

## 6. Quan sát và diễn tập
- Giao `ff-observer` theo `briefs/observe.md` (Fix/Nâng cấp: màn hiện tại; Mới: màn precedent). Ảnh + mô tả hành vi + request mạng khi mở màn.
- **Diễn tập** 5–8 tình huống role × thao tác "trên giấy" qua mô hình đích (vd "admin chỉ có quyền màn email mở dropdown"). Ghi kết quả vào phụ lục.

## Làm rõ yêu cầu
- Mỗi câu "Cần bạn chọn" kèm `Khuyến nghị` và căn cứ (câu hỏi không có khuyến nghị là khảo sát, không phải cam kết).
- Dossier dùng từ khái quát làm mục tiêu ("nhanh hơn", "gọn", "dễ dùng", "hiện đại") thì hỏi một câu về ngưỡng cụ thể ở `Q<n>` ("nhanh hơn" nghĩa là dưới mấy giây ở màn nào?). Hỏi thêm: "nếu không phải biện minh với ai thì bạn thực sự muốn gì?" khi câu trả lời nghe như lời khuyên thực hành tốt chứ không phải mong muốn.
- Đổi yêu cầu mơ hồ thành tiêu chí kiểm được trước khi viết AC.
- "Tự quyết" là danh sách giả định, ghi rõ để user sửa ở Gate: mỗi dòng kèm căn cứ.

## 7. Khuôn `brief.md` trang 1 (≤1 trang)

```markdown
> Trạng thái: CHỜ DUYỆT
# Brief <id> — <tên>
Cỡ: Nhỏ|Vừa|Lớn (lý do 1 dòng) · Nhánh: <từ dossier> · Repo: <tên cấu hình>

## Chức năng và hiện trạng
<Chức năng để làm gì, ai dùng, luồng chính; AS-IS đã kiểm và nguồn. Nhận xét dossier chưa kiểm ghi rõ.>

## Thẻ yêu cầu gì
- "<trích nguyên văn>" — D-01

## Tôi hiểu là
| Ý (lời thường, không từ nội bộ) | Nguồn |
|---|---|
| … | D-01 |

## Sẽ làm
| Việc | Nguồn |
|---|---|

## Không làm
| Việc | Lý do | Nguồn |
|---|---|---|

## Hành vi đích và thế nào là xong
<TO-BE theo role/thao tác; ví dụ đầu vào → kết quả; tác động dùng chung và điều chưa chắc.>

## Cần bạn chọn
### Q1. <câu hỏi>
Bối cảnh: <1–2 câu>
- Phương án A: <hệ quả người dùng/nghiệp vụ thấy được>
- Phương án B: <hệ quả>
Khuyến nghị: <A|B> vì <căn cứ file:line hoặc D-xx>

## Phụ lục
(không bắt buộc đọc) §1 Các mục dossier · §1.1 Chẩn đoán Fix · Nhật ký giả thuyết · §2 Nguồn dữ liệu duy nhất · §3 Bất biến (≤5, kèm `file:line`) · §4 Đối chiếu thành phần với precedent · §5 Ngân sách request · Tự quyết (kèm căn cứ) · Ngoài phạm vi · Diễn tập role × thao tác
```

"Không làm" luôn có mặt, kể cả khi chỉ ghi "Không có việc nào bị loại ngoài dossier", vì bất đồng ngầm về điều không làm chiếm một nửa các lần hiểu lệch. Mỗi khối "Cần bạn chọn" map 1:1 sang một câu `AskUserQuestion`. Bất biến "giữ như cũ" phải trích `file:line` chứng minh code hôm nay làm vậy; không trích được là hành vi MỚI, chuyển sang "Cần bạn chọn".

## Khuôn restate

Artifact giữ nguồn và hợp đồng cho agent. Bản restate cho người duyệt là packet `understand` theo `${CLAUDE_PLUGIN_ROOT}/references/human-output.md`; tổng hợp đủ bối cảnh trước quyết định, không dán Brief hoặc phụ lục.

## Khuôn MƠ HỒ

Dossier mâu thuẫn với code hoặc nhiều nghĩa:

```
MƠ HỒ: "<trích D-xx>" nhưng `file:line` làm khác.
Cách hiểu A: … · Cách hiểu B: … · Cách hiểu C: hỏi, vì có vẻ là quyết định cố ý.
Hậu quả mỗi cách: …
Khuyến nghị: <A|B> vì <căn cứ>
```

Dossier không nói về một tình huống:

```
THIẾU YÊU CẦU: dossier không nói <tình huống>.
Chạm cái đang có: <không | có: bản ghi/luồng nào bị từ chối, chặn hoặc ghi đè, kèm số liệu>
Căn cứ code cùng miền: <file:line | không có | mâu thuẫn: file:line ↔ file:line>
Loại: <kỹ thuật | luật nghiệp vụ>
```

Điền đủ bốn dòng rồi chọn theo dòng đầu tiên khớp:
1. "Chạm cái đang có: có" → "Cần bạn chọn" (ranh giới 1), kể cả khi dossier đã xin quy tắc đó.
2. Căn cứ "mâu thuẫn" → khối `MƠ HỒ` → "Cần bạn chọn", kể cả khi sửa rẻ hoặc đa số căn cứ nghiêng một phía.
3. Có căn cứ cùng miền → "Tự quyết", trích đúng `file:line` đã đọc.
4. Không có căn cứ, loại luật nghiệp vụ (tuổi, hạn mức, trạng thái, ai được làm) → không thêm luật; "Tự quyết: luật nghiệp vụ chưa có, không thêm". Luật tương tự ở miền khác chỉ ghi làm tham khảo.
5. Không có căn cứ, loại kỹ thuật → hỏi; không tự bịa yêu cầu.

"Cùng miền" = cùng module/màn/loại dữ liệu với chỗ sắp sửa. `ff trace-check` báo đỏ khi một `file:line` trong Brief không tồn tại.

Khối `MƠ HỒ` đi vào Brief thành một khối "Cần bạn chọn". Việc có hỏi hay không theo 4 ranh giới trong `rules.md`.
