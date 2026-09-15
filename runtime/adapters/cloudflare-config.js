/** Native headless configuration; deployment identity stays with the consumer. */
export function createCloudflareAgentConfig({ name, main, authSessionNamespace, canvasRoomNamespace } = {}) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)
    || typeof main !== 'string' || !main || main.length > 4096 || /[\x00-\x1f]/.test(main))
    throw new TypeError('An explicit Worker name and entry path are required.');
  const namespace = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
  if (!namespace(authSessionNamespace) || !namespace(canvasRoomNamespace)
    || authSessionNamespace === canvasRoomNamespace)
    throw new TypeError('Distinct explicit rate-limit namespaces are required.');
  return {
    name, main, minify: true, workers_dev: false, preview_urls: false,
    // Preserve the existing runtime semantics during source migration.
    compatibility_date: '2026-07-05', compatibility_flags: ['nodejs_compat'],
    ratelimits: [
      { name: 'AUTH_SESSION_RATE_LIMITER', namespace_id: authSessionNamespace, simple: { limit: 30, period: 60 } },
      { name: 'CANVAS_ROOM_RATE_LIMITER', namespace_id: canvasRoomNamespace, simple: { limit: 120, period: 60 } },
    ],
    observability: { enabled: true, head_sampling_rate: 0.01,
      logs: { enabled: true, head_sampling_rate: 0.01, invocation_logs: false }, traces: { enabled: false } },
    durable_objects: { bindings: [
      { name: 'CANVAS_ROOM', class_name: 'CanvasRoom' }, { name: 'AGENT_STATE', class_name: 'AgentState' },
    ] },
    migrations: [
      { tag: 'v1-canvas-room', new_sqlite_classes: ['CanvasRoom'] },
      { tag: 'v2-agent-state', new_sqlite_classes: ['AgentState'] },
    ],
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    vars: { AGENT_TOOLKIT_TELEMETRY_ENABLED: 'true' },
    secrets: { required: ['AGENT_API_JWT_SECRET', 'AGENT_REVIEW_JWT_SECRET'] },
  };
}
