import fs from "node:fs";
import path from "node:path";

import { chromium, type Locator, type Page } from "playwright";

import { getConfig } from "@applyflow/config";

export type SubmitAnswer = {
  questionLabel: string;
  answer: string;
  requiresApproval: boolean;
};

export type EasyApplySubmitResult =
  | { kind: "submitted"; url: string }
  | { kind: "needs_review"; url: string; reason: string; artifactDir?: string }
  | { kind: "blocked"; url: string; reason: "login_required" | "checkpoint"; artifactDir?: string }
  | { kind: "failed"; url: string; error: string; artifactDir?: string };

function classifyUrl(url: string): "ok" | "login" | "checkpoint" {
  if (url.includes("/checkpoint/")) return "checkpoint";
  if (url.includes("/login")) return "login";
  return "ok";
}

async function saveArtifacts(params: { page: Page; artifactDir?: string; name: string }) {
  if (!params.artifactDir) return;
  fs.mkdirSync(params.artifactDir, { recursive: true });
  await params.page.screenshot({
    path: path.join(params.artifactDir, `${params.name}.png`),
    fullPage: true,
  });
}

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

async function fillTextLike(page: Page, label: string, value: string): Promise<boolean> {
  // Try by aria-label first
  const byAria = page
    .locator(`input[aria-label="${label}"], textarea[aria-label="${label}"]`)
    .first();
  if ((await byAria.count()) > 0) {
    await byAria.fill(value);
    return true;
  }

  // Try by label[for]
  const byLabelFor = page.locator(`label:has-text("${label}")`).first();
  if ((await byLabelFor.count()) > 0) {
    const forId = await byLabelFor.getAttribute("for");
    if (forId) {
      const el = page.locator(`#${CSS.escape(forId)}`).first();
      if ((await el.count()) > 0) {
        await el.fill(value);
        return true;
      }
    }
  }

  return false;
}

async function clickFirstVisible(locator: Locator): Promise<boolean> {
  const n = await locator.count();
  for (let i = 0; i < n; i++) {
    const item = locator.nth(i);
    if (await item.isVisible()) {
      await item.click();
      return true;
    }
  }
  return false;
}

export async function submitEasyApply(params: {
  accountId: string;
  headful: boolean;
  jobUrl: string;
  answers: SubmitAnswer[];
  artifactDir?: string;
  maxSteps: number;
}): Promise<EasyApplySubmitResult> {
  const config = getConfig();
  const userDataDir = `${config.playwrightUserDataDirBase}/${params.accountId}`;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !params.headful,
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await context.newPage();
    await page.goto(params.jobUrl, { waitUntil: "domcontentloaded" });

    const state = classifyUrl(page.url());
    if (state === "login" || state === "checkpoint") {
      if (params.artifactDir)
        await saveArtifacts({ page, artifactDir: params.artifactDir, name: "blocked" });
      else await saveArtifacts({ page, name: "blocked" });
      const base = {
        kind: "blocked" as const,
        url: page.url(),
        reason: state === "login" ? ("login_required" as const) : ("checkpoint" as const),
      };
      return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
    }

    const easyApplyButton = page.locator('button:has-text("Easy Apply")').first();
    if ((await easyApplyButton.count()) === 0) {
      if (params.artifactDir)
        await saveArtifacts({ page, artifactDir: params.artifactDir, name: "not-easy-apply" });
      else await saveArtifacts({ page, name: "not-easy-apply" });
      const base = { kind: "needs_review" as const, url: page.url(), reason: "not_easy_apply" };
      return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
    }

    await easyApplyButton.click({ timeout: 10_000 });

    const answerByLabel = new Map<string, SubmitAnswer>();
    for (const a of params.answers) {
      answerByLabel.set(normalizeLabel(a.questionLabel), a);
    }

    for (let step = 0; step < params.maxSteps; step++) {
      // Stop if blocked mid-flow
      const s2 = classifyUrl(page.url());
      if (s2 === "login" || s2 === "checkpoint") {
        if (params.artifactDir)
          await saveArtifacts({ page, artifactDir: params.artifactDir, name: `blocked-${step}` });
        else await saveArtifacts({ page, name: `blocked-${step}` });
        const base = {
          kind: "blocked" as const,
          url: page.url(),
          reason: s2 === "login" ? ("login_required" as const) : ("checkpoint" as const),
        };
        return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
      }

      // Fill visible text inputs based on captured labels
      const inputs = await page
        .locator("input[aria-label], textarea[aria-label]")
        .evaluateAll((els) =>
          els
            .map((e) => (e as HTMLElement).getAttribute("aria-label") || "")
            .map((s) => s.trim())
            .filter(Boolean)
        );

      for (const label of inputs) {
        const match = answerByLabel.get(normalizeLabel(label));
        if (!match) continue;
        if (match.requiresApproval) {
          if (params.artifactDir) {
            await saveArtifacts({
              page,
              artifactDir: params.artifactDir,
              name: `needs-approval-${step}`,
            });
          } else {
            await saveArtifacts({ page, name: `needs-approval-${step}` });
          }
          const base = {
            kind: "needs_review" as const,
            url: page.url(),
            reason: `answer_requires_approval:${label}`,
          };
          return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
        }
        if (match.answer === "NEEDS_HUMAN_INPUT") {
          if (params.artifactDir) {
            await saveArtifacts({
              page,
              artifactDir: params.artifactDir,
              name: `needs-human-${step}`,
            });
          } else {
            await saveArtifacts({ page, name: `needs-human-${step}` });
          }
          const base = {
            kind: "needs_review" as const,
            url: page.url(),
            reason: `needs_human_input:${label}`,
          };
          return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
        }
        await fillTextLike(page, label, match.answer);
      }

      // If submit is visible, do it
      const submit = page.locator('button:has-text("Submit application")').first();
      if ((await submit.count()) > 0) {
        await submit.click({ timeout: 10_000 });
        await page.waitForTimeout(1000);
        if (params.artifactDir)
          await saveArtifacts({ page, artifactDir: params.artifactDir, name: "submitted" });
        else await saveArtifacts({ page, name: "submitted" });
        return { kind: "submitted", url: page.url() };
      }

      // Otherwise advance
      const next = page.locator('button:has-text("Next"), button:has-text("Continue")');
      const clicked = await clickFirstVisible(next);
      if (!clicked) {
        if (params.artifactDir)
          await saveArtifacts({ page, artifactDir: params.artifactDir, name: `stuck-${step}` });
        else await saveArtifacts({ page, name: `stuck-${step}` });
        const base = {
          kind: "needs_review" as const,
          url: page.url(),
          reason: "no_next_or_submit",
        };
        return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
      }
      await page.waitForTimeout(500);
    }

    if (params.artifactDir)
      await saveArtifacts({ page, artifactDir: params.artifactDir, name: "max-steps" });
    else await saveArtifacts({ page, name: "max-steps" });
    const base = { kind: "failed" as const, url: page.url(), error: "max_steps_reached" };
    return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const base = { kind: "failed" as const, url: params.jobUrl, error: message };
    return params.artifactDir ? { ...base, artifactDir: params.artifactDir } : base;
  } finally {
    await context.close();
  }
}
