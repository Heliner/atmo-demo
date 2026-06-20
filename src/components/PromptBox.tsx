"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Zap, Users, Trophy, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentMentionInput } from "@/components/AgentMentionInput";

type Mode = "engineer" | "team" | "race";

const MODE_META: Record<Mode, { label: string; icon: React.ElementType; desc: string; disabled?: boolean }> = {
  engineer: { label: "Engineer", icon: Zap, desc: "Just Alex. Fast." },
  team: { label: "Team", icon: Users, desc: "PM, Architect, Engineer collaborate." },
  race: { label: "Race", icon: Trophy, desc: "3 models compete. Coming in v2.", disabled: true },
};

export function PromptBox({
  initial = "",
  initialMode = "team",
  autoSubmit = false,
}: {
  initial?: string;
  initialMode?: Mode;
  autoSubmit?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const submittedOnce = useRef(false);

  async function submit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text.trim(), mode }),
      });
      const data = await res.json();
      if (data.id) router.push(`/project/${data.id}`);
      else throw new Error(data.error || "Failed to create project");
    } catch (e) {
      setSubmitting(false);
      alert((e as Error).message);
    }
  }

  if (autoSubmit && initial && !submittedOnce.current) {
    submittedOnce.current = true;
    setTimeout(submit, 50);
  }

  const ModeIcon = MODE_META[mode].icon;

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-3">
        {(Object.keys(MODE_META) as Mode[]).map((m) => {
          const meta = MODE_META[m];
          const Icon = meta.icon;
          const isDisabled = meta.disabled;
          return (
            <button
              key={m}
              onClick={() => !isDisabled && setMode(m)}
              disabled={isDisabled}
              title={isDisabled ? meta.desc : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-all",
                isDisabled
                  ? "border-[#23232E] text-[#5C5C70] cursor-not-allowed opacity-60"
                  : mode === m
                  ? "bg-[#14141C] border-[#7C5CFF]/60 text-white shadow-[0_0_0_3px_rgba(124,92,255,0.12)]"
                  : "border-[#23232E] text-[#9090A0] hover:text-white hover:border-[#2E2E3C]",
              )}
            >
              <Icon size={12} />
              {meta.label}
              {isDisabled && <span className="ml-1 text-[9px] uppercase">soon</span>}
            </button>
          );
        })}
        <div className="ml-auto text-xs text-[#7C7C90] hidden sm:block">{MODE_META[mode].desc}</div>
      </div>

      <div className="relative rounded-2xl bg-[#0E0E16] border border-[#23232E] focus-within:border-[#7C5CFF]/60 focus-within:shadow-[0_0_0_4px_rgba(124,92,255,0.10)] transition-all">
        <AgentMentionInput
          variant="bare"
          rows={4}
          value={text}
          onChange={setText}
          // /api/projects ignores agent at creation; keep the @prefix in the
          // raw prompt so message history reflects what the user typed.
          onSubmit={() => submit()}
          placeholder="Tell the team what to build. e.g., 'A kanban board with drag-and-drop and a sprint burndown chart…'  Tip: type @ to direct-message a teammate."
          textareaClassName="w-full bg-transparent text-white placeholder-[#5C5C70] resize-none p-4 pr-14 text-sm leading-relaxed outline-none"
        />
        <div className="flex items-center justify-between px-3 py-2 border-t border-[#23232E]/60">
          <div className="flex items-center gap-2">
            <Chip>🎨 Theme: Dark</Chip>
            <Chip>🧩 Atoms Cloud</Chip>
            <Chip className="hidden sm:inline-flex">⌘ + ↵ to send</Chip>
          </div>
          <button
            onClick={submit}
            disabled={!text.trim() || submitting}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-white text-black text-sm font-semibold hover:bg-zinc-100 disabled:bg-[#23232E] disabled:text-[#5C5C70]"
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Routing…
              </>
            ) : (
              <>
                <ModeIcon size={14} /> Build with {MODE_META[mode].label}
                <ArrowUp size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-6 px-2 rounded-md bg-[#14141C] border border-[#23232E] text-[11px] text-[#9090A0]",
        className,
      )}
    >
      {children}
    </span>
  );
}
