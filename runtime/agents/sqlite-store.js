import { constants, closeSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalizeJson } from '../json-contract.mjs';
import { assertIdentifier } from './agent-swarm-contract.js';

const SCHEMA = 'agentic-os/swarm-sqlite/v1';
const DEFAULTS = Object.freeze({ maxRecords: 128, maxRecordsPerPrincipal: 32,
  maxRecordBytes: 499_999, maxActiveTasks: 8, maxActiveTasksPerPrincipal: 4, busyTimeoutMs: 1_000 });

function privatePath(path, directory = false) {
  const stat = lstatSync(path);
  if ((directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
    throw new TypeError('Agent state requires a private owned directory and regular files.');
  }
}

/** Toolkit records reuse the same local atomic storage protocol in an inert envelope. */
export async function createAgentToolkitSqliteStore(options) {
  const store = await createAgentSwarmSqliteStore(options);
  const key = id => `toolkit:${createHash('sha256').update(assertIdentifier(id, 'recordId', 512)).digest('hex')}`;
  const wrap = value => ({ runId: key(value.recordId), ownerPrincipalId: value.ownerPrincipalId ?? value.principalDigest ?? 'toolkit-admission',
    expiresAt: value.expiresAt, status: 'completed', payload: value });
  return Object.freeze({
    put: value => store.put(wrap(value)),
    get: async id => (await store.get(key(id)))?.payload ?? null,
    claim: async (id, claim, expires) => (await store.claim(key(id), claim, expires))?.payload ?? null,
    replace: (id, claim, value) => {
      if (id !== value.recordId) throw new TypeError('Toolkit record identity changed.');
      return store.replace(key(id), claim, wrap(value));
    },
    release: (id, claim) => store.release(key(id), claim),
    commit: (id, claim) => store.commit(key(id), claim),
    delete: id => store.delete(key(id)), stats: store.stats, close: store.close,
  });
}

function preparePath(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new TypeError('directory must be an absolute private state path.');
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privatePath(directory, true);
  const path = join(directory, 'swarm.sqlite');
  try { closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  privatePath(path);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { privatePath(path + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}

/** Explicit local adapter. Core imports remain usable without Node's optional SQLite module. */
export async function createAgentSwarmSqliteStore({ directory, now = () => Date.now(), ...options } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  const limits = { ...DEFAULTS, ...options };
  for (const [key, value] of Object.entries(limits)) {
    if (!(key in DEFAULTS) || !Number.isSafeInteger(value) || value < 1
      || value > (key === 'maxRecordBytes' ? 499_999 : key === 'busyTimeoutMs' ? 5_000 : 1_024)) {
      throw new TypeError(`Unsupported or unbounded SQLite store option: ${key}`);
    }
  }
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { throw new TypeError('The local SQLite adapter requires Node.js 22.13 or newer.'); }
  const db = new DatabaseSync(preparePath(directory));
  let closed = false;
  try {
    db.exec(`PRAGMA busy_timeout=${limits.busyTimeoutMs}; PRAGMA trusted_schema=OFF;`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if (tables.length && !tables.some(({ name }) => name === 'agent_store_meta')) {
      throw new TypeError('Unknown agent state database; no migration was authorized.');
    }
    // SQLite may reject a simultaneous first WAL transition without waiting on busy_timeout.
    for (let attempt = 0; ; attempt++) {
      try { db.exec('PRAGMA journal_mode=WAL'); break; }
      catch (error) {
        if (error.errcode !== 5 || attempt >= 7) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    db.exec(`CREATE TABLE IF NOT EXISTS agent_store_meta
      (id INTEGER PRIMARY KEY CHECK(id=1), schema TEXT NOT NULL, config TEXT NOT NULL, clock INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_records
      (id TEXT PRIMARY KEY, principal TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL,
       claim TEXT, claim_expires INTEGER, active_tasks INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_records_principal ON agent_records(principal);`);
    const config = JSON.stringify(canonicalizeJson(limits));
    const meta = db.prepare('SELECT * FROM agent_store_meta WHERE id=1').get();
    if (meta && (meta.schema !== SCHEMA || meta.config !== config)) {
      throw new TypeError('Agent state schema or capacity configuration changed; preserve state for migration.');
    }
    if (!meta) db.prepare('INSERT INTO agent_store_meta VALUES (1, ?, ?, 0)').run(SCHEMA, config);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* No transaction may have started. */ }
    db.close(); throw error;
  }

  function transaction(operation) {
    if (closed) throw new TypeError('Agent state store is closed.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const at = now(), prior = db.prepare('SELECT clock FROM agent_store_meta WHERE id=1').get().clock;
      if (!Number.isSafeInteger(at) || at < prior) throw new TypeError('Agent state clock regressed or is invalid.');
      db.prepare('UPDATE agent_store_meta SET clock=? WHERE id=1').run(at);
      db.prepare('DELETE FROM agent_records WHERE expires<=?').run(at);
      db.prepare('UPDATE agent_records SET claim=NULL, claim_expires=NULL WHERE claim_expires<=?').run(at);
      const result = operation(at);
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function record(value, at) {
    const safe = canonicalizeJson(value, 'swarm record');
    if (!safe || typeof safe !== 'object' || Array.isArray(safe)
      || !Number.isSafeInteger(safe.expiresAt) || safe.expiresAt <= at) {
      throw new TypeError('record.expiresAt must be a future integer timestamp.');
    }
    const id = assertIdentifier(safe.runId, 'record.runId');
    const principal = assertIdentifier(safe.ownerPrincipalId ?? 'unassigned', 'record.ownerPrincipalId');
    const body = JSON.stringify(safe);
    if (Buffer.byteLength(body) > limits.maxRecordBytes) throw new RangeError('Agent record byte capacity exceeded.');
    const active = (safe.tasks ?? []).filter(task => (task.status === 'running' && task.leaseExpiresAt > at) || (task.status === 'reconciling' && task.reconciliation?.expiresAt > at)).length
      + (safe.synthesis?.status === 'running' && safe.synthesis.leaseExpiresAt > at ? 1 : 0);
    return { id, principal, body, expires: safe.expiresAt, active };
  }

  function admit(candidate, insert, at) {
    // Recompute expired peer execution leases atomically; a crash cannot retain capacity forever.
    for (const row of db.prepare('SELECT id, body FROM agent_records').all()) {
      const active = record(JSON.parse(row.body), at).active;
      db.prepare('UPDATE agent_records SET active_tasks=? WHERE id=?').run(active, row.id);
    }
    const peers = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(principal=?), 0) AS owned, COALESCE(SUM(active_tasks), 0) AS active,
      COALESCE(SUM(CASE WHEN principal=? THEN active_tasks ELSE 0 END), 0) AS owned_active
      FROM agent_records WHERE id<>?`).get(candidate.principal, candidate.principal, candidate.id);
    if ((insert && peers.total >= limits.maxRecords) || peers.owned >= limits.maxRecordsPerPrincipal
      || peers.active + candidate.active > limits.maxActiveTasks
      || peers.owned_active + candidate.active > limits.maxActiveTasksPerPrincipal) {
      throw new RangeError('Agent state queue or execution capacity exceeded.');
    }
  }

  const read = id => db.prepare('SELECT * FROM agent_records WHERE id=?').get(id);
  const key = value => assertIdentifier(value, 'runId');
  const claimKey = value => assertIdentifier(value, 'claimId', 512);
  const owns = (id, claim) => read(id)?.claim === claim;
  return Object.freeze({
    async put(value) {
      return transaction(at => {
        const item = record(value, at);
        if (read(item.id)) return false;
        admit(item, true, at);
        db.prepare('INSERT INTO agent_records VALUES (?, ?, ?, ?, NULL, NULL, ?)')
          .run(item.id, item.principal, item.body, item.expires, item.active);
        return true;
      });
    },
    async get(value) {
      const id = key(value);
      return transaction(() => { const row = read(id); return row ? JSON.parse(row.body) : null; });
    },
    async listPending({ limit = 8 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > limits.maxRecords)
        throw new TypeError('Pending run scan exceeds its configured bound.');
      return transaction(() => db.prepare('SELECT body FROM agent_records ORDER BY id').all()
        .map(row => JSON.parse(row.body)).filter(row => !['completed', 'blocked', 'canceled'].includes(row.status))
        .sort((a, b) => Date.parse(a.updatedAt ?? a.createdAt) - Date.parse(b.updatedAt ?? b.createdAt))
        .slice(0, limit));
    },
    async claim(value, claimValue, claimExpiresAt) {
      const id = key(value), claim = claimKey(claimValue);
      return transaction(at => {
        if (!Number.isSafeInteger(claimExpiresAt) || claimExpiresAt <= at) {
          throw new TypeError('claimExpiresAt must be a future integer timestamp.');
        }
        const row = read(id);
        if (!row || row.claim) return null;
        db.prepare('UPDATE agent_records SET claim=?, claim_expires=? WHERE id=?').run(claim, claimExpiresAt, id);
        return JSON.parse(row.body);
      });
    },
    async replace(value, claimValue, replacement) {
      const id = key(value), claim = claimKey(claimValue);
      return transaction(at => {
        if (!owns(id, claim)) return false;
        const item = record(replacement, at);
        if (item.id !== id) throw new TypeError('Replacement run identity changed.');
        const prior = read(id);
        if (JSON.parse(prior.body).ownerPrincipalId !== undefined && item.principal !== prior.principal) {
          throw new TypeError('Replacement run principal changed.');
        }
        admit(item, false, at);
        db.prepare(`UPDATE agent_records SET principal=?, body=?, expires=?, active_tasks=?,
          claim=NULL, claim_expires=NULL WHERE id=?`).run(item.principal, item.body, item.expires, item.active, id);
        return true;
      });
    },
    async release(value, claimValue) {
      const id = key(value), claim = claimKey(claimValue);
      return transaction(() => {
        if (!owns(id, claim)) return false;
        db.prepare('UPDATE agent_records SET claim=NULL, claim_expires=NULL WHERE id=?').run(id);
        return true;
      });
    },
    async commit(value, claimValue) {
      const id = key(value), claim = claimKey(claimValue);
      return transaction(() => {
        if (!owns(id, claim)) return false;
        db.prepare('DELETE FROM agent_records WHERE id=?').run(id); return true;
      });
    },
    async delete(value) {
      const id = key(value);
      return transaction(() => { db.prepare('DELETE FROM agent_records WHERE id=?').run(id); return true; });
    },
    stats: () => Object.freeze({ persistence: 'local-sqlite', atomicClaims: true,
      horizontalRecovery: true, recoveryScope: 'same-local-filesystem', durableCommit: true,
      activeRuns: null, limits: Object.freeze({ ...limits }) }),
    close() { if (!closed) { db.close(); closed = true; } },
  });
}
