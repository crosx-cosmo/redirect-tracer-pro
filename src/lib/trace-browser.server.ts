/**
 * Headless-browser fallback.
 *
 * The app runs in a serverless edge runtime, which cannot host Chromium, so
 * pages that navigate through *computed* JavaScript are rendered by an external
 * isolated browser service. Nothing user-supplied is ever executed here: only
 * the URL is handed to the remote browser, which runs it in its own sandbox.
 *
 * Configure with the secrets:
 *   BROWSERLESS_TOKEN     (required to enable the fallback)
 *   BROWSERLESS_BASE_URL  (optional, defaults to production-sfo.browserless.io)
 *
 * When it is not configured the engine reports that exact reason on the hop
 * instead of pretending the chain is complete.
 */

export interface BrowserTraceResult {
  ok: boolean;
  /** Why the fallback could not run / did not resolve anything. */
  reason: string | null;
  finalUrl: string | null;
  navigations: Array<{ url: string; ms: number }>;
  elapsedMs: number;
}

const RENDER_SCRIPT = `
export default async function ({ page, context }) {
  const navigations = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push({ url: frame.url(), ms: Date.now() });
  });
  await page.goto(context.url, { waitUntil: 'networkidle2', timeout: context.timeout });
  await page.waitForTimeout(1500).catch(() => {});
  return {
    data: { finalUrl: page.url(), navigations },
    type: 'application/json',
  };
}
`;

export function browserFallbackConfigured(): boolean {
  return Boolean(process.env["BROWSERLESS_TOKEN"]);
}

export async function traceWithBrowser(
  url: string,
  timeoutMs: number,
): Promise<BrowserTraceResult> {
  const started = Date.now();
  const token = process.env["BROWSERLESS_TOKEN"];
  if (!token) {
    return {
      ok: false,
      reason:
        "This page navigates with computed JavaScript, which requires the isolated headless-browser fallback. It is not configured (missing BROWSERLESS_TOKEN), so the chain was not followed further.",
      finalUrl: null,
      navigations: [],
      elapsedMs: 0,
    };
  }

  const base = process.env["BROWSERLESS_BASE_URL"] ?? "https://production-sfo.browserless.io";

  try {
    const response = await fetch(
      `${base.replace(/\/$/, "")}/function?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: RENDER_SCRIPT,
          context: { url, timeout: Math.max(5000, timeoutMs - 2000) },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return {
        ok: false,
        reason: `Headless-browser fallback failed with ${response.status}${detail ? `: ${detail}` : ""}.`,
        finalUrl: null,
        navigations: [],
        elapsedMs: Date.now() - started,
      };
    }

    const payload = (await response.json()) as {
      data?: { finalUrl?: string; navigations?: Array<{ url: string; ms: number }> };
      finalUrl?: string;
    };
    const finalUrl = payload.data?.finalUrl ?? payload.finalUrl ?? null;
    if (!finalUrl) {
      return {
        ok: false,
        reason: "The headless browser returned no final URL for this page.",
        finalUrl: null,
        navigations: [],
        elapsedMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      reason: null,
      finalUrl,
      navigations: payload.data?.navigations ?? [],
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `Headless-browser fallback error: ${error instanceof Error ? error.message : "unknown error"}.`,
      finalUrl: null,
      navigations: [],
      elapsedMs: Date.now() - started,
    };
  }
}
