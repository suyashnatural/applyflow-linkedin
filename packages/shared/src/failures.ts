import { z } from "zod";

export const FailureCodeSchema = z.enum([
  "blocked_login_required",
  "blocked_checkpoint",
  "selector_missing",
  "timeout",
  "network",
  "unknown",
]);
export type FailureCode = z.infer<typeof FailureCodeSchema>;

export const FailureSchema = z.object({
  code: FailureCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type Failure = z.infer<typeof FailureSchema>;

export class ApplyFlowError extends Error {
  public readonly failure: Failure;

  constructor(failure: Failure) {
    super(failure.message);
    this.name = "ApplyFlowError";
    this.failure = failure;
  }
}

export function asFailure(error: unknown): Failure {
  if (error instanceof ApplyFlowError) return error.failure;
  const message = error instanceof Error ? error.message : String(error);
  return { code: "unknown", message, retryable: true };
}
