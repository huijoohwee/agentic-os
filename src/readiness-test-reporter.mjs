import { resolve } from 'node:path';

/** Emit only a machine-owned summary; target stdout cannot imitate test events. */
export default async function* readinessTestReporter(events) {
  const proofPath = process.env.AGENTIC_OS_PROOF_PATH;
  const sentinel = process.env.AGENTIC_OS_PROOF_SENTINEL;
  const result = { pass: 0, fail: 0, skipped: 0, todo: 0 };

  for await (const event of events) {
    const name = event.data?.name;
    const wrapper = typeof name === 'string'
      && (name === proofPath || resolve(name) === proofPath);
    if (event.type === 'test:fail') result.fail += 1;
    if (event.type === 'test:pass' && !wrapper && event.data?.skip) result.skipped += 1;
    if (event.type === 'test:pass' && !wrapper && event.data?.todo) result.todo += 1;
    if (event.type === 'test:pass' && !wrapper && !event.data?.skip && !event.data?.todo) result.pass += 1;
  }

  yield `${sentinel}${Buffer.from(JSON.stringify(result)).toString('base64')}\n`;
}
