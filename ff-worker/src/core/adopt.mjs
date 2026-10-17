// Nhận thẻ có sẵn (làm tay / phiên bản cũ) vào driver: chỉ đọc thư mục thẻ, không bao giờ tạo duyệt hay receipt.
import fs from 'node:fs'
import path from 'node:path'
import { inspectCard } from '../../../scripts/cli/state.mjs'
import { findCardDir } from '../../../scripts/lib/cards.mjs'

const GATES = ['GATE_A', 'GATE_B', 'GATE_C']

/**
 * Quy tắc (bảo thủ):
 * - revision = revision lớn nhất trên đĩa ('' nếu chưa có); revision thiếu revision.json là legacy (ff copy dựng lại mốc từ git).
 * - Gate chỉ "approved/auto_passed" khi receipt thật còn khớp hash; mọi thứ khác (pending/stale/absent) là chờ người, kể cả khi file nói "ĐÃ DUYỆT".
 * - Không suy ra receipt pha (build/verify/ship) từ file: pha thiếu receipt sẽ do driver giao lại, không coi là xong.
 * - Pha khởi đầu: build chỉ khi Gate A và B đã hợp lệ; ngược lại understand (agent chỉ trình các Gate còn pending).
 */
export function inspectAdoption(root, config, cardId) {
  const card = findCardDir(root, config, cardId)
  if (card.error) return null
  const state = inspectCard(root, config, card.dir)
  const revDir = path.join(card.dir, state.activeRevision ?? '')
  const has = (name) => fs.existsSync(path.join(revDir, name))
  const gates = Object.fromEntries(GATES.map((g) => [g, state.gates[g].status]))
  const ok = (g) => ['approved', 'auto_passed'].includes(gates[g])
  const artifacts = Object.fromEntries([['brief', state.activeRevision ? 'delta.md' : 'brief.md'], ['spec', '02-spec.md'], ['design', '03-design.md'], ['plan', '04-plan.md'], ['report', '05-verify-report.md'], ['humanOutput', 'human-output.json']].map(([k, f]) => [k, has(f)]))
  const empty = !state.activeRevision && !Object.values(artifacts).some(Boolean)
  return {
    revision: state.activeRevision ?? '', legacyRevision: Boolean(state.activeRevision) && !has('revision.json'),
    gates, artifacts, stage: state.readyForBuild ? 'build' : 'understand',
    pendingGates: GATES.filter((g) => !ok(g) && (g !== 'GATE_C' || ok('GATE_B'))),
    adopted: !empty && (Object.values(artifacts).some(Boolean) || Boolean(state.activeRevision)),
  }
}

export const adoptionSummary = (a) => `revision ${a.revision || 'gốc'}${a.legacyRevision ? ' (legacy, thiếu revision.json)' : ''}; đã duyệt ${GATES.filter((g) => ['approved', 'auto_passed'].includes(a.gates[g])).join(',') || 'chưa Gate nào'}; chờ người ${a.pendingGates.join(',') || 'không'}`
