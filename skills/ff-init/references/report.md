# Báo cáo `/ff-init`

## Đã cấu hình

Liệt kê repo, branch, lệnh, app/e2e và adapter. Mỗi mục ghi `file:line` hoặc “bạn chọn”.

## Còn thiếu

Liệt kê từng key chưa có trong `.ff.env`, mục đích của key và nơi lấy; không đọc file để tìm giá trị. Ghi lỗi doctor và cách sửa. Nếu không có, ghi “không”.

## Bước tiếp theo

Nếu worker còn thiếu key: “Điền các key trên vào `.ff.env` (agent không đọc file này), rồi gõ `/ff-worker start`.” Nếu đã đủ: “Gõ `/ff-worker start` khi muốn bật worker.” Không bật worker trong `/ff-init`.
