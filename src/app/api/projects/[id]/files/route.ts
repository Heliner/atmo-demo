import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const html: string = body.html;
  const note: string | undefined = body.note;
  if (!html) return NextResponse.json({ error: "html required" }, { status: 400 });

  const latest = await db().execute({
    sql: "SELECT MAX(version) as v FROM files WHERE project_id = ?",
    args: [id],
  });
  const version = (Number(latest.rows[0]?.v) || 0) + 1;

  await db().execute({
    sql: "INSERT INTO files (id, project_id, version, path, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [nanoid(10), id, version, "app.html", html, Date.now()],
  });

  if (note) {
    await db().execute({
      sql: "INSERT INTO messages (id, project_id, agent, kind, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        nanoid(10),
        id,
        "system",
        "race-pick",
        note,
        JSON.stringify({ version, fileSize: html.length }),
        Date.now(),
      ],
    });
  }

  await db().execute({
    sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
    args: ["built", Date.now(), id],
  });

  return NextResponse.json({ version });
}
