import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";
import { completeJob, leaseNextJob } from "@applyflow/queue";
import { getDb } from "@applyflow/db";
import { discoverLinkedInJobs, ensureLinkedInSession } from "@applyflow/linkedin-automation";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "worker boot");

const leaseOwner = process.env.WORKER_ID ?? `worker-${process.pid}`;
const pollMs = Number.parseInt(process.env.WORKER_POLL_MS ?? "1000", 10);
const leaseMs = Number.parseInt(process.env.WORKER_LEASE_MS ?? "30000", 10);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

for (;;) {
  const leased = await leaseNextJob({ leaseOwner, leaseMs });
  if (leased.kind === "none") {
    await sleep(pollMs);
    continue;
  }

  const jobId = leased.jobId;
  logger.info({ jobId, leaseOwner }, "job leased");

  try {
    const db = getDb();
    const job = await db.queueJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error(`queue job not found: ${jobId}`);

    if (job.type === "LINKEDIN_SESSION_BOOTSTRAP") {
      const accountId = job.accountId ?? (job.payload as any)?.accountId;
      if (!accountId || typeof accountId !== "string") {
        throw new Error("LINKEDIN_SESSION_BOOTSTRAP requires accountId");
      }

      const headful = process.env.HEADFUL === "1";
      const result = await ensureLinkedInSession({ accountId, headful });
      logger.info({ jobId, accountId, result }, "linkedin session check");

      if (result.kind !== "ok") {
        if (!headful) {
          throw new Error(`session not ready (${result.kind}); rerun with HEADFUL=1 to login`);
        }
        if (result.kind === "checkpoint") {
          throw new Error("linkedin checkpoint unresolved");
        }
        throw new Error("linkedin login not completed");
      }
    } else if (job.type === "DISCOVER_LINKEDIN_JOBS") {
      const accountId = job.accountId ?? (job.payload as any)?.accountId;
      if (!accountId || typeof accountId !== "string") {
        throw new Error("DISCOVER_LINKEDIN_JOBS requires accountId");
      }

      const keywords = (job.payload as any)?.keywords;
      const location = (job.payload as any)?.location;
      const maxCardsRaw = (job.payload as any)?.maxCards;

      if (!keywords || typeof keywords !== "string") {
        throw new Error("DISCOVER_LINKEDIN_JOBS requires payload.keywords");
      }

      const maxCards =
        typeof maxCardsRaw === "number" && Number.isFinite(maxCardsRaw)
          ? Math.floor(maxCardsRaw)
          : 25;

      const headful = process.env.HEADFUL === "1";
      const discoverParams: Parameters<typeof discoverLinkedInJobs>[0] = {
        accountId,
        headful,
        keywords,
        maxCards,
      };
      if (typeof location === "string" && location.length > 0) {
        discoverParams.location = location;
      }

      const cards = await discoverLinkedInJobs(discoverParams);

      logger.info({ jobId, accountId, count: cards.length }, "discovered linkedin job cards");

      for (const card of cards) {
        await db.jobPosting.upsert({
          where: {
            accountId_linkedInJobId: { accountId, linkedInJobId: card.linkedInJobId },
          },
          update: {
            url: card.url,
            lastSeenAt: new Date(),
          },
          create: {
            accountId,
            linkedInJobId: card.linkedInJobId,
            url: card.url,
            easyApply: false,
          },
        });
      }
    } else {
      // Other job types will be implemented in later PRs.
      logger.info({ jobId, type: job.type }, "no handler yet; completing");
    }

    await completeJob({ jobId, leaseOwner, ok: true });
    logger.info({ jobId }, "job succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ jobId, err: message }, "job failed");
    await completeJob({ jobId, leaseOwner, ok: false, error: message });
  }
}
