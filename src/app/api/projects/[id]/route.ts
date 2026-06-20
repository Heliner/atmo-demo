import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const p = await db().execute({
    sql: "SELECT id, name, prompt, mode, status, created_at FROM projects WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (p.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const msgs = await db().execute({
    sql: "SELECT id, agent, kind, content, meta, created_at FROM messages WHERE project_id = ? ORDER BY created_at ASC",
    args: [id],
  });
  const files = await db().execute({
    sql: "SELECT id, version, path, content, created_at FROM files WHERE project_id = ? ORDER BY version DESC LIMIT 1",
    args: [id],
  });
  return NextResponse.json({
    project: p.rows[0],
    messages: msgs.rows.map((r) => ({
      id: r.id,
      agent: r.agent,
      kind: r.kind,
      content: r.content,
      meta: r.meta ? JSON.parse(r.meta as string) : null,
      created_at: Number(r.created_at),
    })),
    latestFile: files.rows[0]
      ? {
          path: files.rows[0].path,
          content: files.rows[0].content,
          version: Number(files.rows[0].version),
        }
      : null,
  });
}
