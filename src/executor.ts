import type { Logger } from "pino";

/**
 * Result of a single AI execution round.
 */
export interface ExecutionRoundResult {
  sessionId?: string;
  resultSubtype?: string;
  tokens: TokenUsage;
  terminationReason: "completed" | "error" | "timeout" | "aborted";
  errorMessage?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreationInput: number;
  cacheReadInput: number;
}

export interface ExecutionRoundOptions {
  prompt: string;
  workingDir: string;
  maxTurns: number;
  continueSession: boolean;
  abortSignal?: AbortSignal;
  logger: Logger;
  /** Called whenever token usage is updated (e.g. after each assistant message) */
  onTokenUpdate?: (tokens: TokenUsage) => void;
}

/**
 * Abstract interface for AI agent executors.
 * Implement this to add new AI backends (Claude SDK, Codex, etc.).
 */
export interface AgentExecutor {
  /** Human-readable name for logging */
  readonly name: string;

  /**
   * Execute a single round of AI agent work.
   * The executor handles process lifecycle internally.
   */
  executeRound(options: ExecutionRoundOptions): Promise<ExecutionRoundResult>;

  /**
   * Abort the currently running execution, if any.
   */
  abort(): void;
}

export function zeroTokens(): TokenUsage {
  return { input: 0, output: 0, cacheCreationInput: 0, cacheReadInput: 0 };
}

export function addTokens(base: TokenUsage, delta: TokenUsage): TokenUsage {
  return {
    input: base.input + delta.input,
    output: base.output + delta.output,
    cacheCreationInput: base.cacheCreationInput + delta.cacheCreationInput,
    cacheReadInput: base.cacheReadInput + delta.cacheReadInput
  };
}
