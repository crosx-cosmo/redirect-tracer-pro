import { assemble, paramsOf, protocolOf, redirectTypeLabel } from "./redirect-analysis";
import type { RedirectAnalysis, RedirectHop } from "./redirect-types";

interface DemoHopSeed {
  url: string;
  status: number;
  statusText: string;
  time: number;
  location?: string;
  server?: string;
  ip?: string;
}

const SEEDS: DemoHopSeed[] = [
  {
    url: "http://demo-offer.example/go?click_id=abc123&aff_id=5541&sub1=newsletter&utm_source=demo&utm_campaign=spring",
    status: 301,
    statusText: "Moved Permanently",
    time: 118,
    location:
      "https://demo-offer.example/go?click_id=abc123&aff_id=5541&sub1=newsletter&utm_source=demo&utm_campaign=spring",
    server: "nginx/1.24.0",
    ip: "203.0.113.10",
  },
  {
    url: "https://demo-offer.example/go?click_id=abc123&aff_id=5541&sub1=newsletter&utm_source=demo&utm_campaign=spring",
    status: 302,
    statusText: "Found",
    time: 246,
    location:
      "https://tracker.example/r/9f2?click_id=abc123&aff_id=5541&sub2=retarget&utm_source=demo",
    server: "cloudflare",
    ip: "198.51.100.24",
  },
  {
    url: "https://tracker.example/r/9f2?click_id=abc123&aff_id=5541&sub2=retarget&utm_source=demo",
    status: 307,
    statusText: "Temporary Redirect",
    time: 1720,
    location: "https://shop.example/landing?utm_source=demo",
    server: "envoy",
    ip: "198.51.100.77",
  },
  {
    url: "https://shop.example/landing?utm_source=demo",
    status: 200,
    statusText: "OK",
    time: 312,
    server: "AmazonS3",
    ip: "192.0.2.55",
  },
];

export function buildDemoAnalysis(startUrl: string): RedirectAnalysis {
  const hops: RedirectHop[] = SEEDS.map((seed, index) => ({
    index,
    url: seed.url,
    protocol: protocolOf(seed.url),
    status: seed.status,
    statusText: seed.statusText,
    redirectType: redirectTypeLabel(seed.status),
    responseTimeMs: seed.time,
    location: seed.location ?? null,
    resolvedLocation: seed.location ?? null,
    server: seed.server ?? null,
    ip: seed.ip ?? null,
    headers: {
      date: "Thu, 03 Sep 2026 06:55:00 GMT",
      "content-type": seed.status === 200 ? "text/html; charset=utf-8" : "text/html",
      server: seed.server ?? "unknown",
      ...(seed.location ? { location: seed.location } : {}),
      "cache-control": seed.status === 301 ? "public, max-age=3600" : "no-store",
    },
    params: paramsOf(seed.url),
  }));

  const analysis = assemble({
    startUrl,
    hops,
    redirectLoop: false,
    truncated: false,
    page: { canonical: "https://shop.example/landing", metaRobots: "index, follow" },
    source: "demo",
  });

  return analysis;
}
