# Báo bắt đầu/kết thúc pha cho worker

Áp dụng ngay cho `ff-understand`, `ff-build`, `ff-verify` và recipe ship. Đọc trước P0:

```bash
ff stage context <id> --json
```

- `enabled: false`, hoặc `pendingDispatch: null`: dùng skill thủ công như trước; không tự tạo dispatch/receipt.
- Có pending: `stage` phải đúng skill đang chạy, `revision` phải đúng `ff state`. Giữ `cardId`, `revision`, `runId`, `dispatchId`, `workflow` của context. Sai scope/lệnh context lỗi → báo lỗi, không fallback thủ công.
- Gọi `ff stage begin <id> --dispatch <dispatchId>` trước công việc. Lặp cùng dispatch an toàn; không tự sửa `.ff/tasks` hoặc cấp dispatch.
- Giữ cùng cuộc hội thoại; không `/clear`, tạo phiên mới hoặc ép compact để đổi pha. Worker gọi pha tiếp theo.
- Hoàn tất pha bằng `ff stage finish` đúng outcome và evidence trước khi trả điều khiển. Không tự gọi skill pha sau. Recipe ship dùng `ff ship <id>`, CLI quản lý receipt ship.
- `ff doctor` tổng quát không chặn worker chỉ vì `gh` thiếu. Doctor theo pha kiểm e2e ngay trước verify, remote/branch trước ship, và chỉ kiểm/auth `gh` cho S2. Auto/auth hết quota là blocked/setup; không fallback API/PAYG.

## Evidence trước finish

Lưu bằng chứng local trong `<activeDir>/evidence/<dispatchId>/`. Không ghi token, password, cookie, storage-state hoặc environment có credential vào log/report/evidence. Các đường dẫn trong evidence tương đối **workspace root**, không tương đối repo hay thư mục thẻ; không symlink/đường dẫn ra ngoài workspace. Dùng `sha256sum` để lấy SHA-256 đủ 64 ký tự từ byte thực. HEAD lấy bằng `git rev-parse HEAD` trong từng bản copy repo.

Viết `stage-evidence.json` bằng Write, theo cấu trúc:

```json
{
  "cardId": "<id>", "revision": "", "runId": "<context.runId>", "dispatchId": "<context.dispatchId>",
  "workflow": {"digest": "<context.workflow.digest>", "cliVersion": "<context.workflow.cliVersion>"},
  "heads": {"<repo.name>": "<HEAD thực>"},
  "artifactHashes": {"<đường dẫn artifact>": "<sha256 thực>"},
  "testLockHash": "<sha256 của manifest từ state.testLock>",
  "checks": [{"command": "<lệnh chính xác đã chạy>", "cwd": "<worktree repo>", "exitCode": 0, "logPath": "<log local>", "logHash": "<sha256 log>"}],
  "reviewRefs": ["<review.json>"], "acMatrixRef": "<ac-evidence.json>"
}
```

- Scope phải giữ nguyên context đã begin, root revision là `""` (không null). Không chép scope mới vào kết quả chạy cũ. `heads` chứa mọi repo đã có bản copy; build/verify bắt buộc mọi repo config.
- `artifactHashes` bắt buộc dossier, ledger cấp thẻ, Brief gốc hoặc delta hiện tại, mọi spec/design hiện hành; build thêm mọi plan, verify thêm mọi `05-verify-report.md`. Nếu chia cụm, liệt kê artifact mỗi cụm trong active revision. Thêm các file review, AC JSON và mọi bằng chứng được AC JSON tham chiếu; mỗi file phải có nội dung.
- `checks` lấy exitCode thực của lint/type-check/build/test đã chạy theo config, stdout/stderr đã loại credential lưu log riêng. Mỗi command cấu hình phải có check đúng cwd; không thay bằng `echo PASS`. Không chạy lại lệnh giả để tạo log. `finish` tự chạy lại `squash-check`/`ac-matrix`, lưu log kiểm độc lập.
- Review độc lập sau sửa cuối cùng: lưu JSON `{ "status": "pass", "revision": "", "heads": {"repo": "SHA"}, "findings": [] }` từ kết quả review thật. Còn lỗi chưa sửa thì không được ghi pass. Liên kết bản review đầy đủ trong artifactHashes nếu có.
- AC JSON: `{ "revision": "", "heads": {"repo": "SHA"}, "criteria": [{"id": "AC-01", "status": "pass", "evidence": ["đường/dẫn/log-hoặc-proof"]}] }`. Mọi AC chưa bỏ trong spec hiện tại cần đúng một dòng pass và file bằng chứng cụ thể đã hash. Build ghi bằng chứng test/check hành vi; verify ghi bằng chứng nghiệm thu thật. `no_change` vẫn cần tất cả AC, checks, review và test lock; 0 commit không chứng minh AC.
- Understand pass dùng `checks: []`, `reviewRefs: []`, `acMatrixRef: null`, `testLockHash: null` nếu chưa áp dụng; chỉ pass khi `readyForBuild` hiện tại true. Không tạo Gate trong finish.
- Khi lỗi/kẹt: chọn `implementation_failed`, `environment_blocked`, hoặc `needs_human`; giữ scope/workflow/HEAD thực, checks thất bại và/hoặc artifact chẩn đoán đã hash. Chưa có review/AC/test lock dùng `[]`/`null`. Không báo pass khi chưa đủ bằng chứng. Receipt lỗi không phải receipt hoàn thành thành công; worker quyết định retry/chờ người.

## Kết thúc

```bash
ff stage finish <id> --dispatch <dispatchId> --outcome <pass|no_change|implementation_failed|environment_blocked|needs_human> --evidence <activeDir>/evidence/<dispatchId>/stage-evidence.json
```

Chỉ báo đã bàn giao khi lệnh thành công. Receipt được ghi trước event; lặp lại cùng dispatch/outcome phục hồi event nếu bị gián đoạn. Không sửa HEAD/artifact/lock sau receipt rồi tái dùng receipt đó. Một dispatch đã finish là cố định; worker cấp dispatch mới cho vòng sửa. `ff state --json` thêm `receipts.<stage>.valid` và outcome, không thay ý nghĩa Gate cũ.

Cuối pha chỉ nêu hướng dẫn bước sau rồi trả điều khiển cho worker. Không tự gọi skill kế tiếp, verify, ship hoặc push chỉ vì có receipt. Gate A/B/C và xác nhận ship vẫn riêng; receipt không thay approval.
