"use client";

import { useEffect, useState } from "react";
import { AGENTS, type AgentId } from "@/lib/agents/roles";
import { AgentAvatar } from "@/components/AgentAvatar";

interface BillingTotal {
  input: number;
  output: number;
  cost_cents: number;
}

interface BillingPerAgent {
  agent: AgentId;
  input: number;
  output: number;
  cost_cents: number;
  calls: number;
}

interface BillingSummary {
  total: BillingTotal;
  perAgent: BillingPerAgent[];
}

const POLLING_STATUSES = new Set(["planning", "building", "awaiting-approval"]);

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function isValidAgentId(s: string): s is AgentId {
  return s in AGENTS;
}

export function BillingWidget({
  projectId,
  status,
  pollMs = 4000,
}: {
  projectId: string;
  status: string;
  pollMs?: number;
}) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const r = await fetch(`/api/projects/${projectId}/billing`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const body = (await r.json()) as BillingSummary;
        if (cancelled) return;
        setSummary(body);
      } catch {
        /* network blip; will retry on next tick if polling */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchOnce();

    if (!POLLING_STATUSES.has(status)) {
      return () => {
        cancelled = true;
      };
    }

    const timer = setInterval(fetchOnce, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, status, pollMs]);

  const total = summary?.total ?? { input: 0, output: 0, cost_cents: 0 };
  const perAgent = summary?.perAgent ?? [];
  const totalTokens = total.input + total.output;
  const live = POLLING_STATUSES.has(status);

  return (
    <div className="w-[240px] rounded-lg bg-[#0E0E16]/95 border border-[#23232E] backdrop-blur shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#23232E]">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[#7C7C90] font-medium">
            Tokens
          </span>
          {live && (
            <span className="relative inline-flex w-1.5 h-1.5" aria-hidden>
              <span className="absolute inset-0 rounded-full animate-ping opacity-60 bg-[#7C5CFF]" />
              <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-[#7C5CFF]" />
            </span>
          )}
        </div>
      </div>

      <div className="px-3 py-2.5">
        <div className="text-xl font-semibold text-white tabular-nums leading-tight">
          {loading && !summary ? (
            <span className="text-[#5C5C70]">—</span>
          ) : (
            formatTokens(totalTokens)
          )}
        </div>
        <div className="text-[10px] text-[#7C7C90] mt-0.5 tabular-nums">
          {formatTokens(total.input)} in · {formatTokens(total.output)} out
        </div>
      </div>

      {perAgent.length > 0 && (
        <div className="px-2 pb-2 border-t border-[#23232E]/60">
          <div className="flex flex-col gap-0.5 pt-1.5">
            {perAgent.map((row) => {
              const valid = isValidAgentId(row.agent);
              const role = valid ? AGENTS[row.agent] : null;
              const rowTokens = row.input + row.output;
              return (
                <div
                  key={row.agent}
                  className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[#14141C]"
                  title={`${row.calls} call${row.calls === 1 ? "" : "s"} · ${row.input} in / ${row.output} out`}
                >
                  {valid ? (
                    <AgentAvatar agent={row.agent} size={18} />
                  ) : (
                    <span className="inline-block w-[18px] h-[18px] rounded-full bg-[#23232E]" />
                  )}
                  <span className="text-[11px] text-[#D5D5DF] truncate flex-1">
                    {role?.name ?? row.agent}
                  </span>
                  <span className="text-[10px] text-[#7C7C90] tabular-nums">
                    {formatTokens(rowTokens)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
