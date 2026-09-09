/**
 * Local lane identity and filesystem-safe naming: `agent/<device>/<scope>`.
 * A lane ref is only an observable projection; it grants no cross-device authority.
 */

import { hostname } from 'node:os';

export const LANE_PREFIX = 'agent';
export const SEGMENT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const DEVICE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const LANE_REF = /^agent\/[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9-]*$/;

function validDevice(device) {
  const value = String(device);
  return DEVICE.test(value) && !value.includes('..')
    && !value.includes('--') && !value.endsWith('.') && !value.endsWith('.lock');
}
const validScope = (scope) => String(scope).length <= 128 && SEGMENT.test(String(scope))
  && !String(scope).includes('--');
export function assertDevice(device) {
  if (!validDevice(device)) {
    throw new Error(
      `invalid device "${device}": use 1-64 lowercase letters, digits, dots, underscores, or single hyphens`,
    );
  }
  return device;
}

/** Stable, lowercase, hyphen-safe device segment derived from the host. */
export function deviceSegment(raw = hostname()) {
  const value = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!value) throw new Error('device segment could not be derived; pass --device');
  return assertDevice(value);
}

export function assertScope(scope) {
  if (!validScope(scope)) {
    throw new Error(
      `invalid scope "${scope}": use lowercase letters, digits and single interior hyphens, e.g. pricing-table`,
    );
  }
  return scope;
}

export function laneRef(scope, device = deviceSegment()) {
  return `${LANE_PREFIX}/${assertDevice(device)}/${assertScope(scope)}`;
}

export function isLaneRef(ref) {
  const value = String(ref);
  if (!LANE_REF.test(value)) return false;
  const [, device, scope] = value.split('/');
  return validDevice(device) && validScope(scope);
}

export function parseLaneRef(ref) {
  if (!isLaneRef(ref)) return null;
  const [, device, scope] = String(ref).split('/');
  return { device, scope };
}

/** Filesystem name for the lane worktree directory. */
export function laneDirName(scope, device = deviceSegment()) {
  return `${assertDevice(device)}--${assertScope(scope)}`;
}
