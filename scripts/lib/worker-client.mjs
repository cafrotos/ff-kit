import fs from 'node:fs'
import path from 'node:path'

export async function workerRequest(root, endpoint, body, fetcher = globalThis.fetch) {
  let status
  try { status = JSON.parse(fs.readFileSync(path.join(root, '.ff/worker.json'), 'utf8')) } catch {
    throw new Error('worker chưa chạy; dùng /ff-worker start')
  }
  if (!Number.isInteger(status.port) || status.port < 1 || status.port > 65535 || typeof status.token !== 'string' || !status.token) {
    throw new Error('worker chưa sẵn sàng; dùng ff worker status')
  }
  const response = await fetcher(`http://127.0.0.1:${status.port}${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${status.token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  })
  let data = {}
  try { data = await response.json() } catch {}
  if (!response.ok) throw new Error(data.error ?? `worker trả HTTP ${response.status}`)
  return data
}
