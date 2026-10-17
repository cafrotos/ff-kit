repo web (ship_branch=dev, base_branch=main); repo api (ship_branch=dev, base_branch=main)
- `git branch -a --list 'feature/888-ext-setup'` (cả 2 repo) -> remotes/origin/feature/888-ext-setup
- web: `git log --all --oneline --grep "#888"` -> 3c9a1e0 feat: extension screen moved to System module (Trello: #888); 58f7b2d feat: extension form + employee dropdown (Trello: #888)
- api: `git log --all --oneline --grep "#888"` -> 54a3c1b feat: extension API under /system, permission system:extension, migration (Trello: #888)
- `git branch -a --contains 3c9a1e0` / `--contains 54a3c1b` -> chỉ remotes/origin/feature/888-ext-setup (chưa vào dev, chưa vào main)
- api `git show 54a3c1b --stat` -> src/system/extension.controller.ts (guard @Permission('system:extension') cho create/update/assign), src/system/extension.service.ts (create() lưu thẳng, không kiểm trùng số máy), src/users/available.controller.ts (gọi CrmUserService.list({careOnly:true})), migrations/2026101501-extension.ts
- web `git show 58f7b2d --stat` -> src/system/extension/ExtensionForm.tsx, src/system/extension/useAvailableUsers.ts (tải toàn bộ user, không phân trang)
- `ff state 888 --json` -> brief pending, design pending, gate C pending (chưa có receipt)
