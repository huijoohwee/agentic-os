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
  const push = (ok, id, detail, remedy) => {
    lines.push(`  ${ok ? MARK.ok : MARK.fail} ${pad(id, 18)} ${detail}`);
    if (!ok && remedy) lines.push(`       remedy: ${remedy}`);
  };
  push(
    !local.mainDirty,
    'main-clean',
    local.mainDirty ? 'canonical main has uncommitted tracked changes' : 'canonical main is clean',
    'move the bytes into a lane: npm run lane -- <scope>',
  );
  push(
    local.behind === 0,
    'main-current',
    local.behind === 0 ? 'canonical main equals origin/main' : `canonical main is ${local.behind} behind origin/main`,
    'git -C . merge --ff-only origin/main',
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
    lines.push(`${pad('LANE', 44)} ${pad('STATE', 11)} ${pad('AHEAD', 6)} NEXT`);
    for (const lane of lanes) {
      lines.push(
        `${pad(lane.ref, 44)} ${pad(lane.state, 11)} ${pad(lane.commits, 6)} ${lane.next.join(', ')}`,
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
    lines.push(`merge queue ${state}; ${queue.openPrs.length} open pull request(s)`);
    if (!queue.queueEnabled) lines.push('run npm run doctor for the exact drift');
  }
  return lines.join('\n');
}

export function formatSurvey(survey, { applied = false } = {}) {
  const lines = [];
  if (survey.integrated.length === 0) {
    lines.push('no lane is provably integrated; nothing to retire.');
  } else {
    lines.push(applied ? 'retired:' : 'retirable (proven integrated):');
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
  return ['this is the exact mutation queue:apply performs:', '', JSON.stringify(plan, null, 2)].join(
    '\n',
  );
}
