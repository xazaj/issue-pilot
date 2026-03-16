<div align="center">

# Issue-Pilot

**让 AI 自动处理你的 GitHub Issues**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[English](README.en.md)

</div>

---

Issue-Pilot 是一个本地运行的 AI 任务调度守护进程。它持续监控 GitHub Issues 的标签变化，自动认领任务并调度 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 执行——无需部署服务器，无需第三方服务，一条命令即可启动。

## 工作原理

```
GitHub Issues                     Issue-Pilot（本地进程）

 Issue #42                        ┌──────────────┐
 [pilot:ready]  ─────────────────>│  Reconciler   │ 每 N 秒轮询
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │  Dispatcher   │ 串行队列
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │    Runner     │ 调度 Claude Code
                                  └──────┬───────┘
                                         │
 Issue #42                               │
 [pilot:in-progress]  <──────────────────┘
 Claude 创建 PR、更新标签…
```

1. 你给 Issue 打上 `pilot:ready` 标签
2. Issue-Pilot 发现后认领（标签切换为 `pilot:in-progress`）
3. Claude Code 根据 `WORKFLOW.md` 中定义的提示词执行任务
4. 成功后 Claude 移除标签，可选创建 PR
5. 失败则标记为 `pilot:failed`，并在 Issue 中留下诊断评论

## 核心特性

- **调和循环架构** — 借鉴 Kubernetes Controller 模式，轮询 + 状态对比，天然幂等，故障自愈
- **零外部依赖** — 仅需 GitHub API + Claude Code CLI，无中间件、无数据库、无 HTTP 服务
- **Workflow as Code** — 配置和提示词放在同一个 Markdown 文件中，版本化管理
- **多层故障保护** — 心跳检测、任务超时、进程崩溃恢复，绝大多数故障场景自动恢复
- **双模式运行** — Headless（结构化 JSON 日志）+ TUI（交互式终端仪表盘）

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org/) | 22+ LTS | 运行时 |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | 最新版 | 已安装并完成认证 |
| GitHub Token | — | 需要 Issues 读写 + repo 读取权限 |

## 快速开始

### 1. 安装

```bash
npm install -g issue-pilot
```

### 2. 配置 GitHub Token

三种方式（优先级从高到低）：

```bash
# 方式 A：环境变量（推荐，兼容 CI/CD）
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# 方式 B：全局配置文件
mkdir -p ~/.issue-pilot
echo "GITHUB_TOKEN=ghp_xxxxxxxxxxxx" > ~/.issue-pilot/.env

# 方式 C：当前目录 .env（仅开发时使用）
echo "GITHUB_TOKEN=ghp_xxxxxxxxxxxx" > .env
```

### 3. 创建标签

在目标仓库的 **Settings → Labels** 中创建以下标签（名称可自定义）：

| 标签 | 用途 |
|------|------|
| `pilot:ready` | 标记任务已就绪，等待 AI 执行 |
| `pilot:in-progress` | 任务正在执行中 |
| `pilot:failed` | 执行失败，需人工介入 |

### 4. 创建 Workflow 文件

```bash
# 全局安装用户：放到全局目录
mkdir -p ~/.issue-pilot
cp node_modules/issue-pilot/WORKFLOW.example.md ~/.issue-pilot/WORKFLOW.md

# 或放到当前工作目录
cp node_modules/issue-pilot/WORKFLOW.example.md ./WORKFLOW.md
```

编辑 `WORKFLOW.md`，填入你的仓库信息：

```yaml
---
repo_owner: "your-org"          # GitHub 用户名或组织名
repo_name: "your-repo"          # 仓库名称
working_dir: "/path/to/repo"    # 本地仓库绝对路径
---
```

### 5. 启动

```bash
issue-pilot
```

完成。现在去你的仓库里给一个 Issue 打上 `pilot:ready` 标签试试。

## 使用方式

### Headless 模式（结构化 JSON 日志输出）

```bash
issue-pilot                          # 自动查找 WORKFLOW.md
issue-pilot /path/to/WORKFLOW.md     # 指定 workflow 文件
```

### TUI 模式（交互式终端仪表盘）

```bash
issue-pilot-tui
issue-pilot-tui /path/to/WORKFLOW.md
```

### 从源码运行

```bash
git clone https://github.com/xazaj/issue-pilot.git
cd issue-pilot
npm install
npm start                     # Headless 模式
npm run tui                   # TUI 模式
npm run dev                   # 开发模式（文件变更自动重启）
```

## Workflow 文件查找顺序

```
1. 命令行参数指定的路径
2. ./WORKFLOW.md（当前工作目录）
3. ~/.issue-pilot/WORKFLOW.md（全局默认）
```

## WORKFLOW.md 配置参考

`WORKFLOW.md` 由两部分组成：YAML Front Matter（运行时配置）+ Markdown 正文（Mustache 提示词模板）。

### 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `repo_owner` | *必填* | GitHub 用户名或组织名 |
| `repo_name` | *必填* | 仓库名称 |
| `working_dir` | *必填* | 本地仓库克隆的绝对路径 |
| `poll_interval` | `30` | 轮询间隔（秒） |
| `ready_label` | `pilot:ready` | 触发执行的标签 |
| `in_progress_label` | `pilot:in-progress` | 认领时打上的标签 |
| `failed_label` | `pilot:failed` | 失败时打上的标签 |
| `model` | `claude-sonnet-4-6` | Claude 模型 |
| `max_outer_turns` | `5` | 外层重试轮次上限 |
| `claude_max_turns` | `50` | Claude 单次会话 agentic 轮次上限 |
| `task_timeout_minutes` | `30` | 单任务硬性超时（分钟） |
| `heartbeat_timeout_minutes` | `5` | 无输出超时（分钟） |
| `assignee` | `""` | 只处理指派给特定用户的 Issue |
| `log_level` | `info` | 日志级别：`debug` / `info` / `warn` / `error` |

### 模板变量

提示词正文中可使用以下 Mustache 变量：

| 变量 | 说明 |
|------|------|
| `{{issue_number}}` | Issue 编号 |
| `{{issue_title}}` | Issue 标题 |
| `{{issue_body}}` | Issue 正文（Markdown） |
| `{{issue_url}}` | Issue 的 Web URL |
| `{{issue_labels}}` | 当前标签（逗号分隔） |
| `{{issue_assignees}}` | 指派人（逗号分隔） |
| `{{repo_owner}}` | 仓库所有者 |
| `{{repo_name}}` | 仓库名称 |

## 架构

```
src/
  resolve.ts          # Workflow 文件查找与环境变量加载
  config.ts           # WORKFLOW.md 解析与 Zod 校验
  github.ts           # Octokit 封装：查询、认领、释放、评论
  reconciler.ts       # 调和循环：定时轮询 GitHub，发现新任务
  dispatcher.ts       # 串行调度：队列管理、优雅关闭
  runner.ts           # 任务执行：Claude 进程管理、多轮续接
  executor.ts         # AI 执行器抽象接口
  claude-executor.ts  # Claude Agent SDK 实现
  prompt.ts           # Mustache 提示词渲染
  logger.ts           # Pino 结构化日志
  history.ts          # 任务历史记录
  index.ts            # Headless 模式入口
  tui.tsx             # TUI 模式入口
  tui/                # TUI 组件（Ink + React）
```

详细设计文档见 [`docs/architecture.md`](docs/architecture.md) 和 [`docs/design.md`](docs/design.md)。

## 故障恢复

调和循环架构使绝大多数故障场景自动恢复，无需人工干预：

| 故障场景 | 恢复方式 |
|----------|----------|
| 进程崩溃/重启 | 重启后自动发现 `in-progress` 和 `ready` 的 Issue |
| Claude 进程僵死 | 心跳检测（5 分钟）→ 任务超时（30 分钟）→ 强制终止 |
| 网络中断 | 下一轮轮询自动重试 |
| GitHub API 限流 | Octokit 内置 429 重试机制 |
| Issue 标签被手动修改 | 每次扫描读取最新状态，自动适应 |

## 许可证

[MIT](LICENSE)
