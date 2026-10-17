import { spawnSync } from 'node:child_process'

// `=name` is exact only as a session target; window/pane commands need `=name:`.
const paneTarget = name => `=${name}:`

function defaultRun(args, cwd) {
  const r = spawnSync('tmux', args, { cwd, encoding: 'utf8', timeout: 10000 })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export class Tmux {
  constructor({ run = defaultRun, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, quietMs = 15000 } = {}) {
    this.run = run
    this.quietMs = quietMs
    this.sleep = sleep
    this.now = now
  }

  hasSession(name, cwd) { return this.run(['has-session', '-t', `=${name}`], cwd).status === 0 }
  capture(name, cwd, lines = 30) { return this.run(['capture-pane', '-pt', paneTarget(name), '-S', `-${lines}`], cwd).stdout }
  killSession(name, cwd) { return this.run(['kill-session', '-t', `=${name}`], cwd).status === 0 }

  async sendLiteral(name, cwd, text) {
    if (typeof text !== 'string' || !text || text.includes('\0')) throw new TypeError('Invalid literal input')
    if (this.run(['send-keys', '-t', paneTarget(name), '-l', '--', text], cwd).status !== 0) throw new Error('tmux literal send failed')
    await this.sleep(250)
    if (this.run(['send-keys', '-t', paneTarget(name), 'C-m'], cwd).status !== 0) throw new Error('tmux Enter send failed')
  }

  /**
   * Pane metadata only; never parses screen text. `idle` means no human holds the
   * pane: alive, no attached client, not in copy mode and no keystroke for
   * `quietMs`. A leftover draft cannot be ruled out here; the UserPromptSubmit
   * hook rejects any worker prompt that is not byte-identical to the dispatch.
   */
  inspectPane(name, cwd) {
    const has = this.run(['has-session', '-t', `=${name}`], cwd)
    // has-session exit 1 can also mean a broken socket/server: absence is only
    // established by an explicit tmux diagnostic, never by arbitrary failure.
    if (has.status !== 0) {
      const absent = has.status === 1 && /can't find session|no server running|no sessions/.test(has.stderr ?? '')
      return { exists: absent ? false : null, status: absent ? 'exited' : 'blocked', inputEmpty: false }
    }
    const meta = this.run(['display-message', '-p', '-t', paneTarget(name), '#{pane_dead}\t#{pane_current_command}\t#{pane_in_mode}\t#{window_panes}\t#{session_attached}\t#{session_activity}'], cwd)
    if (meta.status !== 0) return { exists: true, status: 'blocked', inputEmpty: false }
    const [dead, , mode, panes, attached, activity] = (meta.stdout ?? '').trim().split('\t')
    if (panes === '1' && mode === '0' && dead === '1') return { exists: true, status: 'exited', inputEmpty: false }
    const activityMs = Number(activity) * 1000
    if (panes !== '1' || dead !== '0' || !/^\d+$/.test(attached ?? '') || !Number.isFinite(activityMs) || activityMs <= 0) return { exists: true, status: 'blocked', inputEmpty: false }
    if (attached !== '0' || mode !== '0') return { exists: true, status: 'occupied', attached: Number(attached), inputEmpty: false }
    const quietMs = this.now() - activityMs
    if (quietMs < this.quietMs) return { exists: true, status: 'occupied', attached: 0, quietMs, inputEmpty: false }
    return { exists: true, status: 'idle', attached: 0, quietMs, inputEmpty: true }
  }

  async respawn(name, cwd, command) {
    const result = this.run(['respawn-pane', '-t', paneTarget(name), '-c', cwd, command], cwd)
    if (result.status !== 0) throw new Error('tmux resume failed; session preserved')
  }

  async start(name, cwd, command, prompt, { ready = /[❯$#%]\s*$/m, timeoutMs = 30000, persistent = false } = {}) {
    if (this.hasSession(name, cwd)) return { existing: true }
    const started = this.run(['new-session', '-d', '-s', name, '-c', cwd, command], cwd)
    if (started.status !== 0) throw new Error('tmux không tạo được phiên agent')
    if (persistent) {
      const retained = this.run(['set-option', '-w', '-t', paneTarget(name), 'remain-on-exit', 'on'], cwd)
      if (retained.status !== 0) throw new Error('tmux cannot retain task pane; session preserved')
      return { existing: false }
    }
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
    this.run(['send-keys', '-t', paneTarget(name), '-l', prompt], cwd)
    await this.sleep(250)
    this.run(['send-keys', '-t', paneTarget(name), 'C-m'], cwd)
    return { existing: false }
  }
}
