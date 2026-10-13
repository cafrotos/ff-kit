import fs from 'node:fs'
import path from 'node:path'
import { readTask, writeTask } from './task-store.mjs'

function slugify(value) {
  const slug = String(value ?? 'task').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return slug || 'task'
}

export async function processTasks({ root, config, source, channel, launchTask, log = (s) => process.stderr.write(s) }) {
  const cards = await source.poll()
  const cardsDir = path.resolve(root, config.workspace.cards_dir)
  const results = []
  const max = config.worker?.max_concurrent_tasks ?? 2
  let active = 0
  try {
    for (const file of fs.readdirSync(path.join(root, '.ff/tasks')).filter((name) => name.endsWith('.json'))) {
      const task = JSON.parse(fs.readFileSync(path.join(root, '.ff/tasks', file), 'utf8'))
      if (!['completed', 'failed'].includes(task.phase)) active++
    }
  } catch {}
  for (const card of cards) {
    if (!/^[A-Za-z0-9]+$/.test(String(card.id))) {
      log(`[ff-worker] bỏ qua thẻ có ID không hợp lệ\n`)
      continue
    }
    const previous = readTask(root, card.id)
    if (previous) {
      if (!['completed', 'failed'].includes(previous.phase) && launchTask) {
        try {
          const recovered = await launchTask(card, previous, { resume: true })
          previous.phase = 'running'
          previous.session = recovered?.session ?? previous.session
          previous.updatedAt = new Date().toISOString()
          writeTask(root, previous)
        } catch (e) {
          log(`[ff-worker] khôi phục thẻ ${previous.cardId} lỗi (${e.message})\n`)
        }
      }
      results.push(previous)
      continue
    }
    if (active >= max) continue
    const slug = previous?.slug ?? slugify(card.name)
    const task = { cardId: String(card.id), trelloCardId: String(card.trelloCardId ?? card.id), slug, phase: 'received', updatedAt: new Date().toISOString() }
    const cardDir = path.join(cardsDir, `${task.cardId}-${slug}`)
    fs.mkdirSync(cardDir, { recursive: true })
    const dossierPath = path.join(cardDir, '01-dossier.md')
    if (!fs.existsSync(dossierPath)) {
      const dossier = await source.fetchDossier(card)
      fs.writeFileSync(dossierPath, dossier, { flag: 'wx', mode: 0o600 })
    }
    writeTask(root, task)
    active++
    if (launchTask) {
      try {
        const started = await launchTask(card, task, { resume: false })
        task.phase = 'running'
        task.session = started?.session
        task.updatedAt = new Date().toISOString()
        writeTask(root, task)
      } catch (e) {
        task.phase = 'received'
        task.lastError = String(e.message).slice(0, 240)
        task.updatedAt = new Date().toISOString()
        writeTask(root, task)
        log(`[ff-worker] không thể khởi động thẻ ${task.cardId} (${e.message})\n`)
      }
    }
    try {
      await channel.notify({ taskId: task.cardId, kind: 'info', title: `Đã nhận thẻ: ${card.name}`, fields: { phase: task.phase }, body: `Dossier: ${path.relative(root, dossierPath)}` })
    } catch (e) {
      log(`[ff-worker] gửi thông báo thất bại (${e.message}); task vẫn được giữ lại\n`)
    }
    results.push(task)
  }
  return results
}

export async function launchAgentTask({ root, config, tmux, card, task, resume = false }) {
  const engine = config.engine?.default ?? 'claude'
  const command = config.engine?.commands?.[engine] ?? engine
  const session = `${config.worker.tmux.session_prefix ?? 'ff-'}${task.cardId}`
  const dossier = path.relative(root, path.join(root, config.workspace.cards_dir, `${task.cardId}-${task.slug}`, '01-dossier.md'))
  const prompt = [
    `Xử lý thẻ #${task.cardId} theo workflow ff-kit.`,
    `Đọc dossier tại ${dossier}.`,
    'Bắt đầu với /ff-understand và theo các Gate; không tự ghi nhận nội dung đã duyệt.',
    resume ? 'Đây là phiên khôi phục: kiểm tra trạng thái thẻ hiện có rồi tiếp tục từ bước còn dang dở.' : '',
  ].filter(Boolean).join('\n')
  await tmux.start(session, root, command, prompt, { ready: engine === 'claude' ? /Claude Code v\d|shift\+tab to cycle|\? for shortcuts|❯\s*$/im : /[❯$#%]\s*$/m })
  return { session }
}
