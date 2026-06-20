import { notFound } from "next/navigation";
import { db, ensureSchema, loadMemories } from "@/lib/db";
import { listLatestVFiles } from "@/lib/sandbox/vfiles";
import { listSchema } from "@/lib/sandbox/sqlbox";
import { ProjectClient, type ProjectInitial } from "@/components/ProjectClient";
import type { ShellEntry } from "@/components/AppViewer";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await ensureSchema();
  const { id } = await params;

  const projRs = await db().execute({
    sql: "SELECT id, name, prompt, mode, status, created_at FROM projects WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (projRs.rows.length === 0) notFound();
  const pr = projRs.rows[0];
  const project: ProjectInitial["project"] = {
    id: pr.id as string,
    name: pr.name as string,
    prompt: pr.prompt as string,
    mode: pr.mode as string,
    status: pr.status as string,
    created_at: Number(pr.created_at),
  };

  const msgRs = await db().execute({
    sql: "SELECT id, agent, kind, content, meta, created_at FROM messages WHERE project_id = ? ORDER BY created_at ASC",
    args: [id],
  });
  const messages: ProjectInitial["messages"] = msgRs.rows.map((r) => {
    const rawMeta = r.meta as string | null;
    let meta: unknown = null;
    if (rawMeta) {
      try {
        meta = JSON.parse(rawMeta);
      } catch {
        meta = rawMeta;
      }
    }
    return {
      id: r.id as string,
      agent: r.agent as string,
      kind: r.kind as string,
      content: r.content as string,
      meta,
      created_at: Number(r.created_at),
    };
  });

  const [vfiles, memories, schema] = await Promise.all([
    listLatestVFiles(id),
    loadMemories(id),
    listSchema(id),
  ]);

  // Replay run_command / run_python tool calls into a ShellEntry[] so the Shell
  // tab is populated on refresh. tool-call rows carry args; matching results
  // live in tool-result rows linked by meta.tool_call_id.
  const shellHistory = buildShellHistory(messages);

  const initial: ProjectInitial = {
    project,
    messages,
    vfiles,
    memories,
    schema,
    shellHistory,
  };

  return <ProjectClient initial={initial} />;
}

// Walk the persisted messages and join tool-call rows (args) with matching
// tool-result rows (output) by meta.tool_call_id. Falls back to extracting
// command/output from the result alone if the linkage is missing.
function buildShellHistory(
  messages: ProjectInitial["messages"],
): ShellEntry[] {
  type MetaShape = {
    tool_call_id?: string;
    name?: string;
    args?: unknown;
    result?: unknown;
  };
  const callsByName: Array<{
    id: string;
    agent: string;
    name: "run_command" | "run_python";
    args: Record<string, unknown>;
    ts: number;
  }> = [];
  const resultsById = new Map<string, { result: Record<string, unknown>; ts: number; agent: string }>();
  const orphanResults: Array<{
    id: string;
    agent: string;
    name: "run_command" | "run_python";
    result: Record<string, unknown>;
    ts: number;
  }> = [];

  function asObj(v: unknown): Record<string, unknown> {
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  }

  for (const m of messages) {
    const meta = (m.meta && typeof m.meta === "object"
      ? (m.meta as MetaShape)
      : {}) as MetaShape;
    const name = meta.name;
    if (name !== "run_command" && name !== "run_python") continue;

    if (m.kind === "tool-call") {
      const tcid = meta.tool_call_id ?? m.id;
      callsByName.push({
        id: tcid,
        agent: m.agent,
        name,
        args: asObj(meta.args),
        ts: m.created_at,
      });
    } else if (m.kind === "tool-result") {
      const tcid = meta.tool_call_id;
      const result = asObj(meta.result);
      if (tcid) {
        resultsById.set(tcid, { result, ts: m.created_at, agent: m.agent });
      } else {
        // No linkage — best-effort standalone entry from result alone.
        orphanResults.push({
          id: m.id,
          agent: m.agent,
          name,
          result,
          ts: m.created_at,
        });
      }
    }
  }

  const entries: ShellEntry[] = [];
  for (const c of callsByName) {
    const r = resultsById.get(c.id);
    const result = r?.result ?? {};
    const command =
      c.name === "run_command"
        ? String(
            (result.command as string | undefined) ??
              (c.args.command as string | undefined) ??
              (c.args.code as string | undefined) ??
              "",
          )
        : String(c.args.code ?? "").slice(0, 120);
    entries.push({
      id: c.id,
      agent: c.agent,
      name: c.name,
      command: command || `(${c.name})`,
      stdout: result.stdout as string | undefined,
      stderr: result.stderr as string | undefined,
      exitCode: result.exitCode as number | undefined,
      sandbox: result.sandbox as string | undefined,
      durationMs: (result.duration_ms ?? result.durationMs) as
        | number
        | undefined,
      ts: r?.ts ?? c.ts,
    });
  }
  for (const o of orphanResults) {
    const command =
      o.name === "run_command"
        ? String((o.result.command as string | undefined) ?? "")
        : "";
    entries.push({
      id: o.id,
      agent: o.agent,
      name: o.name,
      command: command || `(${o.name})`,
      stdout: o.result.stdout as string | undefined,
      stderr: o.result.stderr as string | undefined,
      exitCode: o.result.exitCode as number | undefined,
      sandbox: o.result.sandbox as string | undefined,
      durationMs: (o.result.duration_ms ?? o.result.durationMs) as
        | number
        | undefined,
      ts: o.ts,
    });
  }
  entries.sort((a, b) => a.ts - b.ts);
  return entries;
}
