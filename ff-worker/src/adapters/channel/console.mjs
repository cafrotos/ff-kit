export function formatEvent(event) {
  const prefix = event.taskId ? `[${event.taskId}]` : '[worker]'
  const title = String(event.title ?? '').trim()
  const body = String(event.body ?? '').trim()
  return `${prefix} [${event.kind}] ${title}${body ? `\n${body}` : ''}`
}

export function makeConsoleChannel(output = process.stdout) {
  return {
    name: 'console',
    async notify(event) {
      output.write(`${formatEvent(event)}\n`)
    },
  }
}
