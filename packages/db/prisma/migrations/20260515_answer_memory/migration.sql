-- CreateTable
CREATE TABLE "application_answers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionLabel" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "answer" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'draft',

    CONSTRAINT "application_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_templates" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "answer_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_answers_applicationId_approved_idx" ON "application_answers"("applicationId", "approved");

-- CreateIndex
CREATE UNIQUE INDEX "application_answers_applicationId_questionId_key" ON "application_answers"("applicationId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "answer_templates_accountId_fingerprint_key" ON "answer_templates"("accountId", "fingerprint");

-- AddForeignKey
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

