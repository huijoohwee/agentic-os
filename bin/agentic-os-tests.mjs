/** Repository-owned affected validation; explicit all and compatibility fast/git entrypoints. */
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { checkInputResolver, IMPACT_VERSION, selectTests } from './agentic-os-test-impact.mjs';
import { hash, LIMITS, manifestDigest, snapshotReader } from './agentic-os-test-inputs.mjs';
import { executeCommand, lockReceipts, receiptDirectory, previousCheck, writeCheck, writeReceipt } from './agentic-os-test-receipt.mjs';

import { ciBudgetsJobIsExact } from './agentic-os-doc-budget.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FAST = ['lane-state.test.mjs', 'governance-contract.test.mjs', 'completion.test.mjs', 'authority-evidence.test.mjs'];
export function parseArguments(argv) {
  const [mode = 'affected', ...flags] = argv;
  if (!['affected', 'all', 'plan', 'fast', 'git'].includes(mode)) throw new Error('expected affected, all, plan, fast or git');
  const options = { mode, base: 'origin/main', head: 'HEAD', committed: false, fresh: false, 'ci-run': null };
  const seen = new Set();
  for (const flag of flags) {
    const match = flag.match(/^--(base|head|ci-run)=(.+)$/u), key = match?.[1] ?? flag.slice(2);
    if (seen.has(key)) throw new Error('duplicate test option'); seen.add(key);
    if (match && key === 'ci-run') {
      if (!/^[1-9][0-9]{0,15}$/u.test(match[2])) throw new Error('invalid ci-run');
      options['ci-run'] = match[2];
    } else if (match) options[key] = match[2];
    else if (['--committed', '--fresh'].includes(flag)) options[key] = true;
    else throw new Error(`unknown test option:${flag}`);
  }
  if (['fast', 'git'].includes(mode) && flags.length) throw new Error('fast/git accepts no options');
  return options;
}

/** Skip a second local suite only when bound CI already covers this exact HEAD. */
export function boundCiCoverage(identity, observation) {
  if (observation == null) return null;
  const source = observation.source ?? {};
  if (source.revision !== identity.headRevision || source.tree !== identity.headTree)
    throw new Error('blocked-ci-coverage-identity');
  const runId = Number(observation.ci?.runId);
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('blocked-ci-coverage-run');
  const status = observation.status ?? observation.outcome;
  if (status === 'failed' || status === 'blocked') return null;
  if (status === 'passed' || status === 'running' || observation.coverage?.partial === true)
    return { runId, status: status === 'passed' ? 'passed' : 'running' };
  return null;
}

/** Local reuse excludes unrelated revision changes only when the check has bounded inputs. */
export function validationChecks(observed, plan) {
  const { after, identity } = observed, inputsFor = checkInputResolver(after);
  const shared = [...after].filter(([path]) => path === 'package.json' || path === 'package-lock.json'
    || path === '.npmrc' || path === 'test/impact-contracts.json' || path.startsWith('bin/agentic-os-test'));
  const definitions = [{ name: 'evaluators', stage: 'evaluators', command: 'npm', args: ['run', 'evals'],
    inputs: { scope: 'repository', paths: [], reasons: ['repository-evaluators'] } },
  ...plan.suites.map(suite => ({ name: suite.path, stage: suite.stage, command: process.execPath,
    args: ['--test', '--test-reporter=tap', '--test-concurrency=1', suite.path],
    inputs: inputsFor(suite.path) }))];
  return definitions.map(check => {
    const inputs = check.inputs.scope === 'repository' ? identity : {
      sourceDigest: manifestDigest(new Map([...shared, ...check.inputs.paths.map(path => [path, after.get(path)])
        .filter(([, file]) => file)])), root: identity.root,
      configurationDigest: identity.configurationDigest, environmentDigest: identity.environmentDigest,
      node: identity.node, executable: identity.executable, platform: identity.platform, arch: identity.arch, git: identity.git };
    return { ...check, id: `check-${hash(check.name).slice(0, 24)}`,
      fingerprint: hash(JSON.stringify({ version: IMPACT_VERSION, command: [check.command, ...check.args], inputs })) };
  });
}

/** Fill idle slots without crossing stage barriers; stop new work after any failure. */
export async function runCheckPool(checks, run, concurrency = 4) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('invalid-check-concurrency');
  const pending = [...checks].sort((a,b) => (b.estimatedMs ?? 0) - (a.estimatedMs ?? 0) || a.name.localeCompare(b.name));
  let next = 0, stopped = false, failure;
  await Promise.all(Array.from({length: Math.min(concurrency, pending.length)}, async () => {
    while (!stopped && next < pending.length) {
      const check = pending[next++];
      try { if (await run(check) === false) stopped = true; }
      catch (error) { stopped = true; failure ??= error; }
    }
  }));
  if (failure) throw failure;
}

/** Allocate evaluator coverage to the unchanged required CI job; this is not passed evidence. */
export function ciEvaluatorAllocation(workflow, environment, revision) {
  const e = environment;
  if (e.GITHUB_ACTIONS !== 'true' || e.GITHUB_JOB !== 'test' || e.GITHUB_SHA !== revision
    || !/^[a-f0-9]{40}$/u.test(revision) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(e.GITHUB_REPOSITORY ?? '')
    || !e.GITHUB_WORKFLOW_REF?.startsWith(`${e.GITHUB_REPOSITORY}/.github/workflows/ci.yml@`)
    || !/^[1-9][0-9]*$/u.test(e.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]*$/u.test(e.GITHUB_RUN_ATTEMPT ?? '')
    || !ciBudgetsJobIsExact(workflow)) throw Error('blocked-test-ci-evaluator-owner');
  return { name: 'budgets', workflow: '.github/workflows/ci.yml', workflowDigest: hash(workflow),
    revision, runId: e.GITHUB_RUN_ID, runAttempt: e.GITHUB_RUN_ATTEMPT, status: 'not-observed' };
}

export async function runTests(argv, { root = ROOT, out = console.log, ci = false, ciObservation } = {}) {
  const options = parseArguments(argv);
  if (['fast', 'git'].includes(options.mode)) {
    const files = readdirSync(join(root, '__tests__')).filter(name => name.endsWith('.test.mjs'))
      .filter(name => options.mode === 'fast' ? FAST.includes(name) : !FAST.includes(name)).sort();
    const result = await executeCommand(root, process.execPath,
      ['--test', '--test-reporter=tap', '--test-concurrency=4', ...files.map(name => `__tests__/${name}`)]);
    out(result.output); return result.reason ? 1 : result.exitCode ?? 1;
  }
  const observe = snapshotReader({ root, base: options.base, head: options.head, committed: options.committed });
  const observed = observe(), plan = selectTests({ ...observed, forceAll: options.mode === 'all' });
  if (ci && (!options.committed || !options.fresh || options.mode !== 'affected')) throw Error('blocked-test-ci-options');
  const externalRequiredChecks = ci ? [ciEvaluatorAllocation(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'),
    process.env, observed.identity.headRevision)] : [];
  const directory = receiptDirectory(root), checks = validationChecks(observed, plan)
    .filter(check => !ci || check.stage !== 'evaluators');
  const ciRun = options['ci-run'] ?? (/^[1-9][0-9]{0,15}$/u.test(process.env.AGENTIC_OS_CI_RUN ?? '')
    ? process.env.AGENTIC_OS_CI_RUN : null);
  let coverage = null;
  if (ciRun && !ci && !options.fresh && options.mode !== 'all' && !options.committed) {
    const observation = ciObservation ?? (await import('./agentic-os-ci-observation.mjs'))
      .readCiObservation(root, ciRun);
    coverage = boundCiCoverage(observed.identity, observation);
  }
  const canReuse = !options.fresh && options.mode !== 'all' && !options.committed
    && !process.env.CI && !process.env.GITHUB_ACTIONS && coverage === null;
  const decorate = check => {
    const prior = previousCheck(directory, check);
    return { ...check, prior, reuse: Boolean(canReuse && prior?.fingerprint === check.fingerprint),
      estimatedMs: prior?.result.elapsedMs ?? (check.stage === 'evaluators' ? 10_000 : check.stage === 'packaging' ? 30_000 : 3_000),
      estimateSource: prior ? 'previous-check' : 'default-budget-estimate' };
  };
  const preview = checks.map(decorate), summary = {
    selected: plan.suites.length, skipped: plan.available - plan.suites.length,
    reused: coverage ? checks.length : preview.filter(check => check.reuse).length,
    estimatedCommandMs: coverage ? 0 : Math.ceil(preview.reduce((total, check) => total + (check.reuse ? 0 : check.estimatedMs), 0)),
    concurrency: 4, timeBudgetMs: LIMITS.testMs, outputBytesPerCheck: LIMITS.outputBytes,
    ...(coverage ? { boundCi: coverage } : {}) };
  if (options.mode === 'plan') {
    out(JSON.stringify({ identity: observed.identity, ...plan, cost: summary,
      checks: preview.map(({ prior, ...check }) => check) }, null, 2)); return 0;
  }
  const release = lockReceipts(directory), started = performance.now();
  const receipt = { schema: 'agentic-os/test-receipt/v2', authority: false,
    identity: observed.identity, plan, cost: summary, externalRequiredChecks, outcome: 'running', exitCode: null,
    startedAt: Date.now(), results: [] };
  const stable = () => {
    if (JSON.stringify(observe().identity) !== JSON.stringify(observed.identity))
      throw new Error('blocked-test-input-drift');
  };
  try {
    stable();
    if (ci) out('evaluators: allocated to required budgets job; result not observed by test job');
    writeReceipt(directory, 'last.json', receipt);
    out(`${plan.mode}: ${plan.suites.length}/${plan.available} suites; ${plan.changed.length} changed paths; ${summary.skipped} skipped`);
    out(`cost: ~${(summary.estimatedCommandMs / 1000).toFixed(1)} command-seconds, ${summary.reused} reusable checks; concurrency 4; budget ${LIMITS.testMs / 1000}s`);
    if (plan.reasons.length) out(`coverage reasons: ${plan.reasons.join(', ')}`);
    for (const suite of plan.suites) out(`selected ${suite.path}: ${suite.reasons.join(', ')}`);
    if (coverage) {
      out(`deferred local suite: bound CI ${coverage.runId} covers HEAD (${coverage.status})`);
      for (const check of checks) {
        receipt.results.push({ name: check.name, stage: check.stage, reused: true, reusedFrom: 'bound-ci',
          runId: coverage.runId, exitCode: 0, elapsedMs: 0, reason: null, counts: { tests: 0, pass: 0, fail: 0, cancelled: 0 },
          validatedAt: receipt.startedAt });
      }
    } else for (const stage of ['evaluators', 'behavior', 'packaging']) {
      const pending = [];
      for (const original of checks.filter(check => check.stage === stage)) {
        const check = decorate(original);
        if (check.reuse) {
          receipt.results.push({ name: check.name, stage, ...check.prior.result,
            reused: true, validatedAt: check.prior.finishedAt });
          out(`reused local check: ${check.name}`);
        } else pending.push(check);
      }
      await runCheckPool(pending, async check => {
        stable();
        const remaining = LIMITS.testMs - (performance.now() - started);
        if (remaining <= 0) throw new Error('blocked-test-time-budget');
        out(`running ${check.name}`);
        const result = await executeCommand(root, check.command, check.args,
          { timeoutMs: Math.min(remaining, stage === 'evaluators' ? 60_000 : LIMITS.testMs) });
        if (stage !== 'evaluators' && result.exitCode === 0 && (!result.counts.tests
          || result.counts.fail !== 0 || result.counts.cancelled !== 0)) result.reason ||= 'incomplete-test-report';
        stable();
        const saved = writeCheck(directory, check, result);
        receipt.results.push({ name: check.name, stage, ...saved.result, reused: false, validatedAt: saved.finishedAt });
        out(`${check.name}: exit ${result.exitCode}, ${(result.elapsedMs / 1000).toFixed(2)}s, ${JSON.stringify(result.counts)}`);
        if (result.exitCode !== 0 || result.reason) {
          receipt.outcome = result.reason ? 'interrupted' : 'failed'; receipt.exitCode = 1;
          out(result.output.slice(-16_000)); return false;
        }
        return true;
      });
      if (receipt.outcome !== 'running') break;
    }
    stable();
    if (receipt.outcome === 'running') { receipt.outcome = 'passed'; receipt.exitCode = 0; }
  } catch (error) {
    receipt.outcome = 'blocked'; receipt.exitCode = 1; receipt.error = error.message;
    out(error.message);
  } finally {
    receipt.finishedAt = Date.now();
    receipt.elapsedMs = performance.now() - started;
    try { writeReceipt(directory, 'last.json', receipt); } finally { release(); }
  }
  out(`validation receipt: ${join(directory, 'last.json')}`);
  return receipt.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try { process.exitCode = await runTests(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
