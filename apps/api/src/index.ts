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

if (process.env.RUN_DISCOVER_DEMO === "1") {
  const jobId = await enqueueJob({
    type: "DISCOVER_LINKEDIN_JOBS",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId: process.env.LINKEDIN_ACCOUNT_ID,
    payload: {
      keywords: process.env.LINKEDIN_KEYWORDS ?? "software engineer",
      location: process.env.LINKEDIN_LOCATION,
      maxCards: process.env.LINKEDIN_MAX_CARDS
        ? Number.parseInt(process.env.LINKEDIN_MAX_CARDS, 10)
        : 25,
    },
  });
  logger.info({ jobId }, "enqueued discover demo job");
}

if (process.env.RUN_SYNC_DEMO === "1") {
  const jobId = await enqueueJob({
    type: "SYNC_JOB_DETAILS",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId: process.env.LINKEDIN_ACCOUNT_ID,
    payload: {
      maxJobs: process.env.LINKEDIN_SYNC_MAX_JOBS
        ? Number.parseInt(process.env.LINKEDIN_SYNC_MAX_JOBS, 10)
        : 10,
    },
  });
  logger.info({ jobId }, "enqueued sync details demo job");
}

if (process.env.RUN_EASY_APPLY_DEMO === "1") {
  const jobId = await enqueueJob({
    type: "EASY_APPLY_ATTEMPT",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId: process.env.LINKEDIN_ACCOUNT_ID,
    payload: {
      jobPostingId: process.env.JOB_POSTING_ID,
      maxSteps: process.env.EASY_APPLY_MAX_STEPS
        ? Number.parseInt(process.env.EASY_APPLY_MAX_STEPS, 10)
        : 20,
    },
  });
  logger.info({ jobId }, "enqueued easy apply dry-run job");
}

process.stdin.resume();
