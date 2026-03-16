import { useState, useEffect, useCallback, useRef } from "react";
import { loadConfig } from "../../config.js";
import { ClaudeExecutor } from "../../claude-executor.js";
import { Dispatcher } from "../../dispatcher.js";
import { GitHubClient } from "../../github.js";
import { createLogger } from "../../logger.js";
import { Reconciler } from "../../reconciler.js";
import { Runner } from "../../runner.js";
import { HistoryStore } from "../../history.js";
import type { HistoryEntry, HistoryStats } from "../../history.js";
import type { GitHubIssue } from "../../github.js";
import type { RunTaskResult, TokenUsage } from "../../runner.js";
import { LogBuffer } from "../log-buffer.js";
import { Writable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOG_DIR = path.join(os.homedir(), ".issue-pilot");
const LOG_FILE = path.join(LOG_DIR, "daemon.log");
const RECENT_COUNT = 50;

interface SvcRefs {
  reconciler: Reconciler | null;
  dispatcher: Dispatcher | null;
  runner: Runner | null;
  executor: ClaudeExecutor | null;
}

function createDest(buf: LogBuffer): Writable {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = fs.createWriteStream(LOG_FILE, { flags: "a" });
  return new Writable({
    write(chunk: Buffer, _e, cb) { buf.push(chunk.toString()); file.write(chunk, cb); },
    final(cb) { file.end(cb); },
  });
}

export const MODELS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

export function useService(workflowPath: string) {
  const logBuf = useRef(new LogBuffer(200));
  const histRef = useRef(new HistoryStore());
  const svc = useRef<SvcRefs>({ reconciler: null, dispatcher: null, runner: null, executor: null });

  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stats, setStats] = useState<HistoryStats>(histRef.current.getStats());
  const [recent, setRecent] = useState<HistoryEntry[]>(histRef.current.getRecent(RECENT_COUNT));
  const [curTask, setCurTask] = useState<{ issue: GitHubIssue; startedAt: Date } | null>(null);
  const [pending, setPending] = useState<GitHubIssue[]>([]);
  const [liveTokens, setLiveTokens] = useState<TokenUsage | null>(null);
  const [cfgErr, setCfgErr] = useState<string | null>(null);
  const [modelIdx, setModelIdx] = useState(() => {
    try { const { config } = loadConfig(workflowPath); const i = MODELS.indexOf(config.model); return i >= 0 ? i : 0; }
    catch { return 0; }
  });

  const activeModel = MODELS[modelIdx]!;

  // Poll dispatcher state
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const d = svc.current.dispatcher;
      if (d) {
        setCurTask(d.getCurrentTask());
        setPending(d.getPendingIssues());
        setLiveTokens(d.getRunningTokens());
      }
    }, 500);
    return () => clearInterval(id);
  }, [running]);

  const startService = useCallback(() => {
    try {
      const { config, template } = loadConfig(workflowPath);
      const dest = createDest(logBuf.current);
      const logger = createLogger(config.log_level, dest);
      const github = new GitHubClient({ repoOwner: config.repo_owner, repoName: config.repo_name, assignee: config.assignee });
      const executor = new ClaudeExecutor({ model: activeModel, claudeCommand: config.claude_command !== "claude" ? config.claude_command : undefined });
      const runner = new Runner({ config, template, githubClient: github, executor, logger });
      const hist = histRef.current;
      const wrappedRun = async (issue: GitHubIssue): Promise<RunTaskResult> => {
        const result = await runner.runTask(issue);
        if (result.status !== "skipped") {
          hist.append({ issue: result.issueNumber, title: issue.title, status: result.status, durationMs: result.durationMs, tokensIn: result.totalTokens.input, tokensOut: result.totalTokens.output, at: new Date().toISOString() });
          setStats(hist.getStats());
          setRecent(hist.getRecent(RECENT_COUNT));
        }
        return result;
      };
      const dispatcher = new Dispatcher({ logger, runTask: wrappedRun, terminateCurrentProcess: () => runner.terminateCurrentProcess(), getRunningTokens: () => runner.getRunningTokens() });
      const reconciler = new Reconciler({ config, githubClient: github, dispatcher, logger });
      svc.current = { reconciler, dispatcher, runner, executor };
      reconciler.start();
      setRunning(true);
      setStartedAt(Date.now());
      setCfgErr(null);
    } catch (e) { setCfgErr((e as Error).message); }
  }, [workflowPath, activeModel]);

  const stopService = useCallback(async () => {
    setRunning(false); setStartedAt(null); setCurTask(null); setPending([]); setLiveTokens(null);
    const { reconciler, dispatcher, runner } = svc.current;
    if (reconciler) await reconciler.stop();
    if (runner) await runner.terminateCurrentProcess();
    if (dispatcher) await dispatcher.shutdown();
    svc.current = { reconciler: null, dispatcher: null, runner: null, executor: null };
  }, []);

  const cycleModel = useCallback(() => {
    setModelIdx(p => {
      const n = (p + 1) % MODELS.length;
      const exec = svc.current.executor;
      if (exec) exec.setModel(MODELS[n]!);
      return n;
    });
  }, []);

  // Auto-start on mount
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; startService(); } }, [startService]);

  return {
    logBuf: logBuf.current,
    running,
    startedAt,
    stats,
    recent,
    curTask,
    pending,
    liveTokens,
    cfgErr,
    modelIdx,
    activeModel,
    startService,
    stopService,
    cycleModel,
  };
}
