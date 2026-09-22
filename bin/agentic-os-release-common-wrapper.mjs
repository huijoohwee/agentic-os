#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { loadRepositoryProfile, resolveRepositoryRoot } from '../src/git-repository.mjs';
import {
  resolveReleaseCommonCleanupRequest,
  runReleaseCommonCleanup,
  runReleaseCommonCompleteWait,
} from './agentic-os-release-common-complete.mjs';

const repoLabel = process.argv.find((arg) => arg.startsWith('--repo-label='))?.slice(13) ?? 'consumer';
const splitIndex = process.argv.indexOf('--');
const args = splitIndex >= 0 ? process.argv.slice(splitIndex + 1) : [];
const command = args[0] || 'help';
const rest = args.slice(1);

const HELP = `${repoLabel} release:common

Primary human release path:
  npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]
  npm run release:common -- publish --message="<message>" [--title="<title>"] [--body-file=<file>]
  npm run release:common -- complete --ref=<lane> [--timeout-ms=<ms>] [--bundle=<json>] [--stopped]  wait for exact merge, then run close and retire locally when exact evidence is sufficient
  npm run release:common -- close --ref=<lane>  run post-merge closeout and report remaining cleanup blockers
  npm run release:common -- finish --ref=<lane>  run the exact integration diagnostic path only when needed

Underlying execution chain:
  guarded lane -> land -> finish

Exception path:
  npm run release:common -- successor <scope> --expected-head=<published-head> [--write=<paths>]
`;

const run = (script, extraArgs = []) => {
  const result = spawnSync('npm', ['run', script, '--', ...extraArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  if (typeof result.status === 'number' && result.status !== 0) process.exit(result.status);
  if (result.error) throw result.error;
};

if (command === 'help' || command === '--help' || command === '-h') {
  process.stdout.write(HELP);
  process.exit(0);
}

const actions = {
  start() {
    run('lane', rest);
  },
  publish() {
    run('land', rest);
  },
  finish() {
    run('finish', rest);
    run('reap', rest);
  },
  close() {
    run('finish', rest);
    run('reap', rest);
    const result = spawnSync('npm', ['run', 'completion:status', '--', ...rest], {
      stdio: 'pipe',
      env: process.env,
      encoding: 'utf8',
    });
    if (typeof result.status === 'number' && result.status === 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return;
    }
    if (typeof result.stderr === 'string' && /Missing script: "completion:status"/u.test(result.stderr)) {
      process.stderr.write('warning-release-common-close: completion:status script is unavailable; closeout stopped after finish and reap.\n');
      return;
    }
    if (typeof result.stdout === 'string' && result.stdout) process.stdout.write(result.stdout);
    if (typeof result.stderr === 'string' && result.stderr) process.stderr.write(result.stderr);
    process.exit(typeof result.status === 'number' ? result.status : 1);
  },
  async complete() {
    const root = resolveRepositoryRoot(process.cwd());
    const profile = loadRepositoryProfile({ repository: root });
    const cleanup = resolveReleaseCommonCleanupRequest(rest);
    const waitStatus = await runReleaseCommonCompleteWait({
      root,
      argv: rest,
      profile,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    });
    if (waitStatus !== 0) process.exit(waitStatus);
    actions.close();
    const cleanupStatus = await runReleaseCommonCleanup({
      root, ref: rest.find((arg) => arg.startsWith('--ref='))?.slice(6) ?? null,
      bundlePath: cleanup.bundlePath, stopped: cleanup.stopped,
      out: (line) => process.stdout.write(`${line}\n`),
    });
    if (cleanupStatus !== 0) process.exit(cleanupStatus);
  },
  successor() {
    run('successor', rest);
  },
};

if (actions[command]) {
  await actions[command]();
  process.exit(0);
}

process.stderr.write(`unknown release:common command: ${command}\n\n${HELP}`);
process.exit(1);
