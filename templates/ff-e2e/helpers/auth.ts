import type { Page } from '@playwright/test'
import { e2e, e2eUser, e2ePassword } from './env'
import { mintToken } from './jwt'

export type User = Record<string, unknown>
export type Db = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }

export function authHeader(user: User): { Authorization: string } {
  return { Authorization: `Bearer ${mintToken(user)}` }
}

export async function userByEmail(db: Db, email: string): Promise<User> {
  const query = e2e.auth?.jwt?.user_lookup
  if (!query) throw new Error('Thiếu e2e.auth.jwt.user_lookup.')
  const { rows } = await db.query<User>(query, [email])
  if (!rows[0]) throw new Error(`Không thấy user ${email}.`)
  return rows[0]
}

export async function loginAs(page: Page, app: string, path: string, user: User): Promise<void> {
  const appConfig = e2e.apps?.find((item: { name: string }) => item.name === app)
  if (!appConfig) throw new Error(`Không có app '${app}' trong e2e.apps.`)
  const url = new URL(path, appConfig.base_url)
  const strategy = e2e.auth?.strategy ?? 'none'
  if (strategy === 'jwt-mint') {
    const token = mintToken(user)
    const [deliver] = e2e.auth.jwt.deliver
    if (deliver.via === 'query') url.searchParams.set(deliver.name, token)
    else if (deliver.via === 'local_storage') await page.addInitScript(({ name, value }) => localStorage.setItem(name, value), { name: deliver.name, value: token })
    else await page.context().addCookies([{ name: deliver.name, value: token, url: appConfig.base_url }])
  }
  await page.goto(url.toString())
  if (strategy === 'form-login') {
    await page.locator('input[type="email"], input[name="email"]').first().fill(e2eUser() ?? '')
    await page.locator('input[type="password"]').first().fill(e2ePassword() ?? '')
    await page.locator('button[type="submit"]').first().click()
  }
}
