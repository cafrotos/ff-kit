// PreCompact/SessionEnd: chỉ xếp một dòng bằng chứng vào hàng chờ dreaming. Không LLM, không mạng, không bao giờ chặn.
import { readHookInput } from './hook-io.mjs'
import { findRoot, loadConfig } from './config.mjs'
import { inferCardId } from './card-context.mjs'
import { recordEvidence } from './dream-queue.mjs'

export function evidenceHook(event) {
  try {
    if (process.env.FF_DREAM === '1') return // phiên claude -p của chính dreaming
    const input = readHookInput()
    const cwd = input.cwd ?? process.cwd()
    const root = findRoot(cwd)
    if (!root) return
    let cardId = ''
    try { cardId = inferCardId(root, loadConfig(root).config, { cwd }) } catch { /* không suy được thẻ */ }
    recordEvidence(root, { event, sessionId: input.session_id ?? '', cardId, transcriptPath: input.transcript_path ?? '', reason: input.reason ?? input.trigger ?? '' })
  } catch { /* tuyệt đối không làm hỏng phiên */ }
}
