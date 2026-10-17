import { test, expect } from '../../fixtures/test'

test('AC-01: sample app responds', async ({ request }) => {
  const response = await request.get('/')
  expect(response.ok()).toBeTruthy()
})
