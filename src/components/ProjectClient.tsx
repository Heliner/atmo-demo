"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { streamSSE, type SSEEvent } from "@/lib/sse-client";
import { AGENTS, type AgentId } from "@/lib/agents/roles";
import { MessageList, type Message, type MessageKind } from "@/components/AgentMessage";
import {
  AppViewer,
  type AppViewerTab,
  type ShellEntry,
} from "@/components/AppViewer";
import { BillingWidget } from "@/components/BillingWidget";
import { RaceArena } from "@/components/RaceArena";
import { Square } from "lucide-react";
import type { PRD } from "@/lib/agents/orchestrate";
import type { VFile } from "@/lib/sandbox/vfiles";
import type { SchemaInfo } from "@/lib/sandbox/sqlbox";
import { cn } from "@/lib/utils";
import { AgentMentionInput } from "@/components/AgentMentionInput";

// ---------------------------------------------------------------------------
// Initial server payload — shape mirrors src/app/project/[id]/page.tsx
// ---------------------------------------------------------------------------
export interface ProjectInitial {
  project: {
    id: string;
    name: string;
    prompt: string;
    mode: string;
    status: string;
    created_at: number;
  };
  messages: Array<{
    id: string;
    agent: string;
    kind: string;
    content: string;
    meta: unknown;
    created_at: number;
  }>;
  vfiles: VFile[];
  memories: Array<{ key: string; value: string; source_agent: string }>;
  schema: SchemaInfo[];
  shellHistory?: ShellEntry[];
}

interface ConsoleError {
  agent?: string;
  message: string;
  ts: number;
}

const VALID_AGENT_IDS = new Set<AgentId>([
  "mike",
  "emma",
  "bob",
  "alex",
  "iris",
  "user",
  "system",
]);

function toAgentId(raw: string): AgentId {
  return VALID_AGENT_IDS.has(raw as AgentId) ? (raw as AgentId) : "system";
}

const VALID_KINDS = new Set<MessageKind>([
  "chat",
  "plan",
  "status",
  "file",
  "race-pick",
  "user",
  "tool-call",
  "tool-result",
]);

function toMessageKind(raw: string): MessageKind {
  if (VALID_KINDS.has(raw as MessageKind)) return raw as MessageKind;
  // Map legacy/intermediate kinds.
  if (raw === "plan-raw") return "chat";
  return "chat";
}

function mapInitialMessages(raw: ProjectInitial["messages"]): Message[] {
  return raw.map((m) => {
    const meta = (m.meta && typeof m.meta === "object" ? m.meta : {}) as Record<
      string,
      unknown
    >;
    const kind = toMessageKind(m.kind);
    const mapped: Message = {
      id: m.id,
      agent: toAgentId(m.agent),
      kind,
      content: m.content,
      meta: {
        prd: meta.prd as PRD | undefined,
        tool_name: meta.name as string | undefined,
        args: meta.args,
        result: meta.result,
      },
    };
    return mapped;
  });
}

// ---------------------------------------------------------------------------
// ProjectClient — drives plan/execute SSE, owns all panel state.
// ---------------------------------------------------------------------------
export function ProjectClient({ initial }: { initial: ProjectInitial }) {
  const id = initial.project.id;
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>(() =>
    mapInitialMessages(initial.messages),
  );
  const [vfiles, setVfiles] = useState<VFile[]>(initial.vfiles);
  const [memories, setMemories] = useState(initial.memories);
  const [schema, setSchema] = useState<SchemaInfo[]>(initial.schema);
  const [activeTab, setActiveTab] = useState<AppViewerTab>("preview");
  const [activeFile, setActiveFile] = useState<string | undefined>(undefined);
  const [activeTable, setActiveTable] = useState<string | undefined>(undefined);
  const [consoleErrors, setConsoleErrors] = useState<ConsoleError[]>([]);
  const [shellHistory, setShellHistory] = useState<ShellEntry[]>(
    initial.shellHistory ?? [],
  );
  const [status, setStatus] = useState(initial.project.status);
  const [streamingAgent, setStreamingAgent] = useState<AgentId | null>(null);
  const [approving, setApproving] = useState(false);
  // PRD is "approved" once we see any post-plan tool-call from alex/bob.
  const initialApproved = initial.messages.some(
    (m) =>
      (m.agent === "alex" || m.agent === "bob") &&
      (m.kind === "tool-call" || m.kind === "file"),
  );
  const [prdApproved, setPrdApproved] = useState(initialApproved);

  const stopFnRef = useRef<(() => void) | null>(null);
  // Map streaming SSE message id → React message id (they're the same here).
  const streamingMsgRef = useRef<Set<string>>(new Set());
  // Deferred-create map: agent-message-start announces a stream, but we wait
  // until the FIRST chunk to push a bubble. This prevents an empty caret bubble
  // hanging for tens of seconds while Alex/Bob run a long tool chain before
  // emitting any wrap-up text.
  const messageStartRef = useRef<
    Map<string, { agent: AgentId; kind: MessageKind }>
  >(new Map());
  // Latest PRD seen on the wire — used by Engineer Mode auto-approve, which
  // fires immediately after the `prd` event before React state has flushed.
  const latestPrdRef = useRef<PRD | null>(null);
  // Guard so a single auto-approve event can't trigger approve() twice if it
  // somehow arrives more than once.
  const autoApprovedRef = useRef(false);
  // Forward-ref so handleEvent can call approve() without a circular useCallback
  // dependency (approve depends on handleEvent which would otherwise depend on
  // approve). Populated by an effect after both are defined.
  const approveRef = useRef<(prd: PRD) => void>(() => {});
  // Buffer tool-call args (only sent on tool-call-start) so tool-call-end can
  // look them up by id — needed for auto-linkage (e.g. write_file path).
  const toolArgsRef = useRef<Map<string, unknown>>(new Map());
  // Timestamp of the most recent explicit presentation tool call
  // (focus_file/show_preview/show_table/show_console). Auto-linkage from
  // write_file/run_command/run_python defers to this within a short window.
  const recentExplicitFocusRef = useRef<number>(0);

  // ------------------------------------------------------------------
  // Refresh schema (after exec_sql tool runs).
  // ------------------------------------------------------------------
  const refreshSchema = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}/db`);
      if (!r.ok) return;
      const body = await r.json();
      if (Array.isArray(body.schemas)) {
        setSchema(body.schemas as SchemaInfo[]);
      }
    } catch {
      /* network blip; will retry on next tool */
    }
  }, [id]);

  // ------------------------------------------------------------------
  // SSE event router (shared by /plan and /execute).
  // ------------------------------------------------------------------
  const handleEvent = useCallback(
    (ev: SSEEvent) => {
      switch (ev.type) {
        case "status": {
          const sysMsg: Message = {
            id: `status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            agent: "system",
            kind: "status",
            content: ev.content,
          };
          setMessages((prev) => [...prev, sysMsg]);
          return;
        }
        case "agent-message-start": {
          const agent = toAgentId(ev.agent);
          setStreamingAgent(agent);
          streamingMsgRef.current.add(ev.id);
          // Deferred create: don't push a bubble yet. We wait for the first
          // chunk so tool-heavy runs (Alex/Bob) don't show a blinking caret
          // bubble for tens of seconds before any text arrives.
          messageStartRef.current.set(ev.id, { agent, kind: "chat" });
          return;
        }
        case "agent-message-chunk": {
          const pending = messageStartRef.current.get(ev.id);
          if (pending) {
            // First chunk for this id — lazily create the bubble now.
            messageStartRef.current.delete(ev.id);
            const newMsg: Message = {
              id: ev.id,
              agent: pending.agent,
              kind: pending.kind,
              content: ev.delta,
              meta: { streaming: true },
            };
            setMessages((prev) => [...prev, newMsg]);
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === ev.id
                ? { ...m, content: m.content + ev.delta }
                : m,
            ),
          );
          return;
        }
        case "agent-message-end": {
          streamingMsgRef.current.delete(ev.id);
          const wasPending = messageStartRef.current.delete(ev.id);
          if (wasPending) {
            // Stream ended without ever emitting a chunk (e.g. abort-stop or
            // a tool-only run with no wrap-up text). Drop silently — tool-call
            // cards are already in the transcript.
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === ev.id
                  ? { ...m, meta: { ...m.meta, streaming: false } }
                  : m,
              ),
            );
          }
          // Clear streaming agent if no more streams open.
          if (streamingMsgRef.current.size === 0) {
            setStreamingAgent(null);
          }
          return;
        }
        case "prd": {
          const agent = toAgentId(ev.agent);
          // Stash for Engineer Mode auto-approve, which fires synchronously
          // after this event and can't wait for React state to flush.
          latestPrdRef.current = ev.prd;
          // Replace the streaming Emma chat with a plan card.
          setMessages((prev) => {
            const next = prev.filter((m) => m.id !== ev.id);
            next.push({
              id: `${ev.id}-plan`,
              agent,
              kind: "plan",
              content: "",
              meta: { prd: ev.prd },
            });
            return next;
          });
          return;
        }
        case "memories": {
          setMemories(ev.memories);
          return;
        }
        case "awaiting-approval": {
          // Already represented by the plan card "Approve & build" button.
          return;
        }
        case "auto-approve": {
          // Engineer Mode: server tells us to skip the human approve click.
          if (autoApprovedRef.current) return;
          const prd = latestPrdRef.current;
          if (!prd) return;
          autoApprovedRef.current = true;
          approveRef.current(prd);
          return;
        }
        case "tool-call-start": {
          const agent = toAgentId(ev.agent);
          // Stash args by id so tool-call-end (which doesn't carry args) can
          // look them up for auto-linkage (write_file path, run_python code…).
          toolArgsRef.current.set(ev.id, ev.args);
          const msg: Message = {
            id: `tc-${ev.id}`,
            agent,
            kind: "tool-call",
            content: "",
            meta: { tool_name: ev.name, args: ev.args },
          };
          setMessages((prev) => [...prev, msg]);
          return;
        }
        case "tool-call-end": {
          const agent = toAgentId(ev.agent);
          const msg: Message = {
            id: `tr-${ev.id}`,
            agent,
            kind: "tool-result",
            content: "",
            meta: {
              tool_name: ev.name,
              result: ev.result,
            },
          };
          setMessages((prev) => [...prev, msg]);
          // exec_sql / write_file changed sandbox state — refresh schema.
          if (ev.name === "exec_sql") {
            void refreshSchema();
          }

          // ---- Auto-linkage: drive right-pane from tool calls -----------
          const argsRaw = toolArgsRef.current.get(ev.id);
          toolArgsRef.current.delete(ev.id);
          const args = (argsRaw && typeof argsRaw === "object"
            ? (argsRaw as Record<string, unknown>)
            : {}) as Record<string, unknown>;
          const result = (ev.result && typeof ev.result === "object"
            ? (ev.result as Record<string, unknown>)
            : {}) as Record<string, unknown>;
          // 800ms window: if a presentation tool fired very recently, defer.
          const explicitRecent =
            Date.now() - recentExplicitFocusRef.current < 800;

          if (ev.name === "run_command" || ev.name === "run_python") {
            const command =
              ev.name === "run_command"
                ? String(
                    (result.command as string | undefined) ??
                      (args.command as string | undefined) ??
                      (args.code as string | undefined) ??
                      "",
                  )
                : String(args.code ?? "").slice(0, 120);
            setShellHistory((h) => [
              ...h,
              {
                id: ev.id,
                agent,
                name: ev.name as "run_command" | "run_python",
                command: command || `(${ev.name})`,
                stdout: result.stdout as string | undefined,
                stderr: result.stderr as string | undefined,
                exitCode: result.exitCode as number | undefined,
                sandbox: result.sandbox as string | undefined,
                durationMs: (result.duration_ms ?? result.durationMs) as
                  | number
                  | undefined,
                ts: Date.now(),
              },
            ]);
            if (!explicitRecent) setActiveTab("console");
          } else if (ev.name === "write_file") {
            const path =
              (args.path as string | undefined) ??
              (result.path as string | undefined);
            if (path && !explicitRecent) {
              setActiveTab("code");
              setActiveFile(path);
            }
          }
          return;
        }
        case "ui-focus": {
          // Explicit presentation-tool call — wins over auto-linkage.
          recentExplicitFocusRef.current = Date.now();
          const e = ev.event;
          switch (e.__ui_event) {
            case "focus_file":
              setActiveTab("code");
              if (e.path) setActiveFile(e.path);
              return;
            case "show_table":
              setActiveTab("database");
              if (e.table) setActiveTable(e.table);
              return;
            case "show_preview":
              setActiveTab("preview");
              return;
            case "show_console":
              setActiveTab("console");
              return;
          }
          return;
        }
        case "files-snapshot": {
          setVfiles(
            ev.files.map((f) => ({
              path: f.path,
              content: f.content,
              version: f.version,
              size: f.size,
            })),
          );
          return;
        }
        case "error": {
          setConsoleErrors((prev) => [
            ...prev,
            { message: ev.error, ts: Date.now() },
          ]);
          return;
        }
        case "done": {
          setStreamingAgent(null);
          streamingMsgRef.current.clear();
          messageStartRef.current.clear();
          return;
        }
        default:
          return;
      }
    },
    [refreshSchema],
  );

  // ------------------------------------------------------------------
  // startPlan — kick off the Mike + Emma SSE stream.
  // ------------------------------------------------------------------
  const startPlan = useCallback(() => {
    if (stopFnRef.current) return;
    setStatus("planning");
    const stop = streamSSE(
      `/api/projects/${id}/plan`,
      {},
      {
        onEvent: handleEvent,
        onError: (err) =>
          setConsoleErrors((prev) => [
            ...prev,
            { message: err.message, ts: Date.now() },
          ]),
        onDone: () => {
          stopFnRef.current = null;
          setStreamingAgent(null);
        },
      },
    );
    stopFnRef.current = stop;
  }, [id, handleEvent]);

  // ------------------------------------------------------------------
  // approve — run Bob + Alex.
  // ------------------------------------------------------------------
  const approve = useCallback(
    async (_prd: PRD) => {
      if (approving) return;
      setApproving(true);
      setMessages((prev) => [
        ...prev,
        {
          id: `approval-${Date.now()}`,
          agent: "user",
          kind: "user",
          content: "Approved — let's build it.",
        },
      ]);
      setStatus("building");
      const stop = streamSSE(
        `/api/projects/${id}/execute`,
        {},
        {
          onEvent: handleEvent,
          onError: (err) =>
            setConsoleErrors((prev) => [
              ...prev,
              { message: err.message, ts: Date.now() },
            ]),
          onDone: () => {
            stopFnRef.current = null;
            setStreamingAgent(null);
            setApproving(false);
            setPrdApproved(true);
            setStatus("built");
          },
        },
      );
      stopFnRef.current = stop;
      setPrdApproved(true);
    },
    [id, approving, handleEvent],
  );

  // Keep approveRef pointed at the latest approve closure so handleEvent's
  // auto-approve branch can fire without taking approve as a useCallback dep.
  useEffect(() => {
    approveRef.current = approve;
  }, [approve]);

  // ------------------------------------------------------------------
  // stopCurrent — abort whichever SSE is in flight.
  // ------------------------------------------------------------------
  const stopCurrent = useCallback(() => {
    stopFnRef.current?.();
    stopFnRef.current = null;
    setStreamingAgent(null);
    streamingMsgRef.current.clear();
    messageStartRef.current.clear();
  }, []);

  // ------------------------------------------------------------------
  // sendMessage — POST /followup (no agent) or /mention (with agent),
  // stream into the existing SSE handler so chunks/tool-calls/
  // files-snapshot wire through the same reducer paths as plan/execute.
  // ------------------------------------------------------------------
  const sendMessage = useCallback(
    (message: string, agent?: AgentId) => {
      if (stopFnRef.current) return; // another stream already running
      // Mirror the user's message into the transcript immediately so they
      // see it before any network latency. If @-mention, prefix it visibly.
      const displayedContent = agent
        ? `@${AGENTS[agent].name} ${message}`
        : message;
      setMessages((m) => [
        ...m,
        {
          id: nanoid(10),
          agent: "user",
          kind: "user",
          content: displayedContent,
        },
      ]);
      setStatus("building");
      // streamingAgent is purely cosmetic (header spinner); pick a sensible default.
      setStreamingAgent(agent ?? "alex");

      const url = agent
        ? `/api/projects/${id}/mention`
        : `/api/projects/${id}/followup`;
      const body = agent ? { agent, message } : { message };

      const stop = streamSSE(url, body, {
        onEvent: handleEvent,
        onError: (err) => {
          setConsoleErrors((prev) => [
            ...prev,
            { message: err.message, ts: Date.now() },
          ]);
          stopFnRef.current = null;
          setStreamingAgent(null);
          streamingMsgRef.current.clear();
        },
        onDone: () => {
          stopFnRef.current = null;
          setStreamingAgent(null);
          streamingMsgRef.current.clear();
          setStatus("built");
        },
      });
      stopFnRef.current = stop;
    },
    [id, handleEvent],
  );

  // ------------------------------------------------------------------
  // Mount: auto-trigger plan if this is a freshly created project.
  // ------------------------------------------------------------------
  const planTriggeredRef = useRef(false);
  useEffect(() => {
    if (planTriggeredRef.current) return;
    const hasPlan = initial.messages.some(
      (m) => m.agent === "emma" && m.kind === "plan",
    );
    if (initial.project.status === "created" && !hasPlan) {
      planTriggeredRef.current = true;
      startPlan();
    }
    // We intentionally only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Auto-scroll messages to bottom on new content. Defer one frame so
  // the freshly appended message has painted before we measure.
  // ------------------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [messages]);

  // ------------------------------------------------------------------
  // Tool-call from sidebar → focus tab (optional).
  // ------------------------------------------------------------------
  const onToolClick = useCallback(
    (toolName: string, args: unknown) => {
      const a = (args && typeof args === "object" ? args : {}) as Record<
        string,
        unknown
      >;
      if (toolName === "write_file" || toolName === "read_file" || toolName === "focus_file") {
        setActiveTab("code");
        if (typeof a.path === "string") setActiveFile(a.path);
      } else if (toolName === "exec_sql" || toolName === "show_table") {
        setActiveTab("database");
        if (typeof a.table === "string") setActiveTable(a.table);
      } else if (toolName === "show_preview") {
        setActiveTab("preview");
      } else if (toolName === "show_console") {
        setActiveTab("console");
      }
    },
    [],
  );

  // Race Mode: until a winner is promoted (status flips to 'built'), show
  // the 3-lane arena instead of the regular chat + AppViewer layout. We
  // need a PRD before /race will accept the request, so if the auto-plan
  // effect hasn't produced one yet we render a tiny "planning" placeholder
  // and let the messages state above drive the transition.
  if (initial.project.mode === "race" && status !== "built") {
    const havePRD = messages.some(
      (m) => m.agent === "emma" && (m.kind === "plan" || !!m.meta?.prd),
    );
    if (!havePRD) {
      return (
        <div className="h-screen flex items-center justify-center bg-[#07070A] text-white">
          <div className="text-sm text-[#9090A0]">
            Emma is drafting the PRD before the race begins…
          </div>
        </div>
      );
    }
    return (
      <div className="h-screen bg-[#07070A]">
        <RaceArena
          projectId={id}
          onWinnerPicked={() => {
            setStatus("built");
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[#07070A] text-white">
      <div className="w-[42%] flex flex-col border-r border-[#23232E] min-w-0 relative">
        <ProjectHeader
          name={initial.project.name}
          status={status}
          streamingAgent={streamingAgent}
          onStop={stopCurrent}
          canStop={!!streamingAgent}
        />
        <div className="absolute top-16 right-3 z-10 pointer-events-auto">
          <BillingWidget projectId={id} status={status} />
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
        >
          <MessageList
            messages={messages}
            onApprove={approve}
            approving={approving}
            prdApproved={prdApproved}
            autoApproved={initial.project.mode === "engineer"}
            onToolClick={onToolClick}
          />
        </div>
        <FollowupInput
          projectId={id}
          disabled={!!streamingAgent}
          onSend={sendMessage}
        />
      </div>
      <div className="flex-1 min-w-0">
        <AppViewer
          vfiles={vfiles}
          projectId={id}
          schema={schema}
          memories={memories}
          consoleErrors={consoleErrors}
          shellHistory={shellHistory}
          activeTab={activeTab}
          activeFile={activeFile}
          activeTable={activeTable}
          onTabChange={setActiveTab}
          onSelectFile={setActiveFile}
          onSelectTable={setActiveTable}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectHeader — name + status pill + Stop button
// ---------------------------------------------------------------------------
function ProjectHeader({
  name,
  status,
  streamingAgent,
  onStop,
  canStop,
}: {
  name: string;
  status: string;
  streamingAgent: AgentId | null;
  onStop: () => void;
  canStop: boolean;
}) {
  const streamingAgentName = streamingAgent ? AGENTS[streamingAgent].name : null;
  const streamingAgentColor = streamingAgent ? AGENTS[streamingAgent].color : null;
  return (
    <div className="flex items-center gap-2 px-5 h-14 border-b border-[#23232E] shrink-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">{name}</div>
        <div className="text-[11px] text-[#7C7C90] flex items-center gap-1.5">
          <StatusPill status={status} />
          {streamingAgentName && (
            <span
              className="inline-flex items-center gap-1.5"
              style={{ color: streamingAgentColor ?? "#7C5CFF" }}
            >
              <span
                className="relative inline-flex w-1.5 h-1.5"
                aria-hidden
              >
                <span
                  className="absolute inset-0 rounded-full animate-ping opacity-60"
                  style={{ background: streamingAgentColor ?? "#7C5CFF" }}
                />
                <span
                  className="relative inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: streamingAgentColor ?? "#7C5CFF" }}
                />
              </span>
              <span>{streamingAgentName} · Streaming…</span>
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onStop}
        disabled={!canStop}
        title={canStop ? "Stop the current agent" : "Nothing to stop"}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border transition-colors",
          canStop
            ? "bg-[#FF5F57]/10 text-[#FF8B85] border-[#FF5F57]/40 hover:bg-[#FF5F57]/20 hover:text-white hover:border-[#FF5F57]/70"
            : "bg-transparent text-[#5C5C70] border-[#23232E] cursor-not-allowed opacity-60",
        )}
      >
        <Square size={11} fill="currentColor" />
        Stop
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    created: { label: "created", color: "#7C7C90" },
    planning: { label: "planning", color: "#7C5CFF" },
    "awaiting-approval": { label: "awaiting approval", color: "#FFB23F" },
    building: { label: "building", color: "#7C5CFF" },
    built: { label: "built", color: "#34D399" },
    stopped: { label: "stopped", color: "#FF5F57" },
    error: { label: "error", color: "#FF5F57" },
  };
  const s = map[status] ?? { label: status, color: "#7C7C90" };
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium"
      style={{
        color: s.color,
        background: `${s.color}1A`,
        border: `1px solid ${s.color}33`,
      }}
    >
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FollowupInput — multi-turn refinement input with @-mention picker.
// Calls onSend(message, agent?) which the parent wires to /followup (no agent)
// or /mention (with agent).
// ---------------------------------------------------------------------------
function FollowupInput({
  projectId: _projectId,
  disabled,
  onSend,
}: {
  projectId: string;
  disabled: boolean;
  onSend: (msg: string, agent?: AgentId) => void;
}) {
  const [val, setVal] = useState("");

  return (
    <AgentMentionInput
      value={val}
      onChange={setVal}
      onSubmit={(text, agent) => {
        if (!text || disabled) return;
        onSend(text, agent);
        setVal("");
      }}
      disabled={disabled}
    />
  );
}
