// scripts/hooks/session-start.mjs — chạy doctor đầu phiên; đỏ thì báo vào ngữ cảnh, `ff cfg get` sẽ từ chối.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { writeDoctorState } from '../lib/state.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)

let lines
try {
  const r = runDoctor(root, loadConfig(root))
  writeDoctorState(root, r.ok, r.groups)
  const errs = r.checks.filter((c) => !c.ok).map((c) => `- [${c.group}] ${c.msg}`)
  if (r.ok) lines = ['ff doctor: xanh.']
  else if (!r.groups.core) lines = ['ff doctor: ĐỎ nhóm core — `ff cfg get` sẽ từ chối tới khi sửa xong:', ...errs, 'Sửa bằng /ff-init, không sửa ff.config.yaml bằng tay.']
  else lines = ['ff doctor: skill chạy được; còn thiếu:', ...errs, !r.groups.worker ? 'Key adapter chỉ worker cần (kéo thẻ, thông báo). Muốn bật worker: điền .ff.env rồi gõ /ff-worker start.' : '']
} catch (e) {
  writeDoctorState(root, false, { core: false, worker: false, e2e: false })
  lines = [`ff doctor: ĐỎ — ${e.message}`, 'Sửa bằng /ff-init.']
}
process.stdout.write(lines.filter(Boolean).join('\n') + '\n')
process.exit(0)
