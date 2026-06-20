import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

export interface BillingTotal {
  input: number;
  output: number;
  cost_cents: number;
}

export interface BillingPerAgent {
  agent: string;
  input: number;
  output: number;
  cost_cents: number;
  calls: number;
}

export interface BillingSummary {
  total: BillingTotal;
  perAgent: BillingPerAgent[];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;

  try {
    const rs = await db().execute({
      sql: `SELECT agent,
                   COALESCE(SUM(input_tokens), 0)  AS input,
                   COALESCE(SUM(output_tokens), 0) AS output,
                   COALESCE(SUM(cost_cents), 0)    AS cost_cents,
                   COUNT(*)                        AS calls
            FROM agent_billing
            WHERE project_id = ?
            GROUP BY agent
            ORDER BY cost_cents DESC, agent ASC`,
      args: [id],
    });

    const perAgent: BillingPerAgent[] = rs.rows.map((r) => ({
      agent: r.agent as string,
      input: Number(r.input ?? 0),
      output: Number(r.output ?? 0),
      cost_cents: Number(r.cost_cents ?? 0),
      calls: Number(r.calls ?? 0),
    }));

    const total: BillingTotal = perAgent.reduce<BillingTotal>(
      (acc, r) => ({
        input: acc.input + r.input,
        output: acc.output + r.output,
        cost_cents: acc.cost_cents + r.cost_cents,
      }),
      { input: 0, output: 0, cost_cents: 0 },
    );

    const body: BillingSummary = { total, perAgent };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
