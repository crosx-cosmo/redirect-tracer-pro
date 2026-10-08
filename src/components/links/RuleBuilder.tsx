import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, FlaskConical, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  FIELD_LABEL,
  FIELD_OPS,
  MAX_CONDITIONS,
  MAX_RULES,
  OP_LABEL,
  evaluateRules,
  newRuleId,
  parseUserAgent,
  type LinkRule,
  type RuleCondition,
  type RuleField,
} from "@/lib/link-rules";
import { setShortLinkRules } from "@/lib/shortlinks.functions";

const PLACEHOLDER: Record<RuleField, string> = {
  country: "US, GB, IN",
  platform: "android, ios, tablet, desktop",
  browser: "Chrome, Safari, Firefox, Edge",
  os: "Android, iOS, Windows, macOS, Linux",
  query: "ref=partner",
  utm_source: "newsletter",
  utm_medium: "email",
  utm_campaign: "spring-sale",
  weekday: "mon, tue, sat",
  hour: "9-17",
  date: "2026-12-31T23:59",
};

const selectCls =
  "h-9 rounded-md border border-hairline bg-surface-muted px-2 text-xs text-foreground";

export function RuleBuilder({
  id,
  owner,
  initial,
  defaultDestination,
  onSaved,
}: {
  id: string;
  owner: string;
  initial: LinkRule[];
  defaultDestination: string;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<LinkRule[]>(initial);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState({ country: "", ua: "", query: "", when: "" });
  const [testResult, setTestResult] = useState<string | null>(null);
  const save = useServerFn(setShortLinkRules);

  const update = (i: number, patch: Partial<LinkRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateCond = (i: number, k: number, patch: Partial<RuleCondition>) =>
    update(i, {
      conditions: rules[i]!.conditions.map((c, j) => (j === k ? { ...c, ...patch } : c)),
    });
  const move = (i: number, dir: -1 | 1) =>
    setRules((rs) => {
      const next = [...rs];
      const j = i + dir;
      if (j < 0 || j >= next.length) return rs;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function runTest() {
    const ua = test.ua || navigator.userAgent;
    const p = parseUserAgent(ua);
    let query: Record<string, string> = {};
    try {
      query = Object.fromEntries(new URLSearchParams(test.query.replace(/^\?/, "")).entries());
    } catch {
      query = {};
    }
    const now = test.when ? new Date(`${test.when}Z`) : new Date();
    const hit = evaluateRules(rules, {
      country: test.country.trim().toUpperCase() || null,
      platform: p.platform,
      browser: p.browser,
      os: p.os,
      query,
      now,
    });
    setTestResult(
      hit
        ? `Matched "${hit.name || "Untitled rule"}" → ${hit.destination}`
        : `No rule matched → default ${defaultDestination}`,
    );
  }

  async function persist() {
    setSaving(true);
    try {
      await save({ data: { id, owner, rules } });
      toast.success(rules.length ? "Redirect rules saved" : "Rules cleared");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-reveal space-y-3 rounded-xl border border-hairline bg-surface-muted/40 p-3 sm:p-4">
      <p className="text-xs text-muted-foreground">
        Rules are checked top to bottom; the first enabled match wins. If none match, visitors go to
        the default destination:{" "}
        <span className="break-all font-mono text-foreground">{defaultDestination}</span>. Times are
        UTC.
      </p>

      {rules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline p-4 text-center text-xs text-muted-foreground">
          No rules — this link always redirects to its default destination.
        </p>
      ) : null}

      {rules.map((r, i) => (
        <div key={r.id} className="space-y-2 rounded-xl border border-hairline bg-surface/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              #{i + 1}
            </span>
            <Input
              value={r.name}
              placeholder="Rule name"
              maxLength={60}
              onChange={(e) => update(i, { name: e.target.value })}
              className="h-8 min-w-0 flex-1 border-hairline bg-surface-muted text-xs"
            />
            <Switch
              checked={r.enabled}
              aria-label="Enable rule"
              onCheckedChange={(v) => update(i, { enabled: v })}
            />
            <Button variant="ghost" size="sm" aria-label="Move up" onClick={() => move(i, -1)}>
              <ArrowUp className="size-3.5" />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Move down" onClick={() => move(i, 1)}>
              <ArrowDown className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Delete rule"
              onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            When
            <select
              className={selectCls}
              value={r.match}
              onChange={(e) => update(i, { match: e.target.value as "all" | "any" })}
            >
              <option value="all">all conditions match</option>
              <option value="any">any condition matches</option>
            </select>
          </div>

          {r.conditions.map((c, k) => (
            <div key={k} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                className={selectCls}
                value={c.field}
                onChange={(e) => {
                  const field = e.target.value as RuleField;
                  updateCond(i, k, { field, op: FIELD_OPS[field][0]!, value: "" });
                }}
              >
                {(Object.keys(FIELD_LABEL) as RuleField[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABEL[f]}
                  </option>
                ))}
              </select>
              <select
                className={selectCls}
                value={c.op}
                onChange={(e) => updateCond(i, k, { op: e.target.value as RuleCondition["op"] })}
              >
                {FIELD_OPS[c.field].map((o) => (
                  <option key={o} value={o}>
                    {OP_LABEL[o]}
                  </option>
                ))}
              </select>
              <Input
                value={c.value}
                placeholder={c.op === "exists" && c.field === "query" ? "param name" : PLACEHOLDER[c.field]}
                onChange={(e) => updateCond(i, k, { value: e.target.value })}
                className="h-9 flex-1 border-hairline bg-surface-muted text-xs"
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remove condition"
                disabled={r.conditions.length === 1}
                onClick={() =>
                  update(i, { conditions: r.conditions.filter((_, j) => j !== k) })
                }
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={r.conditions.length >= MAX_CONDITIONS}
            onClick={() =>
              update(i, {
                conditions: [...r.conditions, { field: "country", op: "is", value: "" }],
              })
            }
          >
            <Plus className="size-3.5" /> Condition
          </Button>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Redirect to</span>
            <Input
              value={r.destination}
              inputMode="url"
              spellCheck={false}
              placeholder="https://example.com/landing"
              onChange={(e) => update(i, { destination: e.target.value })}
              className="h-9 flex-1 border-hairline bg-surface-muted font-mono text-xs"
            />
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="subtle"
          size="sm"
          disabled={rules.length >= MAX_RULES}
          onClick={() =>
            setRules((rs) => [
              ...rs,
              {
                id: newRuleId(),
                name: "",
                enabled: true,
                match: "all",
                conditions: [{ field: "platform", op: "is", value: "" }],
                destination: "",
              },
            ])
          }
        >
          <Plus className="size-3.5" /> Add rule
        </Button>
        <Button variant="hero" size="sm" onClick={persist} disabled={saving}>
          <Save className="size-3.5" /> {saving ? "Saving…" : "Save rules"}
        </Button>
      </div>

      <div className="space-y-2 rounded-xl border border-hairline bg-surface/60 p-3">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
          <FlaskConical className="size-3" /> Test a visitor
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder="Country code (e.g. US)"
            value={test.country}
            onChange={(e) => setTest({ ...test, country: e.target.value })}
            className="h-9 border-hairline bg-surface-muted text-xs"
          />
          <Input
            placeholder="Query string (e.g. utm_source=ads)"
            value={test.query}
            onChange={(e) => setTest({ ...test, query: e.target.value })}
            className="h-9 border-hairline bg-surface-muted text-xs"
          />
          <Input
            placeholder="User agent (blank = this device)"
            value={test.ua}
            onChange={(e) => setTest({ ...test, ua: e.target.value })}
            className="h-9 border-hairline bg-surface-muted text-xs"
          />
          <Input
            type="datetime-local"
            value={test.when}
            onChange={(e) => setTest({ ...test, when: e.target.value })}
            className="h-9 border-hairline bg-surface-muted text-xs"
          />
        </div>
        <Button variant="subtle" size="sm" onClick={runTest}>
          Run test
        </Button>
        {testResult ? <p className="break-all text-xs text-foreground">{testResult}</p> : null}
      </div>
    </div>
  );
}
