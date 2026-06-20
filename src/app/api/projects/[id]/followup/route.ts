import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { streamText, stepCountIs, type ModelMessage } from "ai";
import { db, ensureSchema, loadMemories } from "@/lib/db";
import { getModel, DOUBAO_PROVIDER_OPTIONS, MODELS } from "@/lib/llm/doubao";
import { ALEX_SYSTEM, memorySection } from "@/lib/agents/prompts";
import { makeTools, isUIEvent } from "@/lib/agents/tools";
import { recordUsage } from "@/lib/agents/billing";
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

// ---------------------------------------------------------------------------
// buildContext — sliding-window assemble: 12 recent user/chat + 6 recent
// tool-call summaries, plus the new user message at the end.
// ---------------------------------------------------------------------------
async function buildContext(
  projectId: string,
  initialIdea: string,
  userMsg: string,
): Promise<ModelMessage[]> {
  const recentMsgs = await db().execute({
    sql: `SELECT agent, kind, content, created_at
            FROM messages
           WHERE project_id = ? AND kind IN ('user', 'chat')
           ORDER BY created_at DESC LIMIT 12`,
    args: [projectId],
  });
  const recent = recentMsgs.rows.slice().reverse();

  const toolMsgs = await db().execute({
    sql: `SELECT meta, created_at FROM messages
           WHERE project_id = ? AND kind = 'tool-call'
           ORDER BY created_at DESC LIMIT 6`,
    args: [projectId],
  });
  const toolLines = toolMsgs.rows
    .slice()
    .reverse()
    .map((r) => {
      try {
        const m = JSON.parse(r.meta as string) as {
          name?: string;
          args?: Record<string, unknown>;
        };
        const a = m.args;
        const argStr = a
          ? ` ${String(
              a.path ?? a.table ?? a.command ?? JSON.stringify(a),
            ).slice(0, 60)}`
          : "";
        return `- ${m.name ?? "(tool)"}${argStr}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const msgs: ModelMessage[] = [
    { role: "user", content: `Initial idea: ${initialIdea}` },
  ];
  if (toolLines.length) {
    msgs.push({
      role: "assistant",
      content: `Recent tool actions:\n${toolLines.join("\n")}`,
    });
  }
  for (const r of recent) {
    const text = String(r.content || "").trim();
    if (!text) continue;
    if (r.kind === "user") {
      msgs.push({ role: "user", content: text });
    } else if (r.kind === "chat" && r.agent === "alex") {
      msgs.push({ role: "assistant", content: text });
    }
    // Skip mike/emma/bob chats — not relevant to follow-up refinement.
  }
  msgs.push({ role: "user", content: userMsg });

  // Cap at 20, sliced from the end so the most recent turns survive.
  if (msgs.length > 20) {
    return msgs.slice(msgs.length - 20);
  }
  return msgs;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const userMsg = String((body as { message?: string }).message || "").trim();
  if (!userMsg) return new Response("message required", { status: 400 });

  const p = await db().execute({
    sql: "SELECT prompt FROM projects WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (p.rows.length === 0) return new Response("not found", { status: 404 });
  const initialIdea = p.rows[0].prompt as string;

  const msgs = await buildContext(id, initialIdea, userMsg);

  await persistMessage(id, "user", "user", userMsg);
  await db().execute({
    sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
    args: ["building", Date.now(), id],
  });

  const tools = makeTools(id);
  const memories = await loadMemories(id);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: object) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      };

      try {
        send({ type: "status", content: "Alex is refining your app…" });
        const alexMsgId = nanoid(10);
        send({
          type: "agent-message-start",
          id: alexMsgId,
          agent: "alex",
          kind: "chat",
        });

        const result = streamText({
          model: getModel("pro"),
          system: ALEX_SYSTEM + memorySection(memories),
          messages: msgs,
          tools: {
            write_file: tools.write_file,
            read_file: tools.read_file,
            list_files: tools.list_files,
            focus_file: tools.focus_file,
            show_preview: tools.show_preview,
            show_console: tools.show_console,
          },
          stopWhen: stepCountIs(10),
          temperature: 0.5,
          maxOutputTokens: 8192,
          providerOptions: DOUBAO_PROVIDER_OPTIONS,
          abortSignal: req.signal,
        });

        for await (const part of result.fullStream) {
          await routeStreamPart(part, alexMsgId, "alex", id, send);
        }

        send({ type: "agent-message-end", id: alexMsgId });
        const text = await result.text;
        await persistMessage(
          id,
          "alex",
          "chat",
          text.trim() || "(Alex finished refinement.)",
        );
        const usage = await result.usage;
        await recordUsage(id, "alex", MODELS.pro, usage, "followup");

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
// routeStreamPart: map AI SDK fullStream events → our custom SSE protocol.
// Copy of execute/route.ts's helper (the two routes diverge enough that
// keeping them independent reads cleaner than extracting now).
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
      const delta =
        (part as { textDelta?: string; text?: string }).textDelta ??
        (part as { text?: string }).text ??
        "";
      if (delta) send({ type: "agent-message-chunk", id: msgId, delta });
      return;
    }
    case "tool-call": {
      const p2 = part as unknown as {
        toolCallId: string;
        toolName: string;
        input?: unknown;
        args?: unknown;
      };
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
      const p2 = part as unknown as {
        toolCallId: string;
        toolName: string;
        output?: unknown;
        result?: unknown;
      };
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
