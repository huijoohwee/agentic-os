#!/usr/bin/env node
/**
 * Small autonomous authoring loop.  This command owns no lifecycle policy: it
 * delegates checkout and checkin to the guarded `agentic-os` entrypoint.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./agentic-os.mjs', import.meta.url));
const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);

function usage() {
  out('usage:');
  out('  agentic-os-checkin-checkout checkout <scope> --write=<path[,path...]> [--device=<device>]');
  out('  agentic-os-checkin-checkout checkin --message=<commit message>');
}

function fail(message) {
  err(`blocked-checkin-checkout-arguments: ${message}`);
  return 1;
}

function exactOption(argv, name) {
  const matches = argv.filter((value) => value.startsWith(`--${name}=`));
  if (matches.length > 1) return { error: `duplicate --${name}` };
  if (matches.length === 0) return { value: null };
  const value = matches[0].slice(name.length + 3);
  return value.length === 0 ? { error: `empty --${name}` } : { value };
}

function child(command, args) {
  const result = spawnSync(process.execPath, [CLI, command, ...args], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return Number.isInteger(result.status) ? result.status : 1;
}

function checkout(argv) {
  const [scope, ...flags] = argv.filter((value) => !value.startsWith('--'));
  if (!scope || argv.filter((value) => !value.startsWith('--')).length !== 1)
    return fail('checkout requires exactly one scope');
  const write = exactOption(flags, 'write');
  const device = exactOption(flags, 'device');
  if (write.error || device.error) return fail(write.error ?? device.error);
  if (write.value === null) return fail('checkout requires --write=<path[,path...]>');
  if (flags.some((value) => !value.startsWith('--write=') && !value.startsWith('--device=')))
    return fail('checkout accepts only --write and --device');
  return child('start', [scope, `--write=${write.value}`,
    ...(device.value === null ? [] : [`--device=${device.value}`])]);
}

function checkin(argv) {
  if (argv.some((value) => !value.startsWith('--message=')))
    return fail('checkin accepts only --message');
  const message = exactOption(argv, 'message');
  if (message.error) return fail(message.error);
  if (message.value === null) return fail('checkin requires --message=<commit message>');
  const branch = spawnSync('git', ['branch', '--show-current'], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'],
  });
  if (branch.status !== 0 || !branch.stdout.trim().startsWith('agent/')) {
    err('blocked-checkin-requires-lane: run checkin from its registered agent/<device>/<scope> worktree');
    return 1;
  }
  const checks = spawnSync('npm', ['test'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  if (checks.stdout) process.stdout.write(checks.stdout);
  if (checks.stderr) process.stderr.write(checks.stderr);
  if (checks.status !== 0) {
    err('blocked-checkin-checks-failed: preserve authored bytes and repair the reported check failure');
    return 1;
  }
  return child('land', [`--message=${message.value}`]);
}

const [action, ...argv] = process.argv.slice(2);
let status;
if (action === 'checkout') status = checkout(argv);
else if (action === 'checkin') status = checkin(argv);
else if (action === 'help' || action === '--help' || action === undefined) {
  usage(); status = action === undefined ? 1 : 0;
} else status = fail(`unknown action ${JSON.stringify(action)}`);
process.exitCode = status;
