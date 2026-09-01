/**
 * Rendering. Takes data, returns strings. No I/O, no git, no provider calls, so
 * every output shape is testable without a repository.
 */

export const MARK = Object.freeze({ ok: 'ok  ', fail: 'FAIL', warn: 'warn' });

function pad(value, width) {
  return String(value).padEnd(width);
}

export function formatFindings(title, findings) {
  const lines = [`${title}:`];
  for (const finding of findings) {
    const mark = finding.ok ? MARK.ok : MARK.fail;
    lines.push(`  ${mark} ${pad(finding.id, 18)} ${finding.detail}`);
    if (!finding.ok && finding.remedy) lines.push(`       remedy: ${finding.remedy}`);
  }
  return lines.join('\n');
}

export function formatConfig(entries) {
  const lines = ['local git configuration:'];
  for (const entry of entries) {
    const mark = entry.ok ? MARK.ok : MARK.fail;
    const actual = entry.actual === null ? 'unset' : entry.actual;
    lines.push(`  ${mark} ${pad(entry.key, 22)} ${pad(actual, 10)} want ${entry.value}`);
    if (!entry.ok) lines.push(`       ${entry.why}`);
  }
  return lines.join('\n');
}

export function formatLocal(local) {
  const lines = ['local repository:'];
  const branch = local.protectedBranch ?? 'main';
  const target = (local.protectedRef ?? 'origin/main').replace(/^refs\/remotes\//u, '');
  const push = (ok, id, detail, remedy) => {
    lines.push(`  ${ok ? MARK.ok : MARK.fail} ${pad(id, 18)} ${detail}`);
    if (!ok && remedy) lines.push(`       remedy: ${remedy}`);
  };
  push(
    !local.mainDirty,
    'main-clean',
    local.mainDirty
      ? `canonical ${branch} has exact tracked-byte/index risk (${local.trackedRiskPaths.length} byte, ${local.hiddenPaths.length} hidden)`
      : `canonical ${branch} tracked bytes and index match HEAD`,
    'move the bytes into a lane: npm run lane -- <scope>',
  );
  lines.push(`  ${MARK.warn} ${pad('owned-paths', 18)} ${local.ownedPathCount ?? local.ownedPaths.length} untracked/ignored path(s) retained`);
  const relationDetail = local.relation === 'equal'
    ? `canonical ${branch} equals cached ${target}`
    : local.relation === 'behind'
      ? `canonical ${branch} is ${local.behind} behind cached ${target}`
      : local.relation === 'ahead'
        ? `canonical ${branch} is ${local.ahead} ahead of cached ${target}`
        : local.relation === 'diverged'
          ? `canonical ${branch} diverged from cached ${target} (${local.ahead} ahead, ${local.behind} behind)`
          : `canonical ${branch} relation to cached ${target} is unknown`;
  push(
    local.relation === 'equal',
    'main-current',
    relationDetail,
    `git -C . merge --ff-only ${target}`,
  );
  push(
    local.staleWorktrees.length === 0,
    'worktrees',
    local.staleWorktrees.length === 0
      ? `${local.worktreeCount} registered worktree(s), none stale`
      : `${local.staleWorktrees.length} registration(s) point at missing directories`,
    'npm run reap',
  );
  push(
    local.laneBranches <= 20,
    'branch-count',
    `${local.laneBranches} local lane branch(es)`,
    'npm run reap',
  );
  return lines.join('\n');
}

export function formatStatus({ device, lanes, caps, queue }) {
  const lines = [`device ${device}`, ''];
  if (lanes.length === 0) {
    lines.push('no lanes. open one with: npm run lane -- <scope>');
  } else {
    lines.push(`${pad('LANE', 44)} ${pad('CACHED_STATE', 13)} ${pad('AHEAD', 6)} CACHED_NEXT`);
    for (const lane of lanes) {
      lines.push(
        `${pad(lane.ref, 44)} ${pad(lane.state, 13)} ${pad(lane.commits, 6)} ${lane.next.join(', ')}`,
      );
      if (lane.untracked > 0) {
        lines.push(`  ${lane.untracked} owned untracked path(s); they stay in place`);
      }
    }
  }
  lines.push('');
  lines.push(`open lanes ${caps.openLanes}/${caps.wipCap} for this device`);
  if (queue) {
    const state = queue.queueEnabled ? 'enabled' : 'NOT ENABLED';
    const count = Array.isArray(queue.openPrs) ? queue.openPrs.length : 'unknown';
    lines.push(`merge queue ${state}; ${count} open pull request(s)`);
    if (!queue.queueEnabled) lines.push('run npm run doctor for the exact drift');
  }
  return lines.join('\n');
}

export function formatSurvey(survey) {
  const lines = [];
  if (survey.integrated.length === 0) {
    lines.push('no lane has an exact integration projection.');
  } else {
    lines.push('proven integrated (cleanup remains separately governed):');
    for (const lane of survey.integrated) {
      lines.push(`  ${pad(lane.branch, 44)} ${lane.proof}`);
      lines.push(`       ${lane.detail}`);
    }
  }
  if (survey.open.length > 0) {
    lines.push('');
    lines.push('open lanes:');
    for (const lane of survey.open) {
      const note =
        lane.alreadyUpstream > 0
          ? `${lane.pending} pending, ${lane.alreadyUpstream} already upstream by patch identity`
          : `${lane.pending} pending`;
      lines.push(`  ${pad(lane.branch, 44)} ${note}`);
    }
  }
  if (survey.blocked?.length) {
    lines.push('');
    lines.push('blocked:');
    for (const lane of survey.blocked) {
      lines.push(`  ${pad(lane.branch, 44)} ${lane.reason}`);
      for (const path of lane.paths ?? []) lines.push(`       ${path}`);
    }
  }
  return lines.join('\n');
}

export function formatRefusal(result, advice) {
  const lines = [`refused: ${result.reason}`];
  if (result.guard) lines.push(`guard: ${result.guard} (${result.from} --${result.event}-->)`);
  if (advice) lines.push(advice);
  return lines.join('\n');
}

export function formatPlan(plan) {
  return ['desired provider policy for repository-authority review:', '', JSON.stringify(plan, null, 2)].join(
    '\n',
  );
}
