import { observeGit } from '../src/git.mjs';
import { hash } from './agentic-os-test-inputs.mjs';

const KEYS = ['base', 'baseSha', 'planDigest', 'pr', 'preservedRef', 'priorMemberRevision',
  'priorAllocationHead', 'priorWriteDigest', 'schema', 'selectedPaths', 'targetHead', 'writeDigest'];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function validPublishedHeadReconciliation(value, { before, row, member, root }) {
  if (!value || Object.keys(value).sort().join(',') !== [...KEYS].sort().join(',')
    || value.schema !== 'agentic-os/workflow-published-head-reconciliation/v1'
    || !/^[a-f0-9]{64}$/u.test(value.planDigest ?? '')
    || !/^[a-f0-9]{40}$/u.test(value.priorAllocationHead ?? '')
    || !/^[a-f0-9]{40}$/u.test(value.priorMemberRevision ?? '')
    || !/^[a-f0-9]{40}$/u.test(value.targetHead ?? '') || !/^[a-f0-9]{40}$/u.test(value.baseSha ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.priorWriteDigest ?? '') || !/^[a-f0-9]{64}$/u.test(value.writeDigest ?? '')
    || !Number.isSafeInteger(value.pr) || value.pr < 1
    || typeof value.base !== 'string' || !/^refs[/]remotes[/][A-Za-z0-9][A-Za-z0-9._-]{0,127}[/]main$/u.test(value.base)
    || !/^refs[/]agentic-os[/]recovery[/]published-head[/][a-f0-9]{24}$/u.test(value.preservedRef ?? '')
    || !Array.isArray(value.selectedPaths) || value.selectedPaths.length < 1 || value.selectedPaths.length > 1024
    || value.selectedPaths.some(path => typeof path !== 'string' || path.length < 1 || path.length > 4096
      || path.includes(',') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    || !same(value.selectedPaths, [...new Set(value.selectedPaths)].sort())
    || Buffer.byteLength(value.selectedPaths.join(',')) > 64000 || hash(JSON.stringify(value.selectedPaths)) !== value.writeDigest
    || !before || !row || !member || !root) return false;
  const first = before.headReconciliation === undefined;
  const stable = before.state === row.state || before.state === 'active' && row.state === 'released';
  const lineage = first
    ? before.headRevision === value.priorAllocationHead && row.headRevision === value.targetHead
      && before.writeDigest === value.priorWriteDigest && row.writeDigest === value.writeDigest
    : same(before.headReconciliation, value)
      && observeGit(['merge-base', '--is-ancestor', value.targetHead, before.headRevision], { cwd: root, allowFail: true }) !== null
      && observeGit(['merge-base', '--is-ancestor', before.headRevision, row.headRevision], { cwd: root, allowFail: true }) !== null;
  return lineage && stable && (before.state === 'active' || before.state === 'released' && row.state === 'released')
    && before.ref === row.ref && before.worktreeId === row.worktreeId && before.path === row.path
    && before.baseRevision === value.baseSha && row.baseRevision === value.baseSha
    && (first ? before.writeDigest === value.priorWriteDigest : before.writeDigest === value.writeDigest)
    && row.writeDigest === value.writeDigest && before.operation === row.operation
    && before.previousWriteDigest === row.previousWriteDigest
    && member.child.context.worktreeId === row.worktreeId && member.child.source.revision === row.headRevision
    && observeGit(['rev-parse', '--verify', value.preservedRef], { cwd: root }) === value.priorAllocationHead
    && observeGit(['cat-file', '-t', value.priorMemberRevision], { cwd: root }) === 'commit'
    && observeGit(['merge-base', '--is-ancestor', value.priorAllocationHead, value.priorMemberRevision], { cwd: root, allowFail: true }) !== null
    && observeGit(['cat-file', '-t', value.targetHead], { cwd: root }) === 'commit'
    && observeGit(['merge-base', '--is-ancestor', value.targetHead, value.priorAllocationHead], { cwd: root, allowFail: true }) !== null;
}
