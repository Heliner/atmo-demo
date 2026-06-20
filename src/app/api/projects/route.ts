import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => ({}));
  const prompt: string = (body.prompt || "").trim();
  // Race mode is now functional (#36) — accept it directly. UI keeps the
  // toggle disabled in PromptBox, but anyone can curl-create a race
  // project to exercise the arena. Default remains 'team'.
  const mode: string = body.mode || "team";
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const id = nanoid(12);
  const now = Date.now();
  const name = prompt.slice(0, 60).replace(/\s+/g, " ");
  await db().execute({
    sql: "INSERT INTO projects (id, name, prompt, mode, theme, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, name, prompt, mode, "dark", "created", now, now],
  });
  return NextResponse.json({ id });
}

export async function GET() {
  await ensureSchema();
  const rs = await db().execute(
    "SELECT id, name, prompt, mode, status, created_at FROM projects ORDER BY created_at DESC LIMIT 24",
  );
  return NextResponse.json({
    projects: rs.rows.map((r) => ({
      id: r.id,
      name: r.name,
      prompt: r.prompt,
      mode: r.mode,
      status: r.status,
      created_at: Number(r.created_at),
    })),
  });
}
