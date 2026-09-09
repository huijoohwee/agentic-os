/** Read-only comparison of one consumer against an exact harness revision. */
import { resolve, join } from 'node:path';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { loadRepositoryProfile } from '../src/git-repository.mjs';
import { headSha } from '../src/git.mjs';
import { option } from './agentic-os-argv.mjs';
import { exactAgenticOsPackagePin, parseAgenticOsLockfilePin, harnessPinFormats } from './composition-pin.mjs';

export function runPinCheck(root, argv, out) {
  const profile = loadRepositoryProfile({ repository: root });
  if (!profile.repository.startsWith('github.com/')) throw new TypeError('pin requires a GitHub source profile');
  const repository = profile.repository.slice('github.com/'.length);
  const expected = option(argv, 'revision') ?? headSha(profile.canonical.remoteRef, root);
  if (!/^[0-9a-f]{40}$/u.test(expected ?? '') || headSha(expected, root) !== expected)
    throw new TypeError('pin requires an exact locally resolvable 40-hex source commit');
  const consumer = resolve(option(argv, 'consumer'));
  const read = file => readBoundedFile(join(consumer, file), 5_000_000, 'consumer pin').toString('utf8');
  const source = read('package.json'), lock = read('package-lock.json');
  const formats = harnessPinFormats(repository);
  const format = formats.find(value => exactAgenticOsPackagePin(source, value.prefix));
  const revision = format ? exactAgenticOsPackagePin(source, format.prefix) : null;
  const lockMatched = !!format && !!parseAgenticOsLockfilePin(lock, format.prefix, format.resolved, revision);
  const findings = [];
  if (!revision) findings.push('consumer_pin_invalid');
  if (revision && revision !== expected) findings.push('consumer_pin_revision_drift');
  if (!lockMatched) findings.push('consumer_lock_pin_invalid');
  if (format && format.name !== 'github') findings.push('consumer_pin_form_drift');
  out(JSON.stringify({ schema: 'agentic-os/consumer-pin-check/v1', consumer,
    observationOnly: true, expectedRevision: expected, revision, format: format?.name ?? null,
    lockMatched, recommendedPin: `github:${repository}#${expected}`, ok: findings.length === 0, findings }, null, 2));
  return findings.length === 0 ? 0 : 1;
}
