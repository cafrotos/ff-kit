import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  api: async ({ request }, use) => use(request),
})

export { expect }
