import { CronExpressionParser } from "cron-parser";

export const DEFAULT_AUTO_APPLY_CRON = "0 */4 * * *";
export const DEFAULT_AUTO_APPLY_TIMEZONE = "UTC";

export function clampScheduleScore(input: number | null | undefined): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  return Math.max(0, Math.min(100, Math.floor(input)));
}

export function clampScheduleAttempts(input: number | null | undefined): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  return Math.max(0, Math.floor(input));
}

export function computeNextRunAt(params: {
  cron: string;
  timezone?: string | null;
  from?: Date;
}): Date {
  const cron = params.cron.trim();
  const timezone = params.timezone?.trim() || DEFAULT_AUTO_APPLY_TIMEZONE;
  const currentDate = params.from ?? new Date();
  const interval = CronExpressionParser.parse(cron, { currentDate, tz: timezone });
  return interval.next().toDate();
}
