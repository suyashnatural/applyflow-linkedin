import { redactSecrets } from "@applyflow/config";

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

function levelRank(level: LogLevel): number {
  switch (level) {
    case "fatal":
      return 60;
    case "error":
      return 50;
    case "warn":
      return 40;
    case "info":
      return 30;
    case "debug":
      return 20;
    case "trace":
      return 10;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function getMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (
    raw === "fatal" ||
    raw === "error" ||
    raw === "warn" ||
    raw === "info" ||
    raw === "debug" ||
    raw === "trace"
  ) {
    return raw;
  }
  return "info";
}

const minLevel = getMinLevel();

export const logger = {
  info(obj: Record<string, unknown> | undefined, msg: string) {
    if (levelRank("info") < levelRank(minLevel)) return;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(redactSecrets({ level: "info", time: nowIso(), msg, ...obj })));
  },
  error(obj: Record<string, unknown> | undefined, msg: string) {
    if (levelRank("error") < levelRank(minLevel)) return;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(redactSecrets({ level: "error", time: nowIso(), msg, ...obj })));
  },
};
