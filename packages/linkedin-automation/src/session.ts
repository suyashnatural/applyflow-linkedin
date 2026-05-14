import fs from "node:fs";
import path from "node:path";

import { getConfig } from "@applyflow/config";
import { logger } from "@applyflow/observability";
import { chromium, type BrowserContext } from "playwright";

export type LinkedInSessionCheckResult =
  | { kind: "ok"; url: string }
  | { kind: "login_required"; url: string }
  | { kind: "checkpoint"; url: string };

function getAccountProfileDir(accountId: string): string {
  const config = getConfig();
  return path.resolve(process.cwd(), config.playwrightUserDataDirBase, accountId);
}

function classifyUrl(url: string): LinkedInSessionCheckResult {
  if (url.includes("/checkpoint/")) return { kind: "checkpoint", url };
  if (url.includes("/login")) return { kind: "login_required", url };
  return { kind: "ok", url };
}

async function openContext(params: {
  accountId: string;
  headful: boolean;
}): Promise<BrowserContext> {
  const userDataDir = getAccountProfileDir(params.accountId);
  fs.mkdirSync(userDataDir, { recursive: true });

  return await chromium.launchPersistentContext(userDataDir, {
    headless: !params.headful,
    viewport: { width: 1280, height: 800 },
  });
}

export async function ensureLinkedInSession(params: {
  accountId: string;
  headful: boolean;
}): Promise<LinkedInSessionCheckResult> {
  const context = await openContext(params);
  const page = await context.newPage();
  try {
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
    const result = classifyUrl(page.url());

    if (result.kind === "ok") return result;

    if (!params.headful) {
      return result;
    }

    logger.info(
      { accountId: params.accountId, url: result.url },
      "linkedin login required; waiting"
    );
    // Give the user time to complete login or resolve checkpoint.
    // Stop waiting once we arrive at /feed or we hit a checkpoint.
    const deadlineMs = Date.now() + 10 * 60_000;
    for (;;) {
      await page.waitForTimeout(1000);
      const current = classifyUrl(page.url());
      if (current.kind === "ok") return current;
      if (current.kind === "checkpoint") return current;
      if (Date.now() > deadlineMs) return current;
    }
  } finally {
    await context.close();
  }
}
