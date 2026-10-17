import path from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { ffConfig } from './helpers/env'

const e2e = ffConfig.e2e
const thisDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: e2e.tests_dir ? path.resolve(ffConfig.root, e2e.tests_dir) : './tests',
  globalSetup: path.join(thisDir, 'global-setup.ts'),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: (e2e.apps ?? []).map((app: { name: string; base_url: string }) => ({
    name: app.name,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: app.base_url,
      ...(ffConfig.e2e.auth_storage ? { storageState: path.resolve(ffConfig.root, ffConfig.e2e.auth_storage) } : {}),
    },
  })),
})
