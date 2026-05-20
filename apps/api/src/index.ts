import { getConfig } from "@applyflow/config";
import { getDb } from "@applyflow/db";
import { logger } from "@applyflow/observability";
import { enqueueJob } from "@applyflow/queue";
import { fingerprintQuestionLabel, isSensitiveQuestionLabel } from "@applyflow/shared";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Prisma } from "@prisma/client";

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

async function computeSubmitReadiness(params: {
  db: ReturnType<typeof getDb>;
  applicationId: string;
}): Promise<{ ready: boolean; missingRequired: string[] }> {
  const dryRunStep = await params.db.applicationStep.findFirst({
    where: { applicationId: params.applicationId, name: "EASY_APPLY_DRY_RUN" },
    orderBy: { createdAt: "desc" },
  });

  const questions = ((dryRunStep?.detail as any)?.questions as any[]) ?? [];
  const required = questions
    .filter((q) => Boolean(q?.required) && typeof q?.label === "string")
    .map((q) => String(q.label));
  if (required.length === 0) return { ready: true, missingRequired: [] };

  const answers = await params.db.applicationAnswer.findMany({
    where: { applicationId: params.applicationId },
  });

  const approvedFingerprints = new Set(
    answers
      .filter((a) => a.approved && a.answer !== "NEEDS_HUMAN_INPUT")
      .map((a) => fingerprintQuestionLabel(a.questionLabel))
  );

  const missing = required.filter(
    (label) => !approvedFingerprints.has(fingerprintQuestionLabel(label))
  );
  return { ready: missing.length === 0, missingRequired: missing.slice(0, 50) };
}

app.get("/applications/:id/answers", async (req, reply) => {
  const id = (req.params as any).id as string;
  const db = getDb();
  const application = await db.application.findUnique({ where: { id } });
  if (!application) return reply.code(404).send({ error: "not_found" });

  const answers = await db.applicationAnswer.findMany({
    where: { applicationId: id },
    orderBy: { questionLabel: "asc" },
  });
  return { answers };
});

app.post("/applications/:id/answers/bulk-approve", async (req, reply) => {
  const applicationId = (req.params as any).id as string;
  const db = getDb();
  const application = await db.application.findUnique({ where: { id: applicationId } });
  if (!application) return reply.code(404).send({ error: "not_found" });

  const answers = await db.applicationAnswer.findMany({ where: { applicationId } });
  const candidates = answers.filter((a) => {
    if (a.approved) return false;
    if (a.answer === "NEEDS_HUMAN_INPUT") return false;
    if (isSensitiveQuestionLabel(a.questionLabel)) return false;
    return a.source === "template" || a.requiresApproval === false;
  });

  if (candidates.length > 0) {
    await db.applicationAnswer.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { approved: true },
    });
  }

  await db.applicationStep.create({
    data: {
      applicationId,
      name: "HUMAN_DECISION",
      state: "bulk_approved",
      detail: {
        approvedCount: candidates.length,
        skippedSensitiveCount: answers.filter((a) => isSensitiveQuestionLabel(a.questionLabel))
          .length,
      },
    },
  });

  const readiness = await computeSubmitReadiness({ db, applicationId });

  if (readiness.ready && process.env.AUTO_SUBMIT_ON_READY === "1") {
    const applicationFresh = await db.application.findUnique({ where: { id: applicationId } });
    if (applicationFresh && applicationFresh.status === "needs_review") {
      await db.application.update({
        where: { id: applicationId },
        data: { status: "queued" },
      });

      await db.applicationStep.create({
        data: {
          applicationId,
          name: "AUTO_SUBMIT_POLICY",
          state: "auto_queued",
        },
      });

      await enqueueJob({
        type: "EASY_APPLY_SUBMIT",
        runId: `run-${Date.now()}`,
        priority: 0,
        accountId: application.accountId,
        applicationId,
        jobPostingId: applicationFresh.jobPostingId,
        payload: { applicationId },
      });
    }
  }

  const updatedAnswers = await db.applicationAnswer.findMany({
    where: { applicationId },
    orderBy: { questionLabel: "asc" },
  });

  return { approvedCount: candidates.length, readiness, answers: updatedAnswers };
});

app.get("/applications/:id/readiness", async (req, reply) => {
  const id = (req.params as any).id as string;
  const db = getDb();
  const application = await db.application.findUnique({ where: { id } });
  if (!application) return reply.code(404).send({ error: "not_found" });

  const readiness = await computeSubmitReadiness({ db, applicationId: id });
  return { readiness };
});

app.get("/templates", async (req) => {
  const accountId = (req.query as any)?.accountId as string | undefined;
  const db = getDb();
  const where: Prisma.AnswerTemplateWhereInput = {};
  if (typeof accountId === "string" && accountId.trim().length > 0) {
    where.accountId = accountId.trim();
  }
  const templates = await db.answerTemplate.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return { templates };
});

app.post("/templates/:id/update", async (req, reply) => {
  const id = (req.params as any).id as string;
  const body = (req.body as any) ?? {};
  const answer = body.answer as string | undefined;
  const approved = Boolean(body.approved);

  if (!answer) return reply.code(400).send({ error: "missing_fields" });

  const db = getDb();
  const template = await db.answerTemplate.findUnique({ where: { id } });
  if (!template) return reply.code(404).send({ error: "not_found" });

  const updated = await db.answerTemplate.update({
    where: { id },
    data: { answer, approved },
  });
  return { template: updated };
});

app.post("/templates/:id/delete", async (req, reply) => {
  const id = (req.params as any).id as string;
  const db = getDb();
  const template = await db.answerTemplate.findUnique({ where: { id } });
  if (!template) return reply.code(404).send({ error: "not_found" });
  await db.answerTemplate.delete({ where: { id } });
  return { ok: true };
});

app.post("/applications/:id/answers/upsert", async (req, reply) => {
  const applicationId = (req.params as any).id as string;
  const body = (req.body as any) ?? {};
  const questionId = body.questionId as string | undefined;
  const questionLabel = body.questionLabel as string | undefined;
  const answer = body.answer as string | undefined;
  const required = Boolean(body.required);
  const approved = Boolean(body.approved);
  const requiresApproval = Boolean(body.requiresApproval);
  const confidence = typeof body.confidence === "number" ? body.confidence : 0;
  const saveAsTemplate = Boolean(body.saveAsTemplate);

  if (!questionId || !questionLabel || !answer) {
    return reply.code(400).send({ error: "missing_fields" });
  }

  const db = getDb();
  const application = await db.application.findUnique({ where: { id: applicationId } });
  if (!application) return reply.code(404).send({ error: "not_found" });

  const row = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const answerRow = await tx.applicationAnswer.upsert({
      where: { applicationId_questionId: { applicationId, questionId } },
      create: {
        applicationId,
        questionId,
        questionLabel,
        required,
        answer,
        confidence,
        requiresApproval,
        approved,
        source: "manual",
      },
      update: {
        questionLabel,
        required,
        answer,
        confidence,
        requiresApproval,
        approved,
        source: "manual",
      },
    });

    if (saveAsTemplate) {
      const fingerprint = fingerprintQuestionLabel(questionLabel);
      await tx.answerTemplate.upsert({
        where: { accountId_fingerprint: { accountId: application.accountId, fingerprint } },
        create: {
          accountId: application.accountId,
          fingerprint,
          answer,
          approved,
        },
        update: {
          answer,
          approved,
        },
      });
    }

    return answerRow;
  });

  const readiness = await computeSubmitReadiness({ db, applicationId });

  if (readiness.ready && process.env.AUTO_SUBMIT_ON_READY === "1") {
    const applicationFresh = await db.application.findUnique({ where: { id: applicationId } });
    if (applicationFresh && applicationFresh.status === "needs_review") {
      await db.application.update({
        where: { id: applicationId },
        data: { status: "queued" },
      });

      await db.applicationStep.create({
        data: {
          applicationId,
          name: "AUTO_SUBMIT_POLICY",
          state: "auto_queued",
        },
      });

      await enqueueJob({
        type: "EASY_APPLY_SUBMIT",
        runId: `run-${Date.now()}`,
        priority: 0,
        accountId: application.accountId,
        applicationId,
        jobPostingId: applicationFresh.jobPostingId,
        payload: { applicationId },
      });
    }
  }

  return { answer: row, readiness };
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

  const readiness = await computeSubmitReadiness({ db, applicationId: id });
  if (!readiness.ready) {
    return reply.code(409).send({ error: "not_ready", missingRequired: readiness.missingRequired });
  }

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
