import { test as base, expect } from '@playwright/test'
import { withDb, type Db } from '../helpers/db'
import { guardEgress } from '../helpers/egress'
import type { APIRequestContext } from '@playwright/test'

export const test = base.extend<{ api: APIRequestContext; db: Db; egressGuard: void }>({
  api: async ({ request }, use) => use(request),
  db: async ({}, use) => withDb((db) => use(db)),
  egressGuard: [async ({ context }, use) => guardEgress(context, () => use()), { auto: true }],
})

export { expect }
