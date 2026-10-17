repo web (ship_branch=dev, base_branch=main)
- `git branch -a --list 'feature/990-export-csv'` -> (rỗng); `git ls-remote --heads origin feature/990-export-csv` -> (rỗng) (branch đã bị xóa sau khi cherry-pick lên dev)
- `git log --all --oneline --grep "#990"` -> b7c1d2e feat: contract CSV export (Trello: #990); c8d9e0f test: export e2e (Trello: #990)
- `git branch -a --contains b7c1d2e` -> remotes/origin/dev (chưa vào main)
- `git show b7c1d2e --stat` -> src/contracts/ExportButton.tsx (gọi exportCsv(allRows), không truyền bộ lọc), src/contracts/exportCsv.ts
- `ff state 990 --json` -> brief approved, design auto_passed, gate C approved
