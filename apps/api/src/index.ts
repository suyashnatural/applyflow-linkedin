import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";
import { enqueueJob } from "@applyflow/queue";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "api boot");

if (process.env.RUN_ENQUEUE_DEMO === "1") {
  const jobId = await enqueueJob({
    type: "LINKEDIN_SESSION_BOOTSTRAP",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId: process.env.LINKEDIN_ACCOUNT_ID,
  });
  logger.info({ jobId }, "enqueued demo job");
}

process.stdin.resume();
