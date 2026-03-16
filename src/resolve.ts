import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";

export const GLOBAL_DIR = path.join(os.homedir(), ".issue-pilot");

/**
 * Resolve the workflow file path using a three-level lookup:
 *   1. Explicit CLI argument
 *   2. ./WORKFLOW.md in the current working directory
 *   3. ~/.issue-pilot/WORKFLOW.md as global fallback
 *
 * Returns the resolved absolute path, or exits with an error message.
 */
export function resolveWorkflowPath(cliArg?: string): string {
  if (cliArg) {
    const resolved = path.resolve(cliArg);
    if (fs.existsSync(resolved)) return resolved;
    console.error(`Workflow file not found: ${resolved}`);
    process.exit(1);
  }

  const cwd = path.resolve("WORKFLOW.md");
  if (fs.existsSync(cwd)) return cwd;

  const global = path.join(GLOBAL_DIR, "WORKFLOW.md");
  if (fs.existsSync(global)) return global;

  console.error(
    [
      "No WORKFLOW.md found. Searched:",
      `  1. ${cwd}`,
      `  2. ${global}`,
      "",
      "Create one from the example:",
      "  cp WORKFLOW.example.md WORKFLOW.md",
      "",
      "Or specify a path:",
      "  issue-pilot /path/to/WORKFLOW.md",
    ].join("\n")
  );
  process.exit(1);
}

/**
 * Load environment variables from .env files.
 * Priority: process env > cwd .env > ~/.issue-pilot/.env
 * (dotenv never overwrites existing variables)
 */
export function loadEnv(): void {
  dotenv.config();
  dotenv.config({ path: path.join(GLOBAL_DIR, ".env") });
}
