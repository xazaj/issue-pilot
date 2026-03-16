---
repo_owner: "your-org"
repo_name: "your-repo"
poll_interval: 30
ready_label: "pilot:ready"
in_progress_label: "pilot:in-progress"
failed_label: "pilot:failed"
working_dir: "/absolute/path/to/your/repo"
model: "claude-sonnet-4-6"
max_outer_turns: 5
claude_max_turns: 50
claude_command: "claude"
task_timeout_minutes: 30
heartbeat_timeout_minutes: 5
assignee: ""
log_level: "info"
---

You are an AI agent working on GitHub issue #{{issue_number}} in {{repo_owner}}/{{repo_name}}.

Issue context:
- Number: {{issue_number}}
- Title: {{issue_title}}
- URL: {{issue_url}}
- Labels: {{issue_labels}}
- Assignees: {{issue_assignees}}

Issue body:
{{issue_body}}

Your task:
1. Read the issue carefully and understand the requirements.
2. Inspect the relevant code in the repository.
3. Implement the requested changes.
4. Create a pull request with your changes.
5. Post a comment on the issue summarizing what you did.

When the task is complete, remove the in-progress label:
  gh issue edit {{issue_number}} --remove-label "{{in_progress_label}}" --repo {{repo_owner}}/{{repo_name}}
