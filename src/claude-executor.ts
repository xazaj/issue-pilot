import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  Options
} from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";
import type {
  AgentExecutor,
  ExecutionRoundOptions,
  ExecutionRoundResult,
  TokenUsage
} from "./executor.js";
import { zeroTokens } from "./executor.js";

interface ClaudeExecutorOptions {
  /** Model to use (e.g. claude-sonnet-4-6, claude-opus-4-6) */
  model?: string;
  /** Path to claude binary (optional, SDK auto-detects) */
  claudeCommand?: string;
  /** Permission mode for Claude Code */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  if (!env.HOME) env.HOME = os.homedir();
  return env;
}

function extractTokens(usage: SDKResultMessage["usage"]): TokenUsage {
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheCreationInput: usage.cache_creation_input_tokens ?? 0,
    cacheReadInput: usage.cache_read_input_tokens ?? 0
  };
}

export class ClaudeExecutor implements AgentExecutor {
  readonly name = "claude-agent-sdk";
  private model: string;
  private readonly claudeCommand?: string;
  private readonly permissionMode: Options["permissionMode"];
  private currentAbortController: AbortController | null = null;

  constructor(options?: ClaudeExecutorOptions) {
    this.model = options?.model ?? "claude-sonnet-4-6";
    this.claudeCommand = options?.claudeCommand;
    this.permissionMode = options?.permissionMode ?? "bypassPermissions";
  }

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  abort(): void {
    this.currentAbortController?.abort();
  }

  async executeRound(
    options: ExecutionRoundOptions
  ): Promise<ExecutionRoundResult> {
    const ac = new AbortController();
    this.currentAbortController = ac;

    // Forward external abort signal
    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        ac.abort();
      } else {
        options.abortSignal.addEventListener("abort", () => ac.abort(), {
          once: true
        });
      }
    }

    const queryOptions: Options = {
      model: this.model,
      cwd: options.workingDir,
      abortController: ac,
      maxTurns: options.maxTurns,
      permissionMode: this.permissionMode,
      allowDangerouslySkipPermissions:
        this.permissionMode === "bypassPermissions",
      env: cleanEnv(),
      settingSources: ["user", "project", "local"],
      continue: options.continueSession,
      systemPrompt: {
        type: "preset",
        preset: "claude_code"
      }
    };

    if (this.claudeCommand) {
      queryOptions.pathToClaudeCodeExecutable = this.claudeCommand;
    }

    let sessionId: string | undefined;
    let resultSubtype: string | undefined;
    let tokens: TokenUsage = zeroTokens();
    let runningTokens: TokenUsage = zeroTokens();
    let errorMessage: string | undefined;

    try {
      const conversation = query({
        prompt: options.prompt,
        options: queryOptions
      });

      for await (const message of conversation as AsyncIterable<SDKMessage>) {
        if (ac.signal.aborted) break;

        switch (message.type) {
          case "system": {
            const sysMsg = message as SDKSystemMessage;
            if ("subtype" in sysMsg && sysMsg.subtype === "init") {
              sessionId = sysMsg.session_id;
              options.logger.debug(
                { session_id: sessionId },
                "claude session initialized"
              );
            }
            break;
          }

          case "assistant": {
            const asstMsg = message as SDKAssistantMessage;
            const usage = asstMsg.message?.usage;
            if (usage) {
              runningTokens = {
                input: runningTokens.input + (usage.input_tokens ?? 0),
                output: runningTokens.output + (usage.output_tokens ?? 0),
                cacheCreationInput: runningTokens.cacheCreationInput + (usage.cache_creation_input_tokens ?? 0),
                cacheReadInput: runningTokens.cacheReadInput + (usage.cache_read_input_tokens ?? 0)
              };
              options.onTokenUpdate?.(runningTokens);
            }
            break;
          }

          case "result": {
            const resultMsg = message as SDKResultMessage;
            resultSubtype = resultMsg.subtype;
            tokens = extractTokens(resultMsg.usage);
            options.onTokenUpdate?.(tokens);
            if (resultMsg.is_error) {
              errorMessage =
                "errors" in resultMsg
                  ? (resultMsg as { errors: string[] }).errors.join("; ")
                  : `result error: ${resultMsg.subtype}`;
            }
            options.logger.info(
              {
                subtype: resultMsg.subtype,
                num_turns: resultMsg.num_turns,
                duration_ms: resultMsg.duration_ms,
                cost_usd: resultMsg.total_cost_usd
              },
              "claude result received"
            );
            break;
          }

          // user, stream_event, etc. — just keep the loop alive
          default:
            break;
        }
      }

      if (ac.signal.aborted) {
        return {
          sessionId,
          resultSubtype,
          tokens,
          terminationReason: "aborted"
        };
      }

      return {
        sessionId,
        resultSubtype,
        tokens,
        terminationReason: errorMessage ? "error" : "completed",
        errorMessage
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (ac.signal.aborted) {
        return {
          sessionId,
          resultSubtype,
          tokens,
          terminationReason: "aborted"
        };
      }

      options.logger.error({ err: error }, "claude execution failed");
      return {
        sessionId,
        resultSubtype,
        tokens,
        terminationReason: "error",
        errorMessage: msg
      };
    } finally {
      this.currentAbortController = null;
    }
  }
}
