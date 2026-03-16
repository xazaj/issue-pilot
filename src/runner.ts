import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { AgentExecutor, TokenUsage } from "./executor.js";
import { addTokens, zeroTokens } from "./executor.js";
import type { GitHubClient, GitHubIssue } from "./github.js";
import { buildTemplateView, renderContinuation, renderFirstTurn } from "./prompt.js";

export type { TokenUsage } from "./executor.js";

export interface RunTaskResult {
  issueNumber: number;
  status: "success" | "failed" | "skipped";
  reason?: string;
  outerTurns: number;
  durationMs: number;
  totalTokens: TokenUsage;
  sessionId?: string;
}

interface RunnerOptions {
  config: Config;
  template: string;
  githubClient: GitHubClient;
  executor: AgentExecutor;
  logger: Logger;
}

export class Runner {
  private readonly config: Config;
  private readonly template: string;
  private readonly githubClient: GitHubClient;
  private readonly executor: AgentExecutor;
  private readonly logger: Logger;
  private taskAbortController: AbortController | null = null;
  private runningTokens: TokenUsage = zeroTokens();

  constructor(options: RunnerOptions) {
    this.config = options.config;
    this.template = options.template;
    this.githubClient = options.githubClient;
    this.executor = options.executor;
    this.logger = options.logger.child({ module: "runner" });
  }

  getRunningTokens(): TokenUsage {
    return { ...this.runningTokens };
  }

  async terminateCurrentProcess(): Promise<void> {
    this.executor.abort();
  }

  async runTask(issue: GitHubIssue): Promise<RunTaskResult> {
    const issueLog = this.logger.child({ issue: issue.number });
    const startedAt = Date.now();
    let outerTurns = 0;
    let sessionId: string | undefined;
    let totalTokens = zeroTokens();
    let claimed = false;
    let status: RunTaskResult["status"] = "failed";
    let reason: string | undefined;

    const taskAc = new AbortController();
    this.taskAbortController = taskAc;
    this.runningTokens = zeroTokens();
    let taskTimeoutHandle: NodeJS.Timeout | undefined;

    try {
      // --- Claim or resume ---
      const hasReady = await this.githubClient.hasLabel(
        issue.number,
        this.config.ready_label
      );
      const hasInProgress = await this.githubClient.hasLabel(
        issue.number,
        this.config.in_progress_label
      );

      if (hasReady) {
        claimed = await this.githubClient.claimIssue(
          issue.number,
          this.config.ready_label,
          this.config.in_progress_label
        );
        if (!claimed) {
          issueLog.info("issue claim failed, ready label was removed concurrently");
          return {
            issueNumber: issue.number,
            status: "skipped",
            reason: "claim_failed",
            outerTurns,
            durationMs: Date.now() - startedAt,
            totalTokens
          };
        }
      } else if (hasInProgress) {
        claimed = true;
        issueLog.info("resuming in-progress issue");
      } else {
        issueLog.info("issue has neither ready nor in-progress label, skipping");
        return {
          issueNumber: issue.number,
          status: "skipped",
          reason: "no_actionable_label",
          outerTurns,
          durationMs: Date.now() - startedAt,
          totalTokens
        };
      }

      // --- Task timeout ---
      const taskTimeoutMs = this.config.task_timeout_minutes * 60 * 1000;
      taskTimeoutHandle = setTimeout(() => {
        issueLog.error({ timeout_ms: taskTimeoutMs }, "task timeout triggered");
        taskAc.abort();
      }, taskTimeoutMs);

      // --- Outer turn loop ---
      while (outerTurns < this.config.max_outer_turns) {
        if (taskAc.signal.aborted) {
          reason = "task_timeout";
          break;
        }

        outerTurns += 1;
        const prompt =
          outerTurns === 1
            ? renderFirstTurn(
                this.template,
                buildTemplateView(
                  issue,
                  this.config as unknown as Record<string, unknown>
                )
              )
            : renderContinuation(
                issue.number,
                outerTurns,
                this.config.max_outer_turns,
                this.config.in_progress_label
              );

        issueLog.info(
          { outer_turn: outerTurns, executor: this.executor.name },
          "starting execution round"
        );

        const round = await this.executor.executeRound({
          prompt,
          workingDir: this.config.working_dir,
          maxTurns: this.config.claude_max_turns,
          continueSession: outerTurns > 1,
          abortSignal: taskAc.signal,
          logger: issueLog,
          onTokenUpdate: (t) => { this.runningTokens = t; }
        });

        totalTokens = addTokens(totalTokens, round.tokens);
        sessionId = round.sessionId ?? sessionId;

        issueLog.info(
          {
            outer_turn: outerTurns,
            result_subtype: round.resultSubtype,
            termination_reason: round.terminationReason
          },
          "execution round finished"
        );

        if (round.terminationReason === "error") {
          reason = `executor_error: ${round.errorMessage ?? "unknown"}`;
          break;
        }
        if (
          round.terminationReason === "timeout" ||
          round.terminationReason === "aborted"
        ) {
          reason = "task_timeout";
          break;
        }

        // Claude exited normally → this round succeeded
        status = "success";
        break;
      }

      if (status !== "success" && !reason) {
        reason = "max_outer_turns_exhausted";
      }

      const durationMs = Date.now() - startedAt;
      if (status === "success") {
        // Remove assignee to prevent Reconciler from re-picking this issue
        try {
          await this.githubClient.removeAssignee(
            issue.number,
            this.config.assignee
          );
        } catch (removeError) {
          issueLog.error({ err: removeError }, "failed to remove assignee after success");
        }
      } else {
        try {
          await this.githubClient.failIssue(
            issue.number,
            this.config.in_progress_label,
            this.config.failed_label
          );
          await this.githubClient.addComment(
            issue.number,
            [
              "Issue-Pilot task failed.",
              `- reason: ${reason}`,
              `- executor: ${this.executor.name}`,
              `- outer turns: ${outerTurns}`,
              `- duration_seconds: ${Math.round(durationMs / 1000)}`,
              `- tokens_input: ${totalTokens.input}`,
              `- tokens_output: ${totalTokens.output}`
            ].join("\n")
          );
        } catch (failureReportError) {
          issueLog.error(
            { err: failureReportError },
            "failed to report task failure"
          );
        }
      }

      issueLog.info(
        { status, reason, outer_turns: outerTurns, duration_ms: durationMs, tokens: totalTokens },
        "task finished"
      );

      return {
        issueNumber: issue.number,
        status,
        reason,
        outerTurns,
        durationMs,
        totalTokens,
        sessionId
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = (error as Error).message;
      issueLog.error({ err: error }, "runTask crashed");

      if (claimed) {
        try {
          await this.githubClient.failIssue(
            issue.number,
            this.config.in_progress_label,
            this.config.failed_label
          );
          await this.githubClient.addComment(
            issue.number,
            `Issue-Pilot task crashed.\n- reason: ${message}`
          );
        } catch (reportError) {
          issueLog.error({ err: reportError }, "failed to report runner crash");
        }
      }

      return {
        issueNumber: issue.number,
        status: "failed",
        reason: `runner_crash: ${message}`,
        outerTurns,
        durationMs,
        totalTokens,
        sessionId
      };
    } finally {
      if (taskTimeoutHandle) {
        clearTimeout(taskTimeoutHandle);
      }
      this.taskAbortController = null;
    }
  }
}
