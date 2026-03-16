import pino from "pino";
import type { DestinationStream } from "pino";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export function createLogger(
  logLevel: LogLevel = "info",
  destination?: DestinationStream
) {
  const opts: pino.LoggerOptions = {
    level: logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return destination ? pino(opts, destination) : pino(opts);
}

export function createModuleLogger(
  logger: ReturnType<typeof createLogger>,
  moduleName: string
) {
  return logger.child({ module: moduleName });
}
