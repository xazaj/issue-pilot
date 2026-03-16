import Mustache from "mustache";
import type { GitHubIssue } from "./github.js";

// Disable HTML escaping — prompts are plain text, not HTML
Mustache.escape = (value: string) => value;

export interface TemplateView {
  // Issue fields
  issue_number: number;
  issue_title: string;
  issue_body: string;
  issue_url: string;
  issue_labels: string;
  issue_assignees: string;
  // Config fields — all front matter values available in templates
  [key: string]: unknown;
}

function joinValues(values: string[]): string {
  return values.filter((value) => value.trim() !== "").join(", ");
}

export function buildTemplateView(
  issue: GitHubIssue,
  config: Record<string, unknown>
): TemplateView {
  return {
    ...config,
    issue_number: issue.number,
    issue_title: issue.title,
    issue_body: issue.body,
    issue_url: issue.url,
    issue_labels: joinValues(issue.labels),
    issue_assignees: joinValues(issue.assignees)
  };
}

export function renderFirstTurn(template: string, view: TemplateView): string {
  return Mustache.render(template, view).trim();
}

export function renderContinuation(
  issueNumber: number,
  currentTurn: number,
  maxTurns: number,
  inProgressLabel: string
): string {
  return `This is continuation turn ${currentTurn} of ${maxTurns}.
The previous turn ended but the task is not yet complete
(the in-progress label is still present on the issue).

Continue from the current working directory state. Do NOT restart from scratch.
When the task is complete, remove the in-progress label using:
  gh issue edit ${issueNumber} --remove-label "${inProgressLabel}"`;
}
