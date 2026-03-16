<div align="center">

# Issue-Pilot

**给 Issue 打个标签，AI 自动帮你处理。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[English](README.en.md)

<br>

<img src="assets/tui-screenshot.png" alt="Issue-Pilot TUI" width="700">

</div>

---

## 这是什么？

Issue-Pilot 是一个本地运行的 AI 任务调度工具。你在 GitHub Issue 上打一个标签，它就会自动调度 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 去处理——分析问题、回答疑问、甚至直接写代码提 PR。

它是一个守护进程，持续轮询 GitHub 获取新任务，自动认领并执行，完成后将结果写回 Issue。不需要部署服务器，不依赖第三方服务，安装后一条命令即可运行。

## 为什么需要它？

Claude Code 处理代码任务的能力很强，但每次都需要手动复制 Issue 内容、粘贴到终端、等待执行完毕再回去更新 Issue。这个循环足够重复，值得自动化。

Issue-Pilot 把这个流程变成了：

```
你打标签 → Issue-Pilot 发现 → Claude Code 执行 → 结果自动写回 Issue
```

你只需要管理 Issue，执行交给 AI。

## 快速开始

### 1. 安装

```bash
npm install -g issue-pilot
```

### 2. 配置

需要准备两样东西：一个 GitHub Token 和一个 Workflow 文件。

**配置 Token：**

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

> 也可以写入 `~/.issue-pilot/.env` 文件中。

**创建 Workflow 文件：**

Workflow 文件是 Markdown 格式，上半部分是 YAML 配置，下半部分是给 AI 的提示词模板。

```bash
mkdir -p ~/.issue-pilot
curl -o ~/.issue-pilot/WORKFLOW.md \
  https://raw.githubusercontent.com/xazaj/issue-pilot/main/WORKFLOW.example.md
```

编辑 `WORKFLOW.md`，填入三个必填项：

```yaml
---
repo_owner: "your-org"          # GitHub 用户名或组织名
repo_name: "your-repo"          # 仓库名称
working_dir: "/path/to/repo"    # 本地仓库的绝对路径
---
```

提示词部分可以根据需求自由定制。需要 AI 做 Issue 分析就写分析提示词，需要直接改代码就写编码提示词。**Workflow 文件定义了 AI 的行为，写什么它就做什么。**

### 3. 创建标签

在目标仓库的 **Settings → Labels** 中创建以下标签（名称可在配置中自定义）：

| 标签 | 用途 |
|------|------|
| `pilot:ready` | 标记任务就绪，等待 AI 执行 |
| `pilot:in-progress` | 任务执行中 |
| `pilot:failed` | 执行失败，需人工介入 |

### 4. 启动

```bash
issue-pilot
```

给任意 Issue 打上 `pilot:ready` 标签即可触发执行。

## 工作原理

架构借鉴了 Kubernetes 的调和循环（Reconciliation Loop）模式：

```
GitHub Issues                     Issue-Pilot（本地进程）

 Issue #42                        ┌──────────────┐
 [pilot:ready]  ─────────────────>│  Reconciler   │ 每 30 秒轮询 GitHub
                                  └──────┬───────┘
                                         │ 发现新任务
                                  ┌──────▼───────┐
                                  │  Dispatcher   │ 串行队列调度
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │    Runner     │ 启动 Claude Code 执行
                                  └──────┬───────┘
                                         │
 Issue #42                               │
 [pilot:in-progress]  <──────────────────┘
 Claude 分析代码、写评论、创建 PR…
```

为什么选择轮询而非 Webhook？因为这是本地工具，没有公网地址来接收 Webhook。而轮询天然具备容错能力——进程重启后自动恢复未完成的任务，网络中断后下一轮自动重试，不需要额外的恢复逻辑。

## 运行模式

**Headless 模式** — 后台运行，输出结构化 JSON 日志：

```bash
issue-pilot                          # 自动查找 WORKFLOW.md
issue-pilot /path/to/WORKFLOW.md     # 指定 Workflow 文件
```

**TUI 模式** — 交互式终端仪表盘：

```bash
issue-pilot-tui
```

## Workflow 文件查找顺序

```
1. 命令行参数指定的路径
2. 当前目录 ./WORKFLOW.md
3. 全局目录 ~/.issue-pilot/WORKFLOW.md
```

## 配置参考

### 运行时配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `repo_owner` | *必填* | GitHub 用户名或组织名 |
| `repo_name` | *必填* | 仓库名称 |
| `working_dir` | *必填* | 本地仓库绝对路径 |
| `poll_interval` | `30` | 轮询间隔（秒） |
| `ready_label` | `pilot:ready` | 触发执行的标签 |
| `in_progress_label` | `pilot:in-progress` | 执行中标签 |
| `failed_label` | `pilot:failed` | 失败标签 |
| `model` | `claude-sonnet-4-6` | Claude 模型 |
| `max_outer_turns` | `5` | 外层重试轮次上限 |
| `claude_max_turns` | `50` | Claude 单次 agentic 轮次上限 |
| `task_timeout_minutes` | `30` | 任务超时（分钟） |
| `heartbeat_timeout_minutes` | `5` | 无输出超时（分钟） |
| `assignee` | `""` | 仅处理指派给特定用户的 Issue |
| `log_level` | `info` | 日志级别 |

### 模板变量

提示词中可使用以下 Mustache 变量：

`{{issue_number}}` `{{issue_title}}` `{{issue_body}}` `{{issue_url}}` `{{issue_labels}}` `{{issue_assignees}}` `{{repo_owner}}` `{{repo_name}}`

## 故障恢复

调和循环架构使大多数故障场景可自动恢复：

| 故障场景 | 恢复方式 |
|----------|----------|
| 进程崩溃或重启 | 重启后自动发现未完成的任务 |
| Claude 进程僵死 | 5 分钟无输出自动终止 |
| 任务执行超时 | 30 分钟硬性超时，标记失败 |
| 网络中断 | 下一轮轮询自动重试 |
| GitHub API 限流 | Octokit 内置 429 重试 |
| 标签被手动修改 | 每次扫描读取最新状态 |

任务失败后，Issue-Pilot 会在 Issue 中留下诊断评论（失败原因、执行轮次、Token 用量）。修复问题后重新打 `pilot:ready` 标签即可重试。

## 从源码运行

```bash
git clone https://github.com/xazaj/issue-pilot.git
cd issue-pilot
npm install
npm start           # Headless 模式
npm run tui         # TUI 模式
npm run dev         # 开发模式（文件变更自动重启）
```

## 环境要求

- **Node.js 22+**
- **Claude Code CLI**（已安装并完成认证）
- **GitHub Token**（Issues 读写 + repo 读取权限）

## 路线图

### v1.0 — 单 Workflow 调度（当前）

单个 Workflow 文件，单一标签触发，适用于 Issue 分析、回复等场景。

### v1.1 — 多 Workflow 调度

支持 `workflows/` 目录，不同标签触发不同 Workflow。内置常用模板：

| 标签 | Workflow | AI 做什么 |
|------|----------|----------|
| `pilot:qa` | 答疑 | 阅读代码库，回答 Issue 中的技术问题 |
| `pilot:fix` | 修复缺陷 | 定位 Bug，修改代码，创建 PR |
| `pilot:impl` | 开发功能 | 根据需求实现功能，创建 PR |

### v1.2 — Workflow 类型

引入 `type` 字段，框架接管机械性操作（创建分支、提交代码、开 PR），提示词只负责思考：

```yaml
---
trigger_label: "pilot:fix"
type: "pr"                  # 框架自动处理分支和 PR 生命周期
branch_prefix: "fix/"
---
（提示词只需专注于理解问题和修复代码）
```

| type | 框架自动处理 | 提示词负责 |
|------|-------------|-----------|
| `comment` | 发布评论 | 分析问题，组织回答 |
| `pr` | 创建分支、提交、开 PR、关联 Issue | 理解需求，编写代码 |
| `review` | 获取 diff、提交 Review | 分析代码质量，给出建议 |

### v1.3 — 流水线与并发

- Workflow 串联：分析 → 人工确认 → 实现 → Review，标签驱动自动流转
- 并发执行：通过 git worktree 隔离，多任务并行处理

## 许可证

[MIT](LICENSE)
