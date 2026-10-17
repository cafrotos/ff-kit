import type { FullConfig } from '@playwright/test'
import { ffConfig } from './helpers/env'

export default async function globalSetup(config: FullConfig): Promise<void> {
  const urls = new Set<string>([
    ...(ffConfig.e2e.health_urls ?? []),
    ...config.projects.map((project) => project.use?.baseURL as string | undefined).filter(Boolean),
  ])
  const errors: string[] = []
  for (const url of urls) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(5_000) })
    } catch {
      errors.push(url)
    }
  }
  if (errors.length) {
    throw new Error([
      'Server chưa sẵn sàng:',
      ...errors.map((url) => `- Không kết nối được ${url}`),
      'Tự bật server rồi chạy lại: ff verify-up <id> <app>.',
    ].join('\n'))
  }
}
