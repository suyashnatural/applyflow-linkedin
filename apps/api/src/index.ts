import { getConfig } from "@applyflow/config";
import { getDb } from "@applyflow/db";
import { logger } from "@applyflow/observability";
import { enqueueJob } from "@applyflow/queue";
import {
  clampScheduleAttempts,
  clampScheduleScore,
  computeNextRunAt,
  DEFAULT_AUTO_APPLY_CRON,
  DEFAULT_AUTO_APPLY_TIMEZONE,
} from "@applyflow/scheduling";
import { fingerprintQuestionLabel, isSensitiveQuestionLabel } from "@applyflow/shared";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Prisma } from "@prisma/client";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "api boot");

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

const apiKey = process.env.API_KEY;
const apiKeyHeader = "x-applyflow-api-key";

app.addHook("preHandler", async (req, reply) => {
  // Health endpoints stay unauthenticated for liveness checks.
  if (req.url === "/healthz" || req.url.startsWith("/healthz/")) return;

  // If API_KEY is not set, run open (dev mode). Set API_KEY in any shared env.
  if (!apiKey) return;

  const provided = req.headers[apiKeyHeader] ?? req.headers[apiKeyHeader.toLowerCase()];
  const key = Array.isArray(provided) ? provided[0] : provided;
  if (typeof key !== "string" || key.length === 0) {
    return reply.code(401).send({ error: "missing_api_key" });
  }
  if (key !== apiKey) {
    return reply.code(403).send({ error: "invalid_api_key" });
  }
});

app.get("/healthz", async () => ({ ok: true }));

app.get("/accounts", async () => {
  const db = getDb();
  const accounts = await db.linkedInAccount.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, createdAt: true, updatedAt: true },
    take: 100,
  });
  return { accounts };
});

type SessionHealthStatus = "healthy" | "re_auth_required" | "checkpoint" | "unknown";

async function getSessionHealthSnapshot(accountId: string): Promise<{
  accountId: string;
  status: SessionHealthStatus;
  canRunAutoApply: boolean;
  lastOk: { time: Date; payload: unknown } | null;
  lastIssue: { time: Date; payload: unknown } | null;
}> {
  const db = getDb();
  const [lastOk, lastIssue] = await Promise.all([
    db.event.findFirst({
      where: { accountId, type: "LINKEDIN_SESSION_OK" },
      orderBy: { time: "desc" },
    }),
    db.event.findFirst({
      where: {
        accountId,
        OR: [{ type: "LINKEDIN_SESSION_REQUIRED" }, { type: "LINKEDIN_BLOCKED" }],
      },
      orderBy: { time: "desc" },
    }),
  ]);

  let status: SessionHealthStatus = "unknown";
  if (lastIssue && (!lastOk || lastIssue.time >= lastOk.time)) {
    const payload = (lastIssue.payload as any) ?? {};
    const kind = payload.kind ?? payload.blockedReason;
    status = kind === "checkpoint" ? "checkpoint" : "re_auth_required";
  } else if (lastOk) {
    status = "healthy";
  }

  return {
    accountId,
    status,
    canRunAutoApply: status === "healthy" || status === "unknown",
    lastOk: lastOk ? { time: lastOk.time, payload: lastOk.payload } : null,
    lastIssue: lastIssue ? { time: lastIssue.time, payload: lastIssue.payload } : null,
  };
}

app.get("/accounts/:id/session-health", async (req, reply) => {
  const accountId = (req.params as any).id as string;
  if (!accountId || accountId.trim().length === 0) {
    return reply.code(400).send({ error: "missing_account_id" });
  }

  const health = await getSessionHealthSnapshot(accountId.trim());
  return health;
});

app.get("/auto-apply/schedules", async (req) => {
  const accountId = (req.query as any)?.accountId as string | undefined;
  const db = getDb();
  const args: Parameters<typeof db.autoApplySchedule.findMany>[0] = {
    orderBy: { updatedAt: "desc" },
    take: 100,
  };
  if (typeof accountId === "string" && accountId.trim().length > 0) {
    args.where = { accountId: accountId.trim() };
  }
  const schedules = await db.autoApplySchedule.findMany(args);
  return { schedules };
});

app.post("/auto-apply/schedules/upsert", async (req, reply) => {
  const body = (req.body as any) ?? {};
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  if (!accountId) return reply.code(400).send({ error: "missing_account_id" });

  const cron =
    typeof body.cron === "string" && body.cron.trim().length > 0
      ? body.cron.trim()
      : DEFAULT_AUTO_APPLY_CRON;
  const timezone =
    typeof body.timezone === "string" && body.timezone.trim().length > 0
      ? body.timezone.trim()
      : DEFAULT_AUTO_APPLY_TIMEZONE;
  const enabled = body.enabled === true;
  const rawMaxAttempts = body.maxAttempts;
  const rawMinScore = body.minScore;
  const maxAttempts = clampScheduleAttempts(
    rawMaxAttempts === "" || rawMaxAttempts == null
      ? null
      : typeof rawMaxAttempts === "number"
        ? rawMaxAttempts
        : Number(rawMaxAttempts)
  );
  const minScore = clampScheduleScore(
    rawMinScore === "" || rawMinScore == null
      ? null
      : typeof rawMinScore === "number"
        ? rawMinScore
        : Number(rawMinScore)
  );

  let nextRunAt: Date;
  try {
    nextRunAt = computeNextRunAt({ cron, timezone });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(400).send({ error: "invalid_schedule", message });
  }

  const db = getDb();
  await db.linkedInAccount.upsert({
    where: { id: accountId },
    update: {},
    create: { id: accountId },
  });

  const schedule = await db.autoApplySchedule.upsert({
    where: { accountId },
    update: {
      enabled,
      cron,
      timezone,
      maxAttempts,
      minScore,
      nextRunAt,
    },
    create: {
      accountId,
      enabled,
      cron,
      timezone,
      maxAttempts,
      minScore,
      nextRunAt,
    },
  });

  return { ok: true, schedule };
});

app.post("/accounts/:id/bootstrap-session", async (req, reply) => {
  const accountId = (req.params as any).id as string;
  if (!accountId || accountId.trim().length === 0) {
    return reply.code(400).send({ error: "missing_account_id" });
  }

  const db = getDb();
  await db.linkedInAccount.upsert({
    where: { id: accountId },
    update: {},
    create: { id: accountId },
  });

  const jobId = await enqueueJob({
    type: "LINKEDIN_SESSION_BOOTSTRAP",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId,
    payload: { accountId },
  });

  return { ok: true, jobId };
});

app.post("/accounts/:id/recover-session", async (req, reply) => {
  const accountId = (req.params as any).id as string;
  if (!accountId || accountId.trim().length === 0) {
    return reply.code(400).send({ error: "missing_account_id" });
  }

  const db = getDb();
  await db.linkedInAccount.upsert({
    where: { id: accountId },
    update: {},
    create: { id: accountId },
  });

  const jobId = await enqueueJob({
    type: "LINKEDIN_SESSION_BOOTSTRAP",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId,
    payload: { accountId },
  });

  const schedule = await db.autoApplySchedule.findUnique({ where: { accountId } });
  if (schedule && !schedule.enabled) {
    await db.autoApplySchedule.update({
      where: { accountId },
      data: {
        enabled: true,
        nextRunAt: computeNextRunAt({ cron: schedule.cron, timezone: schedule.timezone }),
      },
    });
  }

  return { ok: true, jobId, resumedSchedule: Boolean(schedule && !schedule.enabled) };
});

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

app.get("/events", async (req) => {
  const accountId = (req.query as any)?.accountId as string | undefined;
  const type = (req.query as any)?.type as string | undefined;
  const limitRaw = (req.query as any)?.limit as string | number | undefined;
  const limit =
    typeof limitRaw === "number"
      ? Math.floor(limitRaw)
      : typeof limitRaw === "string"
        ? Number.parseInt(limitRaw, 10)
        : 50;
  const take = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 50;

  const db = getDb();
  const where: Prisma.EventWhereInput = {};
  if (typeof accountId === "string" && accountId.trim().length > 0)
    where.accountId = accountId.trim();
  if (typeof type === "string" && type.trim().length > 0) where.type = type.trim();

  const events = await db.event.findMany({
    where,
    orderBy: { time: "desc" },
    take,
  });
  return { events };
});

app.get("/stats/auto-apply", async (req) => {
  const accountId = (req.query as any)?.accountId as string | undefined;
  if (!accountId || typeof accountId !== "string") {
    return { error: "accountId_required" };
  }

  const limitRaw = (req.query as any)?.limit as string | number | undefined;
  const limit =
    typeof limitRaw === "number"
      ? Math.floor(limitRaw)
      : typeof limitRaw === "string"
        ? Number.parseInt(limitRaw, 10)
        : 25;
  const take = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 25;

  const db = getDb();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const recentCycles = await db.event.findMany({
    where: { accountId, type: "AUTO_APPLY_CYCLE" },
    orderBy: { time: "desc" },
    take,
  });

  let sumEnqueuedAttempts = 0;
  let sumDiscovered = 0;
  let sumSynced = 0;
  let sumAttemptBudget = 0;
  for (const e of recentCycles) {
    const p = e.payload as any;
    if (typeof p?.enqueuedAttempts === "number") sumEnqueuedAttempts += p.enqueuedAttempts;
    if (typeof p?.discovered === "number") sumDiscovered += p.discovered;
    if (typeof p?.synced === "number") sumSynced += p.synced;
    if (typeof p?.attemptBudget === "number") sumAttemptBudget += p.attemptBudget;
  }

  const cyclesToday = await db.event.count({
    where: { accountId, type: "AUTO_APPLY_CYCLE", time: { gte: startOfDay } },
  });
  const blockedToday = await db.event.count({
    where: { accountId, type: "LINKEDIN_BLOCKED", time: { gte: startOfDay } },
  });
  const submittedToday = await db.application.count({
    where: { accountId, status: "submitted", updatedAt: { gte: startOfDay } },
  });
  const needsReview = await db.application.count({ where: { accountId, status: "needs_review" } });

  const sessionHealth = await getSessionHealthSnapshot(accountId);

  return {
    accountId,
    today: { cycles: cyclesToday, submitted: submittedToday, blocked: blockedToday, needsReview },
    sessionHealth,
    recent: {
      cycles: recentCycles,
      totals: {
        discovered: sumDiscovered,
        synced: sumSynced,
        attemptBudget: sumAttemptBudget,
        enqueuedAttempts: sumEnqueuedAttempts,
      },
    },
  };
});

app.get("/queue/jobs", async (req) => {
  const status = (req.query as any)?.status as string | undefined;
  const limitRaw = (req.query as any)?.limit as string | number | undefined;
  const limit =
    typeof limitRaw === "number"
      ? Math.floor(limitRaw)
      : typeof limitRaw === "string"
        ? Number.parseInt(limitRaw, 10)
        : 50;
  const take = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 50;

  const db = getDb();
  const where: Prisma.QueueJobWhereInput = {};
  if (typeof status === "string" && status.trim().length > 0) {
    where.status = status.trim() as any;
  }
  const jobs = await db.queueJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
  });
  return { jobs };
});

app.get("/queue/jobs/:id", async (req, reply) => {
  const id = (req.params as any).id as string;
  const db = getDb();
  const job = await db.queueJob.findUnique({ where: { id } });
  if (!job) return reply.code(404).send({ error: "not_found" });
  return { job };
});

app.post("/queue/jobs/:id/cancel", async (req, reply) => {
  const id = (req.params as any).id as string;
  const db = getDb();
  const job = await db.queueJob.findUnique({ where: { id } });
  if (!job) return reply.code(404).send({ error: "not_found" });

  if (job.status !== "queued" && job.status !== "running") {
    return reply.code(409).send({ error: "not_cancelable", status: job.status });
  }

  const updated = await db.queueJob.update({
    where: { id },
    data: {
      status: "canceled",
      leasedUntil: null,
      error: "canceled_by_user",
    },
  });
  return { ok: true, job: updated };
});

app.get("/applications", async (req) => {
  const status = (req.query as any)?.status as string | undefined;
  const db = getDb();
  const args: Parameters<typeof db.application.findMany>[0] = {
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      jobPosting: { select: { id: true, title: true, companyName: true, score: true } },
    },
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

app.post("/templates/:id/clone-to-account", async (req, reply) => {
  const id = (req.params as any).id as string;
  const body = (req.body as any) ?? {};
  const accountId = body.accountId as string | undefined;
  if (!accountId || typeof accountId !== "string") {
    return reply.code(400).send({ error: "missing_account_id" });
  }

  const db = getDb();
  const template = await db.answerTemplate.findUnique({ where: { id } });
  if (!template) return reply.code(404).send({ error: "not_found" });

  await db.linkedInAccount.upsert({
    where: { id: accountId },
    update: {},
    create: { id: accountId },
  });

  const cloned = await db.answerTemplate.upsert({
    where: { accountId_fingerprint: { accountId, fingerprint: template.fingerprint } },
    create: {
      accountId,
      fingerprint: template.fingerprint,
      answer: template.answer,
      approved: template.approved,
    },
    update: {
      answer: template.answer,
      approved: template.approved,
    },
  });

  return { template: cloned };
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

app.post("/auto-apply/run", async (req, reply) => {
  const body = (req.body as any) ?? {};
  const accountId = body.accountId as string | undefined;
  if (!accountId || typeof accountId !== "string") {
    throw new Error("auto-apply requires accountId");
  }

  const health = await getSessionHealthSnapshot(accountId);
  if (!health.canRunAutoApply) {
    return reply.code(409).send({
      ok: false,
      error: "session_unhealthy",
      sessionHealth: health,
    });
  }

  const maxAttemptsRaw = body.maxAttempts as number | undefined;
  const maxAttempts =
    typeof maxAttemptsRaw === "number" && Number.isFinite(maxAttemptsRaw)
      ? Math.max(0, Math.floor(maxAttemptsRaw))
      : undefined;

  const minScoreRaw = body.minScore as number | undefined;
  const minScore =
    typeof minScoreRaw === "number" && Number.isFinite(minScoreRaw)
      ? Math.max(0, Math.min(100, Math.floor(minScoreRaw)))
      : undefined;

  const jobId = await enqueueJob({
    type: "RUN_AUTO_APPLY_CYCLE",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId,
    payload: { accountId, maxAttempts, minScore },
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

if (process.env.RUN_SCORE_DEMO === "1") {
  const accountId = process.env.LINKEDIN_ACCOUNT_ID;
  if (!accountId) throw new Error("LINKEDIN_ACCOUNT_ID is required for RUN_SCORE_DEMO");

  const candidates = await getDb().jobPosting.findMany({
    where: { accountId, description: { not: null }, score: null },
    orderBy: { discoveredAt: "desc" },
    take: process.env.SCORE_MAX_JOBS ? Number.parseInt(process.env.SCORE_MAX_JOBS, 10) : 10,
  });

  for (const posting of candidates) {
    const jobId = await enqueueJob({
      type: "SCORE_JOB_POSTING",
      runId: `run-${Date.now()}`,
      priority: 0,
      accountId,
      jobPostingId: posting.id,
      payload: { jobPostingId: posting.id },
    });
    logger.info({ jobId, jobPostingId: posting.id }, "enqueued score job posting");
  }
}

if (process.env.RUN_AUTO_APPLY_DEMO === "1") {
  const accountId = process.env.LINKEDIN_ACCOUNT_ID;
  if (!accountId) throw new Error("LINKEDIN_ACCOUNT_ID is required for RUN_AUTO_APPLY_DEMO");
  const jobId = await enqueueJob({
    type: "RUN_AUTO_APPLY_CYCLE",
    runId: `run-${Date.now()}`,
    priority: 0,
    accountId,
    payload: {
      accountId,
      maxAttempts: process.env.AUTO_APPLY_TOP_N
        ? Number.parseInt(process.env.AUTO_APPLY_TOP_N, 10)
        : undefined,
      minScore: process.env.AUTO_APPLY_MIN_SCORE
        ? Number.parseInt(process.env.AUTO_APPLY_MIN_SCORE, 10)
        : undefined,
    },
  });
  logger.info({ jobId }, "enqueued auto-apply cycle");
}

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
await app.listen({ port, host: "0.0.0.0" });
logger.info({ port }, "api listening");
