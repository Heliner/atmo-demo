// Race-winner promotion (task #36): copy every vfile under
// "race-<winner>/<path>" back to bare "<path>" (as a new version), flip
// project.status → 'built', and drop a race-pick system message so the
// chat lane has a record of the decision.
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db, ensureSchema } from "@/lib/db";
import { listLatestVFiles, writeVFile } from "@/lib/sandbox/vfiles";

export const runtime = "nodejs";

const WINNER_LABEL: Record<string, string> = {
  pro: "Pro",
  std: "Std",
  lite: "Lite",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const winner: string = (body?.winner ?? "").toString();
  if (!["pro", "std", "lite"].includes(winner)) {
    return NextResponse.json(
      { error: "winner must be one of pro|std|lite" },
      { status: 400 },
    );
  }

  const prefix = `race-${winner}/`;
  const allFiles = await listLatestVFiles(id);
  const winnerFiles = allFiles.filter((f) => f.path.startsWith(prefix));
  if (winnerFiles.length === 0) {
    return NextResponse.json(
      { error: `no files found for race-${winner}/` },
      { status: 404 },
    );
  }

  let promoted = 0;
  for (const f of winnerFiles) {
    const logical = f.path.slice(prefix.length);
    if (!logical) continue;
    await writeVFile(id, logical, f.content);
    promoted += 1;
  }

  await db().execute({
    sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
    args: ["built", Date.now(), id],
  });

  await db().execute({
    sql: "INSERT INTO messages (id, project_id, agent, kind, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      nanoid(10),
      id,
      "system",
      "race-pick",
      `You picked Doubao ${WINNER_LABEL[winner] ?? winner}`,
      JSON.stringify({ winner, promoted_files: promoted }),
      Date.now(),
    ],
  });

  return NextResponse.json({ ok: true, winner, promoted });
}
