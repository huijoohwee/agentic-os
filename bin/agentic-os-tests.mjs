/** A small pure-unit loop plus the complementary integration suite. Full test stays authoritative. */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const fast = new Set(['lane-state.test.mjs', 'governance-contract.test.mjs',
  'completion.test.mjs', 'authority-evidence.test.mjs']);
const mode = process.argv[2];
if (!['fast', 'git'].includes(mode) || process.argv.length !== 3) throw new TypeError('expected fast or git');
const files = readdirSync(new URL('../__tests__/', import.meta.url)).filter(file => file.endsWith('.test.mjs'))
  .filter(file => mode === 'fast' ? fast.has(file) : !fast.has(file)).sort();
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4',
  ...files.map(file => `__tests__/${file}`)], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
