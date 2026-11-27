export type ContentSecurityPolicyMode = 'enforce' | 'report-only'
export type ContentSecurityPolicyHeaderName = 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only'
export type ContentSecurityPolicyOptions = Readonly<{
  mode: ContentSecurityPolicyMode
  policy: string
}>

export function contentSecurityPolicyHeaderName(mode: ContentSecurityPolicyMode): ContentSecurityPolicyHeaderName
export function validateContentSecurityPolicy(policy: string): string
export function setContentSecurityPolicy(headers: Headers, options: ContentSecurityPolicyOptions): Headers
export function assertContentSecurityPolicy(headers: Headers, options: ContentSecurityPolicyOptions): string
export function formatContentSecurityPolicyHeader(mode: ContentSecurityPolicyMode, policy: string, indent?: string): string
