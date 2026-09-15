import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SandboxAgentBlock, assertIdentifier } from "./sandbox-agent-contract.js";
import { createPodmanCommandRunner } from "./podman-command-runner.js";

const OWNER_LABEL = "agentic-canvas-os.sandbox";

function pass(id, condition) {
  if (!condition) throw new SandboxAgentBlock("containment_proof_failed", `Containment check failed: ${id}.`);
  return Object.freeze({ id, status: "pass" });
}

function parseInspect(value, field) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0]) {
    throw new SandboxAgentBlock("containment_proof_failed", `${field} inspection was unavailable.`);
  }
  return parsed[0];
}

function hardenedTmpfs(value, mountPath) {
  const options = String(value?.[mountPath] || "").split(",");
  return ["nosuid", "nodev", "noexec"].every((expected) => options.includes(expected));
}

function nonRootUser(value) {
  return Boolean(value) && !/^0(?::0)?$/.test(value);
}

function noProcessCapabilities(status) {
  const lines = status.split("\n");
  return ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].every((key) => {
    const matches = lines.filter((line) => line.startsWith(`${key}:`));
    return matches.length === 1 && new RegExp(`^${key}:\\s+0{16}$`).test(matches[0]);
  });
}

export function createPodmanContainmentVerifier({
  revision,
  image,
  runPodman = createPodmanCommandRunner({ maxOutputBytes: 1_000_000 }),
  maxPids = 128,
} = {}) {
  const safeRevision = assertIdentifier(revision, "revision");
  const safeImage = assertIdentifier(image, "image");
  if (typeof runPodman !== "function") throw new TypeError("runPodman must be a function.");
  if (!Number.isInteger(maxPids) || maxPids < 1) throw new TypeError("maxPids must be a positive integer.");
  const descriptor = Object.freeze({ id: "podman-independent-probe", revision: safeRevision });

  async function verify({ state, provider, signal }) {
    if (provider.id !== "podman-cli" || state?.schema !== "podman-sandbox-state/v1") {
      throw new SandboxAgentBlock("containment_proof_failed", "Podman verifier received incompatible provider state.");
    }
    const inspected = parseInspect(
      (await runPodman(["inspect", state.containerId], { signal })).stdout,
      "container",
    );
    const host = inspected.HostConfig || {};
    const config = inspected.Config || {};
    const checks = [
      pass("container-running", inspected.State?.Running === true),
      pass("immutable-image", config.Image === safeImage),
      pass("non-root-user", nonRootUser(config.User)),
      pass("read-only-root", host.ReadonlyRootfs === true),
      pass("no-capabilities-added", Array.isArray(host.CapAdd) && host.CapAdd.length === 0),
      pass("no-new-privileges", host.SecurityOpt?.some((item) => item.includes("no-new-privileges"))),
      pass("not-privileged", host.Privileged === false),
      pass("private-pid-ipc-cgroup", host.PidMode !== "host" && host.IpcMode !== "host" && host.CgroupnsMode !== "host"),
      pass("bounded-memory-cpu-pids", host.Memory > 0 && host.NanoCpus > 0 && host.PidsLimit > 0 && host.PidsLimit <= maxPids),
      pass("workspace-tmpfs-hardened", hardenedTmpfs(host.Tmpfs, "/workspace") && hardenedTmpfs(host.Tmpfs, "/tmp")),
      pass("no-host-bind-mounts", (inspected.Mounts || []).every((mount) => mount.Type !== "bind")),
      pass("owned-container", config.Labels?.[OWNER_LABEL] === "true" && config.Labels?.["agentic-canvas-os.provider-revision"] === provider.revision),
    ];

    const engineSecurity = JSON.parse((await runPodman(["info", "--format", "{{json .Host.Security}}"], { signal })).stdout);
    checks.push(pass("engine-seccomp", engineSecurity.seccompEnabled === true));
    if (state.networkId) {
      const network = parseInspect(
        (await runPodman(["network", "inspect", state.networkId], { signal })).stdout,
        "network",
      );
      checks.push(pass("internal-network", network.internal === true));
      checks.push(pass("agent-container-not-published", !Object.keys(host.PortBindings || {}).length));
      let proxiesHardened = state.previewPorts?.length > 0
        && state.previewBindings?.length === state.previewPorts.length;
      for (const binding of state.previewBindings || []) {
        const proxy = parseInspect(
          (await runPodman(["inspect", binding.proxyContainerId], { signal })).stdout,
          "preview proxy",
        );
        const proxyHost = proxy.HostConfig || {};
        const proxyBindings = Object.values(proxyHost.PortBindings || {}).flat();
        const publishedPort = await runPodman(
          ["port", binding.proxyContainerId, `${binding.containerPort}/tcp`],
          { signal },
        );
        const proxyCaps = await runPodman(["exec", binding.proxyContainerId, "cat", "/proc/1/status"], { signal });
        proxiesHardened &&= noProcessCapabilities(proxyCaps.stdout);
        proxiesHardened &&= proxy.State?.Running === true
          && proxy.Config?.Image === safeImage
          && nonRootUser(proxy.Config?.User)
          && proxy.Config?.Labels?.["agentic-canvas-os.sandbox-role"] === "preview-proxy"
          && proxyHost.ReadonlyRootfs === true
          && Array.isArray(proxyHost.CapAdd) && proxyHost.CapAdd.length === 0
          && proxyHost.SecurityOpt?.some((item) => item.includes("no-new-privileges"))
          && proxyHost.Privileged === false
          && proxyHost.Memory > 0
          && proxyHost.NanoCpus > 0
          && proxyHost.PidsLimit > 0
          && proxyHost.PidsLimit <= maxPids
          && hardenedTmpfs(proxyHost.Tmpfs, "/tmp")
          && (proxy.Mounts || []).every((mount) => mount.Type !== "bind")
          && proxyBindings.length === 1
          && proxyBindings[0].HostIp === "127.0.0.1"
          && /^127\.0\.0\.1:[0-9]+$/m.test(publishedPort.stdout.trim());
      }
      checks.push(pass("hardened-loopback-preview-proxies", proxiesHardened));
    } else {
      checks.push(pass(
        "network-disabled",
        host.NetworkMode === "none"
          && !Object.keys(host.PortBindings || {}).length
          && !state.previewPorts?.length
          && !state.previewBindings?.length,
      ));
    }

    const caps = await runPodman(["exec", state.containerId, "cat", "/proc/1/status"], { signal });
    checks.push(pass("all-process-capabilities-dropped", noProcessCapabilities(caps.stdout)));
    const user = await runPodman(["exec", state.containerId, "id", "-u"], { signal });
    checks.push(pass("behavior-non-root", Number(user.stdout.trim()) > 0));
    const rootWrite = await runPodman(
      ["exec", state.containerId, "touch", "/containment-root-write"],
      { signal, acceptedExitCodes: [0, 1, 2, 126] },
    );
    checks.push(pass("behavior-root-write-denied", rootWrite.exitCode !== 0));
    await runPodman(["exec", state.containerId, "touch", "/workspace/.containment-probe"], { signal });
    await runPodman(["exec", state.containerId, "rm", "/workspace/.containment-probe"], { signal });
    checks.push(pass("behavior-workspace-write", true));

    const egressProbe = [
      "const net=require('node:net');",
      "const socket=net.connect({host:'1.1.1.1',port:443});",
      "const blocked=()=>process.exit(0);",
      "socket.setTimeout(750);",
      "socket.on('connect',()=>process.exit(1));",
      "socket.on('error',blocked);",
      "socket.on('timeout',()=>{socket.destroy();blocked();});",
    ].join("");
    const egress = await runPodman(
      ["exec", state.containerId, "node", "-e", egressProbe],
      { signal, acceptedExitCodes: [0, 1] },
    );
    checks.push(pass("behavior-egress-denied", egress.exitCode === 0));

    return Object.freeze({ status: "verified", fresh: true, checks: Object.freeze(checks) });
  }

  return Object.freeze({ descriptor, verify });
}

const digest = /^[a-f0-9]{64}$/u;
const refuse = () => { throw new TypeError('Local model artifacts or container do not match the host policy.'); };
const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const stable = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'nlink']
  .every(key => left[key] === right[key]);

/** Explicit optional llama-compatible server profile; the generic runtime has no dependency on it. */
export function createPodmanModelCommand({ modelSha256, modelMount = '/models/model.gguf',
  keyMount = '/run/model-key', containerPort = 8080 } = {}) {
  if (!digest.test(modelSha256) || !Number.isSafeInteger(containerPort) || containerPort < 1024 || containerPort > 65535
    || ![modelMount, keyMount].every(path => typeof path === 'string' && isAbsolute(path) && resolve(path) === path)
    || modelMount === keyMount) refuse();
  return Object.freeze(['--model', modelMount, '--alias', 'sha256:' + modelSha256,
    '--host', '0.0.0.0', '--port', String(containerPort), '--api-key-file', keyMount,
    '--ctx-size', '2048', '--parallel', '1', '--threads', '2', '--n-predict', '512', '--no-webui', '--no-webui-mcp-proxy']);
}

async function verifiedFile(path, { secret = false, expected = null, signal } = {}) {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) refuse();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid())
      || (before.mode & (secret ? 0o077n : 0o022n)) !== 0n || before.size < 1n
      || before.size > BigInt(secret ? 4096 : 2_147_483_648)) refuse();
    const hash = createHash('sha256'), chunks = [];
    const buffer = Buffer.alloc(65536); let offset = 0;
    while (offset < Number(before.size)) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      if (!bytesRead) refuse();
      hash.update(buffer.subarray(0, bytesRead));
      if (secret) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      offset += bytesRead;
    }
    if (!stable(before, await handle.stat({ bigint: true })) || !stable(before, await lstat(path, { bigint: true }))) refuse();
    const sha256 = hash.digest('hex');
    if (expected !== null && sha256 !== expected) refuse();
    const value = secret ? Buffer.concat(chunks).toString('utf8').trim() : null;
    if (secret && !/^[A-Za-z0-9_-]{32,256}$/u.test(value)) refuse();
    return { sha256, bytes: offset, value };
  } finally { await handle.close(); }
}

/** Optional host-only readback. Starts nothing, downloads nothing, and never
 * treats a prior receipt or image tag as current artifact verification. */
export function createPodmanModelVerifier({ modelPath, modelSha256, apiKeyPath, imageDigest,
  containerId, endpoint, executable = '/app/llama-server', containerPort = 8080,
  modelMount = '/models/model.gguf', keyMount = '/run/model-key',
  runPodman = createPodmanCommandRunner({ maxOutputBytes: 128_000 }) } = {}) {
  const url = new URL(endpoint);
  if (!digest.test(modelSha256) || !/^sha256:[a-f0-9]{64}$/u.test(imageDigest)
    || !digest.test(containerId) || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || !url.port || url.username || url.password || url.search || url.hash
    || typeof modelPath !== 'string' || typeof apiKeyPath !== 'string' || modelPath === apiKeyPath
    || ![modelMount, keyMount].every(path => typeof path === 'string' && isAbsolute(path) && resolve(path) === path)
    || modelMount === keyMount || typeof runPodman !== 'function'
    || typeof executable !== 'string' || !isAbsolute(executable) || resolve(executable) !== executable) refuse();
  const command = createPodmanModelCommand({ modelSha256, modelMount, keyMount, containerPort });
  async function verifyArtifacts({ signal } = {}) {
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]);
    const file = await verifiedFile(modelPath, { expected: modelSha256, signal: bounded });
    await verifiedFile(apiKeyPath, { secret: true, signal: bounded });
    const parsed = JSON.parse((await runPodman(['container', 'inspect', containerId], { signal: bounded })).stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1) refuse();
    const item = parsed[0], host = item.HostConfig, config = item.Config;
    if (item.Id !== containerId || item.State?.Running !== true || item.State?.Paused !== false
      || item.ImageDigest !== imageDigest || item.Path !== executable || !host || !config || !exact(config.Cmd, command)
      || !String(config.Image).endsWith('@' + imageDigest) || host.ReadonlyRootfs !== true
      || host.Privileged !== false || host.PublishAllPorts !== false
      || !Array.isArray(host.CapAdd) || host.CapAdd.length
      || !host.SecurityOpt?.some(value => value === 'no-new-privileges' || value === 'no-new-privileges=true')
      || ['host', 'container'].some(value => [host.PidMode, host.IpcMode, host.NetworkMode].some(mode => String(mode).startsWith(value)))
      || !(host.Memory > 0 && host.Memory <= 2_147_483_648)
      || !(host.NanoCpus > 0 && host.NanoCpus <= 2_000_000_000)
      || !(host.PidsLimit > 0 && host.PidsLimit <= 128)) refuse();
    const ports = Object.entries(host.PortBindings ?? {});
    if (ports.length !== 1 || ports[0][0] !== containerPort + '/tcp' || ports[0][1]?.length !== 1
      || ports[0][1][0].HostIp !== '127.0.0.1' || ports[0][1][0].HostPort !== url.port) refuse();
    const mounts = item.Mounts;
    if (!Array.isArray(mounts) || mounts.length !== 2) refuse();
    for (const [source, destination] of [[modelPath, modelMount], [apiKeyPath, keyMount]]) {
      if (mounts.filter(mount => mount.Type === 'bind' && mount.Source === source
        && mount.Destination === destination && mount.RW === false).length !== 1) refuse();
    }
    const status = await runPodman(['exec', containerId, 'cat', '/proc/1/status'], { signal: bounded });
    if (!noProcessCapabilities(status.stdout)) refuse();
    bounded.throwIfAborted();
    return Object.freeze({ verified: true, modelSha256, imageDigest, containerId, modelBytes: file.bytes,
      observedAt: new Date().toISOString(), authority: false });
  }
  return Object.freeze({ verifyArtifacts,
    async getHeaders() { const { value } = await verifiedFile(apiKeyPath, { secret: true });
      return { authorization: 'Bearer ' + value }; } });
}
