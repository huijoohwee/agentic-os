import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertContentSecurityPolicy,
  formatContentSecurityPolicyHeader,
  setContentSecurityPolicy,
  validateContentSecurityPolicy,
} from '../lib/content-security-policy.mjs'

const policy = "default-src 'self'; script-src 'self'; style-src 'self'"

test('sets and verifies one enforcing or report-only policy', () => {
  for (const mode of ['enforce', 'report-only']) {
    const headers = new Headers({ 'content-security-policy': 'default-src *' })
    setContentSecurityPolicy(headers, { mode, policy })
    assert.equal(assertContentSecurityPolicy(headers, { mode, policy }), policy)
    assert.equal(headers.has(mode === 'enforce' ? 'content-security-policy-report-only' : 'content-security-policy'), false)
  }
})

test('rejects a missing, conflicting, or changed policy header', () => {
  const headers = new Headers({ 'content-security-policy-report-only': policy })
  assert.throws(() => assertContentSecurityPolicy(headers, { mode: 'enforce', policy }), /header_mismatch/u)
  headers.set('content-security-policy', policy)
  assert.throws(() => assertContentSecurityPolicy(headers, { mode: 'enforce', policy }), /conflicting/u)
  headers.delete('content-security-policy-report-only')
  headers.set('content-security-policy', `${policy}; img-src *`)
  assert.throws(() => assertContentSecurityPolicy(headers, { mode: 'enforce', policy }), /header_mismatch/u)
})

test('rejects duplicate directives and unsupported modes', () => {
  assert.throws(() => validateContentSecurityPolicy("default-src 'self'; DEFAULT-SRC *"), /duplicate/u)
  assert.throws(() => setContentSecurityPolicy(new Headers(), { mode: 'dev', policy }), /unsupported/u)
})

test('formats static header blocks through the common policy owner', () => {
  assert.equal(formatContentSecurityPolicyHeader('enforce', policy), `  Content-Security-Policy: ${policy}`)
})
