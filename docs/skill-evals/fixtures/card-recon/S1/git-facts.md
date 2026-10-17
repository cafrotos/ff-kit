repo web (ship_branch=dev, base_branch=main)
- `git branch -a --list 'feature/777-order-filter'` -> remotes/origin/feature/777-order-filter (không còn local)
- `git log --all --oneline --grep "#777"` -> a1b2c3d feat: order status filter (Trello: #777); d4e5f6a test: order filter e2e (Trello: #777)
- `git branch -a --contains a1b2c3d` -> remotes/origin/dev, remotes/origin/feature/777-order-filter
- merged vào dev ngày 2026-10-10; chưa vào main
- `git diff --stat` -> src/orders/OrderList.tsx, src/orders/useOrderFilter.ts
- `ff state 777 --json` -> brief approved, design auto_passed, gate C approved
