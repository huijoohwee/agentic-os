#!/usr/bin/env node
/**
 * ADLC harness entrypoint. One command opens a lane, one lands it.
 *
 * Every mutation is either local and reversible, or an explicit opt-in.
 */

import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  git,
  gitLines,
  repoRoot,
  currentBranch,
  dirtyTracked,
  headSha,
  fetch as gitFetch,
  worktrees,
} from '../src/git.mjs';
import { deviceSegment, laneRef, isLaneRef, parseLaneRef } from '../src/lane-id.mjs';
import { transition, legalEvents, orderingMode } from '../src/lane-state.mjs';
import { capFacts, capAdvice, CAPS } from '../src/wip.mjs';
import * as store from '../src/lane-records.mjs';
import * as queue from '../src/queue.mjs';
import * as config from '../src/config.mjs';
import {
  PROTECTED_BRANCH,
  PROTECTED_REF,
  provision,
  inspect as inspectWorktree,
  retire,
  laneBranches,
  staleWorktrees,
} from '../src/worktree.mjs';
import { surveyLanes, sourceHeadTrailer } from '../src/patch-identity.mjs';
import * as report from '../src/report.mjs';

const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);

function flag(argv, name) {
  return argv.includes(`--${name}`);
}

function option(argv, name, fallback = null) {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function positional(argv) {
  return argv.filter((arg) => !arg.startsWith('--'));
}

/** Refuse to run a main-worktree command from inside a lane. */
function requireCanonical(root) {
  const branch = currentBranch(root);
  if (branch === PROTECTED_BRANCH) return;
  err(
    `this command runs in the canonical ${PROTECTED_BRANCH} worktree, not in a lane.\n` +
      `current branch: ${branch ?? 'detached'}`,
  );
  process.exit(1);
}

function localHealth(root) {
  const behindRaw = git(['rev-list', '--count', `${PROTECTED_BRANCH}..${PROTECTED_REF}`], {
    cwd: root,
    allowFail: true,
  });
  return {
    mainDirty: dirtyTracked(root),
    behind: behindRaw === null ? 0 : Number(behindRaw),
    staleWorktrees: staleWorktrees(root).map((entry) => entry.path),
    worktreeCount: worktrees(root).length,
    laneBranches: laneBranches(root).length,
  };
}

function cmdSetup(root) {
  const changed = config.ensure(root);
  for (const hook of ['pre-commit', 'pre-push']) {
    const path = join(root, '.githooks', hook);
    if (existsSync(path)) chmodSync(path, 0o755);
  }
  out(report.formatConfig(config.inspect(root)));
  out('');
  out(changed.length === 0 ? 'configuration already correct.' : `${changed.length} setting(s) written.`);
  out('hooks executable, core.hooksPath set. Next: npm run doctor');
  return 0;
}

function cmdDoctor(root) {
  const configEntries = config.inspect(root);
  const local = localHealth(root);
  out(report.formatConfig(configEntries));
  out('');
  out(report.formatLocal(local));
  out('');

  const observed = queue.observe({ cwd: root });
  const findings = queue.audit(observed);
  out(report.formatFindings('remote configuration', findings));

  const failures =
    configEntries.filter((entry) => !entry.ok).length +
    findings.filter((finding) => !finding.ok).length +
    (local.mainDirty ? 1 : 0) +
    (local.staleWorktrees.length > 0 ? 1 : 0);

  out('');
  if (failures === 0) {
    out('harness invariants hold.');
    return 0;
  }
  out(`${failures} finding(s) need attention. Nothing was changed.`);
  return 1;
}

function cmdStart(root, argv) {
  requireCanonical(root);
  const [scope] = positional(argv);
  if (!scope) {
    err('usage: npm run lane -- <scope>   e.g. npm run lane -- pricing-table');
    return 1;
  }
  const device = option(argv, 'device', deviceSegment());
  const ref = laneRef(scope, device);

  gitFetch('origin', root);
  const branches = laneBranches(root);
  const scopeTaken = branches.some((branch) => parseLaneRef(branch)?.scope === scope);
  const facts = {
    ...capFacts(branches, device, { baseRef: PROTECTED_REF, protectedRef: PROTECTED_REF }),
    baseFetched: true,
    scopeTaken,
  };

  const result = transition('planned', 'provision', facts);
  if (!result.ok) {
    err(report.formatRefusal(result, capAdvice(result.reason)));
    if (result.reason === 'blocked-scope-taken') err(`scope "${scope}" is already an open lane`);
    return 1;
  }

  const created = provision({ ref, scope, device, cwd: root });
  store.put(
    {
      ...store.newRecord({
        ref,
        device,
        scope,
        base: PROTECTED_REF,
        baseSha: created.baseSha,
        worktree: created.path,
      }),
      state: 'active',
    },
    root,
  );

  out(`lane ${ref}`);
  out(`worktree ${created.path}`);
  out(`base ${PROTECTED_REF} @ ${created.baseSha.slice(0, 9)}`);
  out('');
  out(`  cd ${created.path}`);
  out('  # author, commit, then:');
  out('  npm run land');
  return 0;
}

/**
 * Title and body for the lane's pull request.
 *
 * The body ends with the Source-Head trailer. With the squash message built from
 * the body, that trailer lands on the protected branch and becomes the
 * deterministic integration proof for a lane whose commits were collapsed.
 */
function pullRequestText(root, ref, laneHeadSha) {
  const subjects = gitLines(['log', '--format=%s', `${PROTECTED_REF}..HEAD`, '--reverse'], {
    cwd: root,
  });
  const scope = parseLaneRef(ref)?.scope ?? ref;
  const title = subjects.length === 1 ? subjects[0] : `${scope}: ${subjects.length} commits`;
  const body = [
    ...(subjects.length > 1 ? subjects.map((subject) => `- ${subject}`) : []),
    ...(subjects.length > 1 ? [''] : []),
    `Lane: ${ref}`,
    sourceHeadTrailer(laneHeadSha),
  ].join('\n');
  return { title, body };
}

function cmdLand(cwd) {
  const root = repoRoot(cwd);
  const ref = currentBranch(root);
  if (!ref || !isLaneRef(ref)) {
    err(`land runs inside a lane worktree. current branch: ${ref ?? 'detached'}`);
    err('open one with: npm run lane -- <scope>');
    return 1;
  }

  gitFetch('origin', root);
  const record = store.get(ref, root) ?? { state: 'active', ejections: 0 };
  const laneHeadSha = headSha('HEAD', root);
  const commits = gitLines(['rev-list', `${PROTECTED_REF}..HEAD`], { cwd: root }).length;

  if (record.ejections === 1 && record.state === 'published') {
    const allowed = transition('published', 'restack', { ejections: 1 });
    if (!allowed.ok) {
      err(report.formatRefusal(allowed, 'the lane was ejected twice; it is wrong, not stale'));
      return 1;
    }
    git(['rebase', '--update-refs', PROTECTED_REF], { cwd: root });
    out(`restacked ${ref} onto ${PROTECTED_REF} (the one restack an ejection permits)`);
  }

  const publish = transition(record.state === 'planned' ? 'active' : record.state, 'publish', {
    onCanonicalMain: false,
    dirtyTracked: dirtyTracked(root),
    laneCommits: commits,
    pushed: true,
  });
  if (!publish.ok && publish.reason !== 'blocked-illegal-transition') {
    err(report.formatRefusal(publish, 'commit your work, then run npm run land again'));
    return 1;
  }

  git(['push', '--set-upstream', 'origin', ref], { cwd: root });
  out(`pushed ${ref} @ ${laneHeadSha.slice(0, 9)}`);
  store.put({ ref, state: 'published' }, root);

  const observed = queue.observe({ cwd: root });
  const orderingFacts = {
    queueEnabled: observed.queueEnabled,
    autoMergeAllowed: observed.autoMerge,
    requiredCheckCount: observed.requiredChecks?.length ?? 0,
    strict: observed.strict,
  };
  const enqueueResult = transition('published', 'enqueue', {
    ...orderingFacts,
    prOpen: true,
    laneHeadSha,
    checksHeadSha: laneHeadSha,
  });
  if (!enqueueResult.ok) {
    err(report.formatRefusal(enqueueResult, 'run npm run doctor, then npm run queue:apply'));
    return 1;
  }

  const mode = orderingMode(orderingFacts);
  const handed = queue.enqueue(ref, { cwd: root, ...pullRequestText(root, ref, laneHeadSha) });
  store.put({ ref, state: 'queued', pr: handed.pr?.number ?? null, mode }, root);
  out(handed.pr?.url ? `handed to the provider: ${handed.pr.url}` : 'handed to the provider');
  out(
    mode === 'merge-queue'
      ? 'ordering: merge queue, batched'
      : 'ordering: auto-merge, no batching (enable the merge queue for batches)',
  );
  out('');
  out('Do not rebase or restack this lane now. The provider owns its base.');
  return 0;
}

function cmdStatus(root, argv) {
  const device = option(argv, 'device', deviceSegment());
  const branches = laneBranches(root);
  const lanes = branches.map((ref) => {
    const record = store.get(ref, root);
    const observedLane = inspectWorktree(ref, root);
    const state = record?.state ?? 'active';
    return {
      ref,
      state,
      commits: observedLane.commits,
      untracked: observedLane.untracked.length,
      next: legalEvents(state),
    };
  });
  const observed = queue.observe({ cwd: root });
  out(
    report.formatStatus({
      device,
      lanes,
      caps: capFacts(branches, device, { baseRef: PROTECTED_REF, protectedRef: PROTECTED_REF }),
      queue: observed.available ? observed : null,
    }),
  );
  return 0;
}

function cmdReap(root, argv) {
  requireCanonical(root);
  gitFetch('origin', root);
  const branches = laneBranches(root);
  const survey = surveyLanes(PROTECTED_REF, branches, { cwd: root });
  survey.blocked = [];

  const apply = flag(argv, 'apply');
  if (apply) {
    const retired = [];
    for (const lane of survey.integrated) {
      try {
        retire(lane.branch, { cwd: root });
        store.remove(lane.branch, root);
        retired.push(lane);
      } catch (error) {
        survey.blocked.push({
          branch: lane.branch,
          reason: error.reason ?? String(error.message),
          paths: error.paths,
        });
      }
    }
    survey.integrated = retired;
  }

  const stale = staleWorktrees(root).map((entry) => entry.path);
  out(report.formatSurvey(survey, { applied: apply }));
  if (stale.length > 0) {
    out('');
    out(`${stale.length} stale worktree registration(s)${apply ? ' pruned' : ''}:`);
    for (const path of stale) out(`  ${path}`);
    if (apply) git(['worktree', 'prune'], { cwd: root });
  }
  if (!apply && (survey.integrated.length > 0 || stale.length > 0)) {
    out('');
    out('read-only survey. To retire the proven-integrated lanes:');
    out('  npm run reap -- --apply');
  }
  return 0;
}

function cmdQueue(root, argv) {
  const [action = 'show'] = positional(argv);
  if (action === 'show') {
    const observed = queue.observe({ cwd: root });
    out(report.formatFindings('remote configuration', queue.audit(observed)));
    out('');
    out(report.formatPlan(queue.plan()));
    return 0;
  }
  if (action === 'apply') {
    if (!flag(argv, 'yes')) {
      out(report.formatPlan(queue.plan()));
      out('');
      out('This mutates shared branch protection on the remote. Re-run to confirm:');
      out('  npm run queue:apply -- --yes');
      return 1;
    }
    const applied = queue.apply({ cwd: root });
    for (const step of applied) {
      out(`${step.ok ? 'ok  ' : 'FAIL'} ${step.step}`);
      if (step.error) out(`       provider: ${step.error}`);
      if (step.note) out(`       ${step.note}`);
    }
    out('');
    out('Verify with: npm run doctor');
    return applied.some((step) => step.step.startsWith('ruleset') && step.ok) ? 0 : 1;
  }
  err(`unknown queue action "${action}". use: show | apply`);
  return 1;
}

function cmdHelp() {
  out(
    [
      'agentic-os — ADLC harness',
      '',
      '  npm run setup             write local git config, make hooks executable',
      '  npm run doctor            report harness and remote drift, change nothing',
      '  npm run lane -- <scope>   open a lane worktree at fetched origin/main',
      '  npm run land              push the lane, open a PR, hand it to the queue',
      '  npm run status            lanes, WIP against caps, queue state',
      '  npm run reap [-- --apply] retire lanes proven integrated by patch identity',
      '  npm run queue:show        inspect the required remote configuration',
      '  npm run queue:apply       write it (explicit, mutates branch protection)',
      '',
      `caps: ${CAPS.openLanesPerDevice} open lanes per device, stack depth ${CAPS.stackDepth}`,
    ].join('\n'),
  );
  return 0;
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  const cwd = process.cwd();
  let root;
  try {
    root = repoRoot(cwd);
  } catch {
    err('not inside a git repository.');
    return 1;
  }

  switch (command) {
    case 'setup':
      return cmdSetup(root);
    case 'git-configure':
      out(report.formatConfig(config.inspect(root)));
      config.ensure(root);
      return 0;
    case 'guard-install':
      return cmdSetup(root);
    case 'doctor':
      return cmdDoctor(root);
    case 'start':
      return cmdStart(root, argv);
    case 'land':
      return cmdLand(cwd);
    case 'status':
      return cmdStatus(root, argv);
    case 'reap':
      return cmdReap(root, argv);
    case 'queue':
      return cmdQueue(root, argv);
    case undefined:
    case 'help':
    case '--help':
      return cmdHelp();
    default:
      err(`unknown command "${command}"`);
      cmdHelp();
      return 1;
  }
}

try {
  process.exit(main());
} catch (error) {
  err(`agentic-os: ${error.message}`);
  process.exit(1);
}
