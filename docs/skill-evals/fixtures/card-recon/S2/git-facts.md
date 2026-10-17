repo web (ship_branch=dev, base_branch=main)
- `git branch -a --list 'fix/778-phone-save'` -> (rỗng); `git ls-remote --heads origin fix/778-phone-save` -> (rỗng)
- `git log --all --oneline --grep "#778"` -> (rỗng)
- `ff state 778 --json` -> chưa có brief, chưa có gate
