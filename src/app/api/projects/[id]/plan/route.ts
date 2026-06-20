import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { db, ensureSchema, saveMemory, loadMemories } from "@/lib/db";
import { mikeIntro, emmaPlanStream, extractJSON, type PRD } from "@/lib/agents/orchestrate";
import { recordUsage } from "@/lib/agents/billing";
import { MODELS } from "@/lib/llm/doubao";

export const runtime = "nodejs";
export const maxDuration = 90;

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const p = await db().execute({
    sql: "SELECT prompt, mode FROM projects WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (p.rows.length === 0) return new Response("not found", { status: 404 });
  const idea = p.rows[0].prompt as string;
  const mode = (p.rows[0].mode as string) || "team";

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: object) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        await db().execute({
          sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
          args: ["planning", Date.now(), id],
        });

        // -------- Engineer Mode short-circuit --------
        // Skip Mike + Emma entirely, synthesize a minimal PRD inline, and
        // auto-approve so the frontend jumps straight to Alex.
        if (mode === "engineer") {
          send({
            type: "status",
            content: "Engineer Mode — going straight to Alex with a minimal brief…",
          });

          const minPRD: PRD = {
            title: idea.slice(0, 40).replace(/\s+/g, " "),
            one_liner: idea,
            target_user: "You — the founder",
            core_value: "Quick prototype, no PM cycle.",
            primary_screen: "A single-page app honoring the prompt.",
            tasks: [
              "Implement the user's idea as a single-page web app",
              "Use Tailwind via CDN",
              "Persist any state to localStorage",
            ],
            data_entities: [],
            preferences: [],
          };

          const emmaMsgId = nanoid(10);
          send({ type: "prd", id: emmaMsgId, agent: "emma", prd: minPRD });
          await persistMessage(
            id,
            "emma",
            "plan",
            "(Engineer Mode: skipping PRD)",
            { prd: minPRD },
          );

          send({ type: "awaiting-approval" });
          send({ type: "auto-approve" });
          await db().execute({
            sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
            args: ["awaiting-approval", Date.now(), id],
          });
          send({ type: "done" });
          return;
        }

        // -------- Mike intro --------
        send({ type: "status", content: "Mike is routing your request to the team…" });
        const mikeMsgId = nanoid(10);
        send({ type: "agent-message-start", id: mikeMsgId, agent: "mike", kind: "chat" });
        const mike = await mikeIntro(idea);
        const mikeText = mike.text || "";
        for (const ch of mikeText.match(/[\s\S]{1,28}/g) || []) {
          send({ type: "agent-message-chunk", id: mikeMsgId, delta: ch });
          await new Promise((r) => setTimeout(r, 30));
        }
        send({ type: "agent-message-end", id: mikeMsgId });
        await persistMessage(id, "mike", "chat", mikeText);
        await recordUsage(id, "mike", MODELS.std, mike.usage, "chat");

        // -------- Emma PRD --------
        send({ type: "status", content: "Emma is drafting a PRD…" });
        const emmaMsgId = nanoid(10);
        send({ type: "agent-message-start", id: emmaMsgId, agent: "emma", kind: "plan-raw" });
        const emmaStream = emmaPlanStream(idea, req.signal);
        let emmaRaw = "";
        for await (const chunk of emmaStream.textStream) {
          emmaRaw += chunk;
          send({ type: "agent-message-chunk", id: emmaMsgId, delta: chunk });
        }
        send({ type: "agent-message-end", id: emmaMsgId });
        const emmaUsage = await emmaStream.usage;
        await recordUsage(id, "emma", MODELS.pro, emmaUsage, "chat");

        const prd = extractJSON<PRD>(emmaRaw);
        if (!prd || !prd.title || !Array.isArray(prd.tasks)) {
          send({
            type: "error",
            error: "Emma's PRD was malformed. Try again.",
            raw: emmaRaw.slice(0, 500),
          });
          controller.close();
          return;
        }
        send({ type: "prd", id: emmaMsgId, agent: "emma", prd });
        await persistMessage(id, "emma", "plan", emmaRaw, { prd });

        // -------- Persist Emma's preferences as short-term memories --------
        if (Array.isArray(prd.preferences)) {
          for (const pref of prd.preferences) {
            if (pref?.key && pref?.value) {
              await saveMemory(id, pref.key, String(pref.value), "emma");
            }
          }
          const mems = await loadMemories(id);
          send({ type: "memories", memories: mems });
        }

        send({ type: "awaiting-approval" });
        send({ type: "done" });
        await db().execute({
          sql: "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
          args: ["awaiting-approval", Date.now(), id],
        });
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
