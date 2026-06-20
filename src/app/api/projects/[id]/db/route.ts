import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { listSchema, selectTable } from "@/lib/sandbox/sqlbox";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;
  const table = req.nextUrl.searchParams.get("table");

  try {
    if (table) {
      const data = await selectTable(id, table);
      return NextResponse.json(data);
    }
    const schemas = await listSchema(id);
    return NextResponse.json({ schemas });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
