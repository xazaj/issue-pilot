<div align="center">

# Issue-Pilot

**给 Issue 打个标签，AI 就去干活了。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[English](README.en.md)

</div>

---

## 这是什么？

简单来说：你在 GitHub Issue 上打一个标签，Issue-Pilot 就会自动派 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 去处理这个 Issue。

它是一个跑在你本地的守护进程，每隔几秒去 GitHub 看一眼有没有新任务，有就认领、派 AI 去干，干完了自动汇报结果。整个过程不需要你盯着，不需要部署服务器，`npm install` 之后一条命令就能跑起来。

## 为什么做这个？

用过 Claude Code 的人都知道，它在处理代码任务时非常强。但每次都要手动复制 Issue 内容、粘贴到终端、等它跑完再回去更新 Issue——这个过程太繁琐了。

Issue-Pilot 做的事情就是**把这个手动循环自动化**：

```
你打标签 → Issue-Pilot 发现 → 派 Claude Code 去干 → 结果写回 Issue
```

说白了，你只需要管理你的 Issue，剩下的交给 AI。

## 怎么用？

整个流程只有三步：

**第一步：安装**

```bash
npm install -g issue-pilot
```

**第二步：配置**

你需要准备两样东西——一个 GitHub Token 和一个 Workflow 文件。

GitHub Token 设置成环境变量就行：

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

> 也可以放到 `~/.issue-pilot/.env` 里，效果一样。

Workflow 文件是一个 Markdown 文件，上半部分是配置，下半部分是你给 AI 写的提示词。创建一个：

```bash
mkdir -p ~/.issue-pilot
# 从示例复制一份
curl -o ~/.issue-pilot/WORKFLOW.md https://raw.githubusercontent.com/xazaj/issue-pilot/main/WORKFLOW.example.md
```

打开编辑，改三个必填项就行：

```yaml
---
repo_owner: "your-org"          # 你的 GitHub 用户名
repo_name: "your-repo"          # 你的仓库名
working_dir: "/path/to/repo"    # 本地仓库的绝对路径
---
```

下面的提示词部分，你可以按自己的需求随便改。想让 AI 做分诊？写分诊的提示词。想让 AI 直接改代码？写改代码的提示词。**Workflow 文件就是 AI 的行为定义，你写什么它就做什么。**

**第三步：启动**

```bash
issue-pilot
```

然后去你的仓库创建三个标签：`pilot:ready`、`pilot:in-progress`、`pilot:failed`。给任意一个 Issue 打上 `pilot:ready`，看看会发生什么。

## 它到底是怎么工作的？

架构很简单，借鉴了 Kubernetes 的调和循环（Reconciliation Loop）模式：

```
GitHub Issues                     Issue-Pilot（你的电脑上）

 Issue #42                        ┌──────────────┐
 [pilot:ready]  ─────────────────>│  Reconciler   │ 每 30 秒去 GitHub 看一眼
                                  └──────┬───────┘
                                         │ 发现新任务
                                  ┌──────▼───────┐
                                  │  Dispatcher   │ 排队，一个一个来
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │    Runner     │ 启动 Claude Code 干活
                                  └──────┬───────┘
                                         │
 Issue #42                               │
 [pilot:in-progress]  <──────────────────┘
 Claude 分析代码、写评论、创建 PR…
```

为什么用轮询而不是 Webhook？因为这是本地工具，没有公网 IP，接收不了 Webhook。而轮询的好处是**天然抗故障**——进程崩了重启，GitHub API 挂了等恢复，网络断了等重连，下一轮照样能把任务捞回来。不需要任何特殊的恢复逻辑。

## 两种运行模式

**Headless 模式**——后台跑，输出结构化 JSON 日志：

```bash
issue-pilot
issue-pilot /path/to/WORKFLOW.md    # 指定 workflow 文件路径
```

**TUI 模式**——交互式终端仪表盘，看着更直观：

```bash
issue-pilot-tui
```

## Workflow 文件放哪？

Issue-Pilot 会按这个顺序找 Workflow 文件：

1. 你在命令行里指定的路径
2. 当前目录下的 `./WORKFLOW.md`
3. 全局目录 `~/.issue-pilot/WORKFLOW.md`

找不到会告诉你去哪创建，不用猜。

## 配置项速查

Workflow 文件的 YAML 头部支持这些配置：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `repo_owner` | *必填* | GitHub 用户名或组织名 |
| `repo_name` | *必填* | 仓库名 |
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
| `assignee` | `""` | 只处理指派给某人的 Issue |
| `log_level` | `info` | 日志级别 |

提示词模板里可以用这些 Mustache 变量：

`{{issue_number}}` `{{issue_title}}` `{{issue_body}}` `{{issue_url}}` `{{issue_labels}}` `{{issue_assignees}}` `{{repo_owner}}` `{{repo_name}}`

## 出了问题怎么办？

大部分情况下，不需要你管。

| 出了什么事 | Issue-Pilot 会怎么做 |
|------------|---------------------|
| 进程崩了 | 重启后自动捞回之前的任务 |
| Claude 卡住了 | 5 分钟没输出就判定僵死，强制终止 |
| 任务跑太久 | 30 分钟硬性超时，标记失败 |
| 网络断了 | 等网络恢复，下一轮自动重试 |
| GitHub 限流了 | Octokit 自动处理 429，等一会儿重试 |
| 有人手动改了标签 | 没关系，每轮都读最新状态 |

任务失败后，Issue-Pilot 会在 Issue 里留一条评论，告诉你失败原因、跑了几轮、用了多少 token。你修完问题后，重新打 `pilot:ready` 标签就能再跑一次。

## 从源码跑

如果你想改代码或者贡献：

```bash
git clone https://github.com/xazaj/issue-pilot.git
cd issue-pilot
npm install
npm start           # Headless 模式
npm run tui         # TUI 模式
npm run dev         # 开发模式（改代码自动重启）
```

## 环境要求

- **Node.js 22+**
- **Claude Code CLI**（已安装并认证）
- **GitHub Token**（Issues 读写 + repo 读取权限）

## 想深入了解？

- [架构设计](docs/architecture.md) — 调和循环模式、状态机、故障模型、演进路径
- [详细设计](docs/design.md) — 模块设计、通信机制、完整执行流程

## 许可证

[MIT](LICENSE)
