import { z } from "zod";

export const CandidateProfileSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  linkedInUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  workAuthorization: z
    .object({
      country: z.string().min(1),
      authorized: z.boolean(),
      needsSponsorship: z.boolean().optional(),
    })
    .optional(),
  // Free-form resume facts; AI must not invent beyond these.
  resumeFacts: z.array(z.string().min(1)).min(1),
});
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;

export const FormQuestionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["text", "textarea", "select", "radio", "checkbox", "unknown"]),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1)).optional(),
});
export type FormQuestion = z.infer<typeof FormQuestionSchema>;

export const DraftAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1),
  confidence: z.number().min(0).max(1),
  requiresApproval: z.boolean(),
  rationale: z.string().min(1),
  usedFacts: z.array(z.string().min(1)).default([]),
});
export type DraftAnswer = z.infer<typeof DraftAnswerSchema>;

export const DraftAnswersResultSchema = z.object({
  answers: z.array(DraftAnswerSchema),
  warnings: z.array(z.string()).default([]),
});
export type DraftAnswersResult = z.infer<typeof DraftAnswersResultSchema>;
