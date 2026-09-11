/** Repository-owned affected validation; explicit all and compatibility fast/git entrypoints. */
import { readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { selectTests } from './agentic-os-test-impact.mjs';
import { hash, LIMITS, snapshot } from './agentic-os-test-inputs.mjs';
import { executeCommand, lockReceipts, receiptDirectory, reusableReceipt, writeReceipt } from './agentic-os-test-receipt.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FAST = ['lane-state.test.mjs', 'governance-contract.test.mjs', 'completion.test.mjs', 'authority-evidence.test.mjs'];
export function parseArguments(argv) {
  const [mode = 'affected', ...flags] = argv;
  if (!['affected', 'all', 'plan', 'fast', 'git'].includes(mode)) throw new Error('expected affected, all, plan, fast or git');
  const options = { mode, base: 'origin/main', head: 'HEAD', committed: false, fresh: false };
  const seen = new Set();
  for (const flag of flags) {
    const match = flag.match(/^--(base|head)=(.+)$/u), key = match?.[1] ?? flag.slice(2);
    if (seen.has(key)) throw new Error('duplicate test option'); seen.add(key);
    if (match) options[key] = match[2];
    else if (['--committed', '--fresh'].includes(flag)) options[key] = true;
    else throw new Error(`unknown test option:${flag}`);
  }
  if (['fast', 'git'].includes(mode) && flags.length) throw new Error('fast/git accepts no options');
  return options;
}

export async function runTests(argv, { root = ROOT, out = console.log } = {}) {
  const options = parseArguments(argv);
  if (['fast', 'git'].includes(options.mode)) {
    const files = readdirSync(join(root, '__tests__')).filter(name => name.endsWith('.test.mjs'))
      .filter(name => options.mode === 'fast' ? FAST.includes(name) : !FAST.includes(name)).sort();
    const result = await executeCommand(root, process.execPath,
      ['--test', '--test-reporter=tap', '--test-concurrency=4', ...files.map(name => `__tests__/${name}`)]);
    out(result.output); return result.reason ? 1 : result.exitCode ?? 1;
  }
  const args = { root, base: options.base, head: options.head, committed: options.committed };
  const observed = snapshot(args);
  const plan = selectTests({ ...observed, forceAll: options.mode === 'all' });
  if (options.mode === 'plan') { out(JSON.stringify({ identity: observed.identity, ...plan }, null, 2)); return 0; }
  const directory = receiptDirectory(root), release = lockReceipts(directory);
  const fingerprint = hash(JSON.stringify({ identity: observed.identity, plan }));
  let receipt = { schema: 'agentic-os/test-receipt/v1', authority: false, fingerprint,
    identity: observed.identity, planDigest: hash(JSON.stringify(plan)), plan,
    outcome: 'running', exitCode: null, startedAt: Date.now(), results: [] };
  const stable = () => {
    if (JSON.stringify(snapshot(args).identity) !== JSON.stringify(observed.identity))
      throw new Error('blocked-test-input-drift');
  };
  try {
    stable();
    // CI executes fresh. A local success is only a short-lived development optimization.
    const previous = !options.fresh && options.mode !== 'all' && !process.env.CI && !process.env.GITHUB_ACTIONS
      ? reusableReceipt(directory, fingerprint, plan) : null;
    if (previous) {
      stable(); receipt = previous;
      out(`reused local validation: ${plan.suites.length}/${plan.available} suites; ${join(directory, 'last.json')}`);
      return 0;
    }
    writeReceipt(directory, 'last.json', receipt);
    out(`${plan.mode}: ${plan.suites.length}/${plan.available} suites; ${plan.changed.length} changed paths`);
    if (plan.reasons.length) out(`coverage reasons: ${plan.reasons.join(', ')}`);
    const commands = [{ name: 'evaluators', command: 'npm', args: ['run', 'evals'] },
      ...plan.stages.filter(stage => stage.tests.length).map(stage => ({ name: stage.name,
        command: process.execPath, args: ['--test', '--test-reporter=tap', '--test-concurrency=4', ...stage.tests] }))];
    const started = performance.now();
    for (const command of commands) {
      stable();
      const remaining = LIMITS.testMs - (performance.now() - started);
      if (remaining <= 0) throw new Error('blocked-test-time-budget');
      out(`running ${command.name}${command.name === 'packaging' ? ' (affected installation/export contracts)' : ''}`);
      const result = await executeCommand(root, command.command, command.args,
        { timeoutMs: Math.min(remaining, command.name === 'evaluators' ? 60_000 : LIMITS.testMs) });
      if (command.name !== 'evaluators' && result.exitCode === 0 && (!result.counts.tests
        || result.counts.fail !== 0 || result.counts.cancelled !== 0)) result.reason ||= 'incomplete-test-report';
      const { output, ...summary } = result;
      const log = `${command.name}.log`; writeReceipt(directory, log, output);
      receipt.results.push({ name: command.name, command: [command.command, ...command.args], ...summary, log });
      out(`${command.name}: exit ${result.exitCode}, ${(result.elapsedMs / 1000).toFixed(2)}s, ${JSON.stringify(result.counts)}`);
      if (result.exitCode !== 0 || result.reason) {
        receipt.outcome = result.reason ? 'interrupted' : 'failed'; receipt.exitCode = 1;
        out(output.slice(-16_000)); break;
      }
    }
    stable();
    if (receipt.outcome === 'running') { receipt.outcome = 'passed'; receipt.exitCode = 0; }
  } catch (error) {
    receipt.outcome = 'blocked'; receipt.exitCode = 1; receipt.error = error.message;
    out(error.message);
  } finally {
    receipt.finishedAt ??= Date.now();
    try { writeReceipt(directory, 'last.json', receipt); } finally { release(); }
  }
  out(`validation receipt: ${join(directory, 'last.json')}`);
  return receipt.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try { process.exitCode = await runTests(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
