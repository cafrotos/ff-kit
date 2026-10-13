import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readEnvValues, renderPayload, signJwt, storageState } from '../scripts/lib/jwt.mjs'

test('JWT signer renders user fields and uuid and signs HS256 with expiry', () => {
  const config = {
    algorithm: 'HS256',
    expires_in: { default: '2h' },
    payload: { sub: '{user.id}', email: '{user.email}', sid: '{uuid}', role: 'worker' },
  }
  const token = signJwt(config, { id: 'u-1', email: 'a@example.test' }, 'secret', {
    now: 1_700_000_000, uuid: 'fixed-uuid',
  })
  const [head, body, signature] = token.split('.')
  const input = `${head}.${body}`
  assert.equal(signature, crypto.createHmac('sha256', 'secret').update(input).digest('base64url'))
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')), {
    sub: 'u-1', email: 'a@example.test', sid: 'fixed-uuid', role: 'worker', iat: 1_700_000_000, exp: 1_700_007_200,
  })
})

test('JWT signer uses the configured HS384/HS512 digest and explicit lifetime', () => {
  for (const [algorithm, digest] of [['HS384', 'sha384'], ['HS512', 'sha512']]) {
    const token = signJwt({ algorithm, payload: { sub: '{user.id}' } }, { id: 'u1' }, 'secret', { now: 100, uuid: 'fixed', expiresIn: '5m' })
    const [header, body, signature] = token.split('.')
    const input = `${header}.${body}`
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, algorithm)
    assert.equal(signature, crypto.createHmac(digest, 'secret').update(input).digest('base64url'))
    assert.equal(JSON.parse(Buffer.from(body, 'base64url')).exp, 400)
  }
})

test('payload rejects unknown or missing user placeholders', () => {
  assert.throws(() => renderPayload({ sub: '{user.id}', org: '{tenant.id}' }, { id: 'u-1' }), /placeholder/)
  assert.throws(() => renderPayload({ sub: '{user.id}' }, {}), /user\.id/)
})

test('env values parse quoted values without exposing them in key listing', () => {
  const env = readEnvValues('JWT_SECRET="a=b # c"\r\n# ignored\r\nEMPTY=\r\n')
  assert.equal(env.JWT_SECRET, 'a=b # c')
  assert.equal(env.EMPTY, '')
})

test('mcp storage state supports localStorage/cookie and rejects query-only delivery', () => {
  const state = storageState([{ name: 'web', base_url: 'https://app.example.test/path' }], [
    { via: 'local_storage', name: 'authToken' }, { via: 'cookie', name: 'sid' },
  ], 'jwt')
  assert.equal(state.origins[0].origin, 'https://app.example.test')
  assert.deepEqual(state.origins[0].localStorage, [{ name: 'authToken', value: 'jwt' }])
  assert.equal(state.cookies[0].name, 'sid')
  assert.throws(() => storageState([], [{ via: 'query', name: 'token' }], 'jwt'), /local_storage.*cookie/)
})
