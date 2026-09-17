/** Project existing child receipts into outer progress, never raw output or execution authority. */
import { readValidationObservation } from './agentic-os-validation-observation.mjs';

export function validationProgress(root, source, startedAt, {
  read = () => readValidationObservation(root), out = console.log, now = Date.now,
} = {}) {
  const emitted = new Map();
  return () => {
    let observation;
    try { observation = read(); } catch { return; } // A command need not use the stage runner.
    if (observation?.schema !== 'agentic-os/validation-observation/v1' || observation.authority !== false
      || observation.startedAt < startedAt || observation.startedAt > now()
      || !Number.isFinite(observation.startedAt)
      || ['repository', 'revision', 'tree', 'dirty'].some(key => observation.source?.[key] !== source[key])) return;
    for (const stage of observation.stages) {
      const signature = `${stage.status}:${stage.elapsedMs}`;
      if (emitted.get(stage.id) === signature) continue;
      emitted.set(stage.id, signature);
      const duration = stage.elapsedMs === null ? 'unreported' : `${(stage.elapsedMs / 1000).toFixed(2)}s`;
      const resource = Object.entries(stage.resources ?? {}).filter(([key, value]) =>
        ['cpuMs', 'peakMemoryBytes', 'tokens', 'costUsd'].includes(key) && Number.isFinite(value))
        .map(([key, value]) => `${key}=${value}`).join(', ');
      out(`child stage ${stage.id}: ${stage.status}, ${duration}${resource ? `, ${resource}` : ''}`);
    }
  };
}
