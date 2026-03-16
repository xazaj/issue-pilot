import type { Theme } from "./theme.js";

export interface Seg {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

export interface LineContent {
  segs: Seg[];
  chars: number;
}

export interface ServiceState {
  running: boolean;
  startedAt: number | null;
  cfgErr: string | null;
}

export interface TaskState {
  curTask: { issue: { number: number; title: string }; startedAt: Date } | null;
  pending: { number: number; title: string }[];
  liveTokens: { input: number; output: number } | null;
}

export interface StatsState {
  todayDone: number;
  todayFail: number;
  todayRate: number;
  totalDone: number;
  totalFail: number;
  totalRate: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

export interface RecentEntry {
  issue: number;
  title: string;
  status: "success" | "failed" | "skipped";
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  at: string;
}

export interface LogFilter {
  level?: number;
  module?: string;
  keyword?: string;
}

export { Theme };
