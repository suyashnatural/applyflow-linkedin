-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "notifyLoginRequired" BOOLEAN NOT NULL DEFAULT true,
    "notifyCheckpoint" BOOLEAN NOT NULL DEFAULT true,
    "notifyReadyForReview" BOOLEAN NOT NULL DEFAULT true,
    "notifySubmitted" BOOLEAN NOT NULL DEFAULT true,
    "duplicateCooldownMinutes" INTEGER NOT NULL DEFAULT 120,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_accountId_key" ON "notification_preferences"("accountId");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "linkedin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
