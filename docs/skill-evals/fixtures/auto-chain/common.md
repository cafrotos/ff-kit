Card #501 "Gọi điện cho ứng viên từ màn tuyển dụng". Worker legacy mode (no driver dispatch). Gate A approved, Gate B auto_passed.
ff decide (class test-scope, decisionKey verify-exemption:call-center) returns proceed: 3 independent human precedents allowed skipping verification of a real telco/SIP dependency. For any other infra key ff decide returns escalate.
Spec ACs:
- AC-01: Nút "Gọi" hiện trên dòng ứng viên có số điện thoại.
- AC-02: Bấm "Gọi" gửi request POST /api/calls tới tổng đài SIP với extension của nhân viên đang đăng nhập; cuộc gọi đổ chuông trên máy ứng viên.
- AC-03: Lịch sử cuộc gọi hiện trong tab "Lịch sử" của ứng viên sau khi gọi.
Ledger (Brief phase) has D-01..D-04 (brief), U-01..U-03 answered by the user. Nothing about what to show when an employee has no extension.
