export type AppConfig = {
  nodeEnv: string;
  databaseUrl: string;
  logLevel: string;
  openaiApiKey?: string;
  aiModel: string;
  playwrightUserDataDirBase: string;
};

export function getConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://applyflow:applyflow@localhost:5432/applyflow?schema=public";
  const logLevel = process.env.LOG_LEVEL ?? "info";
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const aiModel = process.env.AI_MODEL ?? "gpt-4.1-mini";
  const playwrightUserDataDirBase =
    process.env.PLAYWRIGHT_USER_DATA_DIR_BASE ?? ".local/linkedin-profiles";

  const base: Omit<AppConfig, "openaiApiKey"> = {
    nodeEnv,
    databaseUrl,
    logLevel,
    aiModel,
    playwrightUserDataDirBase,
  };

  if (!openaiApiKey) return base;
  return { ...base, openaiApiKey };
}
