import { Octokit } from "@octokit/rest";

interface GitHubClientOptions {
  repoOwner: string;
  repoName: string;
  assignee?: string;
  token?: string;
  cacheTtlMs?: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  url: string;
}

function normalizeLabel(label: string | { name?: string | null }): string {
  if (typeof label === "string") {
    return label;
  }
  return label.name ?? "";
}

function isPullRequest(issue: { pull_request?: unknown }): boolean {
  return typeof issue.pull_request !== "undefined";
}

export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly assignee: string;
  private readonly cacheTtlMs: number;
  private openIssuesCache: GitHubIssue[] | null = null;
  private openIssuesCacheTime = 0;

  constructor(options: GitHubClientOptions) {
    const token = options.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        "Missing GITHUB_TOKEN. Please set it in environment variables or .env."
      );
    }

    this.octokit = new Octokit({ auth: token });
    this.owner = options.repoOwner;
    this.repo = options.repoName;
    this.assignee = options.assignee ?? "";
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
  }

  private toIssue(rawIssue: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    labels: Array<string | { name?: string | null }>;
    assignees?: Array<{ login?: string | null }> | null;
  }): GitHubIssue {
    return {
      number: rawIssue.number,
      title: rawIssue.title,
      body: rawIssue.body ?? "",
      labels: rawIssue.labels.map(normalizeLabel).filter((label) => label !== ""),
      assignees: (rawIssue.assignees ?? [])
        .map((assignee) => assignee.login ?? "")
        .filter((login) => login !== ""),
      url: rawIssue.html_url
    };
  }

  async listIssuesByLabel(label: string): Promise<GitHubIssue[]> {
    const all = await this.listOpenIssues();
    return all.filter((issue) => issue.labels.includes(label));
  }

  async listOpenIssues(): Promise<GitHubIssue[]> {
    if (this.openIssuesCache && Date.now() - this.openIssuesCacheTime < this.cacheTtlMs) {
      return this.openIssuesCache;
    }

    const response = await this.octokit.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      state: "open",
      assignee: this.assignee || undefined,
      per_page: 100
    });

    const issues = response.data
      .filter((issue) => !isPullRequest(issue))
      .map((issue) =>
        this.toIssue({
          number: issue.number,
          title: issue.title,
          body: issue.body ?? null,
          html_url: issue.html_url,
          labels: issue.labels as Array<string | { name?: string | null }>,
          assignees: issue.assignees
        })
      );

    this.openIssuesCache = issues;
    this.openIssuesCacheTime = Date.now();
    return issues;
  }

  async getIssue(number: number): Promise<GitHubIssue> {
    const response = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: number
    });

    const issue = response.data;
    if (isPullRequest(issue)) {
      throw new Error(
        `Issue #${number} in ${this.owner}/${this.repo} is a pull request, not an issue.`
      );
    }

    return this.toIssue({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      html_url: issue.html_url,
      labels: issue.labels as Array<string | { name?: string | null }>,
      assignees: issue.assignees
    });
  }

  async hasLabel(number: number, label: string): Promise<boolean> {
    const issue = await this.getIssue(number);
    return issue.labels.includes(label);
  }

  async claimIssue(
    number: number,
    readyLabel: string,
    inProgressLabel: string
  ): Promise<boolean> {
    const issue = await this.getIssue(number);
    if (!issue.labels.includes(readyLabel)) {
      return false;
    }

    try {
      await this.octokit.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: number,
        name: readyLabel
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        return false;
      }
      throw error;
    }

    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      labels: [inProgressLabel]
    });

    this.invalidateCache();
    return true;
  }

  async failIssue(
    number: number,
    inProgressLabel: string,
    failedLabel: string
  ): Promise<void> {
    try {
      await this.octokit.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: number,
        name: inProgressLabel
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404) {
        throw error;
      }
    }

    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      labels: [failedLabel]
    });

    this.invalidateCache();
  }

  invalidateCache(): void {
    this.openIssuesCache = null;
    this.openIssuesCacheTime = 0;
  }

  async removeAssignee(number: number, assignee: string): Promise<void> {
    if (!assignee) return;
    try {
      await this.octokit.issues.removeAssignees({
        owner: this.owner,
        repo: this.repo,
        issue_number: number,
        assignees: [assignee]
      });
      this.invalidateCache();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404 && status !== 422) {
        throw error;
      }
    }
  }

  async addComment(number: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      body
    });
  }
}
