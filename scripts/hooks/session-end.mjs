// SessionEnd (chỉ có ~1,5 giây): xếp bằng chứng cho dreaming, không LLM.
import { evidenceHook } from '../lib/dream-hook.mjs'
evidenceHook('SessionEnd')
process.exit(0)
