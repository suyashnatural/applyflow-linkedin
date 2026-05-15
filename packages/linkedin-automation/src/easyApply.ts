import fs from "node:fs";
import path from "node:path";

import { chromium, type Page } from "playwright";

import { getConfig } from "@applyflow/config";

export type EasyApplyDryRunResult =
  | { kind: "not_easy_apply"; url: string }
  | { kind: "blocked"; url: string; reason: "login_required" | "checkpoint" }
  | { kind: "reached_review"; url: string; steps: number; questions: CapturedQuestion[] }
  | { kind: "failed"; url: string; error: string; steps: number; artifactDir?: string };

export type CapturedQuestion = {
  id: string;
  label: string;
  kind: "text" | "textarea" | "select" | "radio" | "checkbox" | "unknown";
  required: boolean;
  options?: string[];
};

function classifyUrl(url: string): "ok" | "login" | "checkpoint" {
  if (url.includes("/checkpoint/")) return "checkpoint";
  if (url.includes("/login")) return "login";
  return "ok";
}

async function captureVisibleQuestions(page: Page): Promise<CapturedQuestion[]> {
  const raw = await page.evaluate(() => {
    const out: Array<{
      id: string;
      label: string;
      kind: "text" | "textarea" | "select" | "radio" | "checkbox" | "unknown";
      required: boolean;
      options?: string[];
    }> = [];

    // Heuristic: LinkedIn Easy Apply modal uses forms with labels near inputs.
    // We capture anything with aria-label or associated label text.
    const candidates = Array.from(document.querySelectorAll("input, textarea, select")) as Array<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >;

    let seq = 0;
    const seen = new Set<string>();

    function getLabel(el: Element): string | null {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return aria.trim();

      const id = (el as HTMLElement).id;
      if (id) {
        const l = document.querySelector(`label[for='${CSS.escape(id)}']`);
        if (l?.textContent) return l.textContent.trim();
      }

      const wrapper = el.closest("label");
      if (wrapper?.textContent) return wrapper.textContent.trim();

      // Try a nearby preceding label-ish element
      const container = el.closest("div");
      const text = container?.querySelector("label, span, p")?.textContent;
      return text ? text.trim() : null;
    }

    for (const el of candidates) {
      const label = getLabel(el);
      if (!label) continue;
      const key = `${label}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const required = (el as any).required === true || el.getAttribute("aria-required") === "true";

      let kind: CapturedQuestion["kind"] = "unknown";
      let options: string[] | undefined;

      if (el.tagName === "TEXTAREA") kind = "textarea";
      else if (el.tagName === "SELECT") {
        kind = "select";
        options = Array.from((el as HTMLSelectElement).options)
          .map((o) => o.textContent?.trim() ?? "")
          .filter(Boolean);
      } else if (el.tagName === "INPUT") {
        const t = (el as HTMLInputElement).type;
        if (t === "checkbox") kind = "checkbox";
        else if (t === "radio") kind = "radio";
        else kind = "text";
      }

      const id = (el as HTMLElement).id || `q_${seq++}`;
      const q: any = { id, label, kind, required };
      if (options && options.length > 0) q.options = options;
      out.push(q);
    }

    return out;
  });
  return raw as CapturedQuestion[];
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
    const questions: CapturedQuestion[] = [];

    // Attempt to click through the modal until we reach a review-like step.
    for (; steps < params.maxSteps; steps++) {
      // Capture questions visible at each step (dedup by label).
      const captured = await captureVisibleQuestions(page);
      for (const q of captured) {
        if (!questions.some((x) => x.label === q.label)) questions.push(q);
      }

      const review = page.locator(':is(h2,h3):has-text("Review")').first();
      if ((await review.count()) > 0) {
        return { kind: "reached_review", url: page.url(), steps, questions };
      }

      const submit = page.locator('button:has-text("Submit application")').first();
      if ((await submit.count()) > 0) {
        // Treat submit as equivalent to review stop point for dry-run.
        return { kind: "reached_review", url: page.url(), steps, questions };
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
