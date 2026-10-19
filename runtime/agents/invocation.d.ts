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
export const RUN_INPUT_BYTES: 200000;
export function validateRunInput(operation: RunOperation, input: unknown): Record<string, unknown>;
export function dispatchRunOperation(runtime: unknown, operation: RunOperation, input: unknown,
  context: unknown, signal?: AbortSignal): Promise<unknown>;
export function createAgentRunClient(options: {
  endpoint: string | URL;
  fetchImpl?: typeof fetch;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  timeoutMs?: number;
}): AgentRunClient;
