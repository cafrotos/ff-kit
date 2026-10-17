// Key secrets theo adapter. Module này không bao giờ trả giá trị của .ff.env, chỉ tên key.
import fs from 'node:fs'

export const ADAPTER_KEYS = {
  trello: [
    { key: 'TRELLO_API_KEY', hint: 'Trello API key: https://trello.com/power-ups/admin → chọn Power-Up → API key' },
    { key: 'TRELLO_API_TOKEN', hint: 'Trello token: bấm link "Token" ở trang API key phía trên' },
  ],
  rocketchat: [
    { key: 'RC_URL', hint: 'URL server Rocket.Chat, vd https://chat.example.com' },
    { key: 'RC_USER_ID', hint: 'Rocket.Chat → My Account → Personal Access Tokens → User Id' },
    { key: 'RC_AUTH_TOKEN', hint: 'Rocket.Chat → My Account → Personal Access Tokens → Token' },
    { key: 'RC_ROOM_ID', hint: 'ID phòng nhận thông báo' },
  ],
  console: [],
}

// Key theo tính năng (không phải adapter).
export const FEATURE_KEYS = {
  'e2e-form-login': [
    { key: 'E2E_USER', hint: 'Tài khoản test để ff-e2e đăng nhập (e2e.auth.strategy: form-login)' },
    { key: 'E2E_PASSWORD', hint: 'Mật khẩu của tài khoản test trên' },
  ],
}

const adaptersOf = (config) => [config.worker?.task_source?.adapter, config.worker?.channel?.adapter].filter(Boolean)

function neededEntries(config) {
  const seen = new Set()
  const features = config.e2e?.auth?.strategy === 'form-login' ? FEATURE_KEYS['e2e-form-login'] : []
  return [...adaptersOf(config).flatMap((a) => ADAPTER_KEYS[a] ?? []), ...features].filter((k) => !seen.has(k.key) && seen.add(k.key))
}

export const requiredKeys = (config) => neededEntries(config).map((k) => k.key)

// D20: key adapter thuộc nhóm worker; key đăng nhập e2e thuộc nhóm e2e.
export function requiredKeysByGroup(config) {
  const e2e = new Set(FEATURE_KEYS['e2e-form-login'].map((k) => k.key))
  const all = requiredKeys(config)
  return { worker: all.filter((k) => !e2e.has(k)), e2e: all.filter((k) => e2e.has(k)) }
}

export function parseEnvKeys(text, { withValueOnly = true } = {}) {
  const keys = new Set()
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
    else v = v.replace(/^#.*$/, '').replace(/\s+#.*$/, '')
    if (!withValueOnly || v.length) keys.add(m[1])
  }
  return keys
}

export function presentKeys(file) {
  try {
    return parseEnvKeys(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function mergeEnvExample(exampleFile, config) {
  let text = ''
  try {
    text = fs.readFileSync(exampleFile, 'utf8')
  } catch {}
  const have = parseEnvKeys(text, { withValueOnly: false })
  const add = neededEntries(config).filter((k) => !have.has(k.key))
  if (!add.length) return []
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let out = text
  if (!text) out = `# Mẫu cho .ff.env — điền giá trị vào .ff.env, không commit .ff.env.${eol}`
  else if (!text.endsWith('\n')) out += eol
  for (const k of add) out += `# ${k.hint}${eol}${k.key}=${eol}`
  fs.writeFileSync(exampleFile, out)
  return add.map((k) => k.key)
}
