import path from 'node:path'
import Ajv from 'ajv'
import schema from '../../schema/ff.config.schema.mjs'

const ajv = new Ajv({ allErrors: true })
const check = ajv.compile(schema)

export function validate(config) {
  const errs = []
  if (!check(config)) {
    for (const e of check.errors) {
      const extra = e.params?.additionalProperty ? `: ${e.params.additionalProperty}` : ''
      errs.push(`${e.instancePath || '/'} ${e.message}${extra}`)
    }
  }
  if (config.worker?.driver?.enabled === true) {
    const source = config.worker.task_source
    if (source?.adapter !== 'trello' || !source.trello) {
      errs.push('/worker/task_source driver cần task_source Trello')
    }
    for (const key of ['accept_list', 'reopen_list']) {
      if (typeof source?.trello?.[key] !== 'string' || !source.trello[key].trim()) {
        errs.push(`/worker/task_source/trello/${key} driver cần list không rỗng`)
      }
    }
  }
  for (const [key, re] of [['guard.migration_script_re', config.guard?.migration_script_re], ['guard.forbidden_script_re', config.guard?.forbidden_script_re], ...(config.guard?.allowed_bash ?? []).map((r, i) => [`guard.allowed_bash[${i}]`, r])]) {
    if (typeof re !== 'string') continue
    try { new RegExp(re) } catch (e) { errs.push(`/${key.replace(/\./g, '/')} regex không hợp lệ: ${e.message}`) }
  }
  const names = (Array.isArray(config.repos) ? config.repos : []).map((r) => r?.name).filter(Boolean)
  for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i))) errs.push(`/repos tên repo trùng: ${n}`)
  const services = Array.isArray(config.e2e?.services) ? config.e2e.services : []
  const svcNames = services.map((x) => x?.name).filter(Boolean)
  for (const n of new Set(svcNames.filter((n, i) => svcNames.indexOf(n) !== i))) errs.push(`/e2e/services tên service trùng: ${n}`)
  const unsafe = (rel) => typeof rel === 'string' && (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..'))
  services.forEach((svc, i) => {
    const rels = [['cwd', svc?.cwd], ...(svc?.env_load ?? []).map((r) => ['env_load', r]), ...(svc?.env_overrides ?? []).flatMap((o) => [['env_overrides.file', o?.file], ['env_overrides.from', o?.from]])]
    for (const [field, rel] of rels) if (unsafe(rel)) errs.push(`/e2e/services/${i}/${field} phải là đường dẫn tương đối trong repo, không có '..'`)
  })
  return errs
}
