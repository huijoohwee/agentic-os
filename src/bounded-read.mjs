/** Race-bounded regular-file reads for catalog and evidence inputs. */

import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';

export function readBoundedFile(path, maxBytes, label = 'file', {
  expectedIdentity,
  expectedPath,
} = {}) {
  const flags = constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(path, flags);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file`);
    if (expectedIdentity
      && (metadata.dev !== expectedIdentity.dev || metadata.ino !== expectedIdentity.ino)) {
      throw new Error(`${label} identity changed`);
    }
    if (expectedPath) {
      const confirmedPath = realpathSync(path);
      const confirmed = statSync(confirmedPath);
      if (confirmedPath !== expectedPath
        || confirmed.dev !== metadata.dev || confirmed.ino !== metadata.ino) {
        throw new Error(`${label} identity changed`);
      }
    }
    if (metadata.size > maxBytes) throw new Error(`${label} byte budget exceeded`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new Error(`${label} byte budget exceeded`);
    const exact = Buffer.allocUnsafeSlow(offset);
    buffer.copy(exact, 0, 0, offset);
    return exact;
  } finally {
    closeSync(descriptor);
  }
}
