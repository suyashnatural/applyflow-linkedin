import fs from "node:fs";

import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";

import { getConfig } from "@applyflow/config";

import { CandidateProfileSchema, DraftAnswersResultSchema } from "./types.js";
import type { CandidateProfile, DraftAnswersResult, FormQuestion } from "./types.js";

function getClient(): OpenAI {
  const config = getConfig();
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required for AI features");
  return new OpenAI({ apiKey: config.openaiApiKey });
}

export function loadCandidateProfile(profilePath: string): CandidateProfile {
  const raw = fs.readFileSync(profilePath, "utf8");
  const json = JSON.parse(raw) as unknown;
  return CandidateProfileSchema.parse(json);
}

function needsApprovalHeuristic(label: string): boolean {
  const l = label.toLowerCase();
  return (
    l.includes("salary") ||
    l.includes("compensation") ||
    l.includes("sponsorship") ||
    l.includes("visa") ||
    l.includes("work authorization") ||
    l.includes("authorized") ||
    l.includes("relocat") ||
    l.includes("criminal") ||
    l.includes("disability") ||
    l.includes("gender") ||
    l.includes("race") ||
    l.includes("ethnic") ||
    l.includes("veteran")
  );
}

export async function draftAnswers(params: {
  profile: CandidateProfile;
  questions: FormQuestion[];
}): Promise<DraftAnswersResult> {
  const client = getClient();
  const config = getConfig();

  const OutputSchema = DraftAnswersResultSchema;
  const outputJsonSchema = zodToJsonSchema(OutputSchema, { name: "DraftAnswersResult" });

  const system = [
    "You draft answers for job application form questions.",
    "Hard rules:",
    "- Use ONLY the provided resumeFacts/profile fields; do not invent facts.",
    '- If you do not have enough information, set answer to "NEEDS_HUMAN_INPUT" and requiresApproval=true.',
    "- Keep answers concise.",
    "- For select/radio questions with options, choose exactly one of the options, or NEEDS_HUMAN_INPUT.",
    "- Populate usedFacts with exact strings copied from resumeFacts that justify the answer.",
    "",
  ].join("\n");

  const heuristicApprovals = params.questions
    .filter((q) => needsApprovalHeuristic(q.label))
    .map((q) => q.id);

  const user = {
    profile: params.profile,
    questions: params.questions,
    approvalsHeuristicQuestionIds: heuristicApprovals,
  };

  const resp = await client.responses.create({
    model: config.aiModel,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
    // Use JSON schema to enforce structure; model must return valid JSON.
    text: {
      format: {
        type: "json_schema",
        name: "DraftAnswersResult",
        schema: outputJsonSchema as any,
      },
    },
  });

  const text = resp.output_text;
  if (!text) throw new Error("AI response missing output_text");
  const parsed = JSON.parse(text) as unknown;
  return DraftAnswersResultSchema.parse(parsed);
}
