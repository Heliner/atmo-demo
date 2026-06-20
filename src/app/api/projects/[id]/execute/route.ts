import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db, ensureSchema, loadMemories } from "@/lib/db";
import {
  bobBuildStream,
  alexBuildStream,
  type PRD,
} from "@/lib/agents/orchestrate";
import { isUIEvent } from "@/lib/agents/tools";
import { recordUsage } from "@/lib/agents/billing";
import { MODELS } from "@/lib/llm/doubao";
import { listLatestVFiles } from "@/lib/sandbox/vfiles";

export const runtime = "nodejs";
export const maxDuration = 180;

async function persistMessage(
  projectId: string,
  agent: string,
  kind: string,
  content: string,
  meta?: object,
) {
  await db().execute({
    sql: "INSERT INTO messages (id, project_id, agent, kind, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      nanoid(10),
      projectId,
      agent,
      kind,
      content,
      meta ? JSON.stringify(meta) : null,
      Date.now(),
    ],
  });
}

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const prd = await findPRD(id);
  if (!prd) return new Response("PRD not found — run plan first", { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: object) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch { /* closed */ }
      };

      try {
        await db().execute({
          sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
          args: ["building", Date.now(), id],
        });

        const memories = await loadMemories(id);

        // ---------------- Bob: design schema + seed ---------------
        let bobSummary = "(no schema notes)";
        if (Array.isArray(prd.data_entities) && prd.data_entities.length > 0) {
          send({ type: "status", content: "Bob is designing the data schema…" });
          const bobMsgId = nanoid(10);
          send({ type: "agent-message-start", id: bobMsgId, agent: "bob", kind: "chat" });

          const bobStream = bobBuildStream(id, prd, memories, req.signal);
          for await (const part of bobStream.fullStream) {
            await routeStreamPart(part, bobMsgId, "bob", id, send);
          }
          send({ type: "agent-message-end", id: bobMsgId });
          const bobText = await bobStream.text;
          bobSummary = bobText.trim() || "(Bob did not summarize.)";
          await persistMessage(id, "bob", "chat", bobSummary);
          const bobUsage = await bobStream.usage;
          await recordUsage(id, "bob", MODELS.std, bobUsage, "tool-loop");
        }

        // ---------------- Alex: write files ----------------
        send({ type: "status", content: "Alex is building the app…" });
        const alexMsgId = nanoid(10);
        send({ type: "agent-message-start", id: alexMsgId, agent: "alex", kind: "chat" });

        const alexStream = alexBuildStream(id, prd, memories, bobSummary, req.signal);
        for await (const part of alexStream.fullStream) {
          await routeStreamPart(part, alexMsgId, "alex", id, send);
        }
        send({ type: "agent-message-end", id: alexMsgId });
        const alexText = await alexStream.text;
        await persistMessage(id, "alex", "chat", alexText.trim() || "(Alex finished.)");
        const alexUsage = await alexStream.usage;
        await recordUsage(id, "alex", MODELS.pro, alexUsage, "tool-loop");

        // 推一份最新 vfiles 全量给前端做最终预览
        const files = await listLatestVFiles(id);
        send({ type: "files-snapshot", files });

        await db().execute({
          sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
          args: ["built", Date.now(), id],
        });

        send({ type: "done" });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      } finally {
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

// ---------------------------------------------------------------------------
// routeStreamPart: map AI SDK fullStream events → our custom SSE protocol
// ---------------------------------------------------------------------------
async function routeStreamPart(
  part: { type: string; [k: string]: unknown },
  msgId: string,
  agent: string,
  projectId: string,
  send: (obj: object) => void,
) {
  switch (part.type) {
    case "text-delta": {
      const delta = (part as { textDelta?: string; text?: string }).textDelta
        ?? (part as { text?: string }).text
        ?? "";
      if (delta) send({ type: "agent-message-chunk", id: msgId, delta });
      return;
    }
    case "tool-call": {
      const p2 = part as unknown as { toolCallId: string; toolName: string; input?: unknown; args?: unknown };
      const toolCallId = p2.toolCallId;
      const toolName = p2.toolName;
      const input = p2.input ?? p2.args;
      send({
        type: "tool-call-start",
        id: toolCallId,
        agent,
        name: toolName,
        args: input,
      });
      await persistMessage(projectId, agent, "tool-call", "", {
        tool_call_id: toolCallId,
        name: toolName,
        args: input,
      });
      return;
    }
    case "tool-result": {
      const p2 = part as unknown as { toolCallId: string; toolName: string; output?: unknown; result?: unknown };
      const toolCallId = p2.toolCallId;
      const toolName = p2.toolName;
      const output = p2.output ?? p2.result;
      send({
        type: "tool-call-end",
        id: toolCallId,
        agent,
        name: toolName,
        result: output,
      });
      if (isUIEvent(output)) {
        send({ type: "ui-focus", event: output });
      }
      await persistMessage(projectId, agent, "tool-result", "", {
        tool_call_id: toolCallId,
        name: toolName,
        result: output,
      });
      return;
    }
    case "error": {
      const err = (part as { error?: unknown }).error;
      send({ type: "error", error: String(err) });
      return;
    }
    default:
      return;
  }
}
