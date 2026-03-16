import type { Logger } from "pino";
import type { GitHubIssue } from "./github.js";
import type { RunTaskResult, TokenUsage } from "./runner.js";

interface DispatcherOptions {
  logger: Logger;
  runTask: (issue: GitHubIssue) => Promise<RunTaskResult>;
  terminateCurrentProcess?: () => Promise<void>;
  getRunningTokens?: () => TokenUsage;
  shutdownTimeoutMs?: number;
}

interface RunningTask {
  issue: GitHubIssue;
  startedAt: Date;
  completion: Promise<void>;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 60_000;
const FORCED_TERMINATION_WAIT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class Dispatcher {
  private readonly logger: Logger;
  private readonly runTask: (issue: GitHubIssue) => Promise<RunTaskResult>;
  private readonly terminateCurrentProcess?: () => Promise<void>;
  private readonly getRunningTokensFn?: () => TokenUsage;
  private readonly shutdownTimeoutMs: number;
  private current: RunningTask | null = null;
  private pending: GitHubIssue[] = [];
  private accepting = true;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: DispatcherOptions) {
    this.logger = options.logger.child({ module: "dispatcher" });
    this.runTask = options.runTask;
    this.terminateCurrentProcess = options.terminateCurrentProcess;
    this.getRunningTokensFn = options.getRunningTokens;
    this.shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  submit(issue: GitHubIssue): boolean {
    if (!this.accepting) {
      this.logger.warn(
        { issue: issue.number },
        "dispatcher is shutting down; reject new task"
      );
      return false;
    }

    if (this.isKnown(issue.number)) {
      this.logger.debug(
        { issue: issue.number },
        "task is already running or pending, ignore duplicate submit"
      );
      return false;
    }

    if (!this.current) {
      this.startTask(issue);
      return true;
    }

    this.pending.push(issue);
    this.logger.info(
      { issue: issue.number, pending: this.pending.length },
      "task enqueued"
    );
    return true;
  }

  isKnown(issueNumber: number): boolean {
    if (this.current?.issue.number === issueNumber) {
      return true;
    }
    if (this.pending.some((issue) => issue.number === issueNumber)) {
      return true;
    }
    return false;
  }

  getCurrentIssueNumber(): number | null {
    return this.current?.issue.number ?? null;
  }

  getCurrentTask(): { issue: GitHubIssue; startedAt: Date } | null {
    if (!this.current) return null;
    return { issue: this.current.issue, startedAt: this.current.startedAt };
  }

  getPendingIssues(): GitHubIssue[] {
    return [...this.pending];
  }

  getRunningTokens(): TokenUsage | null {
    if (!this.current || !this.getRunningTokensFn) return null;
    return this.getRunningTokensFn();
  }

  getPendingIssueNumbers(): number[] {
    return this.pending.map((issue) => issue.number);
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.doShutdown();
    return this.shutdownPromise;
  }

  private startTask(issue: GitHubIssue): void {
    const issueLog = this.logger.child({ issue: issue.number });
    issueLog.info({ pending: this.pending.length }, "task started");

    const completion = this.executeTask(issue, issueLog).finally(() => {
      if (this.current?.issue.number === issue.number) {
        this.current = null;
      }

      if (this.accepting) {
        this.processNext();
      }
    });

    this.current = {
      issue,
      startedAt: new Date(),
      completion
    };
  }

  private async executeTask(issue: GitHubIssue, issueLog: Logger): Promise<void> {
    try {
      const result = await this.runTask(issue);
      issueLog.info(
        {
          status: result.status,
          reason: result.reason,
          outer_turns: result.outerTurns,
          duration_ms: result.durationMs
        },
        "task finished"
      );
    } catch (error) {
      issueLog.error({ err: error }, "task crashed in dispatcher execution");
    }
  }

  private processNext(): void {
    if (!this.accepting) {
      return;
    }
    if (this.current) {
      return;
    }
    if (this.pending.length === 0) {
      return;
    }

    const next = this.pending.shift();
    if (!next) {
      return;
    }

    this.startTask(next);
  }

  private async doShutdown(): Promise<void> {
    this.accepting = false;
    const current = this.current;
    this.logger.info(
      {
        current: current?.issue.number ?? null,
        pending: this.pending.length,
        timeout_ms: this.shutdownTimeoutMs
      },
      "dispatcher shutdown requested"
    );

    if (!current) {
      this.logger.info({ pending: this.pending.length }, "shutdown complete (idle)");
      return;
    }

    const completedInTime = await Promise.race([
      current.completion.then(() => true).catch(() => true),
      sleep(this.shutdownTimeoutMs).then(() => false)
    ]);

    if (!completedInTime) {
      this.logger.warn(
        { issue: current.issue.number },
        "current task did not finish before shutdown timeout"
      );

      if (this.terminateCurrentProcess) {
        try {
          await this.terminateCurrentProcess();
        } catch (error) {
          this.logger.error(
            { err: error, issue: current.issue.number },
            "failed to terminate current process during shutdown"
          );
        }

        const finishedAfterTerminate = await Promise.race([
          current.completion.then(() => true).catch(() => true),
          sleep(FORCED_TERMINATION_WAIT_MS).then(() => false)
        ]);

        if (!finishedAfterTerminate) {
          this.logger.error(
            { issue: current.issue.number },
            "current task still not finished after forced termination wait"
          );
        }
      } else {
        this.logger.warn(
          { issue: current.issue.number },
          "no terminateCurrentProcess hook; cannot force-stop running task"
        );
      }
    }

    this.logger.info({ pending: this.pending.length }, "shutdown complete");
  }
}
