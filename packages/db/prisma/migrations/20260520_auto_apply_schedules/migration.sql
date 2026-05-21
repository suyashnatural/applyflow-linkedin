-- CreateTable
CREATE TABLE "auto_apply_schedules" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "maxAttempts" INTEGER,
    "minScore" INTEGER,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastTriggeredAt" TIMESTAMP(3),

    CONSTRAINT "auto_apply_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_apply_schedules_accountId_key" ON "auto_apply_schedules"("accountId");

-- CreateIndex
CREATE INDEX "auto_apply_schedules_enabled_nextRunAt_idx" ON "auto_apply_schedules"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "auto_apply_schedules" ADD CONSTRAINT "auto_apply_schedules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "linkedin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
