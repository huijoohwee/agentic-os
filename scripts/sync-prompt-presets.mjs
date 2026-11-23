import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const {values: {sync, 'source-root': upstream}} = parseArgs({options: {
  sync: {type: 'boolean', default: false},
  'source-root': {type: 'string'},
}});
const root = new URL('../', import.meta.url);
const pin = JSON.parse(await readFile(new URL('catalog/prompt-preset-source.json', root)));
if (pin.repository !== 'github.com/huijoohwee/agentic-gateway' || !/^[0-9a-f]{40}$/.test(pin.revision)
    || !/^[0-9a-f]{64}$/.test(pin.sha256) || pin.path !== 'catalog/PROMPT-PRESETS.md'
    || pin.compatibilityPath !== 'runtime/agents/docs/PROMPT-PRESETS.md') throw Error('Invalid gateway preset pin');
const target = fileURLToPath(new URL(pin.compatibilityPath, root));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (sync && !upstream) throw Error('--sync requires --source-root pointing to the gateway checkout');
if (upstream) {
  const bytes = execFileSync('git', ['-C', upstream, 'show', pin.revision + ':' + pin.path], {maxBuffer: 500_000});
  if (digest(bytes) !== pin.sha256) throw Error('Gateway source differs from the pinned SHA-256');
  if (sync) {
    const temp = await mkdtemp(join(dirname(target), '.preset-export-'));
    try {
      await writeFile(join(temp, 'catalog'), bytes);
      await rename(join(temp, 'catalog'), target);
    } finally {
      await rm(temp, {recursive: true, force: true});
    }
  }
}
if (digest(await readFile(target)) !== pin.sha256) throw Error('OS export drifted. Edit presets in agentic-gateway, update the pin, and run presets:sync.');
console.log('Verified ' + pin.compatibilityPath + ' at gateway ' + pin.revision);
