# Issue-Pilot

A local AI task scheduler that watches GitHub Issues and automatically dispatches [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to handle them.

Issue-Pilot uses a **reconciliation loop** pattern (inspired by Kubernetes controllers) to poll GitHub for issues with specific labels, claim them, and execute AI-powered workflows — all running locally on your machine.

## How It Works

```
GitHub Issues                    Issue-Pilot (local)

  Issue #42                      ┌─────────────┐
  [silent:ready]  ──────────────>│ Reconciler   │  polls every N seconds
                                 │              │
                                 └──────┬───────┘
                                        │
                                 ┌──────▼───────┐
                                 │ Dispatcher    │  serial queue
                                 │              │
                                 └──────┬───────┘
                                        │
                                 ┌──────▼───────┐
                                 │ Runner        │  spawns Claude Code
                                 │              │
                                 └──────────────┘
                                        │
  Issue #42                             │
  [in-progress] ◄───────────────────────┘
  Claude creates PR, updates labels, etc.
```

1. You label a GitHub issue with `silent:ready`
2. Issue-Pilot detects it, claims it (swaps label to `silent:in-progress`)
3. Claude Code executes the task defined in your `WORKFLOW.md` template
4. On success, Claude removes the label and optionally creates a PR
5. On failure, the issue is labeled `silent:failed` with a diagnostic comment

## Prerequisites

- **Node.js** 22+ LTS
- **Claude Code** CLI installed and authenticated
- **GitHub Token** with Issues read/write and repo read permissions

## Installation

```bash
git clone https://github.com/<your-org>/issue-pilot.git
cd issue-pilot
npm install
```

## Configuration

### 1. Set up environment variables

```bash
cp .env.example .env
# Edit .env and add your GitHub token
```

### 2. Create labels in your target repository

Create these labels in **Settings > Labels** of your target repo (names are customizable):

| Label | Purpose |
|-------|---------|
| `silent:ready` | Marks an issue as ready for AI execution |
| `silent:in-progress` | Issue is currently being processed |
| `silent:failed` | Execution failed, needs human attention |

### 3. Create a WORKFLOW.md

Copy the example and customize it for your project:

```bash
cp WORKFLOW.example.md WORKFLOW.md
```

`WORKFLOW.md` is a single file containing both configuration (YAML front matter) and a prompt template (Mustache syntax):

```markdown
---
repo_owner: "your-org"
repo_name: "your-repo"
working_dir: "/absolute/path/to/your/repo"
poll_interval: 30
model: "claude-sonnet-4-6"
max_outer_turns: 5
claude_max_turns: 50
task_timeout_minutes: 30
---

You are an AI agent working on issue #{{issue_number}}.

Title: {{issue_title}}
Body: {{issue_body}}

... your prompt template here ...
```

#### Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `repo_owner` | *required* | GitHub user or organization |
| `repo_name` | *required* | Repository name |
| `working_dir` | *required* | Absolute path to local repo clone |
| `poll_interval` | `30` | Polling interval in seconds |
| `ready_label` | `silent:ready` | Label that triggers execution |
| `in_progress_label` | `silent:in-progress` | Label applied when claimed |
| `failed_label` | `silent:failed` | Label applied on failure |
| `model` | `claude-sonnet-4-6` | Claude model to use |
| `max_outer_turns` | `5` | Max outer retry loops |
| `claude_max_turns` | `50` | Max agentic turns per Claude session |
| `task_timeout_minutes` | `30` | Hard timeout per task |
| `heartbeat_timeout_minutes` | `5` | No-output timeout |
| `assignee` | `""` | Only process issues assigned to this user |
| `log_level` | `info` | `debug` / `info` / `warn` / `error` |

#### Template Variables

| Variable | Description |
|----------|-------------|
| `{{issue_number}}` | Issue number |
| `{{issue_title}}` | Issue title |
| `{{issue_body}}` | Issue body (Markdown) |
| `{{issue_url}}` | Issue web URL |
| `{{issue_labels}}` | Comma-separated labels |
| `{{issue_assignees}}` | Comma-separated assignees |
| `{{repo_owner}}` | Repository owner |
| `{{repo_name}}` | Repository name |

## Usage

### Headless mode (structured JSON logs)

```bash
npm start
# or with a custom workflow file:
npm start -- path/to/WORKFLOW.md
```

### TUI mode (interactive terminal dashboard)

```bash
npm run tui
```

### Development mode (auto-restart on changes)

```bash
npm run dev
```

## Architecture

Issue-Pilot follows a modular architecture with clear separation of concerns:

| Module | File | Responsibility |
|--------|------|----------------|
| Config | `src/config.ts` | Parse and validate `WORKFLOW.md` |
| GitHub Client | `src/github.ts` | Octokit wrapper for Issues API |
| Reconciler | `src/reconciler.ts` | Poll GitHub, detect new tasks |
| Dispatcher | `src/dispatcher.ts` | Serial task queue with graceful shutdown |
| Runner | `src/runner.ts` | Execute Claude, handle multi-turn loops |
| Executor | `src/executor.ts` | Abstract AI executor interface |
| Claude Executor | `src/claude-executor.ts` | Claude Agent SDK implementation |
| Prompt | `src/prompt.ts` | Mustache template rendering |
| Logger | `src/logger.ts` | Structured logging via pino |

See [`docs/architecture.md`](docs/architecture.md) and [`docs/design.md`](docs/design.md) for detailed design documentation.

## Fault Tolerance

The reconciliation loop architecture provides automatic recovery for most failure scenarios:

- **Process crash** — Restart picks up `in-progress` and `ready` issues automatically
- **Claude hang** — Heartbeat detection (5min) + task timeout (30min)
- **Network outage** — Next poll cycle retries automatically
- **GitHub API rate limit** — Octokit handles 429 retries internally
- **Concurrent label changes** — Each scan reads fresh state from GitHub

## License

[MIT](LICENSE)
