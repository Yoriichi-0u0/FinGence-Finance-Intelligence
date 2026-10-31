import type { Config, Run, ScoredPair } from "../ai02/types";
export interface Provider {
  kind: "PRETRAINED_E5" | "UNIT_TEST_ONLY";
  initialize(): Promise<Record<string, unknown>>;
  embed(texts: readonly string[]): Promise<{ vectors: number[][]; tokenCounts: number[]; rssBytes?: number }>;
  terminate(): void;
  dispose(): Promise<void>;
}
export interface EmbeddingOptions { batchSize: number; cacheEntries: number; timeoutMs: number }
export interface SemanticPair extends Omit<ScoredPair, "method"> { method: "E2b"; cosine: number }
export interface SemanticRun extends Omit<Run, "method" | "candidates"> {
  method: "E2b"; candidates: SemanticPair[]; inferenceKind: Provider["kind"];
  modelMetadata: Record<string, unknown>;
  timings: { embeddingWallMs: number; rankingMs: number; endToEndMs: number };
}
export const DEFAULT_OPTIONS: EmbeddingOptions = { batchSize: 8, cacheEntries: 512, timeoutMs: 120000 };
export const RESEARCH_GRID: Config[] = [.8, .85, .9, .95].flatMap(threshold => [.01, .03, .05].map(margin => ({date:{field:"canonicalDate",maxDays:2},threshold,margin})));
