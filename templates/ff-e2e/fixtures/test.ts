import { test as base, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { guardEgress } from '../helpers/egress'

export const test = base.extend<{ api: APIRequestContext; egressGuard: void }>({
  api: async ({ request }, use) => use(request),
  egressGuard: [async ({ context }, use) => guardEgress(context, () => use()), { auto: true }],
})

export { expect }
