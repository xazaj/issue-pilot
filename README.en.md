<div align="center">

# Issue-Pilot

**Let AI handle your GitHub Issues automatically**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[中文](README.md)

</div>

---

Issue-Pilot is a locally-running AI task scheduling daemon. It continuously monitors GitHub Issue label changes, claims tasks, and dispatches [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to execute them — no server deployment, no third-party services, just one command to start.

## How It Works

```
GitHub Issues                     Issue-Pilot (local)

 Issue #42                        ┌──────────────┐
 [pilot:ready]  ─────────────────>│  Reconciler   │ polls every N seconds
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │  Dispatcher   │ serial queue
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │    Runner     │ spawns Claude Code
                                  └──────┬───────┘
                                         │
 Issue #42                               │
 [pilot:in-progress]  <──────────────────┘
 Claude creates PRs, updates labels…
```

1. You label an issue with `pilot:ready`
2. Issue-Pilot detects and claims it (swaps label to `pilot:in-progress`)
3. Claude Code executes the task defined in your `WORKFLOW.md` prompt template
4. On success, Claude removes the label and optionally creates a PR
5. On failure, the issue is labeled `pilot:failed` with a diagnostic comment

## Key Features

- **Reconciliation loop** — Inspired by Kubernetes controllers: poll + diff, naturally idempotent, self-healing
- **Zero external dependencies** — Only GitHub API + Claude Code CLI. No middleware, no database, no HTTP server
- **Workflow as Code** — Configuration and prompt in a single Markdown file, version-controllable
- **Multi-layer fault protection** — Heartbeat detection, task timeout, crash recovery. Most failures resolve automatically
- **Dual-mode** — Headless (structured JSON logs) + TUI (interactive terminal dashboard)

## Prerequisites

| Dependency | Version | Notes |
|------------|---------|-------|
| [Node.js](https://nodejs.org/) | 22+ LTS | Runtime |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Latest | Installed and authenticated |
| GitHub Token | — | Issues read/write + repo read permissions |

## Quick Start

### 1. Install

```bash
npm install -g issue-pilot
```

### 2. Configure GitHub Token

Three options (highest priority first):

```bash
# Option A: Environment variable (recommended, CI/CD compatible)
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Option B: Global config file
mkdir -p ~/.issue-pilot
echo "GITHUB_TOKEN=ghp_xxxxxxxxxxxx" > ~/.issue-pilot/.env

# Option C: Local .env in current directory (development only)
echo "GITHUB_TOKEN=ghp_xxxxxxxxxxxx" > .env
```

### 3. Create Labels

In your target repository's **Settings → Labels**, create:

| Label | Purpose |
|-------|---------|
| `pilot:ready` | Marks an issue as ready for AI execution |
| `pilot:in-progress` | Issue is currently being processed |
| `pilot:failed` | Execution failed, needs human attention |

### 4. Create a Workflow File

```bash
# For global install users: place in global directory
mkdir -p ~/.issue-pilot
cp node_modules/issue-pilot/WORKFLOW.example.md ~/.issue-pilot/WORKFLOW.md

# Or place in current working directory
cp node_modules/issue-pilot/WORKFLOW.example.md ./WORKFLOW.md
```

Edit `WORKFLOW.md` with your repository details:

```yaml
---
repo_owner: "your-org"          # GitHub user or organization
repo_name: "your-repo"          # Repository name
working_dir: "/path/to/repo"    # Absolute path to local repo clone
---
```

### 5. Start

```bash
issue-pilot
```

Done. Now go label an issue with `pilot:ready` in your repository.

## Usage

### Headless Mode (structured JSON log output)

```bash
issue-pilot                          # Auto-discovers WORKFLOW.md
issue-pilot /path/to/WORKFLOW.md     # Specify workflow file
```

### TUI Mode (interactive terminal dashboard)

```bash
issue-pilot-tui
issue-pilot-tui /path/to/WORKFLOW.md
```

### From Source

```bash
git clone https://github.com/xazaj/issue-pilot.git
cd issue-pilot
npm install
npm start                     # Headless mode
npm run tui                   # TUI mode
npm run dev                   # Development mode (auto-restart on file changes)
```

## Workflow File Lookup Order

```
1. Explicit CLI argument
2. ./WORKFLOW.md (current working directory)
3. ~/.issue-pilot/WORKFLOW.md (global fallback)
```

## WORKFLOW.md Reference

`WORKFLOW.md` consists of two parts: YAML front matter (runtime config) + Markdown body (Mustache prompt template).

### Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `repo_owner` | *required* | GitHub user or organization |
| `repo_name` | *required* | Repository name |
| `working_dir` | *required* | Absolute path to local repo clone |
| `poll_interval` | `30` | Polling interval in seconds |
| `ready_label` | `pilot:ready` | Label that triggers execution |
| `in_progress_label` | `pilot:in-progress` | Label applied when claimed |
| `failed_label` | `pilot:failed` | Label applied on failure |
| `model` | `claude-sonnet-4-6` | Claude model to use |
| `max_outer_turns` | `5` | Max outer retry loops |
| `claude_max_turns` | `50` | Max agentic turns per Claude session |
| `task_timeout_minutes` | `30` | Hard timeout per task (minutes) |
| `heartbeat_timeout_minutes` | `5` | No-output timeout (minutes) |
| `assignee` | `""` | Only process issues assigned to this user |
| `log_level` | `info` | `debug` / `info` / `warn` / `error` |

### Template Variables

Available Mustache variables in the prompt body:

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

## Architecture

```
src/
  resolve.ts          # Workflow file discovery and env loading
  config.ts           # WORKFLOW.md parsing and Zod validation
  github.ts           # Octokit wrapper: query, claim, release, comment
  reconciler.ts       # Reconciliation loop: poll GitHub, detect new tasks
  dispatcher.ts       # Serial scheduler: queue management, graceful shutdown
  runner.ts           # Task execution: Claude process management, multi-turn
  executor.ts         # Abstract AI executor interface
  claude-executor.ts  # Claude Agent SDK implementation
  prompt.ts           # Mustache prompt rendering
  logger.ts           # Pino structured logging
  history.ts          # Task history tracking
  index.ts            # Headless mode entry point
  tui.tsx             # TUI mode entry point
  tui/                # TUI components (Ink + React)
```

See [`docs/architecture.md`](docs/architecture.md) and [`docs/design.md`](docs/design.md) for detailed design documentation.

## Fault Recovery

The reconciliation loop architecture provides automatic recovery for most failure scenarios:

| Failure Scenario | Recovery |
|------------------|----------|
| Process crash/restart | Automatically picks up `in-progress` and `ready` issues |
| Claude process hang | Heartbeat detection (5min) → task timeout (30min) → forced termination |
| Network outage | Next poll cycle retries automatically |
| GitHub API rate limit | Octokit handles 429 retries internally |
| Manual label changes | Each scan reads fresh state from GitHub |

## License

[MIT](LICENSE)
