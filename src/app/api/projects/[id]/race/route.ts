// Race Mode (task #36) — fan out the SAME approved PRD across 3 models
// (Doubao pro / std / lite) in parallel. Each candidate is its own
// streamText tool-loop using a per-key path prefix so write_file lands in
// vfiles under "race-<key>/<path>", letting us promote one later by
// copying its files back to the bare paths.
import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { streamText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { db, ensureSchema, loadMemories } from "@/lib/db";
import { getModel, DOUBAO_PROVIDER_OPTIONS, MODELS, type ModelKey } from "@/lib/llm/doubao";
import { ALEX_SYSTEM, memorySection } from "@/lib/agents/prompts";
import { makeTools } from "@/lib/agents/tools";
import { writeVFile, listLatestVFiles } from "@/lib/sandbox/vfiles";
import { recordUsage } from "@/lib/agents/billing";
import type { PRD } from "@/lib/agents/orchestrate";

export const runtime = "nodejs";
export const maxDuration = 240;

const RACE_KEYS: ModelKey[] = ["pro", "std", "lite"];

async function findPRD(projectId: string): Promise<PRD | null> {
  const rs = await db().execute({
    sql: `SELECT meta FROM messages
          WHERE project_id = ? AND agent = 'emma' AND kind = 'plan'
          ORDER BY created_at DESC LIMIT 1`,
    args: [projectId],
  });
  if (rs.rows.length === 0) return null;
  try {
    const meta = JSON.parse(rs.rows[0].meta as string);
    return meta.prd ?? null;
  } catch {
    return null;
  }
}

// Build a per-candidate tools dict by wrapping the base tools so that
// write_file transparently prefixes "race-<key>/" before persisting.
function makeRaceTools(projectId: string, prefix: string) {
  const base = makeTools(projectId);
  return {
    ...base,
    write_file: tool({
      description: base.write_file.description,
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        const prefixed = `${prefix}${path}`;
        const f = await writeVFile(projectId, prefixed, content);
        return {
          success: true,
          // Report the LOGICAL path back to the LLM so it isn't confused
          // by the bookkeeping prefix; vfiles row still stores the prefixed
          // path for namespace isolation.
          path,
          version: f.version,
          size: f.size,
        };
      },
    }),
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const prd = await findPRD(id);
  if (!prd) {
    return new Response(
      JSON.stringify({ error: "PRD not found — run plan first" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (obj: object) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed by client */
        }
      };

      try {
        await db().execute({
          sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
          args: ["racing", Date.now(), id],
        });

        const memories = await loadMemories(id);

        const candidates = RACE_KEYS.map((key) =>
          runCandidate(id, key, prd, memories, send, req.signal),
        );

        const results = await Promise.allSettled(candidates);
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            send({ type: "race-error", model: RACE_KEYS[i], error: String(r.reason) });
          }
        });

        await db().execute({
          sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
          args: ["awaiting-pick", Date.now(), id],
        });

        send({ type: "done" });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function runCandidate(
  projectId: string,
  key: ModelKey,
  prd: PRD,
  memories: { key: string; value: string; source_agent: string }[],
  send: (obj: object) => void,
  signal?: AbortSignal,
): Promise<void> {
  const prefix = `race-${key}/`;
  send({ type: "race-start", model: key });

  try {
    const raceTools = makeRaceTools(projectId, prefix);
    const result = streamText({
      model: getModel(key),
      system: ALEX_SYSTEM + memorySection(memories),
      messages: [
        {
          role: "user",
          content: `Build this product. Write index.html as your entry, then optionally style.css and app.js. Call show_preview() when done.

PRD:
${JSON.stringify(prd, null, 2)}`,
        },
      ] satisfies ModelMessage[],
      tools: {
        write_file: raceTools.write_file,
        read_file: raceTools.read_file,
        list_files: raceTools.list_files,
        run_command: raceTools.run_command,
        run_python: raceTools.run_python,
        show_preview: raceTools.show_preview,
        focus_file: raceTools.focus_file,
      },
      stopWhen: stepCountIs(16),
      temperature: 0.5,
      maxOutputTokens: 16384,
      providerOptions: DOUBAO_PROVIDER_OPTIONS,
      abortSignal: signal,
    });

    let fileCount = 0;
    let totalSize = 0;

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          const delta =
            (part as { textDelta?: string; text?: string }).textDelta ??
            (part as { text?: string }).text ??
            "";
          if (delta) send({ type: "race-text-delta", model: key, delta });
          break;
        }
        case "tool-call": {
          const p2 = part as unknown as {
            toolName: string;
            input?: unknown;
            args?: unknown;
          };
          send({
            type: "race-tool-call",
            model: key,
            name: p2.toolName,
            args: p2.input ?? p2.args,
          });
          break;
        }
        case "tool-result": {
          const p2 = part as unknown as {
            toolName: string;
            output?: unknown;
            result?: unknown;
          };
          const output = p2.output ?? p2.result;
          send({
            type: "race-tool-result",
            model: key,
            name: p2.toolName,
            result: output,
          });
          if (p2.toolName === "write_file" && output && typeof output === "object") {
            const o = output as { size?: number; success?: boolean };
            if (o.success) {
              fileCount += 1;
              totalSize += o.size ?? 0;
            }
          }
          break;
        }
        case "error": {
          send({
            type: "race-error",
            model: key,
            error: String((part as { error?: unknown }).error),
          });
          break;
        }
        default:
          break;
      }
    }

    const usage = await result.usage;
    await recordUsage(projectId, `alex-${key}`, MODELS[key], usage, "race");

    send({
      type: "race-done",
      model: key,
      file_count: fileCount,
      total_size: totalSize,
    });
  } catch (e) {
    send({ type: "race-error", model: key, error: (e as Error).message });
  }
}

// Helper exported for the winner route — listing race-prefixed files.
export async function listRaceFiles(projectId: string, key: ModelKey) {
  const all = await listLatestVFiles(projectId);
  const prefix = `race-${key}/`;
  return all
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ ...f, logicalPath: f.path.slice(prefix.length) }));
}

// nanoid import is used implicitly via writeVFile; keep this here so future
// edits that add a direct messages.insert don't have to re-import.
void nanoid;
