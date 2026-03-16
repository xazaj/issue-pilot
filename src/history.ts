import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface HistoryEntry {
  issue: number;
  title: string;
  status: "success" | "failed" | "skipped";
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  at: string;
}

export interface HistoryStats {
  totalDone: number;
  totalFail: number;
  totalRate: number;
  todayDone: number;
  todayFail: number;
  todayRate: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

const DATA_DIR = path.join(os.homedir(), ".issue-pilot");
const HISTORY_FILE = path.join(DATA_DIR, "history.jsonl");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? HISTORY_FILE;
    ensureDir();
    this.load();
  }

  private load() {
    try {
      const content = fs.readFileSync(this.filePath, "utf-8");
      this.entries = content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const entry = JSON.parse(line) as HistoryEntry;
          // Sanitize: strip control characters from title (e.g., trailing \r)
          if (entry.title) entry.title = entry.title.replace(/[\r\n]/g, "");
          return entry;
        });
    } catch {
      this.entries = [];
    }
  }

  append(entry: HistoryEntry): void {
    // Sanitize title before persisting
    const clean = { ...entry, title: (entry.title ?? "").replace(/[\r\n]/g, "") };
    this.entries.push(clean);
    fs.appendFileSync(this.filePath, JSON.stringify(clean) + "\n");
  }

  getRecent(n: number): HistoryEntry[] {
    return this.entries.slice(-n);
  }

  getStats(): HistoryStats {
    const today = new Date().toISOString().slice(0, 10);
    const todayEntries = this.entries.filter((e) => e.at.startsWith(today));

    const totalDone = this.entries.filter((e) => e.status === "success").length;
    const totalFail = this.entries.filter((e) => e.status === "failed").length;
    const todayDone = todayEntries.filter((e) => e.status === "success").length;
    const todayFail = todayEntries.filter((e) => e.status === "failed").length;

    const totalTokensIn = this.entries.reduce((s, e) => s + e.tokensIn, 0);
    const totalTokensOut = this.entries.reduce((s, e) => s + e.tokensOut, 0);

    const totalTotal = totalDone + totalFail;
    const todayTotal = todayDone + todayFail;

    return {
      totalDone,
      totalFail,
      totalRate: totalTotal > 0 ? Math.round((totalDone / totalTotal) * 100) : 0,
      todayDone,
      todayFail,
      todayRate: todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0,
      totalTokensIn,
      totalTokensOut,
    };
  }
}
