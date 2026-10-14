// scripts/hooks/notification.mjs — Claude cần người dùng chú ý (xin quyền, đang chờ).
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot } from '../lib/config.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
await notify(root, makeEvent({ kind: 'attention', title: String(input.message??'Claude cần bạn chú ý').slice(0,200), body:String(input.message??'Kiểm tra phiên CLI hiện tại.') }))
process.exit(0)
