import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = path => readFileSync(resolve(root, path), 'utf8')
const fail = message => { throw new Error(`content_security_policy_contract:${message}`) }
const manifest = JSON.parse(read('catalog/content-security-policy-consumers.json'))
const expectedRepositories = [
  'github.com/huijoohwee/agentic-design-system',
  'github.com/huijoohwee/agentic-commerce-os',
  'github.com/huijoohwee/agentic-graph',
]
if (manifest.schema !== 'agentic-os/content-security-policy-consumers/v1'
  || manifest.owner !== 'github.com/huijoohwee/agentic-os') fail('manifest_identity')
if (JSON.stringify(manifest.modes) !== JSON.stringify({ development: 'report-only', preproduction: 'enforce', production: 'enforce' })) fail('mode_defaults')
if (!Array.isArray(manifest.consumers) || JSON.stringify(manifest.consumers.map(item => item.repository)) !== JSON.stringify(expectedRepositories)) fail('consumer_coverage')
for (const consumer of manifest.consumers) {
  if (!Array.isArray(consumer.productionSurfaces) || consumer.productionSurfaces.length === 0
    || !consumer.developmentSurface || !consumer.gate?.workflow || !consumer.gate?.job || !consumer.gate?.command) {
    fail(`consumer_gate_incomplete:${consumer.repository}`)
  }
}
const prompt = read('guides/SYSTEM-PROMPT-RUNTIME.md')
if (!prompt.includes('Prod HTML CSP on; Dev Report-Only→enforce pre-Prod; scoped-owner exceptions')) fail('runtime_prompt_drift')
const guide = read('guides/CONTENT-SECURITY-POLICY.md')
for (const required of ['Production and pre-production HTML', 'Content-Security-Policy-Report-Only', 'agentic-os/content-security-policy']) {
  if (!guide.includes(required)) fail(`guide_missing:${required}`)
}
process.stdout.write(`${JSON.stringify({ schema: manifest.schema, consumers: manifest.consumers.length, modes: manifest.modes })}\n`)
