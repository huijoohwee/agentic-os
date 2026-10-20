/** The optional transport validates JSON at runtime; tool data carries no authorization. */
export type RunOperation = 'start' | 'status' | 'cancel' | 'retry' | 'query' | 'trace' | 'evaluate' | 'compare';
export const RUN_OPERATIONS: readonly RunOperation[];
export type RunInput = Readonly<Record<string, unknown>>;
export type RunResult = Readonly<Record<string, unknown> & {
  runId?: string;
  status: 'planning' | 'running' | 'completed' | 'blocked' | 'canceled' | 'pending'
    | 'idle' | 'reconciling' | 'synthesizing' | 'failed' | 'insufficient-evidence';
  reasonCode?: string;
  writeResultUnknown?: boolean;
}>;
export type AgentRunClient = Readonly<{
  invoke(operation: RunOperation, input: RunInput, options?: { signal?: AbortSignal }): Promise<RunResult>;
}>;
export type ProviderCostVerificationRequest = Readonly<{
  schema: 'agentic-os/provider-cost-verification-request/v1';
  provider: string; effect: string; resource: string; requestDigest: string;
  scopeDigest: string; observedAt: string;
}>;
export type VerifiedZeroCostEvidence = Readonly<{
  schema: 'agentic-os/verified-effect-cost-evidence/v1'; status: 'verified-zero-cost';
  provider: string; mode: 'non-billable' | 'free-fail-closed' | 'provider-hard-cap';
  billingPlan: 'free' | 'none'; providerHardCapUsd: 0 | null;
  quotaExhaustion: 'deny' | 'not-applicable'; paidPlanActive: false;
  addOnsActive: false; overagesEnabled: false; autoUpgradeEnabled: false;
  evidenceDigest: string; scopeDigest: string; verifiedAt: string; expiresAt: string;
}>;
export const RUN_INPUT_BYTES: 200000;
export function validateRunInput(operation: RunOperation, input: unknown): Record<string, unknown>;
export function dispatchRunOperation(runtime: unknown, operation: RunOperation, input: unknown,
  context: unknown, signal?: AbortSignal): Promise<unknown>;
export function createAgentRunClient(options: {
  endpoint: string | URL;
  fetchImpl?: typeof fetch;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  timeoutMs?: number;
  verifyProviderCostEvidence?: (request: ProviderCostVerificationRequest) => VerifiedZeroCostEvidence | Promise<VerifiedZeroCostEvidence>;
  now?: () => number;
}): AgentRunClient;
