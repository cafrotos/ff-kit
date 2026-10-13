import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const template = path.join(root, 'templates/ff-e2e')

test('e2e template is workspace-neutral and contains resolvable local imports', () => {
  const files = []
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else files.push(file)
  })
  walk(template)
  assert.ok(files.some((file) => file.endsWith('playwright.config.ts')))
  assert.ok(files.some((file) => file.endsWith('helpers/auth.ts')))
  assert.ok(files.some((file) => file.endsWith('helpers/jwt.ts')))
  assert.ok(files.some((file) => file.endsWith('examples/000-sample/main-behavior.spec.ts')))
  for (const file of files.filter((item) => /\.(?:ts|json|md)$/.test(item))) {
    const content = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(content, /tiniweb|oe-hrm-fe|system-service/i)
    if (!file.endsWith('.ts')) continue
    for (const match of content.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const withoutExtension = path.resolve(path.dirname(file), match[1]).replace(/\.js$/, '').replace(/\.ts$/, '')
      assert.ok(['.ts', '.tsx', '.js', '.mjs'].some((ext) => fs.existsSync(`${withoutExtension}${ext}`)), `${path.relative(template, file)} import ${match[1]} should resolve`)
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(template, 'package.json'), 'utf8'))
  assert.ok(pkg.devDependencies['@playwright/test'])
})

test('Playwright can enumerate the template when installed in this checkout', async (t) => {
  const executable = path.join(root, 'node_modules/.bin/playwright')
  if (!fs.existsSync(executable)) return t.skip('Playwright dependency is not installed in ff-kit')
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(executable, ['test', '--list', '--config', path.join(template, 'playwright.config.ts')], { cwd: template, encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
