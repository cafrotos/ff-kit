# Kết quả từng pha cho người duyệt

Artifact là hợp đồng chi tiết cho agent. Người dùng nhận bản tổng hợp theo pha, đủ hiểu hành vi và quyết định mà không cần mở dossier, Brief hay phụ lục. Không dán nguyên file, bảng nguồn hoặc log dài vào chat/thông báo. Giữ mức chắc chắn, phạm vi và giới hạn đúng như nguồn; dẫn AC/ảnh/log ngắn khi giúp kiểm chứng.

## Packet và cách trình

1. Đọc `ff state <id> --json` để lấy `activeDir`, `activeRevision` và phạm vi hiện tại. Đọc artifact nguồn của pha dưới đây; chưa có nguồn hoặc còn placeholder thì hoàn thiện/báo thiếu, không trình kết luận như đã kiểm.
2. Lưu `<activeDir>/human-output.json` theo schema dưới đây. Cụm có thể dùng file ở gốc `activeDir` với `scope: "task-N"`. Không tự ghi hash nguồn hay quyền duyệt.
3. Chạy `ff present <id> --file <activeDir>/human-output.json` (thêm `--gate GATE_A|GATE_B|GATE_C` khi chuẩn bị Gate tương ứng). CLI ràng buộc identity/hash nguồn hiện tại, lưu presentation và kết xuất văn bản; gửi thông báo một chiều nếu có worker.
4. In nguyên phần văn bản đã render ở stdout của `ff present` vào Claude chat trước khi hỏi. Với Gate, giao một `ff-gate-reader` mới chỉ phần văn bản đó và pha; sửa nguồn/packet rồi chạy lại `present` nếu cần. Không nhờ reader cũ nhớ ngữ cảnh.
5. Hỏi các quyết định còn mở trong một lượt có bối cảnh chung, tối đa 4 câu/lượt. `AskUserQuestion` dùng header `Q<n>`, câu hỏi đã render gồm prefix `[#<id>]` và `[rev-N]`/`[task-N]` khi có, cùng nhãn/mô tả lựa chọn đã trình. Một lượt chỉ thuộc một thẻ/revision/phạm vi. Ghi câu trả lời vào ledger. Sau quyết định làm đổi nguồn, cập nhật artifact và trình packet mới trước Gate.
6. Lượt duyệt Gate vẫn riêng: header `GATE_A`, `GATE_B`, `GATE_C`, câu hỏi `[#<id>]` thêm `[rev-N]`/`[task-N]` khi có, lựa chọn `Duyệt`/`Cần sửa`; native hooks ghi receipt. Presentation và thông báo không cấp duyệt. Build chỉ báo tiến độ/bàn giao, không thêm Gate.

Thông báo không nhận câu trả lời; người dùng quyết qua CLI. Worker vắng hoặc gửi lỗi thì vẫn trình ở CLI. Timeout nghĩa là chưa biết đã giao hay chưa, không gửi lại mù. Sau thay đổi nguồn/revision phải tạo presentation mới, không tái dùng bản cũ.

## Schema version 1

- `version`: số `1`; `phase`: một pha trong bảng; `scope`: `""` cho toàn thẻ hoặc `"task-N"` cho cụm.
- `headline`: chuỗi tiêu đề nghiệp vụ; `sections`: object có đủ các chuỗi trong bảng, theo thứ tự đó. Nội dung không áp dụng vẫn giải thích ngắn, không để rỗng.
- `decisions`: mảng `{id, question, options: [{label, description}], recommendation}`; các trường là chuỗi, ID là `Q<n>` duy nhất. Không có quyết định thì `[]`. Khuyến nghị nêu lựa chọn và căn cứ; lựa chọn nêu hệ quả người dùng thấy được.
- `nextAction`: chuỗi nêu bước tiếp và có cần người dùng chọn/duyệt không.
- Có thể bỏ `taskId`/`revision`; nếu ghi, chúng phải khớp state (`revision` là null hoặc `rev-N`). CLI sở hữu identity và source hashes, không nhận hash do model viết.

| phase | sections (chuỗi, theo thứ tự) | Nguồn hiện tại |
|---|---|---|
| understand | `function`, `current`, `requested`, `target`, `impact`, `acceptance`, `uncertainty` | Brief gốc hoặc delta revision |
| design | `realization`, `differences`, `impact`, `uncertainty` | spec + design |
| build | `implemented`, `checks`, `remaining`, `readiness` | spec + design + plan |
| verify | `expectedActual`, `evidence`, `regression`, `limitations`, `conclusion` | spec + design + report |
| ship | `acceptedScope`, `destination`, `checks`, `limitations` | spec + design + report |

## Nội dung từng pha

- **Understand / Gate A:** chức năng dùng để làm gì, ai dùng và luồng chính; AS-IS đã kiểm (phân biệt nhận xét dossier); dossier xin gì; TO-BE theo role/thao tác; chỗ bị ảnh hưởng và phần giữ nguyên; ví dụ cụ thể thế nào là xong; điều chưa chắc và hậu quả. Sau đó mới gom quyết định. Nhỏ vẫn đủ các ý, có thể mỗi ý một câu. Lớn cần tổng quan toàn chức năng trước các cụm nghiệp vụ, quan hệ giữa chúng và tác động dùng chung; bảng nguồn dữ liệu không thay lời giải thích.
- **Design / Gate B có điều kiện:** cách hiện thực TO-BE bằng lời thường, điểm khác AS-IS/precedent/hợp đồng đã duyệt, ảnh hưởng đến người dùng và phần dùng chung, lựa chọn hoặc giới hạn còn lại. Không dán Type/DTO/file list. Điều kiện Gate B giữ nguyên; auto pass vẫn trình design và giải thích căn cứ, không gọi đó là user duyệt.
- **Build:** hành vi đã triển khai so với phạm vi được duyệt; lệnh kiểm thật và kết quả (phân biệt lint/type-check với test hành vi); việc còn lại/blocker; mức sẵn sàng để verify. Không gọi code xong là nghiệm thu, không thêm lượt duyệt.
- **Verify / Gate C:** lời hứa → kết quả thực tế theo nhóm AC; bằng chứng đủ định vị môi trường/role/kịch bản; hồi quy ở phần được hứa giữ nguyên; giới hạn với từng AC/tín hiệu; kết luận đạt/chưa đạt và bước cần làm. Tín hiệu không áp dụng ghi `N/A` kèm lý do. Tín hiệu bắt buộc chưa đo là `UNVERIFIED`, không phải N/A; `OBSERVATION` chỉ cho UX, không thay PASS kỹ thuật. User chấp nhận rủi ro không biến điều chưa đo thành bằng chứng thành công.
- **Ship:** phạm vi Gate C đã chấp nhận, repo/remote/branch và commit cần push, checks thật cùng giới hạn còn lại. Phân biệt yêu cầu ship với kết quả: trước push ghi đang chờ xác nhận; sau push chỉ báo đã ship khi remote đã xác minh chứa commit, kèm đích/hash/checks thực tế. Duyệt Gate C không đồng nghĩa đã ship; xác nhận ship vẫn riêng.
- **Reopen:** mọi pha dùng revision hiện tại; ở understand nêu mốc đã ship, delta so với mốc đó, phần giữ nguyên và lý do sửa. Lịch sử chỉ để đối chiếu, không ghi đè hoặc dùng report/Gate cũ thay nguồn hiện tại.

## Ví dụ: giữ bộ lọc ứng viên

```json
{
  "version": 1,
  "phase": "understand",
  "scope": "",
  "headline": "Giữ bộ lọc khi xem nhiều trang ứng viên",
  "sections": {
    "function": "Nhân viên tuyển dụng dùng danh sách ứng viên để tìm hồ sơ theo trạng thái rồi mở từng hồ sơ.",
    "current": "Đã tái hiện: chọn trạng thái Đang phỏng vấn, sang trang 2 thì bộ lọc trở về Tất cả. Chưa kiểm việc tải lại trang.",
    "requested": "Dossier yêu cầu giữ bộ lọc khi chuyển trang; đề xuất lưu vào URL là phương án, chưa phải quyết định đã chốt.",
    "target": "Chuyển trang giữ trạng thái đã chọn. Đổi trạng thái quay về trang 1 để tránh trang trống.",
    "impact": "Sửa luồng danh sách ứng viên. Giữ nguyên quyền xem hồ sơ và thao tác mở chi tiết; không đổi bộ lọc ở màn khác.",
    "acceptance": "Chọn Đang phỏng vấn, sang trang 2 vẫn chỉ thấy ứng viên thuộc trạng thái này. Chuyển sang Đã tuyển thì bắt đầu từ trang 1.",
    "uncertainty": "Dossier chưa nói có giữ bộ lọc sau tải lại trang không. Chọn giữ sẽ cần lưu trạng thái ngoài bộ nhớ màn hình."
  },
  "decisions": [
    {
      "id": "Q1",
      "question": "Có giữ bộ lọc sau khi tải lại trang không?",
      "options": [
        {"label": "Chỉ khi chuyển trang", "description": "Tải lại trang bắt đầu ở Tất cả; đáp ứng phạm vi dossier hiện tại."},
        {"label": "Cả khi tải lại", "description": "Tải lại vẫn ở trạng thái đã chọn; mở rộng yêu cầu lưu bộ lọc."}
      ],
      "recommendation": "Chỉ khi chuyển trang vì D-04 chỉ yêu cầu hành vi này; mở rộng sau khi có nhu cầu cụ thể."
    }
  ],
  "nextAction": "Chọn Q1, cập nhật Brief rồi duyệt Gate A riêng."
}
```
