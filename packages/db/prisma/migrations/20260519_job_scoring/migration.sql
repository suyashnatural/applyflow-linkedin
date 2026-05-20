-- Add job scoring fields
ALTER TABLE "job_postings"
ADD COLUMN "score" INTEGER,
ADD COLUMN "scoreReason" TEXT,
ADD COLUMN "scoredAt" TIMESTAMP(3);

-- Helpful for selecting candidate postings by score
CREATE INDEX "job_postings_accountId_score_idx" ON "job_postings" ("accountId", "score");

