import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { LOG_LEVELS } from "./logger.js";

const configSchema = z
  .object({
    repo_owner: z.string().min(1, "repo_owner is required"),
    repo_name: z.string().min(1, "repo_name is required"),
    poll_interval: z
      .number()
      .int("poll_interval must be an integer")
      .positive("poll_interval must be > 0")
      .default(30),
    ready_label: z.string().min(1).default("pilot:ready"),
    in_progress_label: z.string().min(1).default("pilot:in-progress"),
    failed_label: z.string().min(1).default("pilot:failed"),
    working_dir: z
      .string()
      .min(1, "working_dir is required")
      .refine(
        (value) => path.isAbsolute(value),
        "working_dir must be an absolute path"
      ),
    max_outer_turns: z
      .number()
      .int("max_outer_turns must be an integer")
      .positive("max_outer_turns must be > 0")
      .default(5),
    claude_max_turns: z
      .number()
      .int("claude_max_turns must be an integer")
      .positive("claude_max_turns must be > 0")
      .default(50),
    model: z.string().min(1).default("claude-sonnet-4-6"),
    claude_command: z.string().min(1).default("claude"),
    task_timeout_minutes: z
      .number()
      .int("task_timeout_minutes must be an integer")
      .positive("task_timeout_minutes must be > 0")
      .default(30),
    heartbeat_timeout_minutes: z
      .number()
      .int("heartbeat_timeout_minutes must be an integer")
      .positive("heartbeat_timeout_minutes must be > 0")
      .default(5),
    assignee: z.string().default(""),
    log_level: z.enum(LOG_LEVELS).default("info")
  })
  .strict();

export type Config = z.infer<typeof configSchema>;

export interface LoadedConfig {
  config: Config;
  template: string;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${field}: ${issue.message}`;
    })
    .join("\n");
}

export function loadConfig(workflowPath: string): LoadedConfig {
  const resolvedPath = path.resolve(workflowPath);
  let fileContent: string;

  try {
    fileContent = fs.readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read WORKFLOW.md at "${resolvedPath}": ${(error as Error).message}`
    );
  }

  const parsed = matter(fileContent);
  const result = configSchema.safeParse(parsed.data);
  if (!result.success) {
    throw new Error(
      `Invalid WORKFLOW.md front matter in "${resolvedPath}":\n${formatZodError(result.error)}`
    );
  }

  return {
    config: result.data,
    template: parsed.content.trim()
  };
}
