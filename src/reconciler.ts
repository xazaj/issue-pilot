import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { Dispatcher } from "./dispatcher.js";
import type { GitHubClient, GitHubIssue } from "./github.js";

interface ReconcilerOptions {
  config: Config;
  githubClient: GitHubClient;
  dispatcher: Dispatcher;
  logger: Logger;
}

const IDLE_INTERVAL_MS = 60_000;
const BUSY_INTERVAL_MS = 120_000;

function mergeIssue(base: GitHubIssue, incoming: GitHubIssue): GitHubIssue {
  return {
    number: base.number,
    title: base.title || incoming.title,
    body: base.body || incoming.body,
    labels: Array.from(new Set([...base.labels, ...incoming.labels])),
    assignees: Array.from(new Set([...base.assignees, ...incoming.assignees])),
    url: base.url || incoming.url
  };
}

export class Reconciler {
  private readonly config: Config;
  private readonly githubClient: GitHubClient;
  private readonly dispatcher: Dispatcher;
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | null = null;
  private inFlightScan: Promise<void> | null = null;
  private started = false;
  private previousCurrentIssue: number | null = null;

  constructor(options: ReconcilerOptions) {
    this.config = options.config;
    this.githubClient = options.githubClient;
    this.dispatcher = options.dispatcher;
    this.logger = options.logger.child({ module: "reconciler" });
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.logger.info(
      {
        ready_label: this.config.ready_label,
        in_progress_label: this.config.in_progress_label,
        poll_interval_s: this.config.poll_interval
      },
      "reconciler started"
    );
    this.scheduleNext(0);
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.inFlightScan) {
      await this.inFlightScan;
    }

    this.logger.info("reconciler stopped");
  }

  private scheduleNext(delayMs: number): void {
    if (!this.started) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.started) {
        return;
      }
      this.inFlightScan = this.runSingleScan()
        .catch((error) => {
          this.logger.error({ err: error }, "reconciler scan crashed");
        })
        .finally(() => {
          this.inFlightScan = null;
        });
    }, delayMs);
  }

  private async runSingleScan(): Promise<void> {
    const scanStartedAt = Date.now();

    const readyIssues = await this.githubClient.listIssuesByLabel(
      this.config.ready_label
    );
    const inProgressIssues = await this.githubClient.listIssuesByLabel(
      this.config.in_progress_label
    );

    const merged = new Map<number, GitHubIssue>();
    for (const issue of [...readyIssues, ...inProgressIssues]) {
      const existing = merged.get(issue.number);
      if (!existing) {
        merged.set(issue.number, issue);
      } else {
        merged.set(issue.number, mergeIssue(existing, issue));
      }
    }

    let newTasks = 0;
    const submittedIssueNumbers: number[] = [];
    for (const issue of merged.values()) {
      if (this.dispatcher.isKnown(issue.number)) {
        continue;
      }
      const accepted = this.dispatcher.submit(issue);
      if (accepted) {
        newTasks += 1;
        submittedIssueNumbers.push(issue.number);
      }
    }

    const currentIssue = this.dispatcher.getCurrentIssueNumber();
    this.previousCurrentIssue = currentIssue;

    const nextDelayMs = currentIssue !== null ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS;

    this.logger.info(
      {
        ready: readyIssues.length,
        in_progress: inProgressIssues.length,
        merged: merged.size,
        new_tasks: newTasks,
        submitted: submittedIssueNumbers,
        current: currentIssue,
        pending: this.dispatcher.getPendingCount(),
        duration_ms: Date.now() - scanStartedAt,
        next_interval_ms: nextDelayMs
      },
      "scan complete"
    );

    this.scheduleNext(nextDelayMs);
  }

}
