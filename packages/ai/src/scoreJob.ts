import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";

import { getConfig } from "@applyflow/config";

import { CandidateProfileSchema, JobScoreSchema } from "./types.js";
import type { CandidateProfile, JobScore } from "./types.js";

function getClient(): OpenAI {
  const config = getConfig();
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required for AI features");
  return new OpenAI({ apiKey: config.openaiApiKey });
}

export async function scoreJobPosting(params: {
  profile: CandidateProfile;
  job: {
    title?: string | null;
    companyName?: string | null;
    location?: string | null;
    description?: string | null;
  };
}): Promise<JobScore> {
  const config = getConfig();
  const client = getClient();

  // Validate profile early (and ensure resumeFacts exists).
  CandidateProfileSchema.parse(params.profile);

  const outputJsonSchema = zodToJsonSchema(JobScoreSchema, { name: "JobScore" });

  const system = [
    "You score how good a LinkedIn job posting is for a candidate.",
    "Scoring rules:",
    "- Output score as an integer from 0 to 100.",
    "- Use ONLY the provided candidate profile/resumeFacts and job data; do not invent facts.",
    "- If job data is insufficient (missing description), still score with uncertainty and add warnings.",
    "- Rationale should be concise (1-3 sentences).",
  ].join("\n");

  const user = {
    candidateProfile: params.profile,
    job: {
      title: params.job.title ?? null,
      companyName: params.job.companyName ?? null,
      location: params.job.location ?? null,
      description: params.job.description ?? null,
    },
  };

  const resp = await client.responses.create({
    model: config.aiModel,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "JobScore",
        schema: outputJsonSchema as any,
      },
    },
  });

  const text = resp.output_text;
  if (!text) throw new Error("AI response missing output_text");
  const parsed = JSON.parse(text) as unknown;
  return JobScoreSchema.parse(parsed);
}
