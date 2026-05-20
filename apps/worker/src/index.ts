import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";
import { completeJob, enqueueJob, leaseNextJob, rescheduleJob } from "@applyflow/queue";
import { getDb } from "@applyflow/db";
import { draftAnswers, loadCandidateProfile, scoreJobPosting } from "@applyflow/ai";
import { ApplyFlowError, asFailure, fingerprintQuestionLabel } from "@applyflow/shared";
import {
  discoverLinkedInJobs,
  easyApplyDryRun,
  ensureLinkedInSession,
  fetchLinkedInJobDetail,
  submitEasyApply,
} from "@applyflow/linkedin-automation";
import { QueueJobStatus } from "@prisma/client";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "worker boot");

const leaseOwner = process.env.WORKER_ID ?? `worker-${process.pid}`;
const pollMs = Number.parseInt(process.env.WORKER_POLL_MS ?? "1000", 10);
const leaseMs = Number.parseInt(process.env.WORKER_LEASE_MS ?? "30000", 10);
const candidateProfilePath = process.env.CANDIDATE_PROFILE_PATH;
const scoreThresholdRaw = Number.parseInt(process.env.SCORE_THRESHOLD ?? "70", 10);
const scoreThreshold = Number.isFinite(scoreThresholdRaw)
  ? Math.max(0, Math.min(100, scoreThresholdRaw))
  : 70;
const dailyApplyLimitRaw = Number.parseInt(process.env.DAILY_APPLY_LIMIT ?? "10", 10);
const dailyApplyLimit = Number.isFinite(dailyApplyLimitRaw) ? Math.max(0, dailyApplyLimitRaw) : 10;
const autoApplyTopNRaw = Number.parseInt(process.env.AUTO_APPLY_TOP_N ?? "5", 10);
const autoApplyTopN = Number.isFinite(autoApplyTopNRaw) ? Math.max(0, autoApplyTopNRaw) : 5;
const autoApplyMinScoreRaw = Number.parseInt(process.env.AUTO_APPLY_MIN_SCORE ?? "70", 10);
const autoApplyMinScore = Number.isFinite(autoApplyMinScoreRaw)
  ? Math.max(0, Math.min(100, autoApplyMinScoreRaw))
  : 70;
const accountCooldownMsRaw = Number.parseInt(process.env.ACCOUNT_COOLDOWN_MS ?? "20000", 10);
const accountCooldownMs = Number.isFinite(accountCooldownMsRaw)
  ? Math.max(0, accountCooldownMsRaw)
  : 20_000;
const jitterPctRaw = Number.parseFloat(process.env.ACCOUNT_JITTER_PCT ?? "0.2");
const jitterPct = Number.isFinite(jitterPctRaw) ? Math.max(0, Math.min(1, jitterPctRaw)) : 0.2;
const maxConcurrentRaw = Number.parseInt(process.env.MAX_CONCURRENT_PER_ACCOUNT ?? "1", 10);
const maxConcurrentPerAccount = Number.isFinite(maxConcurrentRaw)
  ? Math.max(0, maxConcurrentRaw)
  : 1;

const lastLinkedInActionAtByAccount = new Map<string, number>();

function computeBackoffMs(attempt: number): number {
  // Exponential backoff with a cap (attempt is 1-based in our queue).
  const base = 2000;
  const ms = Math.min(60_000, base * Math.pow(2, Math.max(0, attempt - 1)));
  return ms;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterDelayMs(ms: number): number {
  const pct = Number.isFinite(jitterPct) ? Math.max(0, Math.min(1, jitterPct)) : 0;
  const rand = (Math.random() * 2 - 1) * pct; // [-pct, +pct]
  return Math.max(0, Math.floor(ms * (1 + rand)));
}

function isLinkedInAutomationJobType(type: string): boolean {
  return (
    type === "LINKEDIN_SESSION_BOOTSTRAP" ||
    type === "DISCOVER_LINKEDIN_JOBS" ||
    type === "SYNC_JOB_DETAILS" ||
    type === "RUN_AUTO_APPLY_CYCLE" ||
    type === "EASY_APPLY_ATTEMPT" ||
    type === "EASY_APPLY_SUBMIT"
  );
}

async function enforceAccountSafetyRails(params: {
  db: ReturnType<typeof getDb>;
  jobId: string;
  leaseOwner: string;
  jobType: string;
  accountId: string;
}): Promise<"ok" | "rescheduled"> {
  if (!isLinkedInAutomationJobType(params.jobType)) return "ok";

  // Enforce per-account concurrency across workers by checking currently leased jobs.
  if (maxConcurrentPerAccount > 0) {
    const now = new Date();
    const running = await params.db.queueJob.count({
      where: {
        id: { not: params.jobId },
        accountId: params.accountId,
        status: QueueJobStatus.running,
        leasedUntil: { gt: now },
      },
    });

    if (running >= maxConcurrentPerAccount) {
      const delayMs = jitterDelayMs(Math.max(1000, accountCooldownMs));
      await rescheduleJob({
        jobId: params.jobId,
        leaseOwner: params.leaseOwner,
        runAfter: new Date(Date.now() + delayMs),
        error: `throttled: account concurrency (${running})`,
      });
      logger.info(
        { jobId: params.jobId, accountId: params.accountId, running, delayMs },
        "throttled: per-account concurrency cap"
      );
      return "rescheduled";
    }
  }

  // Enforce cooldown (best-effort per-worker).
  if (accountCooldownMs > 0) {
    const last = lastLinkedInActionAtByAccount.get(params.accountId);
    if (typeof last === "number") {
      const sinceMs = Date.now() - last;
      if (sinceMs < accountCooldownMs) {
        const delayMs = jitterDelayMs(accountCooldownMs - sinceMs);
        await rescheduleJob({
          jobId: params.jobId,
          leaseOwner: params.leaseOwner,
          runAfter: new Date(Date.now() + delayMs),
          error: `throttled: cooldown (${sinceMs}ms since last)`,
        });
        logger.info(
          { jobId: params.jobId, accountId: params.accountId, sinceMs, delayMs },
          "throttled: per-account cooldown"
        );
        return "rescheduled";
      }
    }
  }

  lastLinkedInActionAtByAccount.set(params.accountId, Date.now());
  return "ok";
}

for (;;) {
  const leased = await leaseNextJob({ leaseOwner, leaseMs });
  if (leased.kind === "none") {
    await sleep(pollMs);
    continue;
  }

  const jobId = leased.jobId;
  logger.info({ jobId, leaseOwner }, "job leased");

  let job: Awaited<ReturnType<ReturnType<typeof getDb>["queueJob"]["findUnique"]>> | null = null;

  try {
    const db = getDb();
    job = await db.queueJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error(`queue job not found: ${jobId}`);

    const accountIdForRails =
      job.accountId ?? ((job.payload as any)?.accountId as string | undefined);
    if (typeof accountIdForRails === "string" && accountIdForRails.length > 0) {
      const railResult = await enforceAccountSafetyRails({
        db,
        jobId,
        leaseOwner,
        jobType: job.type,
        accountId: accountIdForRails,
      });
      if (railResult === "rescheduled") {
        continue;
      }
    }

    if (job.type === "LINKEDIN_SESSION_BOOTSTRAP") {
      const accountId = job.accountId ?? (job.payload as any)?.accountId;
      if (!accountId || typeof accountId !== "string") {
        throw new Error("LINKEDIN_SESSION_BOOTSTRAP requires accountId");
      }

      const headful = process.env.HEADFUL ? process.env.HEADFUL === "1" : true;
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

      const headful = process.env.HEADFUL ? process.env.HEADFUL === "1" : true;
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
    } else if (job.type === "SYNC_JOB_DETAILS") {
      const accountId = job.accountId ?? (job.payload as any)?.accountId;
      if (!accountId || typeof accountId !== "string") {
        throw new Error("SYNC_JOB_DETAILS requires accountId");
      }

      const maxJobsRaw = (job.payload as any)?.maxJobs;
      const maxJobs =
        typeof maxJobsRaw === "number" && Number.isFinite(maxJobsRaw) ? Math.floor(maxJobsRaw) : 10;

      const headful = process.env.HEADFUL ? process.env.HEADFUL === "1" : true;

      const candidates = await db.jobPosting.findMany({
        where: {
          accountId,
          OR: [{ title: null }, { companyName: null }, { location: null }, { description: null }],
        },
        orderBy: { discoveredAt: "desc" },
        take: maxJobs,
      });

      logger.info(
        { jobId, accountId, count: candidates.length, maxJobs },
        "sync job details: selected candidates"
      );

      for (const posting of candidates) {
        const detail = await fetchLinkedInJobDetail({
          accountId,
          headful,
          url: posting.url,
        });

        if (detail.blockedReason) {
          await db.event.create({
            data: {
              runId: job.runId,
              type: "LINKEDIN_BLOCKED",
              payload: { blockedReason: detail.blockedReason, url: detail.url },
              accountId,
              jobPostingId: posting.id,
            },
          });
          throw new ApplyFlowError({
            code:
              detail.blockedReason === "login_required"
                ? "blocked_login_required"
                : "blocked_checkpoint",
            message: `linkedin blocked: ${detail.blockedReason}`,
            retryable: false,
          });
        }

        await db.jobPosting.update({
          where: { id: posting.id },
          data: {
            url: detail.url,
            title: detail.title ?? posting.title,
            companyName: detail.companyName ?? posting.companyName,
            location: detail.location ?? posting.location,
            workplaceType: detail.workplaceType ?? posting.workplaceType,
            description: detail.description ?? posting.description,
            easyApply: detail.easyApply,
            lastSeenAt: new Date(),
          },
        });
      }
    } else if (job.type === "RUN_AUTO_APPLY_CYCLE") {
      const accountId = job.accountId ?? (job.payload as any)?.accountId;
      if (!accountId || typeof accountId !== "string") {
        throw new Error("RUN_AUTO_APPLY_CYCLE requires accountId");
      }

      const headful = process.env.HEADFUL ? process.env.HEADFUL === "1" : true;
      const session = await ensureLinkedInSession({ accountId, headful });
      if (session.kind !== "ok") {
        throw new ApplyFlowError({
          code: session.kind === "login_required" ? "blocked_login_required" : "blocked_checkpoint",
          message: `session not ready (${session.kind})`,
          retryable: false,
        });
      }

      const maxAttemptsRaw = (job.payload as any)?.maxAttempts;
      const maxAttempts =
        typeof maxAttemptsRaw === "number" && Number.isFinite(maxAttemptsRaw)
          ? Math.max(0, Math.floor(maxAttemptsRaw))
          : autoApplyTopN;

      const minScoreRaw = (job.payload as any)?.minScore;
      const minScore =
        typeof minScoreRaw === "number" && Number.isFinite(minScoreRaw)
          ? Math.max(0, Math.min(100, Math.floor(minScoreRaw)))
          : autoApplyMinScore;

      // 1) Discover jobs
      const keywords =
        (job.payload as any)?.keywords ?? process.env.LINKEDIN_KEYWORDS ?? "software engineer";
      const location = (job.payload as any)?.location ?? process.env.LINKEDIN_LOCATION;
      const maxCardsRaw = (job.payload as any)?.maxCards;
      const maxCards =
        typeof maxCardsRaw === "number" && Number.isFinite(maxCardsRaw)
          ? Math.max(1, Math.floor(maxCardsRaw))
          : process.env.LINKEDIN_MAX_CARDS
            ? Math.max(1, Number.parseInt(process.env.LINKEDIN_MAX_CARDS, 10))
            : 25;

      const discoverParams: Parameters<typeof discoverLinkedInJobs>[0] = {
        accountId,
        headful,
        keywords,
        maxCards,
      };
      if (typeof location === "string" && location.length > 0) discoverParams.location = location;

      const cards = await discoverLinkedInJobs(discoverParams);
      for (const card of cards) {
        await db.jobPosting.upsert({
          where: {
            accountId_linkedInJobId: { accountId, linkedInJobId: card.linkedInJobId },
          },
          update: { url: card.url, lastSeenAt: new Date() },
          create: {
            accountId,
            linkedInJobId: card.linkedInJobId,
            url: card.url,
            easyApply: false,
          },
        });
      }

      // 2) Sync details (best-effort for latest rows missing metadata)
      const syncMaxRaw = (job.payload as any)?.syncMaxJobs;
      const syncMax =
        typeof syncMaxRaw === "number" && Number.isFinite(syncMaxRaw)
          ? Math.max(0, Math.floor(syncMaxRaw))
          : process.env.LINKEDIN_SYNC_MAX_JOBS
            ? Math.max(0, Number.parseInt(process.env.LINKEDIN_SYNC_MAX_JOBS, 10))
            : 10;

      const candidates = await db.jobPosting.findMany({
        where: {
          accountId,
          OR: [{ title: null }, { companyName: null }, { location: null }, { description: null }],
        },
        orderBy: { discoveredAt: "desc" },
        take: syncMax,
      });
      for (const posting of candidates) {
        const detail = await fetchLinkedInJobDetail({ accountId, headful, url: posting.url });
        if (!detail.blockedReason) {
          await db.jobPosting.update({
            where: { id: posting.id },
            data: {
              url: detail.url,
              title: detail.title ?? posting.title,
              companyName: detail.companyName ?? posting.companyName,
              location: detail.location ?? posting.location,
              workplaceType: detail.workplaceType ?? posting.workplaceType,
              description: detail.description ?? posting.description,
              easyApply: detail.easyApply,
              lastSeenAt: new Date(),
            },
          });
        }
      }

      // 3) Score unscored jobs (requires candidate profile)
      if (candidateProfilePath) {
        const profile = loadCandidateProfile(candidateProfilePath);
        const scoreMaxRaw = (job.payload as any)?.scoreMaxJobs;
        const scoreMax =
          typeof scoreMaxRaw === "number" && Number.isFinite(scoreMaxRaw)
            ? Math.max(0, Math.floor(scoreMaxRaw))
            : process.env.SCORE_MAX_JOBS
              ? Math.max(0, Number.parseInt(process.env.SCORE_MAX_JOBS, 10))
              : 10;

        const toScore = await db.jobPosting.findMany({
          where: { accountId, description: { not: null }, score: null },
          orderBy: { discoveredAt: "desc" },
          take: scoreMax,
        });

        for (const posting of toScore) {
          const scored = await scoreJobPosting({
            profile,
            job: {
              title: posting.title,
              companyName: posting.companyName,
              location: posting.location,
              description: posting.description,
            },
          });
          await db.jobPosting.update({
            where: { id: posting.id },
            data: { score: scored.score, scoreReason: scored.rationale, scoredAt: new Date() },
          });
        }
      }

      // 4) Enforce daily limit, then enqueue Easy Apply attempts for top scored jobs without existing applications
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const appliedToday = await db.application.count({
        where: { accountId, createdAt: { gte: startOfDay } },
      });

      const remaining = Math.max(0, dailyApplyLimit - appliedToday);
      const attemptBudget = Math.min(remaining, maxAttempts);

      const eligible =
        attemptBudget > 0
          ? await db.jobPosting.findMany({
              where: { accountId, easyApply: true, score: { gte: minScore } },
              orderBy: [{ score: "desc" }, { discoveredAt: "desc" }],
              take: attemptBudget * 3,
            })
          : [];

      let enqueuedAttempts = 0;
      for (const posting of eligible) {
        if (enqueuedAttempts >= attemptBudget) break;
        const existing = await db.application.findFirst({
          where: { accountId, jobPostingId: posting.id },
          select: { id: true },
        });
        if (existing) continue;

        await enqueueJob({
          type: "EASY_APPLY_ATTEMPT",
          runId: `run-${Date.now()}`,
          priority: typeof posting.score === "number" ? posting.score : 0,
          accountId,
          jobPostingId: posting.id,
          payload: { accountId, jobPostingId: posting.id },
        });
        enqueuedAttempts += 1;
      }

      await db.event.create({
        data: {
          runId: job.runId,
          type: "AUTO_APPLY_CYCLE",
          payload: {
            discovered: cards.length,
            synced: candidates.length,
            appliedToday,
            attemptBudget,
            enqueuedAttempts,
            minScore,
          },
          accountId,
        },
      });
    } else if (job.type === "SCORE_JOB_POSTING") {
      const jobPostingId = job.jobPostingId ?? (job.payload as any)?.jobPostingId;
      if (!jobPostingId || typeof jobPostingId !== "string") {
        throw new Error("SCORE_JOB_POSTING requires jobPostingId");
      }
      if (!candidateProfilePath) {
        throw new Error("CANDIDATE_PROFILE_PATH is required for SCORE_JOB_POSTING");
      }

      const posting = await db.jobPosting.findUnique({ where: { id: jobPostingId } });
      if (!posting) throw new Error("job posting not found");

      const profile = loadCandidateProfile(candidateProfilePath);
      const scored = await scoreJobPosting({
        profile,
        job: {
          title: posting.title,
          companyName: posting.companyName,
          location: posting.location,
          description: posting.description,
        },
      });

      await db.jobPosting.update({
        where: { id: posting.id },
        data: {
          score: scored.score,
          scoreReason: scored.rationale,
          scoredAt: new Date(),
        },
      });

      await db.event.create({
        data: {
          runId: job.runId,
          type: "JOB_SCORED",
          payload: { score: scored.score, rationale: scored.rationale, warnings: scored.warnings },
          accountId: posting.accountId,
          jobPostingId: posting.id,
        },
      });
    } else if (job.type === "EASY_APPLY_ATTEMPT") {
      const accountId = job.accountId ?? (job.payload as any)?.accountId;
      if (!accountId || typeof accountId !== "string") {
        throw new Error("EASY_APPLY_ATTEMPT requires accountId");
      }

      const jobPostingId = (job.payload as any)?.jobPostingId ?? job.jobPostingId;
      const maxStepsRaw = (job.payload as any)?.maxSteps;
      const maxSteps =
        typeof maxStepsRaw === "number" && Number.isFinite(maxStepsRaw)
          ? Math.floor(maxStepsRaw)
          : 20;

      const posting =
        typeof jobPostingId === "string"
          ? await db.jobPosting.findUnique({ where: { id: jobPostingId } })
          : await db.jobPosting.findFirst({
              where: { accountId, easyApply: true, score: { gte: scoreThreshold } },
              orderBy: { discoveredAt: "desc" },
            });

      if (!posting) throw new Error("no eligible JobPosting found for EASY_APPLY_ATTEMPT");
      if (typeof posting.score === "number" && posting.score < scoreThreshold) {
        throw new ApplyFlowError({
          code: "unknown",
          message: `job score ${posting.score} below threshold ${scoreThreshold}; not applying`,
          retryable: false,
        });
      }

      const application = await db.application.create({
        data: {
          accountId,
          jobPostingId: posting.id,
          status: "in_progress",
        },
        select: { id: true },
      });

      const headful = process.env.HEADFUL ? process.env.HEADFUL === "1" : true;
      const artifactDir =
        process.env.ARTIFACT_DIR ??
        `.local/artifacts/${accountId}/${application.id}/${Date.now().toString()}`;

      await db.applicationStep.create({
        data: {
          applicationId: application.id,
          name: "EASY_APPLY_DRY_RUN",
          state: "started",
        },
      });

      const result = await easyApplyDryRun({
        accountId,
        headful,
        url: posting.url,
        maxSteps,
        artifactDir,
      });

      if (result.kind !== "reached_review") {
        await db.event.create({
          data: {
            runId: job.runId,
            type: "EASY_APPLY_DRY_RUN_RESULT",
            payload: { kind: result.kind, url: result.url, artifactDir },
            accountId,
            jobPostingId: posting.id,
            applicationId: application.id,
          },
        });
      }

      await db.applicationStep.create({
        data: {
          applicationId: application.id,
          name: "EASY_APPLY_DRY_RUN",
          state: result.kind === "reached_review" ? "succeeded" : "failed",
          detail: { ...result, artifactDir } as any,
        },
      });

      await db.application.update({
        where: { id: application.id },
        data: {
          status: result.kind === "reached_review" ? "needs_review" : "failed",
        },
      });

      if (result.kind === "blocked") {
        await db.event.create({
          data: {
            runId: job.runId,
            type: "LINKEDIN_BLOCKED",
            payload: { blockedReason: result.reason, url: result.url },
            accountId,
            jobPostingId: posting.id,
            applicationId: application.id,
          },
        });
        throw new ApplyFlowError({
          code:
            result.reason === "login_required" ? "blocked_login_required" : "blocked_checkpoint",
          message: `linkedin blocked: ${result.reason}`,
          retryable: false,
        });
      }
      if (result.kind === "failed") {
        throw new Error(result.error);
      }
    } else if (job.type === "EASY_APPLY_SUBMIT") {
      const applicationId = job.applicationId ?? (job.payload as any)?.applicationId;
      if (!applicationId || typeof applicationId !== "string") {
        throw new Error("EASY_APPLY_SUBMIT requires applicationId");
      }

      const application = await db.application.findUnique({
        where: { id: applicationId },
        include: {
          jobPosting: true,
          steps: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!application) throw new Error("application not found");

      const dryRunStep = application.steps.find((s) => s.name === "EASY_APPLY_DRY_RUN");
      const questionsRaw = (dryRunStep?.detail as any)?.questions as any[] | undefined;
      const requiredLabels = new Set<string>();
      if (Array.isArray(questionsRaw)) {
        for (const q of questionsRaw) {
          if (q?.required && typeof q?.label === "string") requiredLabels.add(String(q.label));
        }
      }

      const storedAnswers = await db.applicationAnswer.findMany({
        where: { applicationId },
      });

      // Gate: do not submit unless every required question has an approved answer.
      if (requiredLabels.size > 0) {
        const approvedLabels = new Set(
          storedAnswers
            .filter((a) => a.approved && a.answer !== "NEEDS_HUMAN_INPUT")
            .map((a) => a.questionLabel)
        );
        const missing = [...requiredLabels].filter((l) => !approvedLabels.has(l));
        if (missing.length > 0) {
          await db.application.update({
            where: { id: applicationId },
            data: { status: "needs_review" },
          });
          throw new ApplyFlowError({
            code: "unknown",
            message: `submit blocked: missing approved required answers (${missing.slice(0, 3).join(", ")})`,
            retryable: false,
          });
        }
      }

      const submitAnswers = storedAnswers
        .filter((a) => a.approved && a.answer !== "NEEDS_HUMAN_INPUT")
        .map((a) => ({
          questionLabel: a.questionLabel,
          answer: a.answer,
          requiresApproval: a.requiresApproval,
        }));

      const headful = process.env.HEADFUL ? process.env.HEADFUL === "1" : true;
      const artifactDir =
        process.env.ARTIFACT_DIR ??
        `.local/artifacts/${application.accountId}/${application.id}/${Date.now().toString()}`;

      await db.applicationStep.create({
        data: { applicationId, name: "EASY_APPLY_SUBMIT", state: "started" },
      });

      const result = await submitEasyApply({
        accountId: application.accountId,
        headful,
        jobUrl: application.jobPosting.url,
        answers: submitAnswers,
        artifactDir,
        maxSteps: 30,
      });

      if (result.kind !== "submitted") {
        await db.event.create({
          data: {
            runId: job.runId,
            type: "EASY_APPLY_SUBMIT_RESULT",
            payload: { kind: result.kind, url: result.url, artifactDir },
            accountId: application.accountId,
            jobPostingId: application.jobPostingId,
            applicationId,
          },
        });
      }

      await db.applicationStep.create({
        data: {
          applicationId,
          name: "EASY_APPLY_SUBMIT",
          state: result.kind === "submitted" ? "succeeded" : "failed",
          detail: { ...result, artifactDir } as any,
        },
      });

      if (result.kind === "submitted") {
        await db.application.update({
          where: { id: applicationId },
          data: { status: "submitted" },
        });
      } else if (result.kind === "needs_review") {
        await db.application.update({
          where: { id: applicationId },
          data: { status: "needs_review" },
        });
      } else if (result.kind === "blocked") {
        await db.application.update({ where: { id: applicationId }, data: { status: "blocked" } });
        await db.event.create({
          data: {
            runId: job.runId,
            type: "LINKEDIN_BLOCKED",
            payload: { blockedReason: result.reason, url: result.url },
            accountId: application.accountId,
            jobPostingId: application.jobPostingId,
            applicationId,
          },
        });
        throw new ApplyFlowError({
          code:
            result.reason === "login_required" ? "blocked_login_required" : "blocked_checkpoint",
          message: `linkedin blocked: ${result.reason}`,
          retryable: false,
        });
      } else {
        await db.application.update({ where: { id: applicationId }, data: { status: "failed" } });
        throw new Error(result.error);
      }
    } else if (job.type === "AI_DRAFT_ANSWERS") {
      const applicationId = job.applicationId ?? (job.payload as any)?.applicationId;
      if (!applicationId || typeof applicationId !== "string") {
        throw new Error("AI_DRAFT_ANSWERS requires applicationId");
      }
      if (!candidateProfilePath) {
        throw new Error("CANDIDATE_PROFILE_PATH is required for AI_DRAFT_ANSWERS");
      }

      const dbApplication = await db.application.findUnique({
        where: { id: applicationId },
        include: { steps: { orderBy: { createdAt: "desc" } } },
      });
      if (!dbApplication) throw new Error("application not found");

      const dryRunStep = dbApplication.steps.find((s) => s.name === "EASY_APPLY_DRY_RUN");
      if (!dryRunStep?.detail) throw new Error("missing EASY_APPLY_DRY_RUN detail");

      const detail = dryRunStep.detail as any;
      const questionsRaw = detail.questions as any[] | undefined;
      const questions = Array.isArray(questionsRaw)
        ? questionsRaw.map((q, idx) => ({
            id: typeof q.id === "string" ? q.id : `q_${idx}`,
            label: String(q.label ?? ""),
            kind: q.kind ?? "unknown",
            required: Boolean(q.required),
            options: Array.isArray(q.options) ? q.options.map(String) : undefined,
          }))
        : [];

      const profile = loadCandidateProfile(candidateProfilePath);
      const result = await draftAnswers({ profile, questions });

      const fingerprints = [
        ...new Set(
          questions.map((q) => fingerprintQuestionLabel(q.label)).filter((f) => f.length > 0)
        ),
      ];
      const templates =
        fingerprints.length > 0
          ? await db.answerTemplate.findMany({
              where: {
                fingerprint: { in: fingerprints },
                OR: [{ accountId: dbApplication.accountId }, { accountId: null }],
                approved: true,
              },
            })
          : [];

      const templateByFingerprint = new Map<
        string,
        { answer: string; accountId: string | null; fingerprint: string }
      >();
      // Prefer account-scoped templates over global templates.
      for (const t of templates) {
        const existing = templateByFingerprint.get(t.fingerprint);
        if (!existing) {
          templateByFingerprint.set(t.fingerprint, {
            answer: t.answer,
            accountId: t.accountId ?? null,
            fingerprint: t.fingerprint,
          });
          continue;
        }
        if (existing.accountId === null && t.accountId === dbApplication.accountId) {
          templateByFingerprint.set(t.fingerprint, {
            answer: t.answer,
            accountId: t.accountId ?? null,
            fingerprint: t.fingerprint,
          });
        }
      }

      // Upsert drafts into application_answers (auto-approve when template matches).
      for (const q of questions) {
        const draft = result.answers.find((a) => a.questionId === q.id);
        const existing = await db.applicationAnswer.findUnique({
          where: { applicationId_questionId: { applicationId, questionId: q.id } },
        });

        // Don't overwrite human-edited answers.
        if (existing?.source === "manual") continue;

        const fingerprint = fingerprintQuestionLabel(q.label);
        const template = templateByFingerprint.get(fingerprint);

        const answerText = template?.answer ?? draft?.answer;
        if (!answerText) continue;

        const keepApproved =
          Boolean(existing?.approved) &&
          typeof existing?.answer === "string" &&
          existing.answer === answerText;

        await db.applicationAnswer.upsert({
          where: { applicationId_questionId: { applicationId, questionId: q.id } },
          create: {
            applicationId,
            questionId: q.id,
            questionLabel: q.label,
            required: q.required,
            answer: answerText,
            confidence: template ? 1 : (draft?.confidence ?? 0),
            requiresApproval: template ? false : (draft?.requiresApproval ?? true),
            approved: Boolean(template) || keepApproved,
            source: template ? "template" : "draft",
          },
          update: {
            questionLabel: q.label,
            required: q.required,
            answer: answerText,
            confidence: template ? 1 : (draft?.confidence ?? 0),
            requiresApproval: template ? false : (draft?.requiresApproval ?? true),
            approved: Boolean(template) || keepApproved,
            source: template ? "template" : "draft",
          },
        });
      }

      await db.applicationStep.create({
        data: {
          applicationId,
          name: "AI_DRAFT_ANSWERS",
          state: "succeeded",
          detail: result as any,
        },
      });
    } else {
      // Other job types will be implemented in later PRs.
      logger.info({ jobId, type: job.type }, "no handler yet; completing");
    }

    await completeJob({ jobId, leaseOwner, ok: true });
    logger.info({ jobId }, "job succeeded");
  } catch (error) {
    const failure = asFailure(error);
    logger.error({ jobId, failure }, "job failed");

    // Retry only when allowed and attempts remaining.
    if (
      failure.retryable &&
      job &&
      typeof (job as any).attempts === "number" &&
      typeof (job as any).maxAttempts === "number"
    ) {
      const attempts = (job as any).attempts as number;
      const maxAttempts = (job as any).maxAttempts as number;
      if (attempts < maxAttempts) {
        const delay = computeBackoffMs(attempts);
        await rescheduleJob({
          jobId,
          leaseOwner,
          runAfter: new Date(Date.now() + delay),
          error: `${failure.code}: ${failure.message}`,
        });
        logger.info({ jobId, delayMs: delay }, "job rescheduled");
        continue;
      }
    }

    await completeJob({
      jobId,
      leaseOwner,
      ok: false,
      error: `${failure.code}: ${failure.message}`,
    });
  }
}
