/** @typedef {{ id: string, name: string, url?: string, list?: string, labels?: string[] }} TaskCard */
/** @typedef {{ taskId?: string, title: string, kind: 'info'|'gate'|'ask'|'attention'|'error'|'done', fields?: Record<string, string>, body?: string, revision?: string, gate?: 'GATE_A'|'GATE_B'|'GATE_C', scope?: string, presentation?: object, questions?: object[], [key: string]: unknown }} NotifyEvent */
/** @typedef {{ name: string, poll(): Promise<TaskCard[]>, fetchDossier(card: TaskCard): Promise<string>, moveTo(id: string, status: string): Promise<void>, comment?(id: string, text: string): Promise<void> }} TaskSource */
/** @typedef {{ name: string, notify(event: NotifyEvent): Promise<void> }} Channel */

export function assertTaskSource(value) {
  for (const method of ['poll', 'fetchDossier', 'moveTo']) {
    if (typeof value?.[method] !== 'function') throw new TypeError(`TaskSource thiếu ${method}()`)
  }
  return value
}

export function assertChannel(value) {
  if (typeof value?.notify !== 'function') throw new TypeError('Channel thiếu notify()')
  return value
}
