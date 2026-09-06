import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';
import { CHECK_INPUT_SCHEMA, CHECK_RESULT_SCHEMA, discoverRepositoryChecks, runChecksProcess } from '../bin/agentic-os-checks.mjs';
import { runCli } from '../src/mcp-stdio.mjs';
import { toolArguments } from '../src/mcp-server.mjs';

const CATALOG = JSON.parse(readFileSync(new URL('../catalog/repository-checks.json', import.meta.url)));
const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8',
  env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
const writeJson = (target, value) => writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);

function fixture(t, ids = ['agentic-os']) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-check-discovery-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const repositories = [];
  for (const entry of CATALOG.repositories.filter(item => ids.includes(item.id))) {
    const root = join(parent, entry.id); mkdirSync(root);
    git(root, 'init', '--quiet', '--initial-branch=main');
    git(root, 'config', 'user.name', 'Check fixture');
    git(root, 'config', 'user.email', 'check@example.invalid');
    git(root, 'config', 'core.hooksPath', '/dev/null');
    git(root, 'remote', 'add', 'origin', `https://${entry.repository}.git`);
    const profile = createRepositoryProfile({ repository: entry.repository,
      canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
      adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
      requiredChecks: [`${entry.id} owner gate`] });
    writeJson(join(root, '.agentic-os.json'), profile);
    writeFileSync(join(root, 'owner-source.txt'), 'original owner code\n');
    for (const pkg of entry.packages) {
      mkdirSync(dirname(join(root, pkg.path)), { recursive: true });
      writeJson(join(root, pkg.path), { name: entry.id, scripts: Object.fromEntries(pkg.scripts.map(script =>
        [script, 'node -e "require(\'node:fs\').writeFileSync(\'CANDIDATE_EXECUTED\',\'yes\')"'])) });
    }
    for (const workflow of entry.workflows) {
      mkdirSync(dirname(join(root, workflow)), { recursive: true });
      writeFileSync(join(root, workflow), 'name: Owner checks\non: [push]\njobs: {}\n');
    }
    git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'owner fixture');
    ensureRepositoryTrust(root, profile, { allowCreate: true });
    repositories.push({ id: entry.id, root: entry.id });
  }
  const input = join(parent, 'input.json');
  const payload = { schema: CHECK_INPUT_SCHEMA, repositories, results: [] };
  writeJson(input, payload);
  const root = id => join(parent, id ?? ids[0]);
  return { parent, root, input, payload,
    read: () => discoverRepositoryChecks(input),
    save: () => writeJson(input, payload),
    receipt: (value, name = 'result.json') => { writeJson(join(parent, name), value); payload.results.push(name); writeJson(input, payload); },
  };
}
function receipt(f, overrides = {}) {
  return { schema: CHECK_RESULT_SCHEMA, repository: 'github.com/huijoohwee/agentic-os',
    revision: git(f.root(), 'rev-parse', 'HEAD'),
    command: { package: 'package.json', script: 'test',
      sourceSha256: hash(readFileSync(join(f.root(), 'package.json'))),
      argv: ['npm', 'run', 'test', '--', '--test-name-pattern=paid unlock'] },
    coverage: { scope: 'Filtered paid unlock contract', complete: true,
      counts: { total: 3, passed: 3, failed: 0, skipped: 0 } }, outcome: 'passed', ...overrides };
}

test('six owner references resolve from committed files without running scripts or changing Git', t => {
  const f = fixture(t, CATALOG.repositories.map(row => row.id));
  const before = f.payload.repositories.map(row => git(f.root(row.id), 'rev-parse', 'HEAD'));
  const report = f.read();
  assert.equal(report.repositories.length, 6);
  for (const owner of report.repositories) {
    assert.equal(owner.sourceStatus, 'not-evaluated', JSON.stringify(owner.findings));
    assert.equal(owner.clean, null);
    assert.deepEqual(owner.requiredChecks, [`${owner.id} owner gate`]);
    assert.ok(owner.commands.length >= 2);
    assert.ok(owner.commands.every(command => command.definition.includes('CANDIDATE_EXECUTED')));
    assert.deepEqual(owner.results, []);
    assert.equal(existsSync(join(owner.root, 'CANDIDATE_EXECUTED')), false);
    assert.equal(git(owner.root, 'status', '--porcelain'), '');
  }
  assert.deepEqual(f.payload.repositories.map(row => git(f.root(row.id), 'rev-parse', 'HEAD')), before);
  const nested = report.repositories.find(row => row.id === 'agentic-graph').commands
    .find(row => row.script === 'test:ci:unit');
  assert.deepEqual(nested.argv, ['npm', '--prefix', 'canvas', 'run', 'test:ci:unit']);
  assert.equal(report.candidateCodeExecuted, false);
  assert.equal(report.providerChecksQueried, false);
  assert.equal(report.authenticatedEvidenceObserved, false);
  assert.equal(report.integrationAuthorized, false);
  assert.equal(report.productionReady, false);
  assert.equal('ok' in report, false);
});

test('owner manifests with hundreds of scripts resolve only the catalog-selected references', t => {
  const f = fixture(t, ['agentic-graph']), packagePath = join(f.root(), 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath));
  for (let index = 0; index < 300; index += 1) manifest.scripts[`other-owner-script-${index}`] = 'echo owner-only';
  writeJson(packagePath, manifest); git(f.root(), 'add', '.'); git(f.root(), 'commit', '--quiet', '-m', 'many scripts');
  const owner = f.read().repositories[2];
  assert.equal(owner.sourceStatus, 'not-evaluated'); assert.equal(owner.clean, null);
  assert.deepEqual(owner.commands.map(command => command.script),
    ['runtime:test', 'check', 'test', 'test:ci:unit', 'test:ci:standalone-export']);
  assert.equal(owner.commands[0].sourceSha256, hash(readFileSync(packagePath)));
});

test('matched unsigned results preserve actual filtered coverage and cannot imply ecosystem success', t => {
  const f = fixture(t); const result = receipt(f); f.receipt(result);
  const report = f.read(), observed = report.repositories[0].results[0];
  assert.equal(observed.binding, 'matched');
  assert.equal(observed.authenticated, false);
  assert.equal(observed.reportedOutcome, 'passed');
  assert.equal(observed.coverage.scope, 'Filtered paid unlock contract');
  assert.equal(observed.coverage.counts.total, 3);
  assert.deepEqual([...observed.command.argv], result.command.argv);
  assert.equal(observed.receiptSha256, hash(readFileSync(join(f.parent, 'result.json'))));
  assert.equal(report.repositories[1].sourceStatus, 'unavailable');
  assert.deepEqual(report.repositories[1].findings, ['root_not_supplied']);
  assert.deepEqual(report.repositories[1].results, []);
});

test('stale revision, changed command bytes and mismatched argv are never current matches', t => {
  const f = fixture(t); const result = receipt(f);
  f.receipt({ ...result, revision: '0'.repeat(40) }, 'stale.json');
  f.receipt({ ...result, command: { ...result.command, sourceSha256: '0'.repeat(64) } }, 'digest.json');
  f.receipt({ ...result, command: { ...result.command, argv: ['npm', 'run', 'test', '--provider'] } }, 'argv.json');
  assert.deepEqual(f.read().repositories[0].results.map(row => row.binding),
    ['stale_revision', 'command_mismatch', 'command_mismatch']);
});

test('dirty tracked code and hidden index entries invalidate an otherwise matching pass', t => {
  const f = fixture(t); f.receipt(receipt(f));
  writeFileSync(join(f.root(), 'owner-source.txt'), 'edited owner code\n');
  let row = f.read().repositories[0];
  assert.equal(row.sourceStatus, 'dirty'); assert.equal(row.results[0].binding, 'source_unavailable');
  assert.deepEqual(row.findings, ['worktree_dirty']);
  git(f.root(), 'update-index', '--assume-unchanged', 'owner-source.txt');
  row = f.read().repositories[0];
  assert.equal(row.sourceStatus, 'unavailable'); assert.deepEqual(row.findings, ['git_worktree_snapshot_unavailable']);
  assert.equal(row.results[0].binding, 'source_unavailable');
});

test('raw observation never runs a clean filter or treats its normalized edits as matching source', t => {
  const f = fixture(t);
  writeFileSync(join(f.root(), '.gitattributes'), 'owner-source.txt filter=owner\n');
  git(f.root(), 'add', '.gitattributes'); git(f.root(), 'commit', '--quiet', '-m', 'owner attributes');
  const filter = join(f.parent, 'filter.mjs'), marker = join(f.parent, 'FILTER_EXECUTED');
  writeFileSync(filter, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'yes');process.stdout.write('original owner code\\n');`);
  git(f.root(), 'config', 'filter.owner.clean', `'${process.execPath}' '${filter}'`);
  writeFileSync(join(f.root(), 'owner-source.txt'), 'modified owner code\n');
  f.receipt(receipt(f));
  const owner = f.read().repositories[0];
  assert.equal(existsSync(marker), false);
  assert.equal(owner.sourceStatus, 'dirty');
  assert.equal(owner.results[0].binding, 'source_unavailable');
});

test('large unsupported source inventories retain cheap references without implying a match', t => {
  const f = fixture(t);
  writeFileSync(join(f.root(), 'large-source.bin'), Buffer.alloc(1_048_577, 7));
  git(f.root(), 'add', '.'); git(f.root(), 'commit', '--quiet', '-m', 'large source');
  let owner = f.read().repositories[0];
  assert.equal(owner.sourceStatus, 'not-evaluated'); assert.equal(owner.clean, null);
  assert.equal(owner.commands.length, 3);
  f.receipt(receipt(f)); owner = f.read().repositories[0];
  assert.equal(owner.sourceStatus, 'unavailable');
  assert.equal(owner.commands.length, 3);
  assert.equal(owner.results[0].binding, 'source_unavailable');
});

test('the lazy deadline discards partial output and kills descendants holding inherited output handles', { timeout: 6000 }, async t => {
  const f = fixture(t), worker = join(f.parent, 'deadline-worker.mjs'), marker = join(f.parent, 'child.pid');
  writeFileSync(worker, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
    writeFileSync(${JSON.stringify(marker)},String(child.pid));process.stdout.write('partial result');setInterval(()=>{},1000);`);
  const result = await runChecksProcess(f.input, { entrypoint: worker, timeoutMs: 1500 });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /ETIMEDOUT/);
  assert.equal(existsSync(marker), true);
  const pid = Number(readFileSync(marker, 'utf8'));
  let alive = true;
  for (let attempt = 0; alive && attempt < 80; attempt += 1) {
    try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); alive = false; }
    if (alive) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(alive, false, 'owned descendant survived the deadline');
});

test('cancelling the outer process forwards to the discovery worker and its descendants', { timeout: 6000 }, async t => {
  const f = fixture(t), worker = join(f.parent, 'cancel-worker.mjs'), outer = join(f.parent, 'outer.mjs');
  const marker = join(f.parent, 'cancel-pids.json');
  writeFileSync(worker, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
    writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
  const module = new URL('../bin/agentic-os-checks.mjs', import.meta.url).href;
  writeFileSync(outer, `import {runChecksProcess} from ${JSON.stringify(module)};
    const result=await runChecksProcess(${JSON.stringify(f.input)},{entrypoint:${JSON.stringify(worker)}});
    process.stdout.write(JSON.stringify(result));process.exit(result.exitCode);`);
  const child = spawn(process.execPath, [outer], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); let stdout = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    if (existsSync(marker)) for (const pid of JSON.parse(readFileSync(marker))) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  });
  for (let attempt = 0; !existsSync(marker) && attempt < 100; attempt += 1)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(existsSync(marker), true, 'worker did not start');
  child.kill('SIGTERM');
  const [code] = await closed; assert.equal(code, 1);
  assert.match(JSON.parse(stdout).stderr, /cancelled/);
  for (const pid of JSON.parse(readFileSync(marker))) {
    let alive = true;
    for (let attempt = 0; alive && attempt < 80; attempt += 1) {
      try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); alive = false; }
      if (alive) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(alive, false, `owned process ${pid} survived outer cancellation`);
  }
});

test('missing sources, wrong owner identity and uncommitted package edits are visible failures', t => {
  const f = fixture(t, ['agentic-os', 'agentic-canvas-os', 'agentic-graph']);
  rmSync(join(f.root('agentic-os'), '.github/workflows/ci.yml'));
  const wrongInput = JSON.parse(readFileSync(join(f.root('agentic-canvas-os'), '.agentic-os.json')));
  delete wrongInput.profileDigest;
  const wrong = createRepositoryProfile({ ...wrongInput, repository: 'github.com/other/owner' });
  writeJson(join(f.root('agentic-canvas-os'), '.agentic-os.json'), wrong);
  git(f.root('agentic-canvas-os'), 'add', '.'); git(f.root('agentic-canvas-os'), 'commit', '--quiet', '-m', 'wrong identity');
  writeJson(join(f.root('agentic-graph'), 'package.json'), { scripts: { test: 'echo changed' } });
  const rows = f.read().repositories;
  assert.equal(rows[0].sourceStatus, 'unavailable');
  assert.deepEqual(rows[0].findings, ['composition_head_file_unreadable']);
  assert.deepEqual(rows[1].findings, ['repository_identity_mismatch']);
  assert.deepEqual(rows[2].findings, ['composition_head_file_bytes_unbound']);
});

test('result identity, completion, counts, duplicate and byte bounds fail loudly', t => {
  const f = fixture(t); const result = receipt(f); f.receipt(result);
  for (const invalid of [
    { ...result, revision: 'main' },
    { ...result, command: { ...result.command, package: '../package.json' } },
    { ...result, coverage: { ...result.coverage, complete: false } },
    { ...result, coverage: { ...result.coverage, counts: { total: 3, passed: 3, failed: 1, skipped: 0 } } },
    { ...result, coverage: { scope: 'x'.repeat(66_000), complete: true } },
  ]) {
    writeJson(join(f.parent, 'result.json'), invalid);
    assert.throws(f.read);
  }
  writeJson(join(f.parent, 'result.json'), result); f.payload.results.push('result.json'); f.save();
  assert.throws(f.read, /duplicate_result_observation/);
  f.payload.results = ['result.json', 'reordered.json']; f.save();
  writeJson(join(f.parent, 'reordered.json'), { ...result, outcome: 'failed',
    command: Object.fromEntries(Object.entries(result.command).reverse()) });
  assert.throws(f.read, /duplicate_result_observation/);
});

test('symlinked owner files, symlink inputs and duplicate roots never produce a current match', t => {
  const f = fixture(t); const packagePath = join(f.root(), 'package.json');
  writeFileSync(join(f.parent, 'other-package.json'), readFileSync(packagePath));
  rmSync(packagePath); symlinkSync(join(f.parent, 'other-package.json'), packagePath);
  assert.equal(f.read().repositories[0].sourceStatus, 'unavailable');
  symlinkSync(f.input, join(f.parent, 'input-link.json'));
  assert.throws(() => discoverRepositoryChecks(join(f.parent, 'input-link.json')), /input_symlink/);
  f.payload.repositories.push({ id: 'agentic-canvas-os', root: 'agentic-os' }); f.save();
  assert.deepEqual(f.read().repositories[1].findings, ['duplicate_repository_root']);
  f.payload.repositories.push({ id: 'agentic-os', root: 'agentic-os' }); f.save();
  assert.throws(f.read, /input_repository_invalid/);
});

test('the real CLI, invocation and MCP runner use the same read-only input without executing owners', async t => {
  const f = fixture(t);
  const commands = [['observe', '--checks', `--input=${f.input}`], ['/checks', '#read-only', `@input:${f.input}`]];
  for (const argv of commands) {
    const result = spawnSync(process.execPath, [CLI, ...argv], { cwd: f.root(), encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).repositories[0].sourceStatus, 'not-evaluated');
  }
  const result = await runCli(toolArguments('checks', { input: f.input }), { cwd: f.root(), timeoutMs: 15_000 });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).candidateCodeExecuted, false);
  assert.equal(existsSync(join(f.root(), 'CANDIDATE_EXECUTED')), false);
  assert.equal(validateCommandArguments('observe', ['--checks', '--input=./x.json']), null);
  for (const argv of [['--checks'], ['--input=x'], ['--checks', '--input=x', '--provider'],
    ['--checks', '--input=x', '--deep'], ['--checks', '--input=x', '--input=y']])
    assert.notEqual(validateCommandArguments('observe', argv), null);
});
