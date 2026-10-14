// Stop is an attention event, not proof of task completion. Avoid stop-hook recursion.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot } from '../lib/config.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'

const input = readHookInput()
if (input.stop_hook_active) process.exit(0)
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
await notify(root, makeEvent({ kind: 'attention', title: 'Phiên agent đã dừng; kiểm tra trạng thái thẻ và việc đang chờ' }), { log: () => {} })
process.exit(0)
