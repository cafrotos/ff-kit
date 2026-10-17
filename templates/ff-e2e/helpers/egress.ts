import type { BrowserContext } from '@playwright/test'
import { e2e } from './env'

// Cách ly: app đang test chỉ được gọi host loopback, host của chính e2e.apps/health_urls và e2e.allowed_hosts.
const hostOf = (url: string): string => { try { return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '') } catch { return '' } }

export function isLoopback(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

export function allowedHosts(): Set<string> {
  const urls: string[] = [...(e2e.apps ?? []).map((app: { base_url: string }) => app.base_url), ...(e2e.health_urls ?? [])]
  return new Set([...urls.map(hostOf), ...(e2e.allowed_hosts ?? []).map((host: string) => String(host).toLowerCase())].filter(Boolean))
}

export async function guardEgress(context: BrowserContext, use: () => Promise<void>): Promise<void> {
  const allowed = allowedHosts()
  const blocked = new Set<string>()
  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (/^(?:data|blob|about):/i.test(url)) return route.fallback()
    const host = hostOf(url)
    if (!host || isLoopback(host) || allowed.has(host)) return route.fallback()
    blocked.add(host) // chỉ ghi host: không in URL, header hay token
    return route.abort('blockedbyclient')
  })
  await use()
  if (blocked.size) throw new Error(`Vi phạm cách ly môi trường: app gọi ra host ngoài local: ${[...blocked].join(', ')}. Request đã bị chặn. Kiểm tra env/build của app (API trỏ về môi trường thật?) rồi chạy lại; chỉ thêm vào e2e.allowed_hosts khi host đó thật sự an toàn.`)
}
