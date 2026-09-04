import { createHash } from 'node:crypto';
import { compositionRevision, readCompositionHeadFile } from './composition-git.mjs';

export const COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA =
  'agentic-os/composition-deployment-topology/v1';

const MAXIMUM_SOURCE_BYTES = 500_000;
const MANIFEST_SCHEMA = 'agentic-commerce-production-core-services/v1';
const SERVICE_BINDINGS = Object.freeze([
  'ACOS_ADMISSION', 'CHECKOUT_PROVIDER', 'COMMERCE_SANDBOX', 'DOCS_MCP',
  'MARKETPLACE_PROVIDER',
]);
const FILES = Object.freeze({
  acos: 'wrangler.jsonc', commerceCore: 'wrangler.core.jsonc',
  commerceManifest: 'config/production-core-services.json',
  commerceSandbox: 'wrangler.sandbox.jsonc',
  graphMcp: 'cloudflare/workers/agentic-graph-mcp/wrangler.toml',
  graphTravel: 'cloudflare/workers/agentic-graph-travel-commerce/wrangler.jsonc',
  graphMarketplace: 'cloudflare/workers/agentic-graph-marketplace/wrangler.jsonc',
});
const COMPONENTS = Object.freeze([
  'agentic-os', 'agentic-canvas-os', 'agentic-graph', 'agentic-commerce-os',
]);
const EXECUTION_CODES = Object.freeze([
  'cross_repository_deployment_topology_failed',
  'cross_repository_deployment_topology_invalid',
]);
const FINDING_CODES = Object.freeze([
  ...EXECUTION_CODES, 'provider_service_declaration_unreadable',
  'provider_production_service_name_invalid', 'commerce_production_service_binding_invalid',
  'commerce_release_manifest_unreadable', 'commerce_release_manifest_untracked',
  'commerce_release_manifest_bytes_unbound', 'commerce_release_manifest_invalid',
  'commerce_production_service_target_mismatch', 'commerce_release_service_target_mismatch',
  'topology_component_changed_during_inspection',
]);
const TOPOLOGY_FILE = 'bin/composition-deployment-topology.mjs';

/** Observe declarations and an index-bound manifest without evaluating owner code. */
export function inspectCompositionDeploymentTopology(roots, components = null) {
  const findings = [];
  const revisions = {};
  for (const component of COMPONENTS.filter(value => value !== 'agentic-os')) {
    const revision = components?.[component]?.revision ?? compositionRevision(roots?.[component]);
    revisions[component] = revision;
    if (!/^[0-9a-f]{40}$/u.test(revision ?? '')
      || compositionRevision(roots?.[component]) !== revision) {
      findings.push(finding(component, TOPOLOGY_FILE,
        'topology_component_changed_during_inspection'));
    }
  }
  const source = (component, file) => {
    try { return readSource(roots?.[component], revisions[component], file); } catch {
      findings.push(finding(component, file, 'provider_service_declaration_unreadable'));
      return null;
    }
  };
  const json = (component, file) => {
    const value = source(component, file);
    if (value === null) return null;
    try { return parseJsonc(value); } catch {
      findings.push(finding(component, file, 'provider_service_declaration_unreadable'));
      return null;
    }
  };
  const acos = json('agentic-canvas-os', FILES.acos);
  const sandbox = json('agentic-commerce-os', FILES.commerceSandbox);
  const mcpSource = source('agentic-graph', FILES.graphMcp);
  const travel = json('agentic-graph', FILES.graphTravel);
  const marketplace = json('agentic-graph', FILES.graphMarketplace);
  const expectedServices = orderedMap({
    ACOS_ADMISSION: rootJsoncName(acos),
    CHECKOUT_PROVIDER: productionName(travel),
    COMMERCE_SANDBOX: productionName(sandbox),
    DOCS_MCP: mcpSource === null ? null : rootTomlName(mcpSource),
    MARKETPLACE_PROVIDER: productionName(marketplace),
  });
  for (const binding of SERVICE_BINDINGS) {
    const value = expectedServices[binding] ?? null;
    if (!validServiceName(value)) findings.push(finding(
      providerComponent(binding), providerFile(binding),
      'provider_production_service_name_invalid', binding, null, value,
    ));
  }
  const core = json('agentic-commerce-os', FILES.commerceCore);
  const configuredServices = serviceMap(core?.env?.production?.services,
    'commerce_production_service_binding_invalid', FILES.commerceCore, findings);
  let manifest = null;
  try { manifest = readTrackedManifest(
    roots?.['agentic-commerce-os'], revisions['agentic-commerce-os'],
  ); }
  catch (error) {
    findings.push(finding('agentic-commerce-os', FILES.commerceManifest,
      FINDING_CODES.includes(error?.code) ? error.code : 'commerce_release_manifest_unreadable'));
  }
  const releaseServices = serviceMap(manifest?.value?.services,
    'commerce_release_manifest_invalid', FILES.commerceManifest, findings);
  compareServices(configuredServices, expectedServices,
    'commerce_production_service_target_mismatch', FILES.commerceCore, findings);
  compareServices(releaseServices, expectedServices,
    'commerce_release_service_target_mismatch', FILES.commerceManifest, findings);
  for (const component of COMPONENTS.filter(value => value !== 'agentic-os')) {
    if (compositionRevision(roots?.[component]) !== revisions[component]) {
      findings.push(finding(component, TOPOLOGY_FILE,
        'topology_component_changed_during_inspection'));
    }
  }
  return Object.freeze({
    schema: COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA, ok: findings.length === 0,
    candidateCodeExecuted: false, topologyManifestDigest: manifest?.digest ?? null,
    topologyManifestBlob: manifest?.oid ?? null, expectedServices, configuredServices,
    releaseServices, findings: Object.freeze(findings),
  });
}

export function executeCompositionDeploymentTopology(
  roots, components, inspect = inspectCompositionDeploymentTopology,
) {
  if (inspect !== inspectCompositionDeploymentTopology) {
    return invalidReport('cross_repository_deployment_topology_invalid');
  }
  try {
    const report = inspect(roots, components);
    return isValidCompositionDeploymentTopologyReport(report)
      ? normalizedReport(report) : invalidReport('cross_repository_deployment_topology_invalid');
  } catch { return invalidReport('cross_repository_deployment_topology_failed'); }
}

export function compositionDeploymentTopologyRuntimeFindings(report) {
  return Object.freeze(report.findings.map(item => Object.freeze({
    component: item.component, file: item.file, code: item.code,
    detail: item.binding
      ? `${item.binding}: ${item.observed ?? 'missing'} != ${item.expected ?? 'missing'}` : null,
  })));
}

export function isValidCompositionDeploymentTopologyReport(report) {
  try {
    const keys = ['candidateCodeExecuted', 'configuredServices', 'expectedServices', 'findings',
      'ok', 'releaseServices', 'schema', 'topologyManifestBlob', 'topologyManifestDigest'];
    if (!dataRecord(report, keys, keys) || report.schema !== COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA
      || typeof report.ok !== 'boolean' || report.candidateCodeExecuted !== false
      || !Array.isArray(report.findings)) return false;
    const maps = [report.expectedServices, report.configuredServices, report.releaseServices];
    if (maps.some(map => !serviceRecord(map))) return false;
    if (report.ok) return report.findings.length === 0
      && /^[0-9a-f]{64}$/u.test(report.topologyManifestDigest)
      && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(report.topologyManifestBlob)
      && maps.every(map => SERVICE_BINDINGS.every(binding => validServiceName(map[binding])))
      && SERVICE_BINDINGS.every(binding => report.expectedServices[binding]
        === report.configuredServices[binding]
        && report.expectedServices[binding] === report.releaseServices[binding]);
    const manifestEvidence = report.topologyManifestDigest === null
      && report.topologyManifestBlob === null
      || /^[0-9a-f]{64}$/u.test(report.topologyManifestDigest ?? '')
        && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(report.topologyManifestBlob ?? '');
    return manifestEvidence && report.findings.length > 0 && report.findings.every(validFinding);
  } catch { return false; }
}

function invalidReport(code) {
  return Object.freeze({
    schema: COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA, ok: false,
    candidateCodeExecuted: false, topologyManifestDigest: null, topologyManifestBlob: null,
    expectedServices: Object.freeze({}), configuredServices: Object.freeze({}),
    releaseServices: Object.freeze({}),
    findings: Object.freeze([finding('agentic-os', TOPOLOGY_FILE, code)]),
  });
}
function normalizedReport(report) {
  return Object.freeze({
    schema: COMPOSITION_DEPLOYMENT_TOPOLOGY_SCHEMA, ok: report.ok,
    candidateCodeExecuted: false, topologyManifestDigest: report.topologyManifestDigest,
    topologyManifestBlob: report.topologyManifestBlob,
    expectedServices: orderedMap(report.expectedServices),
    configuredServices: orderedMap(report.configuredServices),
    releaseServices: orderedMap(report.releaseServices),
    findings: Object.freeze(report.findings.map(item => finding(
      item.component, item.file, item.code, item.binding, item.expected, item.observed,
    ))),
  });
}
function readTrackedManifest(rootValue, revision) {
  let observed;
  try { observed = readCompositionHeadFile(rootValue, revision,
    FILES.commerceManifest, 65_536, 'composition topology manifest'); }
  catch (error) {
    if (error?.code === 'composition_head_file_untracked') {
      throw coded('commerce_release_manifest_untracked');
    }
    if (error?.code === 'composition_head_file_bytes_unbound') {
      throw coded('commerce_release_manifest_bytes_unbound');
    }
    throw coded('commerce_release_manifest_unreadable');
  }
  const { bytes, oid } = observed;
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); value = JSON.parse(text); }
  catch { throw coded('commerce_release_manifest_invalid'); }
  if (!validManifest(value) || text !== `${JSON.stringify(sortJson(value))}\n`) {
    throw coded('commerce_release_manifest_invalid');
  }
  return Object.freeze({ value, oid, digest: sha256(bytes) });
}
function validManifest(value) {
  return dataRecord(value, ['schema', 'services'], ['schema', 'services'])
    && value.schema === MANIFEST_SCHEMA && Array.isArray(value.services)
    && value.services.length === SERVICE_BINDINGS.length
    && value.services.every((entry, index) => dataRecord(
      entry, ['binding', 'service'], ['binding', 'service'],
    ) && entry.binding === SERVICE_BINDINGS[index] && validServiceName(entry.service));
}
function serviceMap(entries, invalidCode, file, findings) {
  const values = {};
  if (!Array.isArray(entries)) {
    findings.push(finding('agentic-commerce-os', file, invalidCode)); entries = [];
  }
  for (const entry of entries) {
    const binding = entry?.binding, service = entry?.service;
    if (!dataRecord(entry, ['binding', 'service'], ['binding', 'service'])
      || !SERVICE_BINDINGS.includes(binding) || !validServiceName(service) || binding in values) {
      findings.push(finding('agentic-commerce-os', file, invalidCode,
        typeof binding === 'string' ? binding : null, null,
        typeof service === 'string' ? service : null));
    } else values[binding] = service;
  }
  for (const binding of SERVICE_BINDINGS) if (!(binding in values)) {
    findings.push(finding('agentic-commerce-os', file, invalidCode, binding));
  }
  return orderedMap(values);
}
function compareServices(observed, expected, code, file, findings) {
  for (const binding of SERVICE_BINDINGS) if (observed[binding] !== expected[binding]) {
    findings.push(finding('agentic-commerce-os', file, code, binding,
      expected[binding], observed[binding]));
  }
}
function readSource(rootValue, revision, file) {
  const { bytes } = readCompositionHeadFile(rootValue, revision, file,
    MAXIMUM_SOURCE_BYTES, 'composition deployment topology');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function stripJsonComments(source) {
  let output = '', string = false, escaped = false, line = false, block = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index], next = source[index + 1];
    if (line) { if (current === '\n' || current === '\r') { line = false; output += current; } continue; }
    if (block) { if (current === '*' && next === '/') { block = false; output += ' '; index += 1; }
      else if (current === '\n' || current === '\r') output += current; continue; }
    if (string) { output += current; if (escaped) escaped = false;
      else if (current === '\\') escaped = true; else if (current === '"') string = false; continue; }
    if (current === '"') { string = true; output += current; }
    else if (current === '/' && next === '/') { line = true; output += ' '; index += 1; }
    else if (current === '/' && next === '*') { block = true; output += ' '; index += 1; }
    else output += current;
  }
  if (block || string) throw new Error('unterminated JSONC token');
  return output;
}
function parseJsonc(source) {
  const input = stripJsonComments(source); let output = '', string = false, escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    if (string) { output += current; if (escaped) escaped = false;
      else if (current === '\\') escaped = true; else if (current === '"') string = false; continue; }
    if (current === '"') { string = true; output += current; continue; }
    if (current === ',') { let cursor = index + 1; while (/\s/u.test(input[cursor] ?? '')) cursor += 1;
      if (input[cursor] === '}' || input[cursor] === ']') continue; }
    output += current;
  }
  return JSON.parse(output);
}
function rootTomlName(source) {
  let name = null;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = tomlCodeLine(rawLine)?.trim();
    if (line === undefined) return null;
    if (line === '') continue;
    if (line.startsWith('[')) return validTomlTableHeader(line) ? name : null;
    if (!/^name(?:\s|=)/u.test(line)) continue;
    const match = line.match(/^name\s*=\s*(?:"([A-Za-z0-9-]+)"|'([A-Za-z0-9-]+)')\s*$/u);
    if (!match || name !== null || !validServiceName(match[1] ?? match[2])) return null;
    name = match[1] ?? match[2];
  }
  return name;
}
function tomlCodeLine(line) {
  let quote = null, escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    if (quote !== null) { if (quote === '"' && escaped) escaped = false;
      else if (quote === '"' && current === '\\') escaped = true;
      else if (current === quote) quote = null; }
    else if (current === '"' || current === "'") quote = current;
    else if (current === '#') return line.slice(0, index);
  }
  return quote === null ? line : undefined;
}
function validTomlTableHeader(line) {
  const key = '[A-Za-z0-9_-]+(?:\\s*\\.\\s*[A-Za-z0-9_-]+)*';
  return new RegExp(`^\\[${key}\\]$`, 'u').test(line)
    || new RegExp(`^\\[\\[${key}\\]\\]$`, 'u').test(line);
}
function rootJsoncName(config) { return typeof config?.name === 'string' ? config.name : null; }
function productionName(config) { return typeof config?.env?.production?.name === 'string'
  ? config.env.production.name : null; }
function orderedMap(values) { return Object.freeze(Object.fromEntries(SERVICE_BINDINGS
  .filter(binding => typeof values?.[binding] === 'string').map(binding => [binding, values[binding]]))); }
function serviceRecord(value) { return dataRecord(value, SERVICE_BINDINGS)
  && Object.values(value).every(validServiceName); }
function dataRecord(value, allowed, required = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptors(value)[key], 'value'))
    && required.every(key => keys.includes(key));
}
function validFinding(item) {
  return dataRecord(item, ['component', 'file', 'code', 'binding', 'expected', 'observed'],
    ['component', 'file', 'code', 'binding', 'expected', 'observed'])
    && COMPONENTS.includes(item.component)
    && [...Object.values(FILES), TOPOLOGY_FILE].includes(item.file)
    && FINDING_CODES.includes(item.code)
    && (item.binding === null || SERVICE_BINDINGS.includes(item.binding))
    && validEvidenceValue(item.expected) && validEvidenceValue(item.observed);
}
function providerComponent(binding) { return binding === 'ACOS_ADMISSION' ? 'agentic-canvas-os'
  : binding === 'COMMERCE_SANDBOX' ? 'agentic-commerce-os' : 'agentic-graph'; }
function providerFile(binding) { return binding === 'ACOS_ADMISSION' ? FILES.acos
  : binding === 'COMMERCE_SANDBOX' ? FILES.commerceSandbox
    : binding === 'DOCS_MCP' ? FILES.graphMcp
      : binding === 'CHECKOUT_PROVIDER' ? FILES.graphTravel : FILES.graphMarketplace; }
function validServiceName(value) { return typeof value === 'string'
  && /^[a-z0-9](?:[a-z0-9-]{0,253}[a-z0-9])?$/u.test(value); }
function validEvidenceValue(value) { return value === null
  || (typeof value === 'string' && value.length <= 255); }
function boundedEvidenceValue(value) { return typeof value === 'string' && value.length <= 255
  ? value : null; }
function sortJson(value) { return Array.isArray(value) ? value.map(sortJson)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])])) : value; }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function coded(code) { return Object.assign(new Error(code), { code }); }
function finding(component, file, code, binding = null, expected = null, observed = null) {
  return Object.freeze({ component, file, code,
    binding: SERVICE_BINDINGS.includes(binding) ? binding : null,
    expected: boundedEvidenceValue(expected), observed: boundedEvidenceValue(observed) });
}
