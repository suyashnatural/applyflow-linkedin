import fs from "node:fs";
import path from "node:path";

import { chromium, type Page } from "playwright";

import { getConfig } from "@applyflow/config";

export type EasyApplyDryRunResult =
  | { kind: "not_easy_apply"; url: string }
  | { kind: "blocked"; url: string; reason: "login_required" | "checkpoint" }
  | { kind: "reached_review"; url: string; steps: number }
  | { kind: "failed"; url: string; error: string; steps: number; artifactDir?: string };

function classifyUrl(url: string): "ok" | "login" | "checkpoint" {
  if (url.includes("/checkpoint/")) return "checkpoint";
  if (url.includes("/login")) return "login";
  return "ok";
}

async function maybeSaveArtifacts(params: {
  page: Page;
  artifactDir?: string;
  name: string;
}): Promise<string | undefined> {
  if (!params.artifactDir) return undefined;
  fs.mkdirSync(params.artifactDir, { recursive: true });
  const file = path.join(params.artifactDir, `${params.name}.png`);
  await params.page.screenshot({ path: file, fullPage: true });
  return params.artifactDir;
}

export async function easyApplyDryRun(params: {
  accountId: string;
  headful: boolean;
  url: string;
  maxSteps: number;
  artifactDir?: string;
}): Promise<EasyApplyDryRunResult> {
  const config = getConfig();
  const userDataDir = `${config.playwrightUserDataDirBase}/${params.accountId}`;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !params.headful,
    viewport: { width: 1280, height: 800 },
  });

  let steps = 0;
  try {
    const page = await context.newPage();
    await page.goto(params.url, { waitUntil: "domcontentloaded" });

    const state = classifyUrl(page.url());
    if (state === "login" || state === "checkpoint") {
      return {
        kind: "blocked",
        url: page.url(),
        reason: state === "login" ? "login_required" : "checkpoint",
      };
    }

    const easyApplyButton = page.locator('button:has-text("Easy Apply")').first();
    if ((await easyApplyButton.count()) === 0) {
      return { kind: "not_easy_apply", url: page.url() };
    }

    await easyApplyButton.click({ timeout: 10_000 });
    steps++;

    // Attempt to click through the modal until we reach a review-like step.
    for (; steps < params.maxSteps; steps++) {
      const review = page.locator(':is(h2,h3):has-text("Review")').first();
      if ((await review.count()) > 0) {
        return { kind: "reached_review", url: page.url(), steps };
      }

      const submit = page.locator('button:has-text("Submit application")').first();
      if ((await submit.count()) > 0) {
        // Treat submit as equivalent to review stop point for dry-run.
        return { kind: "reached_review", url: page.url(), steps };
      }

      const next = page
        .locator('button:has-text("Next"), button:has-text("Continue")')
        .filter({ hasNotText: "Review" })
        .first();

      if ((await next.count()) === 0) {
        if (params.artifactDir) {
          await maybeSaveArtifacts({
            page,
            artifactDir: params.artifactDir,
            name: `stuck-${steps}`,
          });
        }

        const base = {
          kind: "failed" as const,
          url: page.url(),
          error: "no next/continue/review/submit button found",
          steps,
        };

        return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
      }

      await next.click({ timeout: 10_000 });
      await page.waitForTimeout(500);
    }

    if (params.artifactDir) {
      await maybeSaveArtifacts({
        page,
        artifactDir: params.artifactDir,
        name: `max-steps-${steps}`,
      });
    }

    const base = {
      kind: "failed" as const,
      url: page.url(),
      error: "max steps reached",
      steps,
    };

    return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const pages = context.pages();
      const page = pages[0];
      if (page && params.artifactDir) {
        await maybeSaveArtifacts({
          page,
          artifactDir: params.artifactDir,
          name: `error-${steps}`,
        });
      }
    } catch {
      // ignore
    }

    const base = { kind: "failed" as const, url: params.url, error: message, steps };
    return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
  } finally {
    await context.close();
  }
}
