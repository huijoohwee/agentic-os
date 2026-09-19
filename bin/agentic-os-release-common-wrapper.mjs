#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const repoLabel = process.argv.find((arg) => arg.startsWith('--repo-label='))?.slice(13) ?? 'consumer';
const splitIndex = process.argv.indexOf('--');
const args = splitIndex >= 0 ? process.argv.slice(splitIndex + 1) : [];
const command = args[0] || 'help';
const rest = args.slice(1);

const HELP = `${repoLabel} release:common

Primary human release path:
  npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]
  npm run release:common -- publish --message="<message>" [--title="<title>"] [--body-file=<file>]
  npm run release:common -- finish --ref=<lane>  observe exact integration from canonical, then classify it
  npm run release:common -- close --ref=<lane>  run post-merge closeout and report remaining cleanup blockers

Underlying execution chain:
  doctor -> status -> lane -> land -> finish

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
    run('doctor');
    run('status');
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
  successor() {
    run('successor', rest);
  },
};

if (actions[command]) {
  actions[command]();
  process.exit(0);
}

process.stderr.write(`unknown release:common command: ${command}\n\n${HELP}`);
process.exit(1);
