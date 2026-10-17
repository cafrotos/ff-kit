import path from 'node:path'

/** One short Vietnamese line telling the human how to reach a card's Claude session. */
export function accessHint({ config, cardId, slug, session }) {
  const tmux = session ?? `${config?.worker?.tmux?.session_prefix ?? 'ff-'}${cardId}`
  const rc = config?.worker?.driver?.remote_control !== false
  const tail = `tmux a -t ${tmux} (cần cho lệnh ! như ff worker resolve)`
  return rc
    ? `Mở phiên Remote Control 'ff-${cardId}${slug ? ` ${slug}` : ''}' trong Claude app/claude.ai/code, hoặc ${tail}`
    : `Mở phiên CLI: ${tail}`
}

/** Card slug from a card directory named `<id>-<slug>`. */
export const slugFromDir = (dir, cardId) => dir ? path.basename(dir).replace(new RegExp(`^${cardId}-?`), '') : ''
