export interface LogEntry {
  time: string;
  level: number;
  module?: string;
  msg: string;
  [key: string]: unknown;
}

const LEVEL_LABELS: Record<number, string> = {
  10: "TRC",
  20: "DBG",
  30: "INF",
  40: "WRN",
  50: "ERR",
  60: "FTL",
};

export function levelLabel(level: number): string {
  return LEVEL_LABELS[level] ?? "???";
}

export class LogBuffer {
  private entries: LogEntry[] = [];
  private readonly maxSize: number;
  private listeners = new Set<() => void>();

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  push(raw: string): void {
    try {
      const entry = JSON.parse(raw) as LogEntry;
      this.entries.push(entry);
      if (this.entries.length > this.maxSize) {
        this.entries.splice(0, this.entries.length - this.maxSize);
      }
      this.notify();
    } catch {
      // ignore malformed lines
    }
  }

  getRecent(n: number): LogEntry[] {
    return this.entries.slice(-n);
  }

  getAll(): LogEntry[] {
    return this.entries;
  }

  get length(): number {
    return this.entries.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
