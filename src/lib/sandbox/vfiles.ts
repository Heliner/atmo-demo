import { db } from "@/lib/db";
import { nanoid } from "nanoid";

export interface VFile {
  path: string;
  content: string;
  version: number;
  size: number;
}

function normalizePath(raw: string): string {
  let p = raw.trim().replace(/\\/g, "/");
  if (p.startsWith("/")) p = p.slice(1);
  if (p.includes("..")) throw new Error("path traversal not allowed");
  if (!p) throw new Error("path required");
  return p;
}

async function nextVersion(projectId: string, path: string): Promise<number> {
  const rs = await db().execute({
    sql: "SELECT MAX(version) AS v FROM vfiles WHERE project_id = ? AND path = ?",
    args: [projectId, path],
  });
  return (Number(rs.rows[0]?.v) || 0) + 1;
}

export async function writeVFile(
  projectId: string,
  rawPath: string,
  content: string,
): Promise<VFile> {
  const path = normalizePath(rawPath);
  const version = await nextVersion(projectId, path);
  await db().execute({
    sql: "INSERT INTO vfiles (id, project_id, path, content, version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [nanoid(10), projectId, path, content, version, Date.now()],
  });
  return { path, content, version, size: content.length };
}

export async function readLatestVFile(
  projectId: string,
  rawPath: string,
): Promise<VFile | null> {
  const path = normalizePath(rawPath);
  const rs = await db().execute({
    sql: "SELECT content, version FROM vfiles WHERE project_id = ? AND path = ? ORDER BY version DESC LIMIT 1",
    args: [projectId, path],
  });
  if (rs.rows.length === 0) return null;
  const content = rs.rows[0].content as string;
  return { path, content, version: Number(rs.rows[0].version), size: content.length };
}

export async function listLatestVFiles(projectId: string): Promise<VFile[]> {
  const rs = await db().execute({
    sql: `
      SELECT path, content, version
      FROM vfiles v
      WHERE project_id = ?
        AND version = (
          SELECT MAX(version) FROM vfiles WHERE project_id = v.project_id AND path = v.path
        )
      ORDER BY path ASC
    `,
    args: [projectId],
  });
  return rs.rows.map((r) => ({
    path: r.path as string,
    content: r.content as string,
    version: Number(r.version),
    size: (r.content as string).length,
  }));
}
