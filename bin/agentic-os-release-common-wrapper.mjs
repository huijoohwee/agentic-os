#!/usr/bin/env node
/** Consumer compatibility shim; the native CLI owns every release transition. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const splitIndex = process.argv.indexOf('--');
const args = splitIndex >= 0 ? process.argv.slice(splitIndex + 1) : [];
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('./agentic-os.mjs', import.meta.url)), 'release-common', ...args,
], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(typeof result.status === 'number' ? result.status : 1);
