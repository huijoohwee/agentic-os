/** Execute consumer-owned validation through one bounded, input-bound shared owner. */
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { remoteRepositoryIdentity } from '../src/github-provider.mjs';
import { readGit, hash, readRegular } from './agentic-os-test-inputs.mjs';
import { executeCommand, lockReceipts, previousCheck, receiptDirectory, writeCheck, writeReceipt } from './agentic-os-test-receipt.mjs';
import { ciArguments } from './agentic-os-test-ci.mjs';
import { consumerSnapshotReader, CONSUMER_LIMITS, sourceDigest } from './agentic-os-validation-inputs.mjs';
import { ECONOMY_FILE, economyContext, readEconomy, observeCost, costOrderedChecks, resourcePlan } from './agentic-os-validation-economy.mjs';
import { VALIDATION_POLICY, VALIDATION_VERSION, validateValidationPolicy, selectValidationChecks,
  checkInputPatterns, matchesInput } from './agentic-os-validation-policy.mjs';
const runtimeRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const runtimeFiles = ['bin/agentic-os-validation.mjs', 'bin/agentic-os-validation-policy.mjs',
  'bin/agentic-os-validation-inputs.mjs', 'bin/agentic-os-test-inputs.mjs', 'bin/agentic-os-test-receipt.mjs',
  'bin/agentic-os-test-ci.mjs', 'bin/agentic-os-validation-economy.mjs',
  'bin/agentic-os-validation-stages.mjs', 'bin/agentic-os-validation-observation.mjs'];
const runtimeDigest = () => hash(JSON.stringify(runtimeFiles.map(path => [path, readRegular(runtimeRoot, path).digest])));
export function validationArguments(argv) {
  const [mode = 'run', ...flags] = argv;
  if (!['plan', 'run', 'ci', 'observe'].includes(mode)) throw new Error('expected validation plan, run, ci or observe');
  const options = { mode, root: process.cwd(), base: 'origin/main', all: false, fresh: false };
  const seen = new Set();
  for (const flag of flags) {
    const match = /^--(root|base|only|input|offset)=(.+)$/u.exec(flag), key = match?.[1] ?? flag.slice(2);
    if (seen.has(key)) throw new Error('duplicate validation option'); seen.add(key);
    if (match) options[key] = key === 'only' ? match[2].split(',') : match[2];
    else if (['--all', '--fresh'].includes(flag)) options[key] = true;
    else throw new Error('unknown validation option');
  }
  if (mode === 'ci' && (seen.has('base') || seen.has('all'))) throw new Error('CI owns its validation baseline');
  if (seen.has('input') && mode !== 'observe' || mode === 'observe' && [...seen].some(key => !['root', 'input', 'offset'].includes(key)))
    throw new Error('observation accepts only root, input and offset');
  if (seen.has('offset') && (mode !== 'observe' || !/^(0|[1-9][0-9]*)$/u.test(options.offset))) throw new Error('invalid observation offset');
  return options;
}
export function resolveValidationCi(root, environment = process.env) {
  if (environment.GITHUB_ACTIONS !== 'true' || !environment.GITHUB_EVENT_PATH) throw new Error('blocked-validation-ci-context');
  const head = readGit(root, ['rev-parse', 'HEAD']).trim();
  const eventBytes = readFileSync(environment.GITHUB_EVENT_PATH);
  if (eventBytes.length > 499_000) throw new Error('blocked-validation-ci-event-budget');
  const event = JSON.parse(eventBytes), pr = event.pull_request;
  // Some existing owners deliberately validate the PR head instead of the synthetic merge.
  // Bind both revisions to the provider event and retain that narrower surface in the receipt.
  if (environment.GITHUB_EVENT_NAME === 'pull_request' && pr?.head?.sha === head
    && /^[a-f0-9]{40}$/u.test(pr?.base?.sha) && !/^0+$/u.test(pr.base.sha)
    && /^[a-f0-9]{40}$/u.test(environment.GITHUB_SHA) && !/^0+$/u.test(environment.GITHUB_SHA)) {
    // merge_commit_sha may be absent/stale on the opened webhook. Bind the provider
    // revision directly to its actual parents instead of accepting metadata as proof.
    if (environment.GITHUB_SHA !== head) {
      const parents = readGit(root, ['show', '-s', '--format=%P', `${environment.GITHUB_SHA}^{commit}`]).trim().split(' ');
      if (parents.length !== 2 || parents[0] !== pr.base.sha || parents[1] !== head)
        throw new Error('blocked-validation-ci-checkout-parents');
    }
    return { base: pr.base.sha, head, committed: true, fresh: true, all: false, checkout: 'pull-request-head' };
  }
  if (environment.GITHUB_SHA !== head) throw new Error('blocked-validation-ci-checkout');
  if (['workflow_dispatch', 'schedule'].includes(environment.GITHUB_EVENT_NAME))
    return { base: head, head, committed: true, fresh: true, all: true, checkout: 'event-revision' };
  const parents = readGit(root, ['show', '-s', '--format=%P', head]).trim().split(' ');
  const args = ciArguments(event, environment.GITHUB_EVENT_NAME, head, parents);
  return { base: args.find(arg => arg.startsWith('--base=')).slice(7), head, committed: true, fresh: true, all: false,
    checkout: environment.GITHUB_EVENT_NAME === 'pull_request' ? 'pull-request-merge' : 'event-revision' };
}
export function validationCheckDefinitions(policy, plan, observed, ownerDigest) {
  return plan.checks.map(check => {
    const patterns = checkInputPatterns(policy, check.id);
    const files = new Map([...observed.after].filter(([path]) => patterns.some(input => matchesInput(path, input))
      || path === VALIDATION_POLICY || /(^|\/)(?:package(?:-lock)?\.json|\.npmrc)$/u.test(path)));
    const { root, configurationDigest, environmentDigest, node, executable, platform, arch } = observed.identity;
    const fingerprint = hash(JSON.stringify({ version: VALIDATION_VERSION, ownerDigest, check: policy.checks.find(item => item.id === check.id),
      sourceDigest: sourceDigest(files), root, configurationDigest, environmentDigest, node, executable, platform, arch }));
    return { ...check, id: `consumer-${hash(check.id).slice(0, 24)}`, name: check.id, stage: 'owner-check', report: 'exit',
      command: check.command[0] === 'node' ? process.execPath : check.command[0], args: check.command.slice(1), fingerprint };
  });
}
/** Receipt diagnostics are bounded; selection and source validation use the complete plan. */
export function validationPlanReceipt(plan) {
  const evidence = values => ({ count: values.length, digest: hash(JSON.stringify(values)),
    sample: values.slice(0, 8).map(value => value.slice(0, 256)),
    abbreviated: values.length > 8 || values.slice(0, 8).some(value => value.length > 256) });
  return { schema: 'agentic-os/validation-plan-receipt/v1', digest: hash(JSON.stringify(plan)),
    mode: plan.mode, partition: plan.partition, available: plan.available,
    changed: evidence(plan.changed), broadReasons: evidence(plan.broadReasons),
    unmatchedPaths: evidence(plan.unmatchedPaths),
    checks: plan.checks.map(check => ({ id: check.id,
      reasons: { count: check.reasons.length, digest: hash(JSON.stringify(check.reasons)) } })) };
}
export async function runRepositoryValidation(argv, { out = console.log } = {}) {
  const options = validationArguments(argv), root = realpathSync(resolve(options.root));
  if (options.mode === 'observe') {
    const { readValidationObservation } = await import('./agentic-os-validation-observation.mjs');
    out(JSON.stringify(readValidationObservation(root, options.input, Number(options.offset ?? 0)), null, 2));
    return 0;
  }
  const ci = options.mode === 'ci' || Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  const marker = hash(root), previousMarker = process.env.AGENTIC_OS_VALIDATION_ACTIVE;
  if (previousMarker?.split(':').includes(marker)) throw new Error('blocked-validation-recursive-run');
  process.env.AGENTIC_OS_VALIDATION_ACTIVE = [previousMarker, marker].filter(Boolean).join(':');
  try {
    if (ci) {
      if (argv.some(flag => flag.startsWith('--base=') || flag === '--all')) throw new Error('CI owns its validation baseline');
      Object.assign(options, resolveValidationCi(root));
    }
    const policyFile = readRegular(root, VALIDATION_POLICY, 128_000);
    const policy = validateValidationPolicy(JSON.parse(policyFile.text));
    const origin = remoteRepositoryIdentity(readGit(root, ['config', '--get', 'remote.origin.url']).trim());
    if (origin?.repository.toLowerCase() !== policy.repository.toLowerCase()) throw new Error('blocked-validation-repository-identity');
    const observe = consumerSnapshotReader({ root, base: options.base, head: options.head || 'HEAD', committed: options.committed });
    const observed = observe(), plan = selectValidationChecks(policy, observed.changed, options), ownerDigest = runtimeDigest();
    const directory = receiptDirectory(root);
    const context = economyContext(policyFile.digest, ownerDigest, observed.identity);
    const readCosts = () => readEconomy(directory, context, Date.now(), policy.checks.map(check => check.id));
    const economy = readCosts();
    const checks = costOrderedChecks(validationCheckDefinitions(policy, plan, observed, ownerDigest), economy);
    const priorFor = check => !options.fresh && !ci && check.reuse === 'local'
      ? previousCheck(directory, check, Date.now(), { allowFailure: true }) : null;
    const previews = checks.map(check => {
      const prior = priorFor(check), matches = prior?.fingerprint === check.fingerprint;
      return { id: check.name, command: [check.command, ...check.args], reasons: check.reasons,
        reuse: matches && prior.outcome === 'passed', unchangedFailure: matches && prior.outcome === 'failed',
        estimatedMs: matches && prior.outcome === 'passed' ? 0 : economy.checks[check.name]?.meanMs ?? null };
    });
    const resources = resourcePlan(checks, economy, previews, { checkout: options.checkout,
      observedBytes: observed.observedBytes, runMs: CONSUMER_LIMITS.runMs });
    if (options.mode === 'plan') {
      out(JSON.stringify({ schema: VALIDATION_VERSION, authority: false, repository: policy.repository,
        identity: observed.identity, execution: ci ? 'ci' : 'local', checkout: options.checkout ?? 'working-tree',
        policyDigest: policyFile.digest, ownerDigest, plan,
        selectedChecks: checks.length, skippedChecks: plan.available - checks.length, checks: previews, resources }, null, 2));
      return 0;
    }
    const release = lockReceipts(receiptDirectory(root)), started = performance.now();
    if (JSON.stringify(readCosts()) !== JSON.stringify(economy)) {
      release(); throw new Error('blocked-validation-cost-drift');
    }
    const receipt = { schema: VALIDATION_VERSION, authority: false, repository: policy.repository,
      identity: observed.identity, execution: ci ? 'ci' : 'local', checkout: options.checkout ?? 'working-tree',
      policyDigest: policyFile.digest, ownerDigest, plan: validationPlanReceipt(plan),
      source: { repository: policy.repository, revision: readGit(root, ['rev-parse', 'HEAD']).trim(),
        tree: readGit(root, ['rev-parse', 'HEAD^{tree}']).trim(),
        dirty: Boolean(readGit(root, ['status', '--porcelain=v1', '--untracked-files=normal']).trim()) },
      outcome: 'running', startedAt: Date.now(), results: [], resources, costRegressions: [] };
    const stable = () => {
      if (JSON.stringify(observe().identity) !== JSON.stringify(observed.identity) || runtimeDigest() !== ownerDigest)
        throw new Error('blocked-validation-input-drift');
    };
    out(`${plan.mode}: ${checks.length}/${plan.available} owner checks; ${observed.changed.length} changed paths; no full-suite parity inferred`);
    try {
      stable(); writeReceipt(directory, 'validation-last.json', receipt);
      // A prior unchanged failure is already a sufficient blocker; do not spend on earlier checks first.
      if (resources.unchangedFailures.length)
        throw new Error(`blocked-validation-unchanged-failure:${resources.unchangedFailures.join(',')}; inspect retained log or use --fresh after a new observation`);
      for (const check of checks) {
        stable();
        const prior = priorFor(check);
        if (prior?.fingerprint === check.fingerprint) {
          if (prior.outcome === 'failed') throw new Error(`blocked-validation-unchanged-failure:${check.name}; inspect retained log or use --fresh after a new observation`);
          receipt.results.push({ id: check.name, reused: true, ...prior.result, validatedAt: prior.finishedAt });
          out(`reused ${check.name}`); continue;
        }
        const remaining = CONSUMER_LIMITS.runMs - (performance.now() - started);
        if (remaining <= 0) throw new Error('blocked-validation-time-budget');
        out(`running ${check.name}: ${[check.command, ...check.args].join(' ')}`);
        const result = await executeCommand(root, check.command, check.args,
          { timeoutMs: Math.min(check.timeoutMs, remaining), outputMode: 'tail',
            onProgress: progress => out(`running ${check.name}: ${Math.floor(progress.elapsedMs / 1000)}s elapsed, `
              + `${Math.ceil(Math.max(0, progress.timeoutMs - progress.elapsedMs) / 1000)}s budget remaining, `
              + `${progress.observedOutputBytes} output bytes, ${Math.floor(progress.quietMs / 1000)}s since output`) });
        stable();
        const saved = writeCheck(directory, check, result);
        receipt.results.push({ id: check.name, reused: false, ...saved.result, validatedAt: saved.finishedAt });
        if (result.exitCode !== 0 || result.reason) receipt.outcome = 'failed';
        writeReceipt(directory, 'validation-last.json', receipt);
        try {
          const regression = observeCost(economy, check, result);
          if (regression) { receipt.costRegressions.push(regression); out(`cost regression ${check.name}: ${Math.round(regression.previousMeanMs)}ms mean -> ${Math.round(result.elapsedMs)}ms`); }
          writeReceipt(directory, ECONOMY_FILE, economy);
        } catch (error) {
          receipt.costObservationError = error.message;
          out(`cost observation unavailable: ${error.message}`);
        }
        out(`${check.name}: exit ${result.exitCode}, ${(result.elapsedMs / 1000).toFixed(2)}s${result.outputTruncated ? ', bounded log tail retained' : ''}`);
        if (result.exitCode !== 0 || result.reason) {
          receipt.outcome = 'failed'; out(result.output.slice(-12_000)); break;
        }
      }
      stable();
      if (receipt.outcome === 'running') receipt.outcome = 'passed';
    } catch (error) { receipt.outcome = 'blocked'; receipt.error = error.message; out(error.message); }
    finally {
      receipt.finishedAt = Date.now(); receipt.elapsedMs = performance.now() - started;
      try { writeReceipt(directory, 'validation-last.json', receipt); } finally { release(); }
    }
    out(`validation receipt: ${join(directory, 'validation-last.json')}`);
    return receipt.outcome === 'passed' ? 0 : 1;
  } finally {
    if (previousMarker === undefined) delete process.env.AGENTIC_OS_VALIDATION_ACTIVE;
    else process.env.AGENTIC_OS_VALIDATION_ACTIVE = previousMarker;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try { process.exitCode = await runRepositoryValidation(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
