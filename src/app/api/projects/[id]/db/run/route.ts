// POST /api/projects/:id/db/run
//
// Called from the parent page (AppViewer) on behalf of the Sandpack iframe via
// postMessage. Dispatches to lib/sandbox/sqlbox.execSql which handles both
// SELECT (returns rows + columns) and mutations (returns rowsAffected + kind).
//
// Wire format: always 200 JSON with an `ok` boolean so the iframe sees a clean
// shape regardless of failure mode (errors aren't HTTP-level — the iframe can't
// inspect status easily across the postMessage bridge).
//
// CORS: open. The real request comes from the parent (same origin) but having
// CORS open is harmless and means the SDK can be reused from anywhere.

import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { execSql } from "@/lib/sandbox/sqlbox";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

interface RunBody {
  op: "query" | "exec";
  sql: string;
  params?: unknown[];
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;

  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { headers: CORS_HEADERS },
    );
  }

  const { op, sql, params: bindParams } = body ?? ({} as RunBody);

  if (op !== "query" && op !== "exec") {
    return NextResponse.json(
      { ok: false, error: "op must be 'query' or 'exec'" },
      { headers: CORS_HEADERS },
    );
  }
  if (typeof sql !== "string" || sql.trim() === "") {
    return NextResponse.json(
      { ok: false, error: "sql is required" },
      { headers: CORS_HEADERS },
    );
  }

  // Parametrised queries not yet supported (execSql doesn't accept bindings).
  // Alex's prompt tells him to inline values — short-circuit if he forgets.
  if (Array.isArray(bindParams) && bindParams.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "parametrised queries not yet supported; inline values",
      },
      { headers: CORS_HEADERS },
    );
  }

  try {
    const result = await execSql(id, sql);

    if (op === "query") {
      // SELECT path. execSql returns kind, columns, rows for SELECT; for non-
      // SELECT under op=query, surface as an error so user code doesn't get a
      // surprise shape.
      if (result.kind !== "select") {
        return NextResponse.json(
          {
            ok: false,
            error: `op='query' requires a SELECT statement (got ${result.kind})`,
          },
          { headers: CORS_HEADERS },
        );
      }
      // Transform rows from positional arrays to objects keyed by column name.
      // Positional indexing in generated apps is fragile — column order is
      // whatever Bob picked in CREATE TABLE, which Alex can't guess reliably.
      const cols = result.columns ?? [];
      const rawRows = result.rows ?? [];
      const objRows: Record<string, unknown>[] = rawRows.map((r) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < cols.length; i++) obj[cols[i]] = r[i];
        return obj;
      });
      return NextResponse.json(
        {
          ok: true,
          columns: cols,
          rows: objRows,
        },
        { headers: CORS_HEADERS },
      );
    }

    // op === 'exec' — mutations / DDL. SELECT is allowed too but uncommon.
    return NextResponse.json(
      {
        ok: true,
        message: result.message,
        rowsAffected: result.rowsAffected,
        kind: result.kind,
        table: result.table,
      },
      { headers: CORS_HEADERS },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { headers: CORS_HEADERS },
    );
  }
}
