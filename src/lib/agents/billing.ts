import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { computeCost, modelKeyFromId, type ModelKey } from "@/lib/llm/doubao";

export interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type BillingKind = "chat" | "tool-loop" | "race" | "followup";

export interface BillingRow {
  agent: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  kind: BillingKind;
}

export async function recordUsage(
  projectId: string,
  agent: string,
  modelId: string,
  usage: UsageLike | undefined,
  kind: BillingKind = "chat",
): Promise<BillingRow> {
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const key: ModelKey = modelKeyFromId(modelId);
  const cost = computeCost(key, input, output);
  await db().execute({
    sql: `INSERT INTO agent_billing
      (id, project_id, agent, model, input_tokens, output_tokens, cost_cents, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [nanoid(10), projectId, agent, modelId, input, output, cost, kind, Date.now()],
  });
  return {
    agent,
    model: modelId,
    input_tokens: input,
    output_tokens: output,
    cost_cents: cost,
    kind,
  };
}

export interface ProjectBilling {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cents: number;
  rows: BillingRow[];
}

export async function loadBilling(projectId: string): Promise<ProjectBilling> {
  const rs = await db().execute({
    sql: `SELECT agent, model, input_tokens, output_tokens, cost_cents, kind
          FROM agent_billing WHERE project_id = ? ORDER BY created_at ASC`,
    args: [projectId],
  });
  const rows = rs.rows.map((r) => ({
    agent: r.agent as string,
    model: r.model as string,
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    cost_cents: Number(r.cost_cents),
    kind: r.kind as BillingRow["kind"],
  }));
  return {
    total_input_tokens: rows.reduce((s, r) => s + r.input_tokens, 0),
    total_output_tokens: rows.reduce((s, r) => s + r.output_tokens, 0),
    total_cost_cents: rows.reduce((s, r) => s + r.cost_cents, 0),
    rows,
  };
}

export function formatCost(cents: number): string {
  const dollars = cents / 100;
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(3)}`;
}
