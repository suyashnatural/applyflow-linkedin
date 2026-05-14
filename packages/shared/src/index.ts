import { z } from "zod";

export const RunIdSchema = z.string().min(1);
export type RunId = z.infer<typeof RunIdSchema>;

export const LinkedInAccountIdSchema = z.string().min(1);
export type LinkedInAccountId = z.infer<typeof LinkedInAccountIdSchema>;
