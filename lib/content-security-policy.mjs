const HEADER_BY_MODE = Object.freeze({
  enforce: 'Content-Security-Policy',
  'report-only': 'Content-Security-Policy-Report-Only',
})

export function contentSecurityPolicyHeaderName(mode) {
  const header = HEADER_BY_MODE[mode]
  if (!header) throw new TypeError(`unsupported_content_security_policy_mode:${mode}`)
  return header
}

export function validateContentSecurityPolicy(policy) {
  if (typeof policy !== 'string' || !policy.trim()) throw new TypeError('content_security_policy_required')
  const directives = new Set()
  for (const part of policy.split(';')) {
    const directive = part.trim().split(/\s+/u, 1)[0]?.toLowerCase()
    if (!directive) continue
    if (!/^[a-z][a-z0-9-]*$/u.test(directive)) throw new TypeError(`invalid_content_security_policy_directive:${directive}`)
    if (directives.has(directive)) throw new TypeError(`duplicate_content_security_policy_directive:${directive}`)
    directives.add(directive)
  }
  return policy.trim()
}

export function setContentSecurityPolicy(headers, { mode, policy }) {
  if (!headers || typeof headers.set !== 'function' || typeof headers.delete !== 'function') {
    throw new TypeError('mutable_response_headers_required')
  }
  const name = contentSecurityPolicyHeaderName(mode)
  const normalized = validateContentSecurityPolicy(policy)
  for (const header of Object.values(HEADER_BY_MODE)) headers.delete(header)
  headers.set(name, normalized)
  return headers
}

export function assertContentSecurityPolicy(headers, { mode, policy }) {
  if (!headers || typeof headers.get !== 'function') throw new TypeError('response_headers_required')
  const name = contentSecurityPolicyHeaderName(mode)
  const otherName = Object.values(HEADER_BY_MODE).find(header => header !== name)
  const expected = validateContentSecurityPolicy(policy)
  if (headers.get(name) !== expected) throw new Error(`content_security_policy_header_mismatch:${name}`)
  if (headers.get(otherName) !== null) throw new Error(`conflicting_content_security_policy_header:${otherName}`)
  return expected
}

export function formatContentSecurityPolicyHeader(mode, policy, indent = '  ') {
  return `${indent}${contentSecurityPolicyHeaderName(mode)}: ${validateContentSecurityPolicy(policy)}`
}
