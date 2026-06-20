"use client";
import { AgentAvatar } from "./AgentAvatar";
import { AGENTS, type AgentId } from "@/lib/agents/roles";
import type { PRD } from "@/lib/agents/orchestrate";
import { Check, FileCode, Sparkles, Wrench, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type MessageKind =
  | "chat"
  | "plan"
  | "status"
  | "file"
  | "race-pick"
  | "user"
  | "tool-call"
  | "tool-result";

export interface Message {
  id: string;
  agent: AgentId;
  kind: MessageKind;
  content: string;
  meta?: {
    prd?: PRD;
    fileSize?: number;
    fileName?: string;
    raceTag?: string;
    streaming?: boolean;
    tool_name?: string;
    args?: Record<string, unknown> | unknown;
    result?: unknown;
  };
}

export function MessageList({
  messages,
  onApprove,
  approving,
  prdApproved,
  autoApproved,
  onToolClick,
}: {
  messages: Message[];
  onApprove?: (prd: PRD) => void;
  approving?: boolean;
  prdApproved?: boolean;
  autoApproved?: boolean;
  onToolClick?: (toolName: string, args: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-5 px-5 py-6">
      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          onApprove={onApprove}
          approving={approving}
          prdApproved={prdApproved}
          autoApproved={autoApproved}
          onToolClick={onToolClick}
        />
      ))}
    </div>
  );
}

function MessageRow({
  message,
  onApprove,
  approving,
  prdApproved,
  autoApproved,
  onToolClick,
}: {
  message: Message;
  onApprove?: (prd: PRD) => void;
  approving?: boolean;
  prdApproved?: boolean;
  autoApproved?: boolean;
  onToolClick?: (toolName: string, args: unknown) => void;
}) {
  const agent = AGENTS[message.agent];

  if (message.kind === "status") {
    return (
      <div className="flex items-center gap-2 text-xs text-[#7C7C90] fade-up">
        <span className="inline-block w-1 h-1 rounded-full bg-[#7C5CFF] animate-pulse" />
        {message.content}
      </div>
    );
  }

  if (message.kind === "user") {
    return (
      <div className="flex gap-3 fade-up">
        <AgentAvatar agent="user" size={32} />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[#9090A0] mb-1">You</div>
          <div className="text-sm text-white whitespace-pre-wrap leading-relaxed">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 fade-up">
      <AgentAvatar agent={message.agent} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-medium text-white">{agent.name}</span>
          <span className="text-[11px] text-[#7C7C90]">· {agent.title}</span>
        </div>

        {message.kind === "chat" && (
          <ChatBubble content={message.content} streaming={message.meta?.streaming} />
        )}

        {message.kind === "plan" && message.meta?.prd && (
          <PrdCard
            prd={message.meta.prd}
            onApprove={onApprove}
            approving={approving}
            approved={prdApproved}
            autoApproved={autoApproved}
          />
        )}

        {message.kind === "file" && (
          <FileCard
            fileName={message.meta?.fileName || "app.html"}
            size={message.meta?.fileSize || message.content.length}
            streaming={message.meta?.streaming}
          />
        )}

        {message.kind === "race-pick" && (
          <div className="text-sm text-[#39C5BB] inline-flex items-center gap-1.5">
            <Sparkles size={14} /> {message.content}
          </div>
        )}

        {message.kind === "tool-call" && (
          <ToolCallCard
            toolName={message.meta?.tool_name}
            args={message.meta?.args}
            onClick={onToolClick}
          />
        )}

        {message.kind === "tool-result" && (
          <ToolResultLine result={message.meta?.result} />
        )}
      </div>
    </div>
  );
}

function ToolCallCard({
  toolName,
  args,
  onClick,
}: {
  toolName?: string;
  args?: unknown;
  onClick?: (toolName: string, args: unknown) => void;
}) {
  const name = toolName || "tool";
  const summary = summarizeArgs(name, args);

  return (
    <button
      type="button"
      onClick={() => onClick?.(name, args)}
      className={cn(
        "inline-flex items-center gap-2 rounded-md bg-[#14141C] border border-[#23232E] px-3 py-2 text-xs",
        onClick ? "hover:border-[#7C5CFF]/50 cursor-pointer" : "cursor-default",
      )}
    >
      <Wrench size={14} className="text-[#7C5CFF] shrink-0" />
      <span className="font-mono text-[#D5D5DF]">{name}</span>
      {summary && (
        <span className="font-mono text-[#7C7C90] truncate max-w-[280px]">
          {summary}
        </span>
      )}
    </button>
  );
}

function ToolResultLine({ result }: { result?: unknown }) {
  const summary = summarizeResult(result);
  if (!summary) return null;
  return (
    <div className="inline-flex items-center gap-2 text-xs text-[#7C7C90] mt-1">
      <CheckCircle2 size={12} className="text-[#39C5BB]" />
      <span className="font-mono">{summary}</span>
    </div>
  );
}

function summarizeArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (typeof a.path === "string") {
    return String(a.path);
  }
  if (typeof a.command === "string") {
    const cmd = String(a.command);
    return cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
  }
  if (typeof a.sql === "string") {
    const sql = String(a.sql).replace(/\s+/g, " ").trim();
    return sql.length > 80 ? sql.slice(0, 80) + "…" : sql;
  }
  if (typeof a.table === "string") {
    return String(a.table);
  }
  if (typeof a.code === "string") {
    const code = String(a.code).replace(/\s+/g, " ").trim();
    return code.length > 80 ? code.slice(0, 80) + "…" : code;
  }
  // Fallback: tool name only.
  void toolName;
  return "";
}

function summarizeResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  if (typeof r.size === "number" && typeof r.path === "string") {
    return `${r.path} · ${(Number(r.size) / 1024).toFixed(1)} KB`;
  }
  if (typeof r.rowsAffected === "number") {
    return `${r.rowsAffected} row(s) affected`;
  }
  if (Array.isArray(r.rows)) {
    return `${(r.rows as unknown[]).length} row(s)`;
  }
  if (typeof r.message === "string") {
    return String(r.message);
  }
  if (r.success === false && typeof r.error === "string") {
    return `error: ${r.error}`;
  }
  return "";
}

function ChatBubble({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div
      className={cn(
        "text-sm text-[#D5D5DF] leading-relaxed whitespace-pre-wrap",
        streaming && "caret",
      )}
    >
      {renderMarkdownLite(content)}
    </div>
  );
}

function PrdCard({
  prd,
  onApprove,
  approving,
  approved,
  autoApproved,
}: {
  prd: PRD;
  onApprove?: (prd: PRD) => void;
  approving?: boolean;
  approved?: boolean;
  autoApproved?: boolean;
}) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-[#14141C] to-[#0E0E16] border border-[#23232E] p-4 mt-1">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-[#7C5CFF] font-semibold">PRD</span>
        <span className="text-xs text-[#7C7C90]">· awaiting your approval</span>
      </div>
      <div className="text-lg font-semibold text-white">{prd.title}</div>
      <div className="text-sm text-[#9090A0] mt-1">{prd.one_liner}</div>

      <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
        <div>
          <div className="text-[#7C7C90] uppercase tracking-wider text-[10px] mb-1">For</div>
          <div className="text-[#D5D5DF]">{prd.target_user}</div>
        </div>
        <div>
          <div className="text-[#7C7C90] uppercase tracking-wider text-[10px] mb-1">Value</div>
          <div className="text-[#D5D5DF]">{prd.core_value}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[#7C7C90] uppercase tracking-wider text-[10px] mb-2">Build plan</div>
        <ul className="space-y-1.5">
          {prd.tasks.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-[#D5D5DF]">
              <span className="mt-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border border-[#39C5BB]/60 shrink-0">
                {approved && <Check size={10} className="text-[#39C5BB]" />}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {approved ? (
          <div className="inline-flex items-center gap-2 text-sm text-[#39C5BB]">
            <Check size={14} /> Approved — Alex is on it.
          </div>
        ) : autoApproved ? (
          <button
            disabled
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-[#23232E] text-[#9090A0] text-sm font-medium cursor-not-allowed"
            title="Engineer Mode skips human approval"
          >
            <Check size={14} /> Auto-approved (Engineer Mode)
          </button>
        ) : (
          <>
            <button
              onClick={() => onApprove?.(prd)}
              disabled={approving}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-[#7C5CFF] text-white text-sm font-medium hover:bg-[#8A6BFF] disabled:opacity-50"
            >
              <Check size={14} /> Approve & build
            </button>
            <button
              disabled
              className="h-8 px-3 rounded-md text-sm text-[#7C7C90] border border-[#23232E] cursor-not-allowed"
              title="Refine — coming soon"
            >
              Refine
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function FileCard({
  fileName,
  size,
  streaming,
}: {
  fileName: string;
  size: number;
  streaming?: boolean;
}) {
  const kb = (size / 1024).toFixed(1);
  return (
    <div className="inline-flex items-center gap-2 rounded-md bg-[#14141C] border border-[#23232E] px-3 py-2 text-xs">
      <FileCode size={14} className="text-[#FFB23F]" />
      <span className="text-[#D5D5DF] font-mono">{fileName}</span>
      <span className="text-[#7C7C90]">{kb} KB</span>
      {streaming ? (
        <span className="text-[#7C5CFF] inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C5CFF] animate-pulse" />
          writing
        </span>
      ) : (
        <span className="text-[#39C5BB]">saved</span>
      )}
    </div>
  );
}

function renderMarkdownLite(text: string) {
  const lines = text.split("\n");
  return lines.map((ln, i) => {
    if (/^\s*[-*]\s/.test(ln)) {
      return (
        <div key={i} className="flex gap-2">
          <span className="text-[#7C5CFF]">•</span>
          <span>{ln.replace(/^\s*[-*]\s/, "")}</span>
        </div>
      );
    }
    return <div key={i}>{ln || " "}</div>;
  });
}
