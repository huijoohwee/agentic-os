import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProgressiveCompletion } from '../bin/agentic-os-release-common-complete.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('progressive completion summary separates stale cleanup debt from deliberate retention', async (t) => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-release-common-residue-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), directory = join(parent, 'worktrees');
  mkdirSync(root); mkdirSync(directory);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  const events = [];
  const rows = [
    { path: join(directory, 'stale'), branch: 'agent/test-device/stale', head: 'a'.repeat(40) },
    { path: join(directory, 'retained'), branch: 'agent/test-device/retained', head: 'b'.repeat(40) },
  ];
  for (const row of rows) mkdirSync(row.path);
  const closeouts = {
    'agent/test-device/stale': {
      missionState: 'source_complete',
      sourceState: 'source_complete',
      adlcState: 'cleanup_pending',
      retentionState: 'cleanup-pending',
      residueDisposition: 'stale-mounted',
      cleanupSatisfied: false,
      completionScope: 'source-only',
      nextAction: { id: 'workspace-cleanup', owner: 'cleanup-operator', command: 'agentic-os cleanup auto --ref=agent/test-device/stale' },
    },
    'agent/test-device/retained': {
      missionState: 'source_complete',
      sourceState: 'source_complete',
      adlcState: 'cleanup_pending',
      retentionState: 'retained',
      residueDisposition: 'deliberate-retained',
      cleanupSatisfied: false,
      completionScope: 'source-only',
      nextAction: { id: 'workspace-cleanup', owner: 'cleanup-operator', command: 'Stop writers and apply the retained policy.' },
    },
  };
  const code = await runProgressiveCompletion({
    root,
    directory,
    policy: { protectedBranch: 'main' },
    profile: {},
    inventory: () => [{ path: root, branch: 'main', head: 'c'.repeat(40) }, ...rows],
    record: ref => ({ state: 'published', head: rows.find(row => row.branch === ref).head, worktree: rows.find(row => row.branch === ref).path }),
    complete: async () => 0,
    status: (root, ref) => ({ closeout: closeouts[ref] }),
    out: line => events.push(JSON.parse(line)),
  });
  assert.equal(code, 2);
  assert.deepEqual(events.slice(0, 2).map(event => event.residueDisposition).sort(), ['deliberate-retained', 'stale-mounted']);
  assert.equal(events.at(-1).cleanupPending, 1);
  assert.equal(events.at(-1).deliberateRetained, 1);
  assert.deepEqual(events.at(-1).nextActions.map(event => event.residueDisposition).sort(), ['deliberate-retained', 'stale-mounted']);
});
