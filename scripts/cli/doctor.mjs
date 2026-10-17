import { findRoot, loadConfig, ConfigError } from '../lib/config.mjs'
import { validate } from '../lib/schema.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { writeDoctorState } from '../lib/state.mjs'

export const summary = 'doctor [--schema-only] [--json] — kiểm ff.config.yaml, repo, lệnh, secrets, nguồn'

export async function run(args, ctx) {
  const schemaOnly = args.includes('--schema-only')
  const json = args.includes('--json')
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff: không thấy ff.config.yaml. Chạy /ff-init.\n')
    return 4
  }
  let result
  try {
    const loaded = loadConfig(root)
    result = schemaOnly
      ? (() => { const errs = validate(loaded.config); return { ok: !errs.length, groups: { core: !errs.length, worker: !errs.length, e2e: !errs.length }, checks: errs.length ? errs.map((e) => ({ ok: false, msg: `schema ${e}`, group: 'core' })) : [{ ok: true, msg: 'schema hợp lệ', group: 'core' }] } })()
      : runDoctor(root, loaded)
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e
    result = { ok: false, groups: { core: false, worker: false, e2e: false }, checks: [{ ok: false, msg: e.message, group: 'core' }], warnings: [] }
  }
  if (!schemaOnly) writeDoctorState(root, result.ok, result.groups)
  if (json) ctx.stdout.write(JSON.stringify(result) + '\n')
  else {
    for (const c of result.checks) ctx.stdout.write(`${c.ok ? '✓' : '✗'} [${c.group}] ${c.msg}\n`)
    for (const warning of result.warnings ?? []) ctx.stdout.write(`! [optional] ${warning}\n`)
    const n = result.checks.filter((c) => !c.ok).length
    const g = result.groups
    let tail = 'ff doctor: xanh\n'
    if (!g.core) tail = `ff doctor: ĐỎ nhóm core (${n} lỗi) — skill không chạy được tới khi sửa; sửa bằng /ff-init, không sửa ff.config.yaml bằng tay\n`
    else if (!result.ok) tail = `ff doctor: ĐỎ nhóm ${['worker', 'e2e'].filter((k) => !g[k]).join(', ')} (${n} lỗi) — skill vẫn chạy; ${!g.worker ? '/ff-worker start sẽ từ chối' : ''}${!g.worker && !g.e2e ? '; ' : ''}${!g.e2e ? 'ff-verify sẽ dừng' : ''}\n`
    ctx.stdout.write(tail)
  }
  return result.ok ? 0 : 1
}
