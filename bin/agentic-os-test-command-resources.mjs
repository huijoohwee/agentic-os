/** Optional waited-process accounting. No sampling, shell, output parsing or authority. */
import { spawnSync } from 'node:child_process';

const LIMIT = 4096;
let capability;
const supervisor = String.raw`
import json, os, resource, signal, subprocess, sys
def emit(value):
    os.write(3, (json.dumps(value, separators=(',', ':')) + '\n').encode())
try:
    child = subprocess.Popen(sys.argv[1:], close_fds=True)
except OSError:
    emit({'spawnFailed': True})
    sys.exit(127)
_, status, usage = os.wait4(child.pid, 0)
code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -os.WTERMSIG(status)
child.returncode = code
emit({'cpuUserMs': usage.ru_utime * 1000, 'cpuSystemMs': usage.ru_stime * 1000,
      'peakMemoryBytes': usage.ru_maxrss * (1 if sys.platform == 'darwin' else 1024)})
if code < 0:
    signal.signal(-code, signal.SIG_DFL)
    os.kill(os.getpid(), -code)
sys.exit(code)
`;

export function resourceCommand(command, args, environment, platform = process.platform) {
  const direct = reason => ({ command, args, measured: false, reason });
  if (!['darwin', 'linux'].includes(platform)) return direct('unsupported-host');
  const key = JSON.stringify([environment.PATH, platform]);
  if (capability?.key !== key) {
    const probe = spawnSync('python3', ['-I', '-c', 'import os, resource, sys; assert hasattr(os, "wait4"); print(sys.executable)'],
      { env: environment, encoding: 'utf8', timeout: 1000, maxBuffer: LIMIT, stdio: ['ignore', 'pipe', 'pipe'] });
    const executable = probe.status === 0 ? probe.stdout.trim() : '';
    capability = { key, executable: executable.startsWith('/') && !/[\r\n\0]/u.test(executable) ? executable : null };
  }
  return capability.executable ? { command: capability.executable, args: ['-I', '-c', supervisor, command, ...args], measured: true }
    : direct('native-accounting-unavailable');
}

export function commandResourceReader(plan) {
  const chunks = []; let bytes = 0;
  return {
    accept(chunk) { bytes += chunk.length; if (bytes <= LIMIT) chunks.push(chunk); },
    finish() {
      const unavailable = reason => ({ status: 'unavailable', reason, cpuMs: null, cpuUserMs: null,
        cpuSystemMs: null, peakMemoryBytes: null });
      if (!plan.measured) return unavailable(plan.reason);
      if (!bytes || bytes > LIMIT) return unavailable(bytes ? 'accounting-byte-budget' : 'accounting-interrupted');
      let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return unavailable('invalid-accounting'); }
      if (value?.spawnFailed === true && Object.keys(value).length === 1)
        return { ...unavailable('spawn-failed'), spawnFailed: true };
      if (!value || Object.keys(value).sort().join() !== 'cpuSystemMs,cpuUserMs,peakMemoryBytes'
        || Object.values(value).some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER)
        || !Number.isSafeInteger(value.peakMemoryBytes) || value.cpuUserMs + value.cpuSystemMs > Number.MAX_SAFE_INTEGER)
        return unavailable('invalid-accounting');
      return { status: 'measured', method: 'wait4', scope: 'waited-process-tree',
        memoryScope: 'maximum-single-process-rss', ...value, cpuMs: value.cpuUserMs + value.cpuSystemMs };
    },
  };
}
