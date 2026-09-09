/** Exact package/lock pins shared by composition and the read-only drift command. */
export function harnessPinFormats(repository) {
  return [
    { name: 'github', prefix: `github:${repository}#`, resolved: `git+ssh://git@github.com/${repository}.git#` },
    { name: 'tarball', prefix: `https://codeload.github.com/${repository}/tar.gz/`,
      resolved: `https://codeload.github.com/${repository}/tar.gz/` },
  ];
}
export function exactAgenticOsPackagePin(source, prefix) {
  let manifest;
  try { manifest = JSON.parse(source); } catch { return null; }
  return exactAgenticOsPinValue(manifest, prefix);
}
function exactAgenticOsPinValue(manifest, prefix) {
  if (typeof prefix !== 'string' || prefix.length === 0
    || !manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  const pins = ['dependencies', 'devDependencies', 'optionalDependencies']
    .filter(section => manifest[section] && typeof manifest[section] === 'object'
      && Object.hasOwn(manifest[section], 'agentic-os'))
    .map(section => manifest[section]['agentic-os']);
  if (pins.length !== 1 || typeof pins[0] !== 'string' || !pins[0].startsWith(prefix)) return null;
  const revision = pins[0].slice(prefix.length);
  return /^[0-9a-f]{40}$/u.test(revision) ? revision : null;
}
export function parseAgenticOsLockfilePin(source, prefix, resolvedPrefix, expectedPin) {
  let lock;
  try { lock = JSON.parse(source); } catch { return null; }
  const root = lock?.packages?.[''], installed = lock?.packages?.['node_modules/agentic-os'];
  const pin = exactAgenticOsPinValue(root, prefix), integrity = installed?.integrity;
  if (lock?.lockfileVersion !== 3 || lock?.requires !== true || pin === null || pin !== expectedPin
    || installed?.resolved !== `${resolvedPrefix}${pin}` || typeof integrity !== 'string'
    || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) return null;
  const encoded = integrity.slice(7), digest = Buffer.from(encoded, 'base64');
  return digest.length === 64 && digest.toString('base64') === encoded
    ? { agenticOsPin: pin, agenticOsIntegrity: integrity } : null;
}
