import { z } from "zod";

export const QueueJobTypeSchema = z.enum([
  "LINKEDIN_SESSION_BOOTSTRAP",
  "DISCOVER_LINKEDIN_JOBS",
  "SYNC_JOB_DETAILS",
  "EASY_APPLY_ATTEMPT",
  "EASY_APPLY_SUBMIT",
  "AI_DRAFT_ANSWERS",
]);
export type QueueJobType = z.infer<typeof QueueJobTypeSchema>;

export const EnqueueJobRequestSchema = z.object({
  type: QueueJobTypeSchema,
  runId: z.string().min(1),
  priority: z.number().int().default(0),
  runAfter: z.date().optional(),
  payload: z.unknown().optional(),
  accountId: z.string().min(1).optional(),
  jobPostingId: z.string().min(1).optional(),
  applicationId: z.string().min(1).optional(),
});
export type EnqueueJobRequest = z.infer<typeof EnqueueJobRequestSchema>;

export type LeaseResult = { kind: "leased"; jobId: string } | { kind: "none" };
