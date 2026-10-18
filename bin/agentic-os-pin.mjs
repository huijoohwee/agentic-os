import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { loadRepositoryProfile, resolveRepositoryRoot } from '../src/git-repository.mjs';
import { currentBranch, headSha, observeGit } from '../src/git.mjs';
import { option, validateCommandArguments } from './agentic-os-argv.mjs';
import { exactAgenticOsPackagePin, parseAgenticOsLockfilePin, harnessPinFormats } from './composition-pin.mjs';
const tree = (revision, root) => revision ? headSha(`${revision}^{tree}`, root) : null, distinct = values => [...new Set(values)].sort(), changed = (args, root) => observeGit(args, { cwd: root, allowFail: true }) === null;
const nextAction = (findings, pin) => pin.findings.length > 0 ? 'update the consumer manifest and lockfile to the recommended exact upstream pin' : findings.includes('upstream_source_revision_mismatch') ? 'invoke the preflight from the exact expected upstream source revision' : findings.includes('consumer_remote_ref_unavailable') ? 'fetch the consumer canonical ref before building a release candidate' : findings.some(value => value.startsWith('consumer_canonical_local_')) ? 'synchronize the consumer local canonical ref with its remote canonical ref' : findings.includes('consumer_source_revision_drift') ? 'synchronize or check out the consumer canonical source revision' : findings.includes('consumer_dirty_tracked') ? 'commit or restore tracked consumer changes before building a release candidate' : null;

export function inspectConsumerPin(root, { consumer: requestedConsumer, revision: requestedRevision = null } = {}) {
  const profile = loadRepositoryProfile({ repository: root }); if (!profile.repository.startsWith('github.com/')) throw new TypeError('pin requires a GitHub source profile');
  const repository = profile.repository.slice('github.com/'.length), expected = requestedRevision ?? headSha(profile.canonical.remoteRef, root); if (!/^[0-9a-f]{40}$/u.test(expected ?? '') || headSha(expected, root) !== expected) throw new TypeError('pin requires an exact locally resolvable 40-hex source commit');
  const consumer = resolve(requestedConsumer), read = file => readBoundedFile(join(consumer, file), 5_000_000, 'consumer pin').toString('utf8'), source = read('package.json'), lock = read('package-lock.json'), format = harnessPinFormats(repository).find(value => exactAgenticOsPackagePin(source, value.prefix)), revision = format ? exactAgenticOsPackagePin(source, format.prefix) : null, lockMatched = !!format && !!parseAgenticOsLockfilePin(lock, format.prefix, format.resolved, revision), recommendedPin = `${format?.prefix ?? `github:${repository}#`}${expected}`, findings = [];
  if (!revision) findings.push('consumer_pin_invalid'); if (revision && revision !== expected) findings.push('consumer_pin_revision_drift'); if (!lockMatched) findings.push('consumer_lock_pin_invalid');
  return Object.freeze({ schema: 'agentic-os/consumer-pin-check/v1', consumer, observationOnly: true, expectedRevision: expected, revision, format: format?.name ?? null, lockMatched, recommendedPin, ok: findings.length === 0, findings: Object.freeze(findings) });
}

/** Cheap, read-only source identity preflight for a consumer release controller. */
export function inspectSourceControlPreflight({ root, pin }) {
  const consumer = resolveRepositoryRoot(pin.consumer), profile = loadRepositoryProfile({ repository: consumer }), expected = pin.expectedRevision, upstreamProfile = loadRepositoryProfile({ repository: root }), consumerRevision = headSha('HEAD', consumer), localRevision = headSha(profile.canonical.localRef, consumer), remoteRevision = headSha(profile.canonical.remoteRef, consumer), upstreamRevision = headSha('HEAD', root);
  const staged = changed(['diff', '--cached', '--no-ext-diff', '--quiet'], consumer), modified = changed(['diff', '--no-ext-diff', '--quiet'], consumer), dirtyTracked = staged || modified, findings = [...pin.findings];
  if (upstreamRevision !== expected) findings.push('upstream_source_revision_mismatch'); if (!remoteRevision) findings.push('consumer_remote_ref_unavailable'); if (!localRevision) findings.push('consumer_canonical_local_ref_unavailable'); if (localRevision && remoteRevision && localRevision !== remoteRevision) findings.push('consumer_canonical_local_drift'); if (!consumerRevision || consumerRevision !== remoteRevision) findings.push('consumer_source_revision_drift'); if (dirtyTracked) findings.push('consumer_dirty_tracked');
  const resolvedFindings = distinct(findings);
  return Object.freeze({ schema: 'agentic-os/source-control-preflight/v1', observationOnly: true, authorizesEffects: false, ready: resolvedFindings.length === 0, findings: Object.freeze(resolvedFindings), nextAction: nextAction(resolvedFindings, pin), upstream: Object.freeze({ repository: upstreamProfile.repository, expectedRevision: expected, observedRevision: upstreamRevision, tree: tree(upstreamRevision, root) }), consumer: Object.freeze({ root: consumer, repository: profile.repository, invocationBranch: currentBranch(consumer), revision: consumerRevision, tree: tree(consumerRevision, consumer), canonical: Object.freeze({ localRef: profile.canonical.localRef, localRevision, remoteRef: profile.canonical.remoteRef, remoteRevision }), workingTree: Object.freeze({ dirtyTracked, staged, modified }) }), pin: Object.freeze({ revision: pin.revision, format: pin.format, lockMatched: pin.lockMatched, recommendedPin: pin.recommendedPin, ok: pin.ok }) });
}

export function runPinCheck(root, argv, out) {
  const pin = inspectConsumerPin(root, { consumer: option(argv, 'consumer'), revision: option(argv, 'revision') });
  if (argv.includes('--source-control')) { const report = inspectSourceControlPreflight({ root, pin }); out(JSON.stringify(report, null, 2)); return report.ready ? 0 : 1; }
  out(JSON.stringify(pin, null, 2)); return pin.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { try { const args = process.argv.slice(2), stripped = args.filter(value => value !== '--source-control'), invalid = args.filter(value => value === '--source-control').length > 1 || validateCommandArguments('pin', stripped); if (invalid) throw Error(invalid); process.exitCode = runPinCheck(resolve(fileURLToPath(new URL('..', import.meta.url))), args, value => process.stdout.write(`${value}\n`)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }
