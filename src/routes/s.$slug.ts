import { createFileRoute } from "@tanstack/react-router";

import { evaluateRules, parseUserAgent, type LinkRule } from "@/lib/link-rules";

const page = (status: number, msg: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Short link</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>${status}</h1><p>${msg}</p><a href="/">Redirect Chain Analyzer</a></body>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/s/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!/^[A-Za-z0-9_-]{3,40}$/.test(params.slug)) return page(404, "Short link not found.");
        const { shortLinkDb, validateDestination } = await import("@/lib/shortlinks.server");
        const db = shortLinkDb();
        const { data, error } = await db.rpc("get_redirect_target", { p_slug: params.slug });
        if (error) return page(503, "Short links are temporarily unavailable.");
        const link = Array.isArray(data) ? data[0] : null;
        if (!link) return page(404, "This short link does not exist or has been disabled.");

        const reqUrl = new URL(request.url);
        const host = reqUrl.host;
        const ua = request.headers.get("user-agent") ?? "";
        const parsed = parseUserAgent(ua);
        const country = (request.headers.get("cf-ipcountry") ?? "").toUpperCase() || null;
        const region = request.headers.get("cf-region") ?? null;
        const query = Object.fromEntries(reqUrl.searchParams.entries());

        // Smart rules: first matching enabled rule wins; otherwise the default destination.
        const rules = (Array.isArray(link.rules) ? link.rules : []) as unknown as LinkRule[];
        const rule = rules.length
          ? evaluateRules(rules, {
              country: country && country !== "XX" ? country : null,
              platform: parsed.platform,
              browser: parsed.browser,
              os: parsed.os,
              query,
              now: new Date(),
            })
          : null;

        let destination = link.destination;
        let ruleId: string | null = null;
        if (rule && !(await validateDestination(rule.destination, host))) {
          destination = rule.destination;
          ruleId = rule.id;
        } else {
          // Re-validate at redirect time so a destination can never become an open redirect to internal hosts.
          const problem = await validateDestination(destination, host);
          if (problem) return page(410, "This short link's destination is no longer allowed.");
        }

        let referrer: string | null = null;
        try {
          const r = request.headers.get("referer");
          if (r) referrer = new URL(r).hostname || null;
        } catch {
          referrer = null;
        }
        const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
        const day = new Date().toISOString().slice(0, 10);
        // Privacy: only a daily-rotating hash of IP + UA is stored, never the IP itself.
        const visitor = await sha256(`${ip}|${ua}|${day}|${link.id}`);
        await db.rpc("record_link_click", {
          p_link_id: link.id,
          p_visitor: visitor,
          p_referrer: referrer as string,
          p_country: (country && country !== "XX" ? country : null) as string,
          p_region: region as string,
          p_device: parsed.device,
          p_browser: parsed.browser,
          p_os: parsed.os,
          p_utm_source: (query["utm_source"] ?? null) as string,
          p_utm_medium: (query["utm_medium"] ?? null) as string,
          p_utm_campaign: (query["utm_campaign"] ?? null) as string,
          p_is_bot: parsed.isBot,
          p_rule: ruleId as string,
        });

        return new Response(null, {
          status: 302,
          headers: {
            location: destination,
            "cache-control": "no-store",
            "referrer-policy": "strict-origin-when-cross-origin",
            "x-robots-tag": "noindex",
          },
        });
      },
    },
  },
});
