#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoLabel = process.argv.find((arg) => arg.startsWith('--repo-label='))?.slice(13) ?? 'consumer';
const splitIndex = process.argv.indexOf('--');
const args = splitIndex >= 0 ? process.argv.slice(splitIndex + 1) : [];
const command = args[0] || 'help';
const rest = args.slice(1);
const ownerCli = join(dirname(fileURLToPath(import.meta.url)), 'agentic-os.mjs');

const HELP = `${repoLabel} release:common

Default path:
  npm run release:common -- start <scope> --write=<paths> [--plan=<committed-plan>]
  npm run release:common -- publish --message="<message>" [--title="<title>"] [--body-file=<file>]
  npm run release:common -- finish --ref=<lane>

Exception path:
  npm run release:common -- successor <scope> --expected-head=<published-head> [--write=<paths>]
`;

const runCli = (cliArgs = []) => {
  const result = spawnSync(process.execPath, [ownerCli, ...cliArgs], {
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
    runCli(['doctor']);
    runCli(['status']);
    runCli(['start', ...rest]);
  },
  publish() {
    runCli(['land', ...rest]);
  },
  finish() {
    runCli(['finish', ...rest]);
    runCli(['reap', ...rest]);
  },
  successor() {
    runCli(['successor', ...rest]);
  },
};

if (actions[command]) {
  actions[command]();
  process.exit(0);
}

process.stderr.write(`unknown release:common command: ${command}\n\n${HELP}`);
process.exit(1);
