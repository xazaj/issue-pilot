# Issue-Pilot 架构设计

---

## 一、设计哲学

### 1.1 问题的本质

Issue-Pilot 要解决的问题可以还原为一句话：

> **一个本地进程，需要感知 GitHub Issue 的状态变化，并调度 AI Agent 执行任务。**

这是一个经典的 **Worker/Consumer 模式**——GitHub Issues 是任务队列，标签是状态，本地进程是消费者。

### 1.2 核心洞察

**对于本地运行的无状态 Worker，调和循环（Reconciliation Loop）是唯一正确的事件检测机制。**

理由来自分布式系统的第一性原理：

1. **本地进程无法保证事件接收的连续性。** 进程重启、网络抖动、中间件故障都会导致事件丢失。任何基于推送的方案都必须加补偿轮询——这意味着推送只是优化，不是基础。
2. **GitHub 本身就是持久化的状态存储。** Issue 的标签就是状态机的当前状态，随时可查。不需要额外的事件流来同步状态。
3. **调和循环天然幂等。** 每次循环都从 GitHub 查询当前状态，不依赖历史事件的完整性。错过一次不影响下次，进程崩溃重启后自动恢复。

这是 Kubernetes Controller 的核心设计模式：**不要监听事件流，要持续调和期望状态与实际状态的差异。** 这个模式在 2016 年被 Kubernetes 验证，经过 10 年的大规模生产考验，已经是 2026 年无可争议的最佳实践。

### 1.3 设计原则

| 原则 | 含义 | 对应决策 |
|------|------|---------|
| **状态即真相** | GitHub Issue 标签是唯一状态源，不维护本地状态副本 | 每次循环都从 GitHub 查询 |
| **调和优于监听** | 持续将实际状态对齐到期望状态，而非响应离散事件 | 调和循环作为唯一事件检测路径 |
| **零外部依赖** | 除 GitHub API 和 Claude CLI 外不依赖任何第三方服务 | 无中间件、无 HTTP 服务 |
| **故障域最小化** | 每个组件的故障只影响自身，不级联 | 模块间松耦合，进程监控独立于业务逻辑 |

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────┐
│                   Issue-Pilot（本地进程）               │
│                                                      │
│  ┌──────────────┐    ┌──────────────┐               │
│  │ Reconciler   │───>│ Dispatcher   │               │
│  │ (调和循环)    │    │ (串行调度)    │               │
│  │              │    │              │               │
│  │ 每 N 秒查询   │    │ 空闲→执行    │               │
│  │ GitHub Issue  │    │ 忙碌→入队    │               │
│  └──────────────┘    └──────┬───────┘               │
│                             │                        │
│                      ┌──────▼───────┐               │
│                      │ Agent Runner │               │
│                      │              │               │
│                      │ 构建提示词    │               │
│                      │ spawn Claude │               │
│                      │ 解析输出流    │               │
│                      │ 多轮续接     │               │
│                      └──────┬───────┘               │
│                             │                        │
│                      ┌──────▼───────┐               │
│                      │ GitHub Client│               │
│                      │ (Octokit)    │               │
│                      │              │               │
│                      │ 认领/释放     │               │
│                      │ 状态查询     │               │
│                      │ 评论记录     │               │
│                      └──────────────┘               │
│                                                      │
└─────────────────────────────────────────────────────┘
         │                          ▲
         │ Octokit REST API         │ Claude 通过 gh CLI
         ▼                          │ 操作 Issue/PR
┌─────────────────────────────────────────────────────┐
│                      GitHub                          │
│                                                      │
│  Issue #42 [pilot:ready]  ──→  [pilot:in-progress] │
│                                        │             │
│                                   Claude 创建 PR     │
│                                   Claude 更新标签     │
│                                        │             │
│                                  [标签移除 = 完成]    │
└─────────────────────────────────────────────────────┘
```

事件检测只有一条路径：Reconciler 定时查询 GitHub API。无中间件、无 HTTP 服务、无 SSE 长连接。

---

## 三、状态机

### 3.1 Issue 状态流转

```
                    用户打标签
 ┌─────────┐      pilot:ready      ┌─────────────┐
 │  Open   │ ─────────────────────> │    Ready     │
 │ (无标签) │                        │ pilot:ready │
 └─────────┘                        └──────┬──────┘
                                           │
                                    Reconciler 发现
                                    Runner 认领
                                    (移除 ready, 加 in-progress)
                                           │
                                    ┌──────▼──────┐
                                    │ In Progress  │
                                    │ pilot:       │
                                    │ in-progress  │
                                    └──────┬──────┘
                                           │
                              ┌────────────┼────────────┐
                              │            │            │
                       Claude 完成    超时/崩溃    轮次耗尽
                       (移除标签)    (Runner 标记)  (Runner 标记)
                              │            │            │
                       ┌──────▼──┐  ┌──────▼──────┐    │
                       │  Done   │  │   Failed    │◄───┘
                       │ (无标签  │  │ pilot:      │
                       │  有 PR) │  │ failed      │
                       └─────────┘  └─────────────┘
                                           │
                                     用户修复后
                                     移除 failed
                                     重新打 ready
                                           │
                                    ┌──────▼──────┐
                                    │    Ready     │ (重新进入循环)
                                    └─────────────┘
```

### 3.2 职责边界

- **Runner**：只负责 ready → in-progress（认领）和 in-progress → failed（异常处理）
- **Claude**：负责 in-progress → done（业务完成），通过 `gh` CLI 操作
- **用户**：负责 → ready（触发）和 failed → ready（重试）

业务流程的灵活性完全由 WORKFLOW.md 的提示词定义，Runner 逻辑始终保持极简。

---

## 四、故障模型分析

从因果链出发，穷举所有故障场景及其恢复路径：

| # | 故障场景 | 影响 | 恢复机制 |
|---|---------|------|---------|
| 1 | Issue-Pilot 进程崩溃 | 当前任务中断，队列丢失 | 重启后 Reconciler 自动发现 ready + in-progress Issue |
| 2 | Claude 进程 hang | current 永远不释放 | 心跳检测（5min）→ 任务超时（30min）→ SIGTERM/SIGKILL |
| 3 | Claude 进程崩溃 | 任务未完成 | exit 事件监听 → 标记 failed → 处理队列 |
| 4 | GitHub API 暂时不可用 | 轮询失败 | 下一个循环自动重试，不需要特殊处理 |
| 5 | GitHub API 限流 (429) | 轮询被拒绝 | Octokit 内置限流处理，自动等待后重试 |
| 6 | 网络断开 | 所有 API 调用失败 | Reconciler 循环继续运行，网络恢复后自动恢复 |
| 7 | GITHUB_TOKEN 过期 | 所有 API 返回 401 | 记录错误日志，人工更换 Token 后重启 |
| 8 | Issue 被手动修改标签 | 状态不一致 | Reconciler 下一轮重新读取真实状态，自动适应 |
| 9 | 同一 Issue 被反复打 ready | 重复入队 | Dispatcher 按 Issue number 去重 |
| 10 | working_dir 状态脏污 | Claude 启动在脏环境 | 提示词中指示 Claude 先检查 git status |
| 11 | 磁盘空间耗尽 | Claude 无法写入文件 | Claude 进程报错退出 → exit 监听 → 标记 failed |

**关键观察：** 故障 #1-#6 和 #8-#9 都是自动恢复的，不需要人工介入。只有 #7（Token 过期）和 #10-#11（环境问题）需要人工处理。这是调和循环架构的核心优势——**绝大多数故障都能自愈**。

---

## 五、演进路径

### 5.1 演进总纲

Issue-Pilot 的核心架构（Reconciler → Dispatcher → Runner）本质上是一个通用的 **"感知 GitHub 状态变化 → 调度 AI Agent 执行"** 框架。当前 v1.0 仅实现了最小闭环：单 workflow、标签触发、Issue 分析。

演进方向的第一性原理：**Workflow 文件就是能力本身。** 框架只做调度，业务逻辑完全由 Workflow 提示词定义。增加新能力 = 写一个新的 Markdown 文件，而非修改框架代码。

沿着这个原理，演进分为三个维度：

```
维度 1：调度能力        一个 workflow → 多 workflow → workflow 流水线
维度 2：感知范围        Issue 标签 → PR 事件 → Projects 看板 → 评论指令
维度 3：执行能力        串行单任务 → 并发多任务（worktree 隔离）
```

### 5.2 版本路线图

---

#### v1.0（当前）— 单 Workflow 分析

**能力：** 一个 WORKFLOW.md，一种触发标签，Issue 分析并留下评论。

**限制：** 只能做一件事。想让 AI 既做分析又做实现，只能靠换 Workflow 文件重启进程。

---

#### v1.1 — 多 Workflow 调度

**核心变更：** 支持 `workflows/` 目录，每个 Workflow 文件声明自己的触发标签，Reconciler 扫描所有触发标签并分发到对应 Workflow。

**配置结构：**

```
~/.issue-pilot/
  workflows/
    triage.md           # trigger_label: "pilot:triage"
    answer.md           # trigger_label: "pilot:answer"
    implement.md        # trigger_label: "pilot:implement"
```

**Workflow Front Matter 扩展：**

```yaml
---
trigger_label: "pilot:triage"      # 新增：触发此 workflow 的标签
in_progress_label: "pilot:wip"     # 认领时打上的标签
failed_label: "pilot:failed"
repo_owner: "xazaj"
repo_name: "my-project"
working_dir: "/path/to/repo"
---
```

**用户使用方式：**

```
给 Issue 打 pilot:triage   → AI 分析问题、澄清需求、列出文件影响范围
给 Issue 打 pilot:answer   → AI 阅读代码回答技术问题
给 Issue 打 pilot:implement → AI 写代码、提交、创建 PR
```

**架构影响：**

- Reconciler：从扫描单一标签 → 扫描所有已注册的 trigger_label
- Dispatcher：submit 时携带 workflow 引用，Runner 按 workflow 构建提示词
- Runner / Executor：无变更

**这是整个演进路径中最关键的一步。** 它将 Issue-Pilot 从"单一用途工具"变成"可扩展框架"，后续所有能力都建立在此基础上。

---

#### v1.2 — Workflow 流水线

**核心变更：** Workflow 完成后可自动触发下一个阶段，形成 Issue 生命周期流水线。

**Front Matter 扩展：**

```yaml
---
trigger_label: "pilot:triage"
on_success:
  add_label: "Human Review"        # 完成后打标签，等待人工确认
on_human_approved:                  # 可选：人工确认后自动进入下一阶段
  remove_label: "Human Review"
  add_label: "pilot:implement"
---
```

**典型流水线：**

```
用户创建 Issue
    │
    ▼ 打 pilot:triage
┌─────────────────┐
│  triage.md       │  AI 分析问题、澄清需求
│  输出：评论       │  提出决策问题
└────────┬────────┘
         │ on_success → 加 "Human Review"
         ▼
┌─────────────────┐
│  人工审核         │  用户回答问题、做决策
│  确认方案         │  移除 "Human Review"，打 pilot:implement
└────────┬────────┘
         ▼
┌─────────────────┐
│  implement.md    │  AI 基于确认的方案写代码
│  输出：PR         │  创建分支、提交、开 PR
└────────┬────────┘
         │ on_success → 加 "pilot:review"
         ▼
┌─────────────────┐
│  review.md       │  AI 审查 PR 代码质量
│  输出：Review     │  提出修改建议或 Approve
└─────────────────┘
```

**设计约束：**

- 流水线的每一步都可以独立触发，也可以串联
- 人工审核是显式的标签操作，不是隐式等待
- 每个 Workflow 的输出是确定性的（评论 / PR / Review），不依赖前序 Workflow 的内部状态
- 状态全部存在 GitHub 标签上，进程重启后流水线自动恢复

---

#### v1.3 — PR 生命周期

**核心变更：** Reconciler 扫描范围从 Issue 扩展到 Pull Request。

**新增 PR 专用模板变量：**

```
{{pr_number}}          PR 编号
{{pr_title}}           PR 标题
{{pr_body}}            PR 描述
{{pr_diff_stat}}       变更文件统计
{{pr_head_branch}}     源分支
{{pr_base_branch}}     目标分支
{{pr_review_comments}} Review 评论内容
```

**新增 Workflow 类型：**

```yaml
# review.md — 代码审查
---
trigger_label: "pilot:review"
target: "pull_request"            # 新增：声明此 workflow 作用于 PR
---
你是代码审查者。审查 PR #{{pr_number}} 的变更。
重点关注：安全漏洞、性能问题、逻辑错误、代码风格。
使用 gh pr review 提交审查意见。
```

```yaml
# revise.md — 处理 Review 反馈
---
trigger_label: "pilot:revise"
target: "pull_request"
---
PR #{{pr_number}} 收到了修改意见。
阅读 Review 评论，修改代码，push 新的 commit。
```

**使用场景：**

```
给 PR 打 pilot:review  → AI 做代码审查，留下 Review 评论
给 PR 打 pilot:revise  → AI 根据 Review 反馈修改代码并推送
给 PR 打 pilot:merge   → AI 检查 CI 状态，确认无阻塞后合并
```

---

#### v2.0 — GitHub Projects 集成

**核心变更：** 将 GitHub Projects（v2）看板的列状态变化作为触发源。

**动机：** 标签适合机器操作，但人类更习惯在看板上拖卡片。Projects 集成让 Issue-Pilot 嵌入团队已有的项目管理工作流，而非要求团队适应新的标签体系。

**映射关系：**

```
Projects 看板列              触发的 Workflow
─────────────              ──────────────
Backlog                     （无动作）
Triage                      triage.md
Ready for Dev               implement.md
In Review                   review.md
Done                        （无动作）
```

**配置方式：**

```yaml
# project.yaml — 项目级配置
project_id: "PVT_xxxx"           # GitHub Projects v2 ID
column_triggers:
  "Triage": "triage.md"
  "Ready for Dev": "implement.md"
  "In Review": "review.md"
```

**架构影响：**

- Reconciler 新增 Projects API 查询路径（GraphQL）
- 与标签触发并存，不替代
- 看板成为 Issue 全生命周期的可视化控制面板

---

#### v2.1 — 评论指令

**核心变更：** 在 Issue / PR 评论中通过 `/pilot` 指令触发 Workflow。

**使用方式：**

```
/pilot triage       → 触发 triage.md
/pilot implement    → 触发 implement.md
/pilot review       → 触发 review.md（在 PR 上）
/pilot answer       → 触发 answer.md
```

**动机：** 标签触发适合流程自动化，但评论指令更适合即时的、一次性的请求。例如：某人在 Issue 里问了一个技术问题，维护者直接回复 `/pilot answer`，无需手动改标签。

**架构影响：**

- Reconciler 新增评论扫描路径：查询最近 N 分钟的新评论，匹配 `/pilot` 前缀
- 触发后的流程与标签触发完全一致（认领 → 执行 → 结果）
- 需要防重：已处理的指令评论标记 reaction（如 👀）避免重复触发

---

#### v2.2 — 并发执行

**核心变更：** 通过 `git worktree` 实现多任务并发，每个任务在独立的工作目录中执行。

**动机：** 当仓库同时有多个 Issue 需要处理时，串行等待效率太低。特别是 triage 类任务（只读不写），完全可以并发。

**实现方式：**

```
主仓库: /path/to/repo                     ← 保持干净
Worktree 1: /path/to/repo/.worktrees/issue-42  ← Claude 在这里工作
Worktree 2: /path/to/repo/.worktrees/issue-57  ← 另一个 Claude 在这里工作
```

**配置：**

```yaml
max_concurrent: 3                  # 最大并发数
worktree_dir: ".worktrees"         # worktree 目录名
```

**架构影响：**

- Dispatcher：从串行队列变为并发池（信号量控制）
- Runner：每次任务创建 worktree，任务结束后清理
- 其余模块无变更

---

### 5.3 里程碑总览

```
v1.0 ──── v1.1 ──── v1.2 ──── v1.3 ──── v2.0 ──── v2.1 ──── v2.2
 │          │         │         │         │         │         │
 单workflow  多workflow  流水线    PR生命周期  Projects  评论指令   并发
 Issue分析   标签路由    自动串联  代码审查    看板驱动   /pilot    worktree
                                 PR合并
```

**每个版本都是增量变更，不需要重写。** 核心调和循环始终是基础，演进只是扩展感知范围和调度维度。

### 5.4 设计红线

以下是演进过程中不应突破的约束，突破任何一条都意味着架构出了问题：

| 红线 | 原因 |
|------|------|
| **始终本地运行** | 这是工具的核心定位。需要远程部署的场景请用 GitHub Actions |
| **GitHub 是唯一状态源** | 不引入本地数据库存储业务状态，所有状态通过 GitHub API 可查可恢复 |
| **Workflow 文件是唯一的业务逻辑载体** | 框架代码不包含任何特定任务的逻辑（不硬编码"分析"、"审查"等概念） |
| **每个 Workflow 独立无状态** | Workflow 之间不共享内存状态，串联通过 GitHub 标签完成 |
| **人工审核是显式操作** | 任何涉及代码变更的流水线必须有人工确认环节，不允许全自动合并 |
