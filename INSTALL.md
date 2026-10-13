# Cài đặt ff-kit vào workspace

Thực hiện trong workspace mục tiêu; các bước đặc quyền hoặc tải dependency/browser cần user xác nhận theo môi trường của họ.

## Điều kiện

- Node.js theo phiên bản tối thiểu ghi trong `package.json`, Git và Claude Code có hỗ trợ plugin.
- Workspace có `CLAUDE.md` (nếu chưa có, chạy `/init`) và một repo Git. Có thể dùng bộ e2e hiện có hoặc tạo `ff-e2e/` bằng `ff e2e-scaffold`.
- `tmux` chỉ cần khi muốn chạy worker nền. Thiếu thì worker không thể khởi động; các skill thủ công vẫn dùng được.

## Cài plugin

Thêm ff-kit từ marketplace hoặc nguồn plugin nội bộ theo hướng dẫn Claude Code đang dùng, rồi cài plugin `ff-kit` và nạp lại phiên. Tên marketplace/URL phụ thuộc nơi bạn lấy plugin; không chạy lệnh cài đặt từ nguồn chưa tin cậy.

Nếu muốn agent quan sát/verify UI, cài và bật plugin Playwright riêng theo hướng dẫn chính thức của môi trường Claude Code. `ff doctor` không gọi Claude CLI để kiểm plugin; nó in cảnh báo tùy chọn. CodeGraph cũng tùy chọn; thiếu `codegraph` thì agent có thể dùng tìm kiếm văn bản thay thế.

## Khởi tạo workspace

1. Nếu chưa có e2e, thông báo trước rằng `ff e2e-scaffold` chạy `npm install`, rồi hỏi user trước khi chạy vì lệnh tải dependency qua mạng. Không tải browser tự động; nếu cần Chromium, hỏi riêng trước `npx playwright install chromium`.
2. Gọi `/ff-init`. Skill khảo sát repo, scripts, branch, URL và nguồn auth; mọi giá trị chưa có bằng chứng phải được hỏi. Nó tạo/cập nhật `ff.config.yaml`, lock và `.ff.env.example`.
3. Điền secret cần thiết trực tiếp vào file secret cục bộ theo tên key trong báo cáo. Không đưa giá trị secret vào prompt hoặc config YAML.
4. Chạy `ff doctor`. Nhóm `core` phải xanh để các lệnh config hoạt động. Nhóm `e2e` cần xanh cho `/ff-verify`; nhóm `worker` cần xanh trước `/ff-worker start`.
5. Dùng `/ff-understand <id>` để bắt đầu task, hoặc đưa yêu cầu trực tiếp để tạo dossier theo hướng dẫn skill.

## Worker tùy chọn

Cấu hình nguồn task và channel trong `ff.config.yaml`, cung cấp key trong file secret đã cấu hình, cài `tmux`, rồi chạy `/ff-worker start`. Lệnh này kiểm tra doctor trước khi tạo session. Không chạy service worker nếu chỉ dùng workflow skill thủ công.

## An toàn và cập nhật

Không đọc hoặc in `.ff.env`, token, storage-state hay giá trị secret. `ff doctor` chỉ báo tên key có/thiếu. Cài đặt và nâng cấp plugin không tự sửa dossier, repo sản phẩm hay bộ e2e đã tồn tại. Sao lưu workspace trước các thay đổi cấu hình lớn và rà diff sau `/ff-init`.

Để cập nhật, nâng phiên bản plugin theo marketplace/nguồn cài ban đầu và nạp lại plugin. Template e2e hiện có không tự bị ghi đè.
