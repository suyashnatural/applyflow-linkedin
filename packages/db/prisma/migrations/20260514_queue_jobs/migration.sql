-- CreateEnum
CREATE TYPE "QueueJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled');

-- CreateTable
CREATE TABLE "queue_jobs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "status" "QueueJobStatus" NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "error" TEXT,
    "runId" TEXT NOT NULL,
    "accountId" TEXT,
    "jobPostingId" TEXT,
    "applicationId" TEXT,

    CONSTRAINT "queue_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queue_jobs_status_runAfter_priority_idx" ON "queue_jobs"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "queue_jobs_leaseOwner_leasedUntil_idx" ON "queue_jobs"("leaseOwner", "leasedUntil");

