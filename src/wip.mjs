/**
 * WIP caps. Cycle time is work-in-progress divided by throughput, so the cap is
 * the velocity control. Everything else in the harness only removes waste.
 */

import { parseLaneRef } from './lane-id.mjs';

export const CAPS = Object.freeze({
  openLanesPerDevice: 3,
  stackDepth: 3,
});

/** Lanes owned by one device, from a list of lane refs. */
export function lanesForDevice(refs, device) {
  return refs.filter((ref) => parseLaneRef(ref)?.device === device);
}

/**
 * Depth of the stack a new lane would create. A lane based on fetched
 * `origin/main` has depth 1; each lane based on another lane adds one.
 */
export function stackDepth(baseRef, protectedRef) {
  return baseRef === protectedRef ? 1 : 2;
}

/** Facts the lane state machine needs for the cap guards. */
export function capFacts(refs, device, { baseRef, protectedRef } = {}) {
  return {
    openLanes: lanesForDevice(refs, device).length,
    wipCap: CAPS.openLanesPerDevice,
    stackDepth: baseRef ? stackDepth(baseRef, protectedRef) : 1,
    stackCap: CAPS.stackDepth,
  };
}

/** Human-readable cap advice used by refusals. */
export function capAdvice(reason) {
  if (reason === 'blocked-wip-cap') {
    return `at the cap of ${CAPS.openLanesPerDevice} open lanes for this device; run "npm run land" or "npm run reap" first`;
  }
  if (reason === 'blocked-stack-depth') {
    return `at the stack depth cap of ${CAPS.stackDepth}; land the bottom of the stack first`;
  }
  return null;
}
