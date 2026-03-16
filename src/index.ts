#!/usr/bin/env node
import { loadEnv, resolveWorkflowPath } from "./resolve.js";

loadEnv();

import { loadConfig } from "./config.js";
import { ClaudeExecutor } from "./claude-executor.js";
import { Dispatcher } from "./dispatcher.js";
import { GitHubClient } from "./github.js";
import { createLogger, createModuleLogger } from "./logger.js";
import { Reconciler } from "./reconciler.js";
import { Runner } from "./runner.js";

async function main() {
  const workflowPath = resolveWorkflowPath(process.argv[2]);
  const { config, template } = loadConfig(workflowPath);

  const logger = createLogger(config.log_level);
  const log = createModuleLogger(logger, "index");

  log.info(
    {
      workflow_path: workflowPath,
      config,
      template_preview: template.slice(0, 200)
    },
    "workflow loaded"
  );

  const github = new GitHubClient({
    repoOwner: config.repo_owner,
    repoName: config.repo_name,
    assignee: config.assignee
  });

  const executor = new ClaudeExecutor({
    model: config.model,
    claudeCommand: config.claude_command !== "claude"
      ? config.claude_command
      : undefined
  });

  const runner = new Runner({
    config,
    template,
    githubClient: github,
    executor,
    logger
  });

  const dispatcher = new Dispatcher({
    logger,
    runTask: (issue) => runner.runTask(issue),
    terminateCurrentProcess: () => runner.terminateCurrentProcess(),
    getRunningTokens: () => runner.getRunningTokens()
  });

  const reconciler = new Reconciler({
    config,
    githubClient: github,
    dispatcher,
    logger
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info({ signal }, "shutdown requested");

    try {
      await reconciler.stop();
      await dispatcher.shutdown();
      log.info("shutdown complete");
    } catch (error) {
      log.error({ err: error }, "shutdown failed");
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT").finally(() => {
      process.exit(0);
    });
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => {
      process.exit(0);
    });
  });

  reconciler.start();
  log.info({ executor: executor.name }, "issue-pilot started");
}

try {
  await main();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
