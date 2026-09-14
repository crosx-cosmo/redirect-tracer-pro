import type { CSSProperties } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { RedirectAnalysis } from "@/lib/redirect-types";
import { CopyButton } from "./CopyButton";
import { StatusBadge } from "./StatusBadge";

export function HeadersTab({ result }: { result: RedirectAnalysis }) {
  if (!result.hops.length) {
    return <p className="text-sm text-muted-foreground">No response headers captured.</p>;
  }
  return (
    <Accordion type="multiple" defaultValue={["hop-0"]} className="space-y-2">
      {result.hops.map((hop, i) => (
        <AccordionItem
          key={hop.index}
          value={`hop-${hop.index}`}
          className="panel animate-rise stagger-fast border-b-0 px-3"
          style={{ "--stagger": i } as CSSProperties}
        >
          <AccordionTrigger className="gap-2 py-3 hover:no-underline">
            <span className="flex min-w-0 items-center gap-2">
              <StatusBadge status={hop.status} />
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {hop.url}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {Object.keys(hop.headers).length} response headers
              </span>
              <CopyButton
                value={Object.entries(hop.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")}
                label="Copy headers"
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-hairline">
              <table className="w-full text-left text-xs">
                <tbody>
                  {Object.entries(hop.headers).map(([key, value], index) => (
                    <tr key={key} className={index % 2 ? "bg-surface-muted" : "bg-surface"}>
                      <td className="w-1/3 border-b border-hairline px-3 py-2 align-top font-mono font-medium text-brand">
                        {key}
                      </td>
                      <td className="border-b border-hairline px-3 py-2 break-all font-mono text-foreground">
                        {value}
                      </td>
                    </tr>
                  ))}
                  {Object.keys(hop.headers).length === 0 ? (
                    <tr>
                      <td className="px-3 py-2 text-muted-foreground" colSpan={2}>
                        No headers returned.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
