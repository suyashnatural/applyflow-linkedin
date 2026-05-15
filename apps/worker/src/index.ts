import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";
import { completeJob, leaseNextJob } from "@applyflow/queue";
import { getDb } from "@applyflow/db";
import { draftAnswers, loadCandidateProfile } from "@applyflow/ai";
import {
  discoverLinkedInJobs,
  easyApplyDryRun,
  ensureLinkedInSession,
  fetchLinkedInJobDetail,
  submitEasyApply,
} from "@applyflow/linkedin-automation";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "worker boot");

const leaseOwner = process.env.WORKER_ID ?? `worker-${process.pid}`;
const pollMs = Number.parseInt(process.env.WORKER_POLL_MS ?? "1000", 10);
const leaseMs = Number.parseInt(process.env.WORKER_LEASE_MS ?? "30000", 10);
const candidateProfilePath = process.env.CANDIDATE_PROFILE_PATH;

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
          throw new Error(`linkedin blocked: ${detail.blockedReason}`);
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
              where: { accountId, easyApply: true },
              orderBy: { discoveredAt: "desc" },
            });

      if (!posting) throw new Error("no eligible JobPosting found for EASY_APPLY_ATTEMPT");

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
        throw new Error(`linkedin blocked: ${result.reason}`);
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
      const questionIdToLabel = new Map<string, string>();
      if (Array.isArray(questionsRaw)) {
        for (const q of questionsRaw) {
          if (typeof q?.id === "string" && typeof q?.label === "string") {
            questionIdToLabel.set(q.id, q.label);
          }
        }
      }

      const aiStep = application.steps.find((s) => s.name === "AI_DRAFT_ANSWERS");
      if (!aiStep?.detail) {
        throw new Error("missing AI_DRAFT_ANSWERS (cannot submit without drafts)");
      }

      const answers = (aiStep.detail as any)?.answers as any[] | undefined;
      if (!Array.isArray(answers)) throw new Error("invalid AI_DRAFT_ANSWERS detail");

      const submitAnswers = answers
        .filter((a) => typeof a?.answer === "string" && typeof a?.questionId === "string")
        .map((a) => ({
          questionLabel: questionIdToLabel.get(String(a.questionId)) ?? String(a.questionId),
          answer: String(a.answer),
          requiresApproval: Boolean(a.requiresApproval),
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
        throw new Error(`linkedin blocked: ${result.reason}`);
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
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ jobId, err: message }, "job failed");
    await completeJob({ jobId, leaseOwner, ok: false, error: message });
  }
}
