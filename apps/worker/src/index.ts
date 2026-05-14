import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "worker boot");

// Placeholder: PR-004 will introduce queue + job handlers.
process.stdin.resume();
