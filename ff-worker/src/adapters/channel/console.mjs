export function formatEvent(event) {
  const prefix = event.taskId ? `[${event.taskId}]` : '[worker]'
  const title = String(event.title ?? '').trim()
  const body = String(event.body ?? '').trim()
  const fields = Object.entries(event.fields ?? {}).map(([key,value])=>`${key}: ${value}`).join('\n')
  return [`${prefix} [${event.kind}] ${title}`,fields,body].filter(Boolean).join('\n')
}

export function makeConsoleChannel(output = process.stdout) {
  return {
    name: 'console',
    async notify(event) {
      output.write(`${formatEvent(event)}\n`)
    },
  }
}
