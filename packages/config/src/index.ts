import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

export { redactSecrets } from "./redaction.js";

const LogLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);

const AppConfigSchema = z.object({
  nodeEnv: z.string().default("development"),
  databaseUrl: z
    .string()
    .min(1)
    .default("postgresql://applyflow:applyflow@localhost:5432/applyflow?schema=public"),
  logLevel: LogLevelSchema.default("info"),
  openaiApiKey: z.string().min(1).optional(),
  aiModel: z.string().min(1).default("gpt-4.1-mini"),
  playwrightUserDataDirBase: z.string().min(1).default(".local/linkedin-profiles"),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

let cachedConfig: AppConfig | undefined;

function repoRootFromHere(): string {
  // packages/config/src -> repo root
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..");
}

function loadEnvOnce(): void {
  if (process.env.__APPLYFLOW_ENV_LOADED === "1") return;
  process.env.__APPLYFLOW_ENV_LOADED = "1";

  const envPath = process.env.APPLYFLOW_ENV_PATH ?? path.join(repoRootFromHere(), ".env");
  if (fs.existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
}

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  loadEnvOnce();

  const parsed = AppConfigSchema.safeParse({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    logLevel: process.env.LOG_LEVEL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    aiModel: process.env.AI_MODEL,
    playwrightUserDataDirBase: process.env.PLAYWRIGHT_USER_DATA_DIR_BASE,
  });

  if (!parsed.success) {
    const error = parsed.error.flatten();
    throw new Error(`Invalid configuration: ${JSON.stringify(error)}`);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}
