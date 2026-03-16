import React, { useState, useEffect } from "react";
import { Box, useInput, useApp } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { themes, loadThemeIndex, saveThemeIndex } from "./theme.js";
import { loadConfig } from "../config.js";
import { fmtDur, BOX } from "./text-utils.js";
import { useService } from "./hooks/useService.js";
import { useLogStream } from "./hooks/useLogStream.js";

import { HLine, Blank } from "./components/Row.js";
import { Header } from "./components/Header.js";
import { ActiveTask } from "./components/ActiveTask.js";
import { Scoreboard } from "./components/Scoreboard.js";
import { StatsStrip } from "./components/StatsStrip.js";
import { LogStrip } from "./components/LogStrip.js";
import { StatusBar } from "./components/StatusBar.js";
import { HelpOverlay } from "./components/HelpOverlay.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";

// ---- Layout row budget ----
// Header:     3 (top border + content + separator)
// ActiveTask: 2 (content + separator)
// Table:      2 (header + divider) + FLEX entries
// StatsStrip: 2 (separator + content)
// LogStrip:   1 (separator) + LOG_LINES (entries)
// Footer:     2 (bottom border + keybindings)
const HEADER_ROWS = 3;
const ACTIVE_ROWS = 2;
const TABLE_CHROME = 2; // header + divider
const STATS_ROWS = 2;
const LOG_SEPARATOR = 1;
const FOOTER_ROWS = 2;
const MIN_TABLE_ENTRIES = 3;
const MIN_LOG_LINES = 1;
const MAX_LOG_LINES = 3;

export default function App({ workflowPath }: { workflowPath: string }) {
  const { exit } = useApp();
  const { width: termW, height: termH } = useScreenSize();
  const COLS = Math.max(80, termW);

  // ---- Adaptive log lines: 1-3 based on terminal height ----
  const totalFixed = HEADER_ROWS + ACTIVE_ROWS + TABLE_CHROME + STATS_ROWS + LOG_SEPARATOR + FOOTER_ROWS;
  // totalFixed = 3 + 2 + 2 + 2 + 1 + 2 = 12
  const flexBudget = Math.max(MIN_TABLE_ENTRIES + MIN_LOG_LINES, termH - totalFixed);
  const LOG_LINES = Math.min(MAX_LOG_LINES, Math.max(MIN_LOG_LINES, flexBudget - MIN_TABLE_ENTRIES));
  const TABLE_ENTRIES = Math.max(MIN_TABLE_ENTRIES, flexBudget - LOG_LINES);
  const TABLE_ROWS = TABLE_CHROME + TABLE_ENTRIES;

  // ---- Theme ----
  const [themeIdx, setThemeIdx] = useState(loadThemeIndex);
  const t = themes[themeIdx]!;

  // ---- Service ----
  const svc = useService(workflowPath);

  // ---- Logs ----
  const logStream = useLogStream(svc.logBuf);

  // ---- UI state ----
  const [spin, setSpin] = useState(0);
  const [tick, setTick] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);

  // OSC 11: sync terminal default bg
  useEffect(() => {
    const h = t.bg.replace("#", "");
    process.stdout.write(`\x1b]11;rgb:${h.slice(0, 2)}/${h.slice(2, 4)}/${h.slice(4, 6)}\x07`);
  }, [t.bg]);

  // 1s tick for spinner + time display
  useEffect(() => {
    const id = setInterval(() => { setTick(v => v + 1); setSpin(f => (f + 1) % 10); }, 1000);
    return () => clearInterval(id);
  }, []);

  // ---- Key bindings ----
  useInput((ch, key) => {
    if (showHelp) { setShowHelp(false); return; }

    if (confirmQuit) {
      if (ch === "y" || ch === "Y") { void svc.stopService().finally(() => exit()); }
      setConfirmQuit(false);
      return;
    }

    if (logStream.filterInput !== null) {
      if (key.escape) { logStream.cancelFilter(); return; }
      if (key.return) { logStream.applyFilterInput(); return; }
      if (key.backspace || key.delete) { logStream.backspaceFilter(); return; }
      if (ch && !key.ctrl && !key.meta) { logStream.appendFilterChar(ch); return; }
      return;
    }

    if (ch === "q") {
      if (svc.running && svc.curTask) { setConfirmQuit(true); return; }
      void svc.stopService().finally(() => exit());
      return;
    }
    if (ch === "s") { svc.running ? void svc.stopService() : svc.startService(); return; }
    if (ch === "t") { setThemeIdx(p => { const n = (p + 1) % themes.length; saveThemeIndex(n); return n; }); return; }
    if (ch === "m") { svc.cycleModel(); return; }
    if (ch === "/") { logStream.startFilter(); return; }
    if (ch === "?") { setShowHelp(true); return; }
    if (ch === "1") { logStream.setQuickLevel(20); return; }
    if (ch === "2") { logStream.setQuickLevel(30); return; }
    if (ch === "3") { logStream.setQuickLevel(40); return; }
    if (ch === "4") { logStream.setQuickLevel(50); return; }
    if (key.escape) { logStream.clearFilter(); return; }
    if (key.upArrow) logStream.scrollUp();
    if (key.downArrow) logStream.scrollDown();
  });

  // ---- Computed ----
  void tick;
  const uptime = svc.startedAt ? fmtDur(Date.now() - svc.startedAt) : "--";
  let timeoutMs = 30 * 60 * 1000;
  let repo = workflowPath, timeoutStr = "30m";
  try {
    const { config } = loadConfig(workflowPath);
    timeoutMs = config.task_timeout_minutes * 60 * 1000;
    repo = `${config.repo_owner}/${config.repo_name}`;
    timeoutStr = `${config.task_timeout_minutes}m`;
  } catch { /* defaults */ }

  const modelShort = svc.activeModel.replace("claude-", "");

  // ---- Render ----
  return (
    <Box flexDirection="column" width={termW} height={termH}>
      <Header t={t} width={COLS} running={svc.running}
        repo={repo} uptime={uptime} spin={spin} />

      <ActiveTask t={t} width={COLS}
        task={{ curTask: svc.curTask, pending: svc.pending, liveTokens: svc.liveTokens }}
        timeoutMs={timeoutMs} spin={spin} cfgErr={svc.cfgErr} />

      <Scoreboard t={t} width={COLS} rows={TABLE_ROWS}
        recent={svc.recent} pending={svc.pending} />

      <StatsStrip t={t} width={COLS} stats={svc.stats}
        queueLen={svc.pending.length} modelShort={modelShort}
        timeoutStr={timeoutStr} />

      <LogStrip t={t} width={COLS} lines={LOG_LINES}
        logs={logStream.logs} scroll={logStream.logScroll}
        filter={logStream.filter} filterInput={logStream.filterInput} />

      <StatusBar t={t} width={COLS} running={svc.running}
        themeName={t.name} modelShort={modelShort} />

      {/* Fill any remaining vertical space */}
      {Array.from({ length: Math.max(0, termH - totalFixed - TABLE_ENTRIES - LOG_LINES) }, (_, i) => (
        <Blank key={`eb${i}`} t={t} width={COLS} />
      ))}

      {showHelp && <HelpOverlay t={t} width={COLS} height={termH} />}
      {confirmQuit && <ConfirmDialog t={t} width={COLS} height={termH}
        message=" Task running. Quit anyway?" />}
    </Box>
  );
}
