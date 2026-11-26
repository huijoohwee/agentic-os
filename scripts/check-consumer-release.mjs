#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRepositoryProfile } from '../src/governance.mjs';
import { providerPolicy } from '../src/lane-state.mjs';
import { consumerReleaseEnforcementFindings } from '../lib/consumer-release-enforcement.mjs';

const oid = /^[a-f\d]{40}$/u;

function run() {
  const args = Object.fromEntries(process.argv.slice(2).map((value) => {
    const match = /^--([a-z-]+)=(.*)$/u.exec(value);
    if (!match) throw new TypeError(`invalid argument: ${value}`);
    return [match[1], match[2]];
  }));
  const root = realpathSync(resolve(args.root ?? process.cwd()));
  const [base, revision, aosRevision] = [args.base, args.revision, args['aos-revision']];
  if (![base, revision, aosRevision].every((value) => oid.test(value ?? '')))
    throw new TypeError('base, revision, and aos-revision must be full commit SHA-1 values');
  const git = (parameters) => execFileSync('git', ['--no-replace-objects', ...parameters], {
    cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 30_000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  }).trimEnd();
  if (git(['rev-parse', 'HEAD']) !== revision) throw new Error('checked-out consumer revision does not match the CI candidate');
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('consumer checkout is not clean');
  // The composite action binds base to the protected webhook SHA; PR merge refs are shallow in CI.

  const profilePath = '.agentic-os.json';
  const trusted = validateRepositoryProfile(JSON.parse(git(['show', `${base}:${profilePath}`])));
  const candidate = validateRepositoryProfile(JSON.parse(git(['show', `${revision}:${profilePath}`])));
  if (trusted.profileDigest !== candidate.profileDigest)
    throw new Error('candidate changes the protected consumer profile; update policy in a separately reviewed source change');
  const expectedRepository = `github.com/${args.repository ?? process.env.GITHUB_REPOSITORY ?? ''}`;
  if (trusted.repository !== expectedRepository)
    throw new Error(`protected profile identity ${trusted.repository} does not match ${expectedRepository}`);

  const findings = consumerReleaseEnforcementFindings(root, trusted, providerPolicy(trusted), {
    expectedAosRevision: aosRevision,
  });
  const failed = findings.filter((finding) => !finding.ok);
  if (failed.length) {
    for (const finding of failed) {
      process.stderr.write(`${finding.id}: ${finding.detail}\n  fix: ${finding.remedy}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(`Consumer release contract passed for ${trusted.repository} at ${revision}.\n`);
  }
}

try { run(); }
catch (error) {
  process.stderr.write(`consumer-release-check: ${error.message}\n`);
  process.exitCode = 1;
}
