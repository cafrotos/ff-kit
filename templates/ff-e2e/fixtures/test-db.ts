import { test as base, expect } from '@playwright/test'
import { withDb, type Db } from '../helpers/db'
import type { APIRequestContext } from '@playwright/test'

export const test = base.extend<{ api: APIRequestContext; db: Db }>({
  api: async ({ request }, use) => use(request),
  db: async ({}, use) => withDb((db) => use(db)),
})

export { expect }
