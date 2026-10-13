import { spawnSync } from 'node:child_process'

function defaultRun(args, cwd) {
  const r = spawnSync('tmux', args, { cwd, encoding: 'utf8', timeout: 10000 })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export class Tmux {
  constructor({ run = defaultRun, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}) {
    this.run = run
    this.sleep = sleep
    this.now = now
  }

  hasSession(name, cwd) { return this.run(['has-session', '-t', `=${name}`], cwd).status === 0 }
  capture(name, cwd, lines = 30) { return this.run(['capture-pane', '-pt', `=${name}`, '-S', `-${lines}`], cwd).stdout }
  killSession(name, cwd) { return this.run(['kill-session', '-t', `=${name}`], cwd).status === 0 }

  async start(name, cwd, command, prompt, { ready = /[❯$#%]\s*$/m, timeoutMs = 30000 } = {}) {
    if (this.hasSession(name, cwd)) return { existing: true }
    const started = this.run(['new-session', '-d', '-s', name, '-c', cwd, command], cwd)
    if (started.status !== 0) throw new Error('tmux không tạo được phiên agent')
    const deadline = this.now() + timeoutMs
    let readyFound = false
    while (this.now() < deadline) {
      if (ready.test(this.capture(name, cwd))) { readyFound = true; break }
      await this.sleep(500)
    }
    if (!readyFound) {
      this.run(['kill-session', '-t', `=${name}`], cwd)
      throw new Error(`phiên agent ${name} không sẵn sàng sau ${timeoutMs / 1000} giây`)
    }
    this.run(['send-keys', '-t', `=${name}`, '-l', prompt], cwd)
    await this.sleep(250)
    this.run(['send-keys', '-t', `=${name}`, 'C-m'], cwd)
    return { existing: false }
  }
}
