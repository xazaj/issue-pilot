# Silent-Dev 详细设计

**技术栈：TypeScript + Octokit + Claude Code CLI**

---

## 一、系统概览

Silent-Dev 是一个本地运行的 AI 任务调度服务。它通过调和循环（Reconciliation Loop）定时查询 GitHub Issue 标签变化，发现符合条件的任务后，启动 Claude Code CLI 执行。全程串行，一次只处理一个 Issue，通过内存队列缓存多余任务。

---

## 二、技术栈

| 职责 | 方案 | 理由 |
|------|------|------|
| 运行时 | Node.js 22+ LTS | 原生 fetch、稳定的 TS 支持 |
| 语言 | TypeScript（`tsx` 运行） | 类型安全，`tsx` 提供 watch 模式和零配置运行 |
| GitHub API | `@octokit/rest` | 官方 SDK，强类型，ETag 缓存 |
| AI 执行 | `claude` CLI | `stream-json` 输出，`--continue` 续接 |
| 进程管理 | Node.js `child_process` | 标准库，无需引入额外依赖 |
| 配置解析 | `gray-matter` + `zod` | YAML front matter 解析 + 运行时类型校验 |
| 提示词模板 | `mustache` | 轻量无逻辑模板 |
| 日志 | `pino` | 结构化 JSON 日志，高性能，生态成熟 |

---

## 三、初始化步骤

使用前的配置流程，只需做一次：

**第 1 步 - 配置 GitHub Token**

在 `.env` 中设置 `GITHUB_TOKEN`，需要 Issues 读写权限和 repo 读权限。

**第 2 步 - 创建标签**

在目标仓库的 Labels 页面创建以下标签（名称可在 WORKFLOW.md 中自定义）：
- `silent:ready` — 标记任务已就绪，等待 Agent 执行
- `silent:in-progress` — 标记任务正在执行中
- `silent:failed` — 标记任务执行失败，需人工介入

---

## 四、WORKFLOW.md 配置设计

配置和提示词放在同一个 Markdown 文件里，版本化在目标仓库中。

文件分两部分：
- 顶部是 YAML front matter，包含运行时配置参数
- 分隔符之后是提示词模板正文，使用 Mustache 语法引用 Issue 字段

**配置参数：**

```yaml
---
# GitHub 仓库
repo_owner: "your-org"
repo_name: "your-repo"

# 调和循环
poll_interval: 30           # 轮询间隔（秒），默认 30

# 标签
ready_label: "silent:ready"
in_progress_label: "silent:in-progress"
failed_label: "silent:failed"

# Claude 执行
working_dir: "/absolute/path/to/repo"
max_outer_turns: 5          # 外层循环最大轮次
claude_max_turns: 50        # Claude 单次会话内部 agentic 轮次上限

# 超时保护
task_timeout_minutes: 30    # 任务总超时（分钟）
heartbeat_timeout_minutes: 5  # 无输出判定僵死（分钟）

# 可选
assignee: ""                # 只处理指派给特定用户的 Issue，留空则不过滤
log_level: "info"           # 日志级别：debug / info / warn / error
---

（下方是 Mustache 提示词模板）
```

**配置参数说明：**

- `repo_owner`：GitHub 仓库所属的用户名或组织名
- `repo_name`：GitHub 仓库名称
- `poll_interval`：调和循环的查询间隔（秒），默认 30
- `ready_label`：触发执行的 Issue 标签，默认 `silent:ready`
- `in_progress_label`：认领时打上的标签，防止重复处理，默认 `silent:in-progress`
- `failed_label`：失败时打上的标签，默认 `silent:failed`
- `working_dir`：Claude 的工作目录，绝对路径
- `max_outer_turns`：外层循环允许的最大轮次（每轮调用一次 Claude）
- `claude_max_turns`：传给 Claude 的 `--max-turns` 参数，控制单次会话内部的 agentic 循环次数
- `task_timeout_minutes`：单个 Issue 任务的总超时时间（分钟），默认 30
- `heartbeat_timeout_minutes`：Claude 输出流无活动的超时时间（分钟），默认 5
- `assignee`：可选过滤，只处理指派给特定用户的 Issue
- `log_level`：日志级别，可选 debug / info / warn / error

---

## 五、模块划分

```
src/
  config.ts        # 读取和验证 WORKFLOW.md（gray-matter + zod）
  github.ts        # Octokit 封装：查询、认领、释放、评论
  reconciler.ts    # 调和循环：定时查询 GitHub，发现新任务交给 Dispatcher
  dispatcher.ts    # 串行调度：队列管理、超时保护、优雅关闭
  runner.ts        # Agent 执行：spawn Claude、解析输出、多轮续接
  prompt.ts        # 提示词渲染（Mustache 模板）
  logger.ts        # pino 日志初始化
  index.ts         # 入口：读取配置 → 初始化模块 → 启动 Reconciler
```

---

## 六、GitHub Client 模块（github.ts）

使用 `@octokit/rest` 封装所有 GitHub API 操作，对外暴露语义明确的函数。

**需要封装的操作：**

- **查询 Issue 列表**：按标签过滤（ready / in-progress），用于 Reconciler 每轮扫描
- **获取 Issue 详情**：通过 issue number 获取完整信息（title、body、labels、assignees、url）
- **认领 Issue**：移除 `ready_label`，添加 `in_progress_label`，两个操作连续调用
- **检查 Issue 当前标签**：轮次结束后查询 Issue 是否仍有 `in_progress_label`
- **释放 Issue**（失败时）：移除 `in_progress_label`，添加 `failed_label`
- **添加评论**：记录任务开始、完成、失败等关键节点信息

**技术要点：**

- Octokit 返回强类型的 TypeScript 对象，无需手动解析 JSON
- 自动处理 HTTP 错误，抛出结构化异常
- 支持 ETag 条件请求，Issue 列表未变化时返回 304，网络开销极小
- 内置限流处理，收到 429 时自动等待后重试
- 认证通过环境变量 `GITHUB_TOKEN` 注入

**注意：** Claude 在工作目录内执行任务时，使用 `gh` CLI（作为 Claude 的工具），这与 Runner 使用 Octokit 互不干涉。

---

## 七、Reconciler 模块（reconciler.ts）

调和循环是整个系统的心脏，负责感知 GitHub 上的任务变化。

### 7.1 核心逻辑

```
每 poll_interval 秒执行一次：
  1. 调用 Octokit 查询所有带 ready_label 的 open Issue
  2. 调用 Octokit 查询所有带 in_progress_label 的 open Issue
  3. 将结果按 Issue number 去重、合并
  4. 与 Dispatcher 的当前状态对比：
     - 新发现的 ready Issue → 交给 Dispatcher 入队
     - 新发现的 in-progress Issue（非当前执行中）→ 作为恢复任务入队
     - 已在队列或执行中的 Issue → 忽略
  5. 记录本轮扫描结果日志
```

### 7.2 ETag 条件请求

当 Issue 列表未发生变化时，GitHub 返回 `304 Not Modified`，响应体为空。实际效果：

- 空闲时：每次轮询几乎零开销（304 响应）
- 有变化时：正常返回数据，立即处理

### 7.3 自适应轮询间隔

三个固定档位的简单切换，不是复杂的自适应算法：

```
默认间隔：30 秒
任务执行中：60 秒（已经在忙了，不需要频繁检查新任务）
刚完成一个任务：10 秒（可能有排队的后续任务）
连续 5 分钟无新任务：恢复 30 秒
```

### 7.4 服务重启时的自动恢复

进程重启后内存队列丢失，但 GitHub 上的 Issue 标签始终是真实状态。Reconciler 第一轮循环就会发现所有带 ready 和 in-progress 标签的 Issue 并重新入队。不需要任何特殊的恢复逻辑——调和循环天然覆盖了这个场景。

---

## 八、Dispatcher 模块（dispatcher.ts）

负责串行调度，确保同一时刻只有一个 Issue 在执行。

### 8.1 内部状态

```typescript
interface DispatcherState {
  current: RunningTask | null;   // 当前执行中的任务
  pending: IssueTask[];          // 等待队列（按发现时间排序）
}

interface RunningTask {
  issue: IssueTask;
  startedAt: Date;
  timeoutTimer: NodeJS.Timeout;
  process: ChildProcess | null;
  outerTurn: number;
}
```

### 8.2 调度逻辑

**Reconciler 提交新 Issue 时：**

- 如果 `current == null`：立即认领并执行
- 如果 `current != null`：检查 Issue number 是否已在 pending 中或等于 current，没有则加入队尾，有则忽略

**Agent 执行完毕时：**

- 置 `current = null`
- 如果 `pending` 非空：取出队首，立即执行下一个
- 如果 `pending` 为空：进入空闲状态

### 8.3 超时与僵死保护

三层独立保护，任何一层触发都执行完整 cleanup，且 cleanup 逻辑幂等：

**第一层 - 输出流心跳检测（软性保护）：**

在解析 Claude stdout 时记录最后活跃时间戳。如果超过 `heartbeat_timeout_minutes`（默认 5 分钟）没有任何输出，判定为进程僵死，触发终止序列。

**第二层 - 任务级超时（硬性保护）：**

每次启动 Agent 时设置 `task_timeout_minutes` 定时器（默认 30 分钟）。超时触发以下序列：

```
1. 向 Claude 进程发送 SIGTERM
2. 启动 5 秒倒计时
3. 若 5 秒后进程仍存活 → 发送 SIGKILL
4. 调用 Octokit：移除 in_progress_label，添加 failed_label
5. 调用 Octokit：添加评论（包含超时时长、已执行轮次、失败原因）
6. 清理：current = null，继续处理 pending 队列
```

**第三层 - 进程异常退出保护：**

监听子进程的 `exit` 事件。当退出码非零或被信号终止时：

```
1. 记录退出码和信号
2. 执行与超时相同的 cleanup 逻辑
3. 评论中区分失败类型：SIGTERM/SIGKILL/crash/非零退出
```

### 8.4 优雅关闭（Graceful Shutdown）

进程收到 SIGTERM/SIGINT 时：

```
1. 停止 Reconciler 循环（不再接受新任务）
2. 如果有正在执行的任务：
   a. 等待当前 Claude 进程自然结束（最长等待 60 秒）
   b. 超时则 SIGTERM → SIGKILL Claude 进程
   c. Issue 保留 in_progress 标签（下次启动时 Reconciler 自动恢复）
3. pending 队列中的 Issue 不做处理（标签仍是 ready，下次启动自动发现）
4. 退出进程
```

无论何时终止服务，GitHub 上的状态都是可恢复的。

---

## 九、Claude Code CLI 通信机制

Claude Code CLI 支持 `--output-format stream-json` 参数，以换行符分隔的 JSON 格式（NDJSON）实时输出执行过程。

**启动命令结构：**

第一轮运行时，把完整的提示词通过 `-p` 传入，同时指定：
- `--output-format stream-json`：获得结构化输出
- `--max-turns N`：控制 Claude 内部 agentic 循环上限
- 进程的 `cwd` 设置为 `working_dir`

**流式输出的消息类型：**

- `type: "system", subtype: "init"`：会话初始化，包含 session_id
- `type: "assistant"`：Claude 的输出（思考过程和工具调用）
- `type: "user"`：工具执行结果反馈给 Claude
- `type: "result", subtype: "success"`：本次会话成功结束，包含 token 用量
- `type: "result", subtype: "error_max_turns"`：Claude 达到内部轮次上限
- `type: "result", subtype: "error_during_tool_use"`：工具执行出错

**多轮执行的衔接：**

Claude Code CLI 支持 `--continue` 参数，在同一 `working_dir` 下续接上一次对话的完整上下文，Runner 不需要自己管理会话状态。

---

## 十、Agent Runner 模块（runner.ts）

执行单个 Issue 任务的核心模块。

### 10.1 执行流程

```
第 1 步 - 认领 Issue
  Octokit: 认领前先检查 ready_label 是否仍存在
  Octokit: 移除 ready_label, 添加 in_progress_label
  Octokit: 添加评论 "Task claimed by Silent-Dev, starting execution..."
  若认领失败（标签已不存在）→ 跳过，可能被其他消费者抢走或用户手动取消

第 2 步 - 构建提示词
  从 WORKFLOW.md 模板渲染完整提示词
  注入 Issue 数据：number, title, body, labels, url, assignees

第 3 步 - 启动第一轮 Claude
  spawn: claude -p "<prompt>" --output-format stream-json --max-turns <N>
  cwd: working_dir
  启动超时定时器和心跳检测

第 4 步 - 实时处理输出流
  逐行解析 NDJSON：
    type: "system", subtype: "init"  → 记录 session_id
    type: "assistant"                → 更新活跃时间戳，日志输出
    type: "user"                     → 更新活跃时间戳（工具执行反馈）
    type: "result"                   → 记录 subtype 和 token 用量
  累计 token 用量

第 5 步 - 检查 Issue 状态
  Octokit: 查询 Issue 当前标签
    in_progress_label 已消失 → Claude 完成了状态流转，任务成功
    in_progress_label 仍存在 → 任务未完成

第 6 步 - 决定是否继续
  if 已完成:
    → 进入结束处理（成功）
  if 未完成 且 outerTurn < max_outer_turns 且 未超时:
    → outerTurn++
    → 构建续接提示词
    → spawn: claude --continue --output-format stream-json --max-turns <N>
    → 回到第 4 步
  if 未完成 且 outerTurn >= max_outer_turns:
    → 进入结束处理（轮次耗尽）

第 7 步 - 结束处理
  成功:
    Octokit: 添加完成评论（token 用量、轮次数、耗时）
  失败（轮次耗尽/超时/崩溃）:
    Octokit: 移除 in_progress_label，添加 failed_label
    Octokit: 添加失败评论（原因、token 用量、轮次数、耗时）
  清理:
    清除超时定时器
    清除心跳检测定时器
    通知 Dispatcher: current = null
```

### 10.2 认领的原子性

"移除 ready_label + 添加 in_progress_label" 不是原子操作。在两次 API 调用之间可能出现另一个消费者认领或用户手动修改标签。

防御策略：**认领前先检查 ready_label 是否仍存在**。如果已被移除，跳过该 Issue。这不是完美的分布式锁，但对于单实例串行执行的场景足够可靠。

---

## 十一、多轮提示词设计（prompt.ts）

**第一轮（完整提示词）：**

WORKFLOW.md 模板渲染结果，包含 Issue 全部信息。模板通过 Mustache 注入以下变量：

```
{{issue_number}}     - Issue 编号
{{issue_title}}      - Issue 标题
{{issue_body}}       - Issue 正文（Markdown）
{{issue_url}}        - Issue 的 Web URL
{{issue_labels}}     - Issue 当前标签（逗号分隔）
{{issue_assignees}}  - Issue 指派人（逗号分隔）
{{repo_owner}}       - 仓库 owner
{{repo_name}}        - 仓库名称
```

**续接轮次（简短提示词）：**

```
This is continuation turn {{current_turn}} of {{max_outer_turns}}.
The previous turn ended but the task is not yet complete
(the in-progress label is still present on the issue).

Continue from the current working directory state. Do NOT restart from scratch.
When the task is complete, remove the in-progress label using:
  gh issue edit {{issue_number}} --remove-label "{{in_progress_label}}"
```

---

## 十二、可观测性（logger.ts）

### 12.1 结构化日志

所有日志以 JSON 格式输出（pino），便于 `jq` 查询和日志聚合：

```jsonc
// 调和循环
{"level":"info","module":"reconciler","msg":"scan complete","ready":2,"in_progress":1,"new_tasks":1}

// 任务执行
{"level":"info","module":"runner","issue":42,"msg":"task started","turn":1}
{"level":"info","module":"runner","issue":42,"msg":"claude output","type":"assistant","tokens":{"input":1200,"output":350}}
{"level":"info","module":"runner","issue":42,"msg":"task completed","turns":2,"duration_s":340,"total_tokens":{"input":8500,"output":2100}}

// 异常
{"level":"error","module":"runner","issue":42,"msg":"task timeout","elapsed_m":30,"turns":3}
{"level":"error","module":"runner","issue":42,"msg":"process crashed","exit_code":1,"signal":null}
```

### 12.2 关键指标

Runner 在内存中维护简单的计数器，每次任务结束时记录到日志：

- 任务总数（成功/失败/超时）
- 平均执行时间
- 平均 token 用量
- 平均外层轮次数

对于本地工具，结构化日志 + `jq` 已经足够，不引入重型监控方案。

---

## 十三、目录结构

```
your-repo/
  WORKFLOW.md               # 配置 + 提示词模板，纳入版本控制

silent-dev/
  src/
    config.ts               # 读取解析 WORKFLOW.md
    github.ts               # Octokit 封装
    reconciler.ts           # 调和循环
    dispatcher.ts           # 串行队列调度 + 超时保护
    runner.ts               # Claude 进程管理、多轮执行
    prompt.ts               # 提示词渲染
    logger.ts               # pino 日志初始化
    index.ts                # 入口，启动服务
  package.json
  tsconfig.json
  .env                      # GITHUB_TOKEN，不提交
  .env.example              # 配置模板，提交到仓库
```

---

## 十四、完整执行流程

```
启动
  │
  ▼
读取 WORKFLOW.md（zod 校验，失败则退出）
  │
  ▼
初始化 Octokit（GITHUB_TOKEN）
  │
  ▼
初始化 pino logger
  │
  ▼
注册 SIGTERM/SIGINT 处理器（优雅关闭）
  │
  ▼
启动 Reconciler 调和循环
  │
  ▼
═══════════════ 调和循环（每 N 秒） ═══════════════

查询 GitHub：ready + in-progress Issue
  │
  ▼
发现新任务？
  ├─ 否 → 等待下一轮
  └─ 是 → 交给 Dispatcher
         │
         ▼
       Dispatcher 空闲？
         ├─ 否 → 加入 pending 队列
         └─ 是 → 立即执行
                  │
═══════════════ 任务执行 ═══════════════
                  │
                  ▼
         Octokit 认领 Issue
         （移除 ready，添加 in-progress）
                  │
                  ▼
         渲染提示词
                  │
                  ▼
         spawn Claude（stream-json）
         启动超时定时器 + 心跳检测
                  │
                  ▼
         实时解析输出流
                  │
                  ▼
         Claude 进程结束
                  │
                  ▼
         查询 Issue 标签
           │
           ├─ in-progress 消失 → 成功
           │     添加完成评论
           │
           ├─ in-progress 存在 且 轮次未满 且 未超时
           │     --continue 续接 → 回到 spawn Claude
           │
           └─ 轮次耗尽 / 超时 / 崩溃 → 失败
                 标记 failed，添加失败评论

═══════════════ 异常处理 ═══════════════

心跳超时（5min 无输出）
  → SIGTERM → 5s → SIGKILL → 标记 failed

任务超时（task_timeout_minutes）
  → SIGTERM → 5s → SIGKILL → 标记 failed

进程崩溃（非零退出码）
  → 标记 failed

所有异常路径最终：
  → 清除定时器
  → current = null
  → 检查 pending → 有则执行下一个

═══════════════ 优雅关闭 ═══════════════

收到 SIGTERM/SIGINT
  → 停止 Reconciler
  → 等待当前任务结束（最长 60s）
  → 超时则终止 Claude 进程（Issue 保留 in-progress，下次自动恢复）
  → 退出
```
