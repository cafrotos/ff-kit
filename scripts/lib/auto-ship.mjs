// Ràng buộc cho ship tự động (N6): phê duyệt ship auto gắn với Gate C auto_passed, HEAD từng repo và ship_branch.
// Nhẹ có chủ ý (không kéo inspectCard/stage-receipts) vì guard hook cũng dùng.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { findCardDir } from './cards.mjs'
import { gateCAuto } from './gates.mjs'

export function autoBinding(root, config, cardId) {
  const card = findCardDir(root, config, String(cardId))
  if (card.error) throw new Error(card.error)
  const gate = gateCAuto(root, String(cardId), card.dir)
  if (!gate.ok) throw new Error(`Gate C chưa ở trạng thái auto_passed hợp lệ: ${gate.reason}`)
  const wt = path.resolve(root, config.workspace.worktrees_dir, path.basename(card.dir)), heads = {}, shipBranches = {}
  for (const repo of config.repos) {
    const copy = path.join(wt, path.basename(repo.path))
    if (!fs.existsSync(path.join(copy, '.git'))) continue
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: copy, encoding: 'utf8', timeout: 5000 })
    if (r.status !== 0) throw new Error(`không đọc được HEAD của ${repo.name}`)
    heads[repo.name] = r.stdout.trim()
    shipBranches[repo.name] = repo.ship_branch
  }
  if (!Object.keys(heads).length) throw new Error('không có bản copy repo để ship')
  return { auto: true, cardId: String(cardId), revision: gate.revision, gateC: gate.hash, heads, shipBranches, exemptAcs: gate.exemptAcs }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** Hợp lệ khi Gate C vẫn auto_passed với đúng receipt, HEAD và ship_branch không đổi. */
export function validateAutoBinding(root, config, binding) {
  try {
    if (binding?.auto !== true) throw new Error('không phải phê duyệt ship auto')
    const now = autoBinding(root, config, binding.cardId)
    for (const k of ['revision', 'gateC', 'heads', 'shipBranches']) if (!same(now[k], binding[k])) throw new Error(`${k === 'gateC' ? 'Gate C' : k === 'heads' ? 'HEAD repo' : k === 'shipBranches' ? 'ship_branch' : k} đã đổi sau khi duyệt auto`)
    return { valid: true, reasons: [] }
  } catch (e) { return { valid: false, reasons: [e.message] } }
}
