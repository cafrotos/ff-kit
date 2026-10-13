import http from 'node:http'
import crypto from 'node:crypto'
import { writeWorkerStatus } from './status.mjs'

const KINDS = new Set(['info', 'gate', 'ask', 'attention', 'error', 'done'])

function authorized(req, token) {
  const got = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(token)
  return got.length === expected.length && crypto.timingSafeEqual(got, expected)
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    let tooLarge = false
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk)
      if (size > maxBytes) tooLarge = true
      else body += chunk
    })
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('request too large'), { status: 413 }))
      try { resolve(body ? JSON.parse(body) : {}) } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

function send(res, status, value) {
  const data = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store' })
  res.end(data)
}

export async function startWorkerHttp({ root, port = 0, token = crypto.randomBytes(32).toString('hex'), channel, handlers = {}, maxBodyBytes = 64 * 1024, adapter = 'unknown' }) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/notify', '/verify-lock', '/ship-request'].includes(req.url)) return send(res, 404, { error: 'not found' })
    if (!authorized(req, token)) return send(res, 401, { error: 'unauthorized' })
    try {
      const body = await readJson(req, maxBodyBytes)
      if (req.url === '/notify') {
        if (!body || !KINDS.has(body.kind) || typeof body.title !== 'string' || !body.title.trim()) return send(res, 400, { error: 'invalid notification' })
        await channel.notify(body)
        return send(res, 200, { delivered: true })
      }
      const handler = req.url === '/verify-lock' ? handlers.verifyLock : handlers.shipRequest
      if (!handler) return send(res, 501, { error: 'not configured' })
      return send(res, 200, await handler(body))
    } catch (e) {
      return send(res, e.status ?? 500, { error: e.status ? e.message : 'request failed' })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('worker HTTP failed to bind')
  const status = { state: 'ready', pid: process.pid, port: address.port, token, adapter, startedAt: new Date().toISOString() }
  const statusPath = writeWorkerStatus(root, status)
  return {
    server, address, token, statusPath,
    close(timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          server.closeAllConnections?.()
          if (!settled) { settled = true; resolve() }
        }, timeoutMs)
        timer.unref?.()
        server.close((e) => {
          clearTimeout(timer)
          if (settled) return
          settled = true
          e ? reject(e) : resolve()
        })
      })
    },
  }
}
