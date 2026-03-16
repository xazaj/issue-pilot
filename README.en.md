<div align="center">

# Issue-Pilot

**Label an issue, AI gets to work.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[中文](README.md)

</div>

---

## What is this?

You slap a label on a GitHub Issue. Issue-Pilot picks it up and sends [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to handle it. Automatically.

It's a daemon running on your machine. Every few seconds it checks GitHub for new tasks, claims them, dispatches AI, and reports back. No servers to deploy, no cloud services to set up — just `npm install` and one command.

## Why?

If you've used Claude Code, you know it's great at coding tasks. But the manual loop — copy issue content, paste into terminal, wait, update issue — gets old fast.

Issue-Pilot automates that loop:

```
You label → Issue-Pilot detects → Claude Code works → Results posted back
```

You manage the issues. AI does the rest.

## How to use it

Three steps:

**Step 1: Install**

```bash
npm install -g issue-pilot
```

**Step 2: Configure**

You need two things — a GitHub token and a workflow file.

Set your GitHub token:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

> Or put it in `~/.issue-pilot/.env`.

Create a workflow file — it's Markdown with config on top and your AI prompt below:

```bash
mkdir -p ~/.issue-pilot
curl -o ~/.issue-pilot/WORKFLOW.md https://raw.githubusercontent.com/xazaj/issue-pilot/main/WORKFLOW.example.md
```

Edit it. Three required fields:

```yaml
---
repo_owner: "your-org"          # Your GitHub username
repo_name: "your-repo"          # Repository name
working_dir: "/path/to/repo"    # Absolute path to local clone
---
```

The prompt section? Customize it however you want. Triage issues? Write a triage prompt. Write code? Write a coding prompt. **The workflow file defines what the AI does.**

**Step 3: Run**

```bash
issue-pilot
```

Create three labels in your repo: `pilot:ready`, `pilot:in-progress`, `pilot:failed`. Label any issue with `pilot:ready` and watch what happens.

## How it works

Simple architecture. Borrowed the reconciliation loop pattern from Kubernetes:

```
GitHub Issues                     Issue-Pilot (your machine)

 Issue #42                        ┌──────────────┐
 [pilot:ready]  ─────────────────>│  Reconciler   │ checks GitHub every 30s
                                  └──────┬───────┘
                                         │ found a task
                                  ┌──────▼───────┐
                                  │  Dispatcher   │ queues it, one at a time
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │    Runner     │ fires up Claude Code
                                  └──────┬───────┘
                                         │
 Issue #42                               │
 [pilot:in-progress]  <──────────────────┘
 Claude reads code, writes comments, opens PRs…
```

Why polling instead of webhooks? This runs locally — no public IP, no webhook endpoint. And polling is **naturally fault-tolerant**: crash and restart? Tasks are still there on GitHub. Network drops? Retry next cycle. No special recovery logic needed.

## Two modes

**Headless** — background mode with structured JSON logs:

```bash
issue-pilot
issue-pilot /path/to/WORKFLOW.md    # specify workflow path
```

**TUI** — interactive terminal dashboard:

```bash
issue-pilot-tui
```

## Where does the workflow file go?

Issue-Pilot looks in this order:

1. Path you pass as CLI argument
2. `./WORKFLOW.md` in the current directory
3. `~/.issue-pilot/WORKFLOW.md` as global default

If it can't find one, it tells you where to create it.

## Configuration reference

YAML front matter in your workflow file:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `repo_owner` | *required* | GitHub user or org |
| `repo_name` | *required* | Repository name |
| `working_dir` | *required* | Absolute path to local repo clone |
| `poll_interval` | `30` | Polling interval (seconds) |
| `ready_label` | `pilot:ready` | Trigger label |
| `in_progress_label` | `pilot:in-progress` | In-progress label |
| `failed_label` | `pilot:failed` | Failure label |
| `model` | `claude-sonnet-4-6` | Claude model |
| `max_outer_turns` | `5` | Max outer retry loops |
| `claude_max_turns` | `50` | Max agentic turns per session |
| `task_timeout_minutes` | `30` | Task timeout (minutes) |
| `heartbeat_timeout_minutes` | `5` | No-output timeout (minutes) |
| `assignee` | `""` | Only handle issues assigned to this user |
| `log_level` | `info` | Log level |

Template variables for the prompt:

`{{issue_number}}` `{{issue_title}}` `{{issue_body}}` `{{issue_url}}` `{{issue_labels}}` `{{issue_assignees}}` `{{repo_owner}}` `{{repo_name}}`

## What if something goes wrong?

Mostly nothing for you to do:

| What happened | What Issue-Pilot does |
|---------------|----------------------|
| Process crashed | Picks up tasks automatically on restart |
| Claude stuck | 5min silence → force-terminated |
| Task too long | 30min hard timeout, marked failed |
| Network down | Retries next poll cycle |
| GitHub rate limited | Octokit handles 429 retries automatically |
| Labels changed manually | Reads fresh state every scan |

Failed tasks get a comment explaining why — failure reason, turns completed, tokens used. Fix the issue, re-label `pilot:ready`, try again.

## Run from source

```bash
git clone https://github.com/xazaj/issue-pilot.git
cd issue-pilot
npm install
npm start           # Headless
npm run tui         # TUI
npm run dev         # Dev mode (auto-restart)
```

## Requirements

- **Node.js 22+**
- **Claude Code CLI** (installed and authenticated)
- **GitHub Token** (issues read/write + repo read)

## Deep dive

- [Architecture](docs/architecture.md) — Reconciliation loop, state machine, fault model, roadmap
- [Detailed Design](docs/design.md) — Module design, communication protocol, full execution flow

## License

[MIT](LICENSE)
