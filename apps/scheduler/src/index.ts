import { getConfig } from "@applyflow/config";
import { getDb } from "@applyflow/db";
import { logger } from "@applyflow/observability";
import { enqueueJob } from "@applyflow/queue";
import {
  computeNextRunAt,
  DEFAULT_AUTO_APPLY_CRON,
  DEFAULT_AUTO_APPLY_TIMEZONE,
} from "@applyflow/scheduling";
import { QueueJobStatus } from "@prisma/client";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "scheduler boot");

const pollMsRaw = Number.parseInt(process.env.SCHEDULER_POLL_MS ?? "30000", 10);
const pollMs = Number.isFinite(pollMsRaw) ? Math.max(1000, pollMsRaw) : 30_000;
const batchSizeRaw = Number.parseInt(process.env.SCHEDULER_BATCH_SIZE ?? "20", 10);
const batchSize = Number.isFinite(batchSizeRaw) ? Math.max(1, batchSizeRaw) : 20;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

for (;;) {
  const db = getDb();
  const now = new Date();
  const dueSchedules = await db.autoApplySchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: batchSize,
  });

  for (const schedule of dueSchedules) {
    const triggeredAt = new Date();
    const nextRunAt = computeNextRunAt({
      cron: schedule.cron || DEFAULT_AUTO_APPLY_CRON,
      timezone: schedule.timezone || DEFAULT_AUTO_APPLY_TIMEZONE,
      from: triggeredAt,
    });

    const claimed = await db.autoApplySchedule.updateMany({
      where: {
        id: schedule.id,
        enabled: true,
        nextRunAt: schedule.nextRunAt,
      },
      data: {
        lastTriggeredAt: triggeredAt,
        nextRunAt,
      },
    });
    if (claimed.count === 0) continue;

    const account = await db.linkedInAccount.findUnique({
      where: { id: schedule.accountId },
      select: { id: true },
    });
    if (!account) {
      await db.event.create({
        data: {
          runId: `schedule-${schedule.id}-${Date.now()}`,
          type: "AUTO_APPLY_SCHEDULE_SKIPPED_MISSING_ACCOUNT",
          payload: { scheduleId: schedule.id, nextRunAt },
          accountId: schedule.accountId,
        },
      });
      continue;
    }

    const existingCycle = await db.queueJob.findFirst({
      where: {
        accountId: schedule.accountId,
        type: "RUN_AUTO_APPLY_CYCLE",
        status: { in: [QueueJobStatus.queued, QueueJobStatus.running] },
      },
      select: { id: true, status: true },
    });

    if (existingCycle) {
      await db.event.create({
        data: {
          runId: `schedule-${schedule.id}-${Date.now()}`,
          type: "AUTO_APPLY_SCHEDULE_SKIPPED_ACTIVE_CYCLE",
          payload: { scheduleId: schedule.id, nextRunAt, existingJobId: existingCycle.id },
          accountId: schedule.accountId,
        },
      });
      continue;
    }

    const jobId = await enqueueJob({
      type: "RUN_AUTO_APPLY_CYCLE",
      runId: `run-${Date.now()}`,
      priority: 0,
      accountId: schedule.accountId,
      payload: {
        accountId: schedule.accountId,
        maxAttempts: schedule.maxAttempts ?? undefined,
        minScore: schedule.minScore ?? undefined,
      },
    });

    await db.event.create({
      data: {
        runId: `schedule-${schedule.id}-${Date.now()}`,
        type: "AUTO_APPLY_SCHEDULE_TRIGGERED",
        payload: {
          scheduleId: schedule.id,
          cron: schedule.cron,
          timezone: schedule.timezone,
          maxAttempts: schedule.maxAttempts,
          minScore: schedule.minScore,
          nextRunAt,
          jobId,
        },
        accountId: schedule.accountId,
      },
    });

    logger.info(
      {
        scheduleId: schedule.id,
        accountId: schedule.accountId,
        jobId,
        nextRunAt,
      },
      "scheduled auto-apply cycle enqueued"
    );
  }

  await sleep(pollMs);
}
