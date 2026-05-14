import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";
import { enqueueJob } from "@applyflow/queue";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "api boot");

if (process.env.RUN_ENQUEUE_DEMO === "1") {
  const jobId = await enqueueJob({
    type: "DISCOVER_LINKEDIN_JOBS",
    runId: `run-${Date.now()}`,
    priority: 0,
  });
  logger.info({ jobId }, "enqueued demo job");
}

process.stdin.resume();
