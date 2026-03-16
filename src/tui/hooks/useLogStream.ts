import { useState, useEffect, useCallback } from "react";
import type { LogBuffer, LogEntry } from "../log-buffer.js";
import type { LogFilter } from "../types.js";

export function useLogStream(logBuf: LogBuffer) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logScroll, setLogScroll] = useState(0);
  const [filter, setFilter] = useState<LogFilter>({});
  const [filterInput, setFilterInput] = useState<string | null>(null);

  useEffect(() => logBuf.subscribe(() => {
    setLogs(logBuf.getAll());
    // Auto-scroll to bottom when not manually scrolled
    setLogScroll(prev => prev === 0 ? 0 : prev);
  }), [logBuf]);

  const scrollUp = useCallback(() => {
    setLogScroll(v => {
      const max = Math.max(0, logs.length - 4);
      return Math.min(v + 1, max);
    });
  }, [logs.length]);

  const scrollDown = useCallback(() => {
    setLogScroll(v => Math.max(0, v - 1));
  }, []);

  const scrollToBottom = useCallback(() => {
    setLogScroll(0);
  }, []);

  const startFilter = useCallback(() => {
    setFilterInput("");
  }, []);

  const cancelFilter = useCallback(() => {
    setFilterInput(null);
  }, []);

  const clearFilter = useCallback(() => {
    setFilter({});
    setFilterInput(null);
  }, []);

  const applyFilterInput = useCallback(() => {
    if (filterInput === null) return;
    const input = filterInput.trim();
    if (!input) {
      setFilter({});
    } else {
      // Parse filter: "level:WRN" or "mod:runner" or just a keyword
      const newFilter: LogFilter = {};
      for (const part of input.split(/\s+/)) {
        if (part.startsWith("level:") || part.startsWith("l:")) {
          const lvl = part.split(":")[1]?.toUpperCase();
          const map: Record<string, number> = { TRC: 10, DBG: 20, INF: 30, WRN: 40, ERR: 50, FTL: 60 };
          if (lvl && map[lvl]) newFilter.level = map[lvl];
        } else if (part.startsWith("mod:") || part.startsWith("m:")) {
          newFilter.module = part.split(":")[1];
        } else {
          newFilter.keyword = part;
        }
      }
      setFilter(newFilter);
    }
    setFilterInput(null);
    setLogScroll(0);
  }, [filterInput]);

  const setQuickLevel = useCallback((level: number) => {
    setFilter(prev => prev.level === level ? {} : { ...prev, level });
    setLogScroll(0);
  }, []);

  const appendFilterChar = useCallback((ch: string) => {
    if (filterInput !== null) {
      setFilterInput(prev => (prev ?? "") + ch);
    }
  }, [filterInput]);

  const backspaceFilter = useCallback(() => {
    if (filterInput !== null) {
      setFilterInput(prev => (prev ?? "").slice(0, -1));
    }
  }, [filterInput]);

  return {
    logs,
    logScroll,
    filter,
    filterInput,
    scrollUp,
    scrollDown,
    scrollToBottom,
    startFilter,
    cancelFilter,
    clearFilter,
    applyFilterInput,
    setQuickLevel,
    appendFilterChar,
    backspaceFilter,
  };
}
