import { chromium } from "playwright";

import { getConfig } from "@applyflow/config";

export type LinkedInJobDetail = {
  url: string;
  title?: string;
  companyName?: string;
  location?: string;
  workplaceType?: string;
  description?: string;
  easyApply: boolean;
  blockedReason?: "login_required" | "checkpoint";
};

function classifyUrl(url: string): "ok" | "login" | "checkpoint" {
  if (url.includes("/checkpoint/")) return "checkpoint";
  if (url.includes("/login")) return "login";
  return "ok";
}

function cleanText(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const s = input.replace(/\s+/g, " ").trim();
  return s.length ? s : undefined;
}

export async function fetchLinkedInJobDetail(params: {
  accountId: string;
  headful: boolean;
  url: string;
}): Promise<LinkedInJobDetail> {
  const config = getConfig();
  const userDataDir = `${config.playwrightUserDataDirBase}/${params.accountId}`;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !params.headful,
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await context.newPage();
    await page.goto(params.url, { waitUntil: "domcontentloaded" });

    const state = classifyUrl(page.url());
    if (state === "login" || state === "checkpoint") {
      return {
        url: page.url(),
        easyApply: false,
        blockedReason: state === "login" ? "login_required" : "checkpoint",
      };
    }

    // Title
    const title = cleanText(await page.textContent("h1"));

    // Company/location block varies; this is best-effort and will be hardened later.
    const companyName = cleanText(
      await page.textContent("a[href*='/company/'], a[href*='/school/']")
    );

    const location = cleanText(
      await page.textContent(
        "[class*='job-details-jobs-unified-top-card__primary-description'] span, [class*='job-details-jobs-unified-top-card__primary-description']"
      )
    );

    // Workplace type sometimes appears as a chip in the top card (Remote/Hybrid/On-site)
    const workplaceType = cleanText(
      await page.textContent("[aria-label*='Workplace type'], [class*='workplace-type']")
    );

    // Description
    const description = cleanText(
      await page.textContent(
        "#job-details, [class*='jobs-description__content'], [class*='jobs-box__html-content']"
      )
    );

    // Easy Apply detection
    const easyApply = (await page.locator('button:has-text("Easy Apply")').count()) > 0;

    const detail: LinkedInJobDetail = { url: page.url(), easyApply };
    if (title) detail.title = title;
    if (companyName) detail.companyName = companyName;
    if (location) detail.location = location;
    if (workplaceType) detail.workplaceType = workplaceType;
    if (description) detail.description = description;
    return detail;
  } finally {
    await context.close();
  }
}
