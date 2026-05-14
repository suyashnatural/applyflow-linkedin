import { chromium } from "playwright";

import { getConfig } from "@applyflow/config";

export type LinkedInJobCard = {
  linkedInJobId: string;
  url: string;
};

function buildSearchUrl(params: { keywords: string; location?: string }): string {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", params.keywords);
  if (params.location) url.searchParams.set("location", params.location);
  return url.toString();
}

function parseJobIdFromUrl(url: string): string | null {
  // Typical patterns:
  // - /jobs/view/<jobId>/
  // - ...currentJobId=<jobId>
  try {
    const u = new URL(url);
    const fromQuery = u.searchParams.get("currentJobId");
    if (fromQuery) return fromQuery;

    const parts = u.pathname.split("/").filter(Boolean);
    const viewIdx = parts.findIndex((p) => p === "view");
    if (viewIdx >= 0) return parts[viewIdx + 1] ?? null;
    return null;
  } catch {
    return null;
  }
}

export async function discoverLinkedInJobs(params: {
  accountId: string;
  headful: boolean;
  keywords: string;
  location?: string;
  maxCards: number;
}): Promise<LinkedInJobCard[]> {
  const config = getConfig();
  const userDataDir = `${config.playwrightUserDataDirBase}/${params.accountId}`;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !params.headful,
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await context.newPage();
    const searchParams: { keywords: string; location?: string } = { keywords: params.keywords };
    if (params.location) searchParams.location = params.location;

    await page.goto(buildSearchUrl(searchParams), {
      waitUntil: "domcontentloaded",
    });

    const links = await page.$$eval("a[href*='/jobs/view/']", (elements) =>
      Array.from(new Set(elements.map((e) => (e as HTMLAnchorElement).href))).slice(0, 500)
    );

    const cards: LinkedInJobCard[] = [];
    for (const url of links) {
      const id = parseJobIdFromUrl(url);
      if (!id) continue;
      cards.push({ linkedInJobId: id, url });
      if (cards.length >= params.maxCards) break;
    }

    return cards;
  } finally {
    await context.close();
  }
}
