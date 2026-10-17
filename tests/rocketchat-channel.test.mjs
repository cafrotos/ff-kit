import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RocketChatChannel } from '../ff-worker/src/adapters/channel/rocketchat.mjs'
import { formatEvent } from '../ff-worker/src/adapters/channel/console.mjs'

function setup(t, { threadPerTask, fetchBehavior, delay = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-rc-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const envFile = path.join(root, 'e.env')
  fs.writeFileSync(envFile, 'RC_URL=https://chat.example\nRC_USER_ID=u\nRC_AUTH_TOKEN=s\nRC_ROOM_ID=room\n')
  const posts = []
  let n = 0
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body)
    if (delay) await new Promise((r) => setTimeout(r, delay))
    const forced = fetchBehavior?.(body, posts.length)
    posts.push(body)
    if (forced) return forced
    return Response.json({ success: true, message: { _id: `m${++n}` } })
  }
  const make = () => new RocketChatChannel({ envFile, fetchImpl, root, threadPerTask, delayMs: 0, log: () => {} })
  return { root, posts, make }
}
const ev = (over = {}) => ({ taskId: '7', cardTitle: 'Tìm kiếm', kind: 'info', title: 'Xong', body: 'nội dung', ...over })
const blocksText = (post) => post.attachments[0].blocks.map((b) => b.text.text).join('')

test('rc: payload dùng blocks mrkdwn + text fallback, nội dung không đổi', async (t) => {
  const { posts, make } = setup(t, { threadPerTask: false })
  const e = ev()
  await make().notify(e)
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0].attachments[0].blocks, [{ type: 'section', text: { type: 'mrkdwn', text: formatEvent(e) } }])
  assert.equal(posts[0].text, formatEvent(e))
  assert.equal(posts[0].tmid, undefined)
})

test('rc: tách section 2500 ở ranh giới dòng/từ, không cắt giữa từ, fence cân bằng', async (t) => {
  const { posts, make } = setup(t, { threadPerTask: false })
  const lines = Array.from({ length: 400 }, (_, i) => `dòng ${i} ` + 'từ '.repeat(10))
  await make().notify(ev({ body: lines.join('\n') }))
  const blocks = posts.flatMap((p) => p.attachments[0].blocks)
  assert.ok(blocks.length > 1)
  for (const b of blocks) assert.ok(b.text.text.length <= 2500)
  const joined = blocks.map((b) => b.text.text).join('\n')
  for (const l of lines) assert.ok(joined.includes(l.trim()), l)
  // từ quá dài + fence
  posts.length = 0
  const code = '```\n' + Array.from({ length: 300 }, (_, i) => `const a${i} = ${i}`).join('\n') + '\n```'
  await make().notify(ev({ body: code }))
  for (const p of posts) for (const b of p.attachments[0].blocks) {
    assert.equal((b.text.text.match(/```/g) ?? []).length % 2, 0)
  }
})

test('rc: tin dài (>7 block) tiếp tục bằng tin kế trong cùng thread', async (t) => {
  const { posts, make } = setup(t, { threadPerTask: true })
  const body = Array.from({ length: 1200 }, (_, i) => `dòng số ${i} ${'x'.repeat(30)}`).join('\n')
  await make().notify(ev({ body }))
  const replies = posts.filter((p) => p.tmid)
  assert.ok(replies.length >= 2)
  assert.ok(replies.every((p) => p.tmid === 'm1'))
  for (const p of posts) assert.ok(p.attachments?.[0].blocks.length <= 7 || !p.tmid)
  for (const p of replies) assert.ok(p.attachments[0].blocks.length <= 7)
})

test('rc: thread_per_task tạo root [#id] tên thẻ rồi reply tmid; lưu file', async (t) => {
  const { root, posts, make } = setup(t)
  await make().notify(ev())
  assert.equal(posts[0].text, '[#7] Tìm kiếm')
  assert.equal(posts[0].tmid, undefined)
  assert.equal(posts[1].tmid, 'm1')
  assert.equal(blocksText(posts[1]), formatEvent(ev()))
  const rec = JSON.parse(fs.readFileSync(path.join(root, '.ff/channel/threads/7.json'), 'utf8'))
  assert.deepEqual(rec, { cardId: '7', roomId: 'room', tmid: 'm1' })
})

test('rc: root tạo đúng một lần khi đồng thời; tmid dùng lại ở instance mới', async (t) => {
  const { posts, make } = setup(t, { delay: 10 })
  await Promise.all([make().notify(ev({ title: 'a' })), make().notify(ev({ title: 'b' })), make().notify(ev({ title: 'c' }))])
  assert.equal(posts.filter((p) => !p.tmid).length, 1)
  assert.equal(posts.filter((p) => p.tmid === 'm1').length, 3)
  await make().notify(ev({ title: 'd' }))
  assert.equal(posts.filter((p) => !p.tmid).length, 1)
  assert.equal(posts.at(-1).tmid, 'm1')
})

test('rc: tmid bị từ chối (400) -> tạo lại root đúng một lần rồi gửi lại', async (t) => {
  let rejected = false
  const { posts, make } = setup(t, { fetchBehavior: (body) => {
    if (body.tmid === 'm1' && !rejected && body.text.includes('Xong b')) { rejected = true; return Response.json({ success: false, error: 'invalid tmid' }, { status: 400 }) }
  } })
  const ch = make()
  await ch.notify(ev({ title: 'Xong a' }))
  await ch.notify(ev({ title: 'Xong b' }))
  const roots = posts.filter((p) => !p.tmid)
  assert.equal(roots.length, 2)
  assert.equal(posts.at(-1).tmid, 'm3')
})

test('rc: lỗi khác 400 -> throw, không gửi lại', async (t) => {
  const { posts, make } = setup(t, { fetchBehavior: (body) => body.tmid ? new Response('x', { status: 500 }) : undefined })
  await assert.rejects(() => make().notify(ev()), /500/)
  assert.equal(posts.length, 2)
})

test('rc: không có taskId -> không POST', async (t) => {
  const { posts, make } = setup(t)
  await make().notify({ kind: 'info', title: 'worker', body: 'x' })
  assert.equal(posts.length, 0)
})

test('rc: thread_per_task=false -> không có tmid, không root', async (t) => {
  const { posts, make } = setup(t, { threadPerTask: false })
  await make().notify(ev())
  assert.equal(posts.length, 1)
  assert.equal(posts[0].tmid, undefined)
})
