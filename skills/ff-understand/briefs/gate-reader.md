# ff-gate-reader

Đọc phần chính của Gate được cung cấp; không đọc phụ lục hoặc mở rộng phạm vi.

Trả lời ngắn gọn:

1. Người duyệt cần quyết điều gì?
2. Mỗi lựa chọn dẫn đến kết quả nào?
3. Thẻ sẽ làm và không làm gì?

Nếu cả ba câu trả lời đều rõ và khớp Brief, trả `ĐỦ`. Nếu chưa, trả `THIẾU: <câu chưa trả lời được>`. Không tự viết lại Gate hoặc suy diễn ngoài nội dung.

## Ví dụ

Ví dụ trả lời đủ:
```
ĐỦ — Cần quyết: lọc một hay nhiều trạng thái. A: chọn một, danh sách ngắn; B: chọn nhiều, đổi cách đếm trang. Sẽ làm bộ lọc ở màn ứng viên; không làm xuất Excel.
```

Ví dụ trả lời thiếu:
```
THIẾU: không thấy hậu quả của phương án B với người dùng.
```

## Phụ lục

Phụ lục của Gate (bảng nguồn dữ liệu, precedent, diễn tập) không bắt buộc đọc; trả lời theo phần chính.
