import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import {
  generateText,
  streamText,
  stepCountIs,
  type ModelMessage,
} from "ai";
import { db, ensureSchema, loadMemories, saveMemory } from "@/lib/db";
import { getModel, DOUBAO_PROVIDER_OPTIONS, MODELS } from "@/lib/llm/doubao";
import {
  MIKE_SYSTEM,
  EMMA_SYSTEM,
  BOB_SYSTEM,
  ALEX_SYSTEM,
  IRIS_SYSTEM,
  memorySection,
} from "@/lib/agents/prompts";
import { makeTools, isUIEvent } from "@/lib/agents/tools";
import { recordUsage } from "@/lib/agents/billing";
import { extractJSON, type PRD } from "@/lib/agents/orchestrate";
import { listLatestVFiles } from "@/lib/sandbox/vfiles";
import { listSchema } from "@/lib/sandbox/sqlbox";

export const runtime = "nodejs";
export const maxDuration = 180;

type AgentName = "mike" | "emma" | "bob" | "alex" | "iris";
const VALID_AGENTS: ReadonlyArray<AgentName> = [
  "mike",
  "emma",
  "bob",
  "alex",
  "iris",
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// persistMessage — same pattern as followup/execute routes.
// ---------------------------------------------------------------------------
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
// buildAlexContext — same sliding-window shape as /followup. Inlined here so
// /mention has zero coupling to /followup's internals.
// ---------------------------------------------------------------------------
async function buildAlexContext(
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
  }
  msgs.push({ role: "user", content: userMsg });

  if (msgs.length > 20) {
    return msgs.slice(msgs.length - 20);
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// findLatestPRD — for Emma refine. Pull last 'plan' message meta.
// ---------------------------------------------------------------------------
async function findLatestPRD(projectId: string): Promise<PRD | null> {
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

// ---------------------------------------------------------------------------
// Stream-chunk a finished text in 28-char windows (mirrors plan/route.ts).
// ---------------------------------------------------------------------------
async function streamChunks(
  text: string,
  msgId: string,
  send: (obj: object) => void,
  delayMs = 30,
) {
  for (const ch of text.match(/[\s\S]{1,28}/g) || []) {
    send({ type: "agent-message-chunk", id: msgId, delta: ch });
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

// ---------------------------------------------------------------------------
// routeStreamPart: map AI SDK fullStream events → custom SSE protocol.
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
      send({
        type: "tool-call-start",
        id: p2.toolCallId,
        agent,
        name: p2.toolName,
        args: p2.input ?? p2.args,
      });
      await persistMessage(projectId, agent, "tool-call", "", {
        tool_call_id: p2.toolCallId,
        name: p2.toolName,
        args: p2.input ?? p2.args,
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
      const output = p2.output ?? p2.result;
      send({
        type: "tool-call-end",
        id: p2.toolCallId,
        agent,
        name: p2.toolName,
        result: output,
      });
      if (isUIEvent(output)) {
        send({ type: "ui-focus", event: output });
      }
      await persistMessage(projectId, agent, "tool-result", "", {
        tool_call_id: p2.toolCallId,
        name: p2.toolName,
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

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/mention
// body: { agent: 'mike'|'emma'|'bob'|'alex'|'iris', message: string }
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const agent = String((body as { agent?: string }).agent || "")
    .toLowerCase()
    .trim() as AgentName;
  const userMsg = String((body as { message?: string }).message || "").trim();

  if (!userMsg) return new Response("message required", { status: 400 });
  if (!VALID_AGENTS.includes(agent)) {
    return new Response("invalid agent", { status: 400 });
  }

  const p = await db().execute({
    sql: "SELECT prompt, status FROM projects WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (p.rows.length === 0) return new Response("not found", { status: 404 });
  const initialIdea = p.rows[0].prompt as string;

  // Persist the user's @-mention message immediately.
  await persistMessage(id, "user", "user", userMsg, { mentioned_agent: agent });

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
        send({
          type: "status",
          content: `${capitalize(agent)} is on it…`,
        });

        const msgId = nanoid(10);

        // -----------------------------------------------------------------
        // mike — one-shot chat, fake-chunked
        // -----------------------------------------------------------------
        if (agent === "mike") {
          send({
            type: "agent-message-start",
            id: msgId,
            agent: "mike",
            kind: "chat",
          });
          const r = await generateText({
            model: getModel("std"),
            system: MIKE_SYSTEM,
            prompt: userMsg,
            temperature: 0.6,
            maxOutputTokens: 6000,
            providerOptions: DOUBAO_PROVIDER_OPTIONS,
            abortSignal: req.signal,
          });
          const text = r.text || "";
          await streamChunks(text, msgId, send);
          send({ type: "agent-message-end", id: msgId });
          await persistMessage(
            id,
            "mike",
            "chat",
            text.trim() || "(Mike had nothing to add.)",
          );
          await recordUsage(id, "mike", MODELS.std, r.usage, "chat");
        }

        // -----------------------------------------------------------------
        // emma — refine PRD with user feedback; fake-chunked
        // -----------------------------------------------------------------
        else if (agent === "emma") {
          const existingPRD = await findLatestPRD(id);
          const prdHint = existingPRD
            ? `\n\nExisting PRD JSON (PRESERVE high-level shape, only adjust what the user asked):\n${JSON.stringify(existingPRD, null, 2)}`
            : "";
          const prompt = `Refine or extend the existing PRD based on this user feedback:\n\n${userMsg}\n\nIf there is a previous PRD in this project, KEEP its high-level shape and only adjust what the user asked.${prdHint}`;

          send({
            type: "agent-message-start",
            id: msgId,
            agent: "emma",
            kind: "plan-raw",
          });
          const r = await generateText({
            model: getModel("pro"),
            system: EMMA_SYSTEM,
            prompt,
            temperature: 0.4,
            maxOutputTokens: 6000,
            providerOptions: DOUBAO_PROVIDER_OPTIONS,
            abortSignal: req.signal,
          });
          const text = r.text || "";
          await streamChunks(text, msgId, send);
          send({ type: "agent-message-end", id: msgId });

          const prd = extractJSON<PRD>(text);
          if (prd && prd.title && Array.isArray(prd.tasks)) {
            send({ type: "prd", id: msgId, agent: "emma", prd });
            await persistMessage(id, "emma", "plan", text, { prd });
            if (Array.isArray(prd.preferences)) {
              for (const pref of prd.preferences) {
                if (pref?.key && pref?.value) {
                  await saveMemory(id, pref.key, String(pref.value), "emma");
                }
              }
              const mems = await loadMemories(id);
              send({ type: "memories", memories: mems });
            }
          } else {
            await persistMessage(id, "emma", "chat", text);
          }
          await recordUsage(id, "emma", MODELS.pro, r.usage, "chat");
        }

        // -----------------------------------------------------------------
        // bob — tool-using architect (exec_sql / run_python / show_table)
        // -----------------------------------------------------------------
        else if (agent === "bob") {
          const memories = await loadMemories(id);
          const tools = makeTools(id);
          const existingSchema = await listSchema(id);
          const schemaSummary = existingSchema.map((t) => ({
            name: t.name,
            columns: t.columns.map((c) => c.name + ":" + c.type),
          }));

          send({
            type: "agent-message-start",
            id: msgId,
            agent: "bob",
            kind: "chat",
          });
          const result = streamText({
            model: getModel("std"),
            system: BOB_SYSTEM + memorySection(memories),
            messages: [
              {
                role: "user",
                content:
                  "Existing schema (sandbox tables): " +
                  JSON.stringify(schemaSummary),
              },
              { role: "user", content: userMsg },
            ] satisfies ModelMessage[],
            tools: {
              exec_sql: tools.exec_sql,
              run_python: tools.run_python,
              show_table: tools.show_table,
            },
            stopWhen: stepCountIs(12),
            temperature: 0.5,
            maxOutputTokens: 6000,
            providerOptions: DOUBAO_PROVIDER_OPTIONS,
            abortSignal: req.signal,
          });
          for await (const part of result.fullStream) {
            await routeStreamPart(part, msgId, "bob", id, send);
          }
          send({ type: "agent-message-end", id: msgId });
          const text = await result.text;
          await persistMessage(
            id,
            "bob",
            "chat",
            text.trim() || "(Bob made the changes.)",
          );
          const usage = await result.usage;
          await recordUsage(id, "bob", MODELS.std, usage, "tool-loop");
        }

        // -----------------------------------------------------------------
        // alex — tool-using engineer (write_file / focus_file / show_preview)
        // -----------------------------------------------------------------
        else if (agent === "alex") {
          const memories = await loadMemories(id);
          const tools = makeTools(id);
          const msgs = await buildAlexContext(id, initialIdea, userMsg);

          send({
            type: "agent-message-start",
            id: msgId,
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
            stopWhen: stepCountIs(12),
            temperature: 0.5,
            maxOutputTokens: 6000,
            providerOptions: DOUBAO_PROVIDER_OPTIONS,
            abortSignal: req.signal,
          });
          for await (const part of result.fullStream) {
            await routeStreamPart(part, msgId, "alex", id, send);
          }
          send({ type: "agent-message-end", id: msgId });
          const text = await result.text;
          await persistMessage(
            id,
            "alex",
            "chat",
            text.trim() || "(Alex finished.)",
          );
          const usage = await result.usage;
          await recordUsage(id, "alex", MODELS.pro, usage, "tool-loop");
        }

        // -----------------------------------------------------------------
        // iris — streamed markdown research brief, no tools
        // -----------------------------------------------------------------
        else if (agent === "iris") {
          send({
            type: "agent-message-start",
            id: msgId,
            agent: "iris",
            kind: "chat",
          });
          const result = streamText({
            model: getModel("std"),
            system: IRIS_SYSTEM,
            prompt: userMsg,
            temperature: 0.5,
            maxOutputTokens: 6000,
            providerOptions: DOUBAO_PROVIDER_OPTIONS,
            abortSignal: req.signal,
          });
          for await (const part of result.fullStream) {
            await routeStreamPart(part, msgId, "iris", id, send);
          }
          send({ type: "agent-message-end", id: msgId });
          const text = await result.text;
          await persistMessage(
            id,
            "iris",
            "chat",
            text.trim() || "(Iris had no research to add.)",
          );
          const usage = await result.usage;
          await recordUsage(id, "iris", MODELS.std, usage, "chat");
        }

        // -----------------------------------------------------------------
        // Snapshot vfiles if alex/bob may have touched them.
        // -----------------------------------------------------------------
        if (agent === "alex" || agent === "bob") {
          const files = await listLatestVFiles(id);
          send({ type: "files-snapshot", files });
        }

        // Touch updated_at; do not clobber status.
        await db().execute({
          sql: "UPDATE projects SET updated_at = ? WHERE id = ?",
          args: [Date.now(), id],
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
