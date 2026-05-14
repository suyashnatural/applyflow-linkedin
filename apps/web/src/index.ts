import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "web boot (placeholder)");

process.stdin.resume();
