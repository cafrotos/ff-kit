import type { Page } from '@playwright/test'

export const samplePage = (page: Page) => ({
  heading: page.getByRole('heading'),
})
