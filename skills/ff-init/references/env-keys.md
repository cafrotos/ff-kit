# Key theo tính năng

Chạy `ff env-example` để tạo danh sách key trống theo adapter. Không ghi giá trị vào YAML hoặc `.ff.env.example`.

| Tính năng | Key |
|---|---|
| Trello TaskSource | `TRELLO_API_KEY`, `TRELLO_API_TOKEN` |
| notification channel Channel | `RC_URL`, `RC_USER_ID`, `RC_AUTH_TOKEN`, `RC_ROOM_ID` |
| E2E form login | `E2E_USER`, `E2E_PASSWORD` |

`console` không cần key channel. JWT secret lấy theo `e2e.auth.jwt.secret.file` và `key`; chỉ báo có/thiếu qua `ff doctor`, không đọc giá trị.
