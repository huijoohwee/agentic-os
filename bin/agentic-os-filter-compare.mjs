#!/usr/bin/env node
/** Hash one inherited stable file descriptor as a raw Git blob. No repository code executes. */

import { createHash } from 'node:crypto';
import { fstatSync, readSync } from 'node:fs';

const [path, oid, rawLimit] = process.argv.slice(2);
const limit = Number(rawLimit);
if (typeof path !== 'string' || path.includes('\0')
  || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid ?? '')
  || !Number.isSafeInteger(limit) || limit < 0) process.exit(2);

try {
  const stat = fstatSync(3, { bigint: true });
  if (!stat.isFile() || stat.size > BigInt(limit)) process.exit(1);
  const algorithm = oid.length === 40 ? 'sha1' : 'sha256';
  const hash = createHash(algorithm);
  hash.update(`blob ${stat.size}\0`);
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (position < Number(stat.size)) {
    const wanted = Math.min(buffer.length, Number(stat.size) - position);
    const count = readSync(3, buffer, 0, wanted, position);
    if (count === 0) process.exit(1);
    hash.update(buffer.subarray(0, count));
    position += count;
  }
  const tail = Buffer.allocUnsafe(1);
  if (readSync(3, tail, 0, 1, position) !== 0) process.exit(1);
  process.exit(hash.digest('hex') === oid ? 0 : 1);
} catch {
  process.exit(1);
}
