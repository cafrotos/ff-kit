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
  for (const [key, re] of [['guard.migration_script_re', config.guard?.migration_script_re], ['guard.forbidden_script_re', config.guard?.forbidden_script_re], ...(config.guard?.allowed_bash ?? []).map((r, i) => [`guard.allowed_bash[${i}]`, r])]) {
    if (typeof re !== 'string') continue
    try { new RegExp(re) } catch (e) { errs.push(`/${key.replace(/\./g, '/')} regex không hợp lệ: ${e.message}`) }
  }
  const names = (Array.isArray(config.repos) ? config.repos : []).map((r) => r?.name).filter(Boolean)
  for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i))) errs.push(`/repos tên repo trùng: ${n}`)
  return errs
}
