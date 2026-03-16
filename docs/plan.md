# Issue-Pilot 开发计划

---

## 开发策略

**自底向上，逐层集成。** 先搭建项目骨架和无依赖的基础模块，再按数据流方向逐步组装：Config → GitHub Client → Prompt → Runner → Dispatcher → Reconciler → Index。每个阶段结束时都有可独立验证的产物。

**总计 7 个阶段，8 个源文件。**

---

## Phase 0：项目骨架

**目标：** 项目可运行 `tsx src/index.ts` 输出 hello world，依赖安装完成。

**任务：**

- [ ] 0.1 初始化项目
  - `npm init`，设置 `name`、`version`、`type: "module"`
  - 创建 `tsconfig.json`（target: ES2022, module: Node16, strict: true）
  - 创建 `.gitignore`（node_modules, .env, dist）
  - 创建 `.env.example`（GITHUB_TOKEN=）

- [ ] 0.2 安装依赖
  - 生产依赖：`@octokit/rest`, `gray-matter`, `zod`, `mustache`, `pino`, `dotenv`
  - 开发依赖：`tsx`, `typescript`, `@types/mustache`, `@types/node`

- [ ] 0.3 配置 npm scripts
  - `start`: `tsx src/index.ts`
  - `dev`: `tsx watch src/index.ts`

- [ ] 0.4 创建 `src/index.ts` 占位入口，确认 `npm start` 可运行

**验证：** `npm start` 正常运行并退出。

---

## Phase 1：Logger + Config

**目标：** 能从 WORKFLOW.md 读取配置并通过 zod 校验，日志结构化输出。

**任务：**

- [ ] 1.1 实现 `src/logger.ts`
  - 初始化 pino 实例，支持 `log_level` 配置
  - 导出创建子 logger 的工厂函数（带 module 字段）

- [ ] 1.2 定义配置 Schema（`src/config.ts`）
  - 用 zod 定义完整配置类型（所有 WORKFLOW.md 参数）
  - 设置默认值：poll_interval=30, ready_label="pilot:ready" 等
  - 导出 `Config` 类型

- [ ] 1.3 实现配置读取（`src/config.ts`）
  - 接收 WORKFLOW.md 文件路径参数
  - 用 `gray-matter` 解析 YAML front matter
  - 用 zod schema `.parse()` 校验，失败则抛出详细错误信息
  - 分离返回：config 对象 + 提示词模板字符串

- [ ] 1.4 创建测试用 WORKFLOW.md
  - 写入完整的 front matter 配置样例
  - 写入简单的提示词模板（包含 Mustache 变量）

**验证：** 在 `index.ts` 中调用 `loadConfig()`，打印解析结果。故意写错配置值，确认 zod 报错信息清晰。

---

## Phase 2：GitHub Client

**目标：** 能通过 Octokit 查询 Issue、操作标签、添加评论。

**任务：**

- [ ] 2.1 实现 `src/github.ts` — Octokit 初始化
  - 从 `GITHUB_TOKEN` 环境变量创建 Octokit 实例
  - Token 缺失时抛出明确错误

- [ ] 2.2 实现 Issue 查询函数
  - `listIssuesByLabel(label: string)`: 查询指定标签的 open Issue 列表
  - `getIssue(number: number)`: 获取单个 Issue 详情（title, body, labels, assignees, url）

- [ ] 2.3 实现标签操作函数
  - `claimIssue(number, readyLabel, inProgressLabel)`: 检查 ready 标签是否存在 → 移除 ready → 添加 in-progress，返回是否认领成功
  - `failIssue(number, inProgressLabel, failedLabel)`: 移除 in-progress → 添加 failed
  - `hasLabel(number, label)`: 检查 Issue 是否有指定标签

- [ ] 2.4 实现评论函数
  - `addComment(number, body)`: 添加评论

- [ ] 2.5 导出统一的 `GitHubClient` 类或对象
  - 构造时接收 config（repo_owner, repo_name）
  - 所有方法内部使用同一个 Octokit 实例

**验证：** 在 `index.ts` 中用真实 Token 调用 `listIssuesByLabel`，确认能拿到数据。手动在测试仓库创建带标签的 Issue 验证。

---

## Phase 3：Prompt 渲染

**目标：** 能将 WORKFLOW.md 模板 + Issue 数据渲染为最终提示词。

**任务：**

- [ ] 3.1 实现 `src/prompt.ts`
  - `renderFirstTurn(template, issueData)`: 用 Mustache 渲染完整提示词
  - `renderContinuation(issueNumber, currentTurn, maxTurns, inProgressLabel)`: 渲染续接提示词（硬编码模板）

- [ ] 3.2 定义 `IssueData` 接口
  - `issue_number`, `issue_title`, `issue_body`, `issue_url`, `issue_labels`, `issue_assignees`, `repo_owner`, `repo_name`

- [ ] 3.3 实现从 Octokit Issue 响应到 `IssueData` 的转换函数

**验证：** 用测试数据调用 `renderFirstTurn`，打印渲染结果确认变量替换正确。

---

## Phase 4：Agent Runner

**目标：** 能 spawn Claude CLI 进程，解析 stream-json 输出，支持多轮续接。这是核心模块。

**任务：**

- [ ] 4.1 实现 Claude 进程 spawn（`src/runner.ts`）
  - 封装 `spawnClaude(prompt, options)`: 构建 `claude -p <prompt> --output-format stream-json --max-turns <N>` 命令
  - `cwd` 设为 `working_dir`
  - 返回 ChildProcess 引用

- [ ] 4.2 实现 NDJSON 输出流解析
  - 逐行读取 stdout
  - 按 `type` 和 `subtype` 分类处理
  - 记录 session_id（从 init 消息）
  - 累计 token 用量（从 result 消息）
  - 每条消息更新活跃时间戳
  - 返回 Promise，resolve 时携带执行结果摘要

- [ ] 4.3 实现多轮执行逻辑
  - `runTask(issue, config, template, githubClient)`: 完整的任务执行流程
  - 步骤：认领 → 渲染提示词 → spawn → 解析输出 → 检查标签 → 决定续接或结束
  - 续接时使用 `claude --continue --output-format stream-json --max-turns <N>`
  - 循环直到：标签消失（成功）/ 轮次耗尽 / 超时 / 崩溃

- [ ] 4.4 实现结束处理
  - 成功：添加完成评论（包含 token 用量、轮次数、耗时）
  - 失败：标记 failed 标签，添加失败评论（区分原因）
  - 清理：清除所有定时器

- [ ] 4.5 实现超时和心跳保护
  - 任务级超时定时器（task_timeout_minutes）
  - 心跳检测定时器（heartbeat_timeout_minutes）
  - SIGTERM → 5s → SIGKILL 终止序列
  - 幂等 cleanup 函数（多次调用不出错）

**验证：** 在 `index.ts` 中硬编码一个 Issue number，调用 `runTask` 执行完整流程。在测试仓库验证：标签变化、评论添加、Claude 实际执行任务。

---

## Phase 5：Dispatcher

**目标：** 串行调度器，管理任务队列和并发控制。

**任务：**

- [ ] 5.1 实现 `src/dispatcher.ts` — 核心调度逻辑
  - 维护 `current` 和 `pending` 状态
  - `submit(issue)`: Reconciler 提交新任务的入口
  - `isKnown(issueNumber)`: 检查 Issue 是否已在队列或执行中
  - 去重逻辑：按 Issue number

- [ ] 5.2 实现任务执行链
  - submit 时：空闲则立即执行，忙碌则入队
  - 任务完成时：自动取出队首执行下一个
  - Runner 的 `runTask` 作为执行函数注入

- [ ] 5.3 实现优雅关闭接口
  - `shutdown()`: 停止接受新任务，等待当前任务完成（最长 60s），超时则终止 Claude 进程
  - 返回 Promise，shutdown 完成后 resolve

**验证：** 模拟连续提交 3 个 Issue，确认串行执行顺序正确、去重逻辑生效。

---

## Phase 6：Reconciler + 入口集成

**目标：** 系统完整运行——调和循环发现任务，Dispatcher 调度，Runner 执行。

**任务：**

- [ ] 6.1 实现 `src/reconciler.ts` — 调和循环
  - `start()`: 启动定时循环
  - `stop()`: 停止循环
  - 每轮逻辑：查询 ready + in-progress Issue → 与 Dispatcher 对比 → 提交新任务
  - 自适应间隔：默认 30s / 执行中 60s / 刚完成 10s

- [ ] 6.2 完成 `src/index.ts` — 入口集成
  - 加载 .env（dotenv）
  - 读取 WORKFLOW.md 配置
  - 初始化 logger、GitHubClient、Dispatcher、Reconciler
  - 注册 SIGTERM/SIGINT → 调用 Reconciler.stop() + Dispatcher.shutdown()
  - 启动 Reconciler

- [ ] 6.3 端到端测试
  - 启动服务
  - 在测试仓库创建 Issue，打上 `pilot:ready` 标签
  - 观察：Reconciler 发现 → Dispatcher 调度 → Runner 认领 → Claude 执行 → 完成/失败
  - 验证标签流转和评论记录

- [ ] 6.4 异常场景验证
  - 进程运行中 Ctrl+C，验证优雅关闭
  - 重启后验证 in-progress Issue 自动恢复
  - 设置极短超时（1 分钟），验证超时保护触发

**验证：** 完整的端到端流程在真实 GitHub 仓库上跑通。

---

## 阶段依赖关系

```
Phase 0（骨架）
  │
  ▼
Phase 1（Logger + Config）
  │
  ├──────────────┐
  ▼              ▼
Phase 2        Phase 3
(GitHub)       (Prompt)
  │              │
  └──────┬───────┘
         ▼
       Phase 4（Runner）
         │
         ▼
       Phase 5（Dispatcher）
         │
         ▼
       Phase 6（Reconciler + 集成）
```

Phase 2 和 Phase 3 无互相依赖，可并行开发。其余阶段串行。

---

## 交付物清单

| 文件 | Phase | 职责 |
|------|-------|------|
| `package.json` | 0 | 项目配置和依赖 |
| `tsconfig.json` | 0 | TypeScript 编译配置 |
| `.env.example` | 0 | 环境变量模板 |
| `src/logger.ts` | 1 | 结构化日志 |
| `src/config.ts` | 1 | 配置读取和校验 |
| `src/github.ts` | 2 | GitHub API 封装 |
| `src/prompt.ts` | 3 | 提示词渲染 |
| `src/runner.ts` | 4 | Claude 进程管理 |
| `src/dispatcher.ts` | 5 | 串行队列调度 |
| `src/reconciler.ts` | 6 | 调和循环 |
| `src/index.ts` | 6 | 入口，模块集成 |
