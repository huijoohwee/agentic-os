/** Opt-in, protected GitHub check evidence. Never authorizes a release or caches live probes. */
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/governance.mjs';
import { gh, remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { hash, readGit, readRegular, safePath } from './agentic-os-test-inputs.mjs';

export const CI_EVIDENCE = 'agentic-os/protected-ci-evidence/v1';
const POLICY = 'agentic-os/ci-evidence-policy/v1', INPUT = 'agentic-os/ci-evidence-input/v1';
const HEX = /^[a-f0-9]{40}$/u, DIGEST = /^[a-f0-9]{64}$/u, MAX_BYTES = 65_536;
const fail = reason => { throw new Error(`blocked-ci-evidence:${reason}`); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const integer = n => Number.isSafeInteger(n) && n > 0;
const text = s => typeof s === 'string' && s.length > 0 && s.length <= 256 && !/[\x00-\x1f]/u.test(s);
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).sort().join(',') === [...keys].sort().join(',');
const digest = o => hash(canonicalJson(o));
const json = file => JSON.parse(readRegular(dirname(resolve(file)), relative(dirname(resolve(file)), resolve(file)), MAX_BYTES).text);
function save(file, value) {
  const bytes = canonicalJson(value) + '\n';
  if (Buffer.byteLength(bytes) > MAX_BYTES) fail('record-budget');
  writeFileSync(resolve(file), bytes, { flag: 'wx', mode: 0o600 });
}
export function validateCiEvidencePolicy(p) {
  if (!exact(p, ['schema', 'repository', 'workflow', 'branch', 'job', 'step', 'command', 'dependencies', 'environment', 'maxAgeSeconds'])
    || p.schema !== POLICY || !/^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(p.repository)
    || !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/u.test(p.workflow)
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(p.branch) || p.branch.includes('..')
    || !text(p.job) || !text(p.step) || !Array.isArray(p.command) || !p.command.length || p.command.length > 16
    || !p.command.every(text) || !integer(p.maxAgeSeconds) || p.maxAgeSeconds > 86_400
    || !Array.isArray(p.dependencies) || p.dependencies.length > 8
    || !Array.isArray(p.environment) || p.environment.length > 32
    || new Set(p.environment).size !== p.environment.length
    || !p.environment.every(v => /^[A-Za-z_][A-Za-z0-9_]{0,95}$/u.test(v))) fail('policy');
  const ids = new Set(['source']);
  for (const dep of p.dependencies) {
    if (!exact(dep, ['id', 'repository', 'path']) || !/^[a-z][a-z0-9-]{0,31}$/u.test(dep.id) || ids.has(dep.id)
      || !/^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(dep.repository)
      || !/^\.\.\/[A-Za-z0-9_.-]+$/u.test(dep.path) || dep.path.endsWith('/..')) fail('dependency-policy');
    ids.add(dep.id);
  }
  return p;
}
function sourceIdentity(root, repository) {
  const origin = remoteRepositoryIdentity(readGit(root, ['config', '--get', 'remote.origin.url']).trim());
  if (origin?.repository.toLowerCase() !== repository.toLowerCase()) fail('repository');
  const revision = readGit(root, ['rev-parse', 'HEAD']).trim(), tree = readGit(root, ['rev-parse', 'HEAD^{tree}']).trim();
  if (!HEX.test(revision) || !HEX.test(tree) || readGit(root, ['diff', '--name-only', '-z', 'HEAD', '--'])) fail('dirty-source');
  return { repository, revision, tree };
}
export function captureCiInputs(root, policyFile, environment = process.env) {
  root = realpathSync(root); const rel = safePath(relative(root, resolve(root, policyFile)));
  const file = readRegular(root, rel, MAX_BYTES), policy = validateCiEvidencePolicy(JSON.parse(file.text));
  if (readGit(root, ['show', `HEAD:${rel}`]) !== file.text) fail('uncommitted-policy');
  const sources = [{ id: 'source', ...sourceIdentity(root, policy.repository) },
    ...policy.dependencies.map(d => ({ id: d.id, ...sourceIdentity(resolve(root, d.path), d.repository) }))];
  if (environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_SERVER_URL !== 'https://github.com'
    || environment.GITHUB_REPOSITORY !== policy.repository.slice(11)
    || environment.GITHUB_SHA !== sources[0].revision || environment.GITHUB_REF !== `refs/heads/${policy.branch}`
    || environment.RUNNER_ENVIRONMENT !== 'github-hosted'
    || !['ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH'].every(k => text(environment[k]))) fail('runner-context');
  const facts = Object.fromEntries(['ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH'].map(k => [k, environment[k]]));
  const input = { schema: INPUT, policyDigest: file.digest, sources, node: process.version,
    platform: process.platform, arch: process.arch, runner: facts,
    ownerDigest: hash(readFileSync(fileURLToPath(import.meta.url))),
    environmentDigest: digest(policy.environment.map(k => [k, environment[k] ?? null])) };
  return { policy, input, inputDigest: digest(input) };
}
export function sealCiEvidence(before, current, environment = process.env, now = Date.now()) {
  if (!same(before, current) || environment.GITHUB_EVENT_NAME !== 'push'
    || environment.GITHUB_WORKFLOW_REF !== `${current.policy.repository.slice(11)}/${current.policy.workflow}@refs/heads/${current.policy.branch}`
    || !integer(Number(environment.GITHUB_RUN_ID)) || !integer(Number(environment.GITHUB_RUN_ATTEMPT))) fail('seal-context');
  return { schema: CI_EVIDENCE, authority: false, input: current.input, inputDigest: current.inputDigest,
    runId: Number(environment.GITHUB_RUN_ID), runAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
    workflow: current.policy.workflow, job: current.policy.job, step: current.policy.step,
    command: current.policy.command, sealedAt: new Date(now).toISOString() };
}
function runBinding(run, policy, current, now) {
  const repo = policy.repository.slice(11);
  if (!integer(run?.id) || !integer(run.run_attempt) || !integer(run.workflow_id)
    || run.repository?.full_name !== repo || run.head_repository?.full_name !== repo
    || run.repository?.id !== run.head_repository?.id || !integer(run.repository.id)
    || run.head_sha !== current.input.sources[0].revision || run.head_branch !== policy.branch
    || run.event !== 'push' || run.path !== policy.workflow || run.status !== 'completed' || run.conclusion !== 'success'
    || !Number.isFinite(Date.parse(run.run_started_at)) || !Number.isFinite(Date.parse(run.updated_at))
    || Date.parse(run.updated_at) > now || now - Date.parse(run.run_started_at) > policy.maxAgeSeconds * 1000
    || run.html_url !== `https://github.com/${repo}/actions/runs/${run.id}`) fail('run-not-reusable');
  return run;
}
function items(payload, key, limit) {
  if (!integer(payload?.total_count) || payload.total_count > limit || !Array.isArray(payload[key])
    || payload[key].length !== payload.total_count) fail(`${key}-inventory`);
  return payload[key];
}
function artifactBinding(artifact, run, name) {
  if (!integer(artifact?.id) || artifact.name !== name || artifact.expired !== false
    || !integer(artifact.size_in_bytes) || artifact.size_in_bytes > MAX_BYTES
    || !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? '')
    || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha
    || artifact.workflow_run?.repository_id !== run.repository.id
    || artifact.workflow_run?.head_repository_id !== run.repository.id) fail('artifact-binding');
  return artifact;
}
export function evidenceArtifactName(runId, attempt) { return `agentic-os-ci-evidence-${runId}-${attempt}`; }
/** Provider must be a current authenticated GitHub API reader; local receipts alone never qualify. */
export function lookupCiEvidence(current, api, now = Date.now()) {
  const { policy } = current, repo = policy.repository.slice(11), base = `repos/${repo}`;
  const branch = api(`${base}/branches/${encodeURIComponent(policy.branch)}`);
  if (branch?.protected !== true || branch.commit?.sha !== current.input.sources[0].revision) fail('protected-tip');
  const payload = api(`${base}/actions/workflows/${encodeURIComponent(policy.workflow.split('/').at(-1))}/runs?head_sha=${current.input.sources[0].revision}&event=push&per_page=10`);
  const runs = items(payload, 'workflow_runs', 10).sort((a, b) => b.id - a.id);
  // Never select an older pass behind a newer pending, failed or cancelled run.
  const run = runBinding(runs[0], policy, current, now);
  const jobs = items(api(`${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`), 'jobs', 100);
  const selected = jobs.filter(j => j.name === policy.job);
  if (selected.length !== 1) fail('job-identity');
  const job = selected[0], steps = job.steps?.filter(s => s.name === policy.step);
  if (!integer(job.id) || job.run_id !== run.id || job.head_sha !== run.head_sha || job.run_attempt !== run.run_attempt
    || job.status !== 'completed' || job.conclusion !== 'success' || steps?.length !== 1
    || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') fail('job-not-passed');
  const name = evidenceArtifactName(run.id, run.run_attempt);
  const artifacts = items(api(`${base}/actions/runs/${run.id}/artifacts?per_page=100`), 'artifacts', 100)
    .filter(a => a.name === name);
  if (artifacts.length !== 1) fail('artifact-identity');
  const artifact = artifactBinding(artifacts[0], run, name);
  return { schema: 'agentic-os/ci-evidence-lookup/v1', authority: false,
    inputDigest: current.inputDigest, runId: run.id, runAttempt: run.run_attempt,
    runUrl: run.html_url, workflowId: run.workflow_id, jobId: job.id, artifactId: artifact.id,
    artifactName: name, artifactDigest: artifact.digest, observedAt: new Date(now).toISOString() };
}
export function verifyCiEvidence(evidence, current, previousLookup, api, now = Date.now()) {
  const observed = lookupCiEvidence(current, api, now);
  const binding = value => ({ ...value, observedAt: null });
  if (!same(binding(observed), binding(previousLookup))) fail('provider-drift');
  if (!exact(evidence, ['schema', 'authority', 'input', 'inputDigest', 'runId', 'runAttempt', 'workflow', 'job', 'step', 'command', 'sealedAt'])
    || evidence.schema !== CI_EVIDENCE || evidence.authority !== false
    || !same(evidence.input, current.input) || evidence.inputDigest !== current.inputDigest
    || digest(evidence.input) !== evidence.inputDigest || !DIGEST.test(evidence.inputDigest)
    || evidence.runId !== observed.runId || evidence.runAttempt !== observed.runAttempt
    || evidence.workflow !== current.policy.workflow || evidence.job !== current.policy.job
    || evidence.step !== current.policy.step || !same(evidence.command, current.policy.command)
    || !Number.isFinite(Date.parse(evidence.sealedAt)) || Date.parse(evidence.sealedAt) > now
    || now - Date.parse(evidence.sealedAt) > current.policy.maxAgeSeconds * 1000) fail('evidence-binding');
  return { schema: 'agentic-os/ci-evidence-reuse/v1', authority: false, reused: true,
    inputDigest: current.inputDigest, runUrl: observed.runUrl, runId: observed.runId,
    runAttempt: observed.runAttempt, artifactId: observed.artifactId, artifactDigest: observed.artifactDigest,
    command: current.policy.command, observedAt: observed.observedAt };
}
function provider(root) {
  const deadline = Date.now() + 30_000; let calls = 0;
  return endpoint => {
    const remaining = deadline - Date.now();
    if (++calls > 8 || remaining <= 0) fail('provider-budget');
    const value = gh(['api', endpoint, '--hostname', 'github.com'], { cwd: root, timeoutMs: Math.min(10_000, remaining) });
    if (value === null || Buffer.byteLength(JSON.stringify(value)) > 512_000) fail('provider-unavailable');
    return value;
  };
}
export function ciEvidenceArguments(argv) {
  const [mode, ...flags] = argv, options = {};
  const required = { capture: ['policy', 'output'], seal: ['policy', 'before', 'output'],
    lookup: ['policy', 'output'], verify: ['policy', 'lookup', 'evidence', 'output'] }[mode];
  if (!required) fail('arguments');
  for (const flag of flags) {
    const m = /^--([a-z]+)=(.+)$/u.exec(flag);
    if (!m || !required.includes(m[1]) || Object.hasOwn(options, m[1])) fail('arguments');
    options[m[1]] = m[2];
  }
  if (required.some(k => !options[k])) fail('arguments');
  return { mode, ...options };
}
export function runCiEvidence(argv, environment = process.env) {
  const options = ciEvidenceArguments(argv), root = realpathSync(process.cwd());
  let result;
  try {
    const current = captureCiInputs(root, options.policy, environment);
    if (options.mode === 'capture') result = current;
    if (options.mode === 'seal') result = sealCiEvidence(json(options.before), current, environment);
    if (options.mode === 'lookup') result = lookupCiEvidence(current, provider(root));
    if (options.mode === 'verify') result = verifyCiEvidence(json(options.evidence), current, json(options.lookup), provider(root));
  } catch (error) {
    if (!['lookup', 'verify'].includes(options.mode)) throw error;
    result = { schema: 'agentic-os/ci-evidence-reuse/v1', authority: false, reused: false,
      reason: String(error.message).startsWith('blocked-ci-evidence:') ? error.message : 'blocked-ci-evidence:unavailable' };
  }
  save(options.output, result);
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT,
    `reused=${result.reused === true}\navailable=${Boolean(result.artifactName)}\n`
    + (result.artifactName ? `run-id=${result.runId}\nartifact-name=${result.artifactName}\n` : ''));
  console.log(canonicalJson(result));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runCiEvidence(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
