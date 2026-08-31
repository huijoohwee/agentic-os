/**
 * Lane identity. The branch name is the entire coordination surface: no lease,
 * no fence epoch, no ledger. `agent/<device>/<scope>`.
 */

import { hostname } from 'node:os';

export const LANE_PREFIX = 'agent';
export const SEGMENT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const LANE_REF = /^agent\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9-]*$/;

/** Stable, lowercase, hyphen-safe device segment derived from the host. */
export function deviceSegment(raw = hostname()) {
  const value = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!value) throw new Error('device segment could not be derived; pass --device');
  return value;
}

export function assertScope(scope) {
  if (!SEGMENT.test(String(scope))) {
    throw new Error(
      `invalid scope "${scope}": use lowercase letters, digits and interior hyphens, e.g. pricing-table`,
    );
  }
  return scope;
}

export function laneRef(scope, device = deviceSegment()) {
  return `${LANE_PREFIX}/${device}/${assertScope(scope)}`;
}

export function isLaneRef(ref) {
  return LANE_REF.test(String(ref));
}

export function parseLaneRef(ref) {
  if (!isLaneRef(ref)) return null;
  const [, device, scope] = String(ref).split('/');
  return { device, scope };
}

/** Filesystem name for the lane worktree directory. */
export function laneDirName(scope, device = deviceSegment()) {
  return `${device}--${assertScope(scope)}`;
}
