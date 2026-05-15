import { getDb } from "@applyflow/db";
import { QueueJobStatus, Prisma } from "@prisma/client";

import type { EnqueueJobRequest, LeaseResult } from "./types.js";
import { EnqueueJobRequestSchema } from "./types.js";

export async function enqueueJob(request: EnqueueJobRequest): Promise<string> {
  const parsed = EnqueueJobRequestSchema.parse(request);
  const db = getDb();
  const data: Record<string, unknown> = {
    type: parsed.type,
    status: QueueJobStatus.queued,
    priority: parsed.priority,
    runAfter: parsed.runAfter ?? new Date(),
    runId: parsed.runId,
  };

  if (parsed.payload !== undefined) data.payload = parsed.payload;
  if (parsed.accountId !== undefined) data.accountId = parsed.accountId;
  if (parsed.jobPostingId !== undefined) data.jobPostingId = parsed.jobPostingId;
  if (parsed.applicationId !== undefined) data.applicationId = parsed.applicationId;

  const job = await db.queueJob.create({
    data: {
      ...(data as any),
    },
    select: { id: true },
  });
  return job.id;
}

export async function leaseNextJob(params: {
  leaseOwner: string;
  leaseMs: number;
}): Promise<LeaseResult> {
  const db = getDb();
  const now = new Date();
  const leasedUntil = new Date(now.getTime() + params.leaseMs);

  return await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const candidate = await tx.queueJob.findFirst({
      where: {
        status: QueueJobStatus.queued,
        runAfter: { lte: now },
        OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      select: { id: true, attempts: true, maxAttempts: true },
    });

    if (!candidate) return { kind: "none" } as const;
    if (candidate.attempts >= candidate.maxAttempts) {
      await tx.queueJob.update({
        where: { id: candidate.id },
        data: { status: QueueJobStatus.failed, error: "max_attempts_exceeded" },
      });
      return { kind: "none" } as const;
    }

    await tx.queueJob.update({
      where: { id: candidate.id },
      data: {
        status: QueueJobStatus.running,
        leaseOwner: params.leaseOwner,
        leasedUntil,
        attempts: { increment: 1 },
      },
    });

    return { kind: "leased", jobId: candidate.id } as const;
  });
}

export async function completeJob(params: {
  jobId: string;
  leaseOwner: string;
  ok: boolean;
  error?: string;
}): Promise<void> {
  const db = getDb();
  const job = await db.queueJob.findUnique({
    where: { id: params.jobId },
    select: { leaseOwner: true, status: true },
  });
  if (!job) throw new Error(`queue job not found: ${params.jobId}`);
  if (job.leaseOwner !== params.leaseOwner) {
    throw new Error(`lease owner mismatch for job ${params.jobId}`);
  }

  await db.queueJob.update({
    where: { id: params.jobId },
    data: {
      status: params.ok ? QueueJobStatus.succeeded : QueueJobStatus.failed,
      error: params.ok ? null : (params.error ?? "unknown_error"),
      leasedUntil: null,
    },
  });
}

export async function rescheduleJob(params: {
  jobId: string;
  leaseOwner: string;
  runAfter: Date;
  error?: string;
}): Promise<void> {
  const db = getDb();
  const job = await db.queueJob.findUnique({
    where: { id: params.jobId },
    select: { leaseOwner: true },
  });
  if (!job) throw new Error(`queue job not found: ${params.jobId}`);
  if (job.leaseOwner !== params.leaseOwner) {
    throw new Error(`lease owner mismatch for job ${params.jobId}`);
  }

  await db.queueJob.update({
    where: { id: params.jobId },
    data: {
      status: QueueJobStatus.queued,
      runAfter: params.runAfter,
      error: params.error ?? null,
      leasedUntil: null,
    },
  });
}
