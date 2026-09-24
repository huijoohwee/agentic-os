import { readBoundedFile } from '../src/catalog-input.mjs';
import { checkDesignContract, DESIGN_LIMITS } from '../src/design.mjs';
import { option } from './agentic-os-argv.mjs';

export async function runDesignCheck(argv, out = console.log) {
  try {
    const bytes = readBoundedFile(option(argv, 'input'), DESIGN_LIMITS.bytes, 'design adoption record');
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const result = await checkDesignContract(input);
    out(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch {
    out(JSON.stringify({ schema: 'native-design-result/v1', ok: false, scope: 'supplied-source-contract',
      authority: false, runtimeVerified: false, policyDigest: null, continuityId: null, sourceRevision: null,
      findings: [{ type: 'malformed-document', reference: 'input', message: 'Cannot read bounded UTF-8 JSON input.' }] }));
    return 1;
  }
}
