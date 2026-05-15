import fs from "node:fs";
import path from "node:path";

import type { BrowserContext, Page } from "playwright";

export type ArtifactBundle = {
  dir: string;
  screenshots: string[];
  traceZip?: string;
};

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export async function captureScreenshot(params: {
  page: Page;
  dir: string;
  name: string;
}): Promise<string> {
  ensureDir(params.dir);
  const file = path.join(params.dir, `${params.name}.png`);
  await params.page.screenshot({ path: file, fullPage: true });
  return file;
}

export async function startTrace(params: { context: BrowserContext }): Promise<void> {
  await params.context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });
}

export async function stopTrace(params: {
  context: BrowserContext;
  dir: string;
  name: string;
}): Promise<string> {
  ensureDir(params.dir);
  const file = path.join(params.dir, `${params.name}.zip`);
  await params.context.tracing.stop({ path: file });
  return file;
}
