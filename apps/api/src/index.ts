import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";

const config = getConfig();
logger.info({ env: config.nodeEnv }, "api boot");

// Placeholder: PR-003 will introduce DB wiring + routes.
process.stdin.resume();
