export interface GenerationLimits {
  maxEntries?: number;
  maxBytes?: number;
  maxFileBytes?: number;
  maxDepth?: number;
  timeoutMs?: number;
  maxOutputBytes?: number;
}
export const GENERATION_LIMITS: Readonly<Required<GenerationLimits>>;
export interface GenerationManifest {
  files: Array<{ path: string; bytes: number; sha256: string; executable: boolean }>;
  entries: number;
  bytes: number;
  digest: string;
}
export function generationManifest(root: string,
  options?: GenerationLimits & { paths?: string[]; exclude?: string[] }): GenerationManifest;
export function generationKey(value: unknown): string;
export interface GeneratedFile {
  bytes: number;
  sha256: string;
  written: boolean;
}
export function writeGeneratedFile(destination: string, value: string | Uint8Array,
  options?: GenerationLimits): Promise<GeneratedFile>;
export function generateFile(options: GenerationLimits & {
  destination: string;
  receipt: string;
  inputs: () => unknown | Promise<unknown>;
  produce: (context: { signal: AbortSignal }) => string | Uint8Array | Promise<string | Uint8Array>;
}): Promise<GeneratedFile & {
  schema: 'agentic-os/generation-receipt/v1';
  key: string;
  destination: string;
  reused: boolean;
}>;
