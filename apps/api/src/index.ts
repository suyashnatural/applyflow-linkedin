import { getConfig } from "@applyflow/config";
import { getDb } from "@applyflow/db";
import { logger } from "@applyflow/observability";
import { enqueueJob } from "@applyflow/queue";
import Fastify from "fastify";
import cors from "@fastify/cors";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "api boot");

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get("/healthz", async () => ({ ok: true }));

app.get("/healthz/db", async (_req, reply) => {
  const db = getDb();
  try {
    // lightweight query
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(503).send({ ok: false, error: message });
  }
});

app.get("/applications", async (req) => {
  const status = (req.query as any)?.status as string | undefined;
  const db = getDb();
  const args: Parameters<typeof db.application.findMany>[0] = {
    orderBy: { createdAt: "desc" },
    take: 100,
  };
  if (status) args.where = { status };
  const applications = await db.application.findMany(args);
  return { applications };
});

app.get("/applications/:id", async (req, reply) => {
  const id = (req.params as any).id as string;
  const db = getDb();
  const application = await db.application.findUnique({
    where: { id },
    include: { jobPosting: true, steps: { orderBy: { createdAt: "asc" } } },
  });
  if (!application) return reply.code(404).send({ error: "not_found" });
  return { application };
});

app.post("/applications/:id/deny", async (req) => {
  const id = (req.params as any).id as string;
  const reason = (req.body as any)?.reason as string | undefined;
  const db = getDb();
  const application = await db.application.update({
    where: { id },
    data: { status: "canceled" },
  });
  await db.applicationStep.create({
    data: {
      applicationId: id,
      name: "HUMAN_DECISION",
      state: "denied",
      detail: { reason: reason ?? null },
    },
  });
  return { application };
});

app.post("/applications/:id/approve", async (req, reply) => {
  const id = (req.params as any).id as string;
  const db = getDb();
  const application = await db.application.findUnique({ where: { id } });
  if (!application) return reply.code(404).send({ error: "not_found" });

  await db.application.update({
    where: { id },
    data: { status: "queued" },
  });
  await db.applicationStep.create({
    data: {
      applicationId: id,
      name: "HUMAN_DECISION",
      state: "approved",
    },
  });

  const jobId = await enqueueJob({
    type: "EASY_APPLY_SUBMIT",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId: application.accountId,
    applicationId: application.id,
    jobPostingId: application.jobPostingId,
    payload: { applicationId: application.id },
  });

  return { ok: true, jobId };
});

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

if (process.env.RUN_AI_DRAFT_DEMO === "1") {
  const applicationId = process.env.APPLICATION_ID;
  if (!applicationId) throw new Error("APPLICATION_ID is required for RUN_AI_DRAFT_DEMO");
  const jobId = await enqueueJob({
    type: "AI_DRAFT_ANSWERS",
    runId: `run-${Date.now()}`,
    priority: 0,
    applicationId,
    payload: { applicationId },
  });
  logger.info({ jobId }, "enqueued ai draft answers job");
}

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
await app.listen({ port, host: "0.0.0.0" });
logger.info({ port }, "api listening");
