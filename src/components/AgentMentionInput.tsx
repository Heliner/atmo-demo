"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { AGENTS, ROSTER, type AgentId } from "@/lib/agents/roles";
import { AgentMentionPopover } from "@/components/AgentMentionPopover";
import { cn } from "@/lib/utils";

export interface AgentMentionInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string, agent?: AgentId) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  // "followup" → bordered card with send button (used in ProjectClient)
  // "bare" → just textarea + popover, no chrome (used inside PromptBox)
  variant?: "followup" | "bare";
  textareaClassName?: string;
  // Optional ID to keep multiple instances independent.
  formId?: string;
}

const NAME_TO_ID: Record<string, AgentId> = (() => {
  const m: Record<string, AgentId> = {};
  for (const id of ROSTER) m[AGENTS[id].name.toLowerCase()] = id;
  return m;
})();

// ---------------------------------------------------------------------------
// parseMention — if value matches `@<name> <rest>`, returns { id, rest }.
// Case-insensitive name match. Otherwise returns null.
// ---------------------------------------------------------------------------
function parseMention(value: string): { id: AgentId; rest: string } | null {
  const m = value.match(/^@(\w+)\s+([\s\S]*)$/);
  if (!m) return null;
  const id = NAME_TO_ID[m[1].toLowerCase()];
  if (!id) return null;
  return { id, rest: m[2].trim() };
}

// ---------------------------------------------------------------------------
// AgentMentionInput
// ---------------------------------------------------------------------------
export function AgentMentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  rows = 1,
  variant = "followup",
  textareaClassName,
}: AgentMentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // The character offset of the trigger '@' that opened the popover.
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  // For tracking the query (substring between '@' and current caret).
  const [caretPos, setCaretPos] = useState(0);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // Filtered roster mirrored from popover so Enter can pick the active item.
  const [filtered, setFiltered] = useState<AgentId[]>([...ROSTER]);

  // The text between '@' and caret. Closes if whitespace appears.
  const query = useMemo(() => {
    if (triggerPos === null) return "";
    if (caretPos <= triggerPos) return "";
    return value.slice(triggerPos + 1, caretPos);
  }, [value, triggerPos, caretPos]);

  const closePopover = useCallback(() => {
    setPopoverOpen(false);
    setTriggerPos(null);
    setHighlightedIndex(0);
  }, []);

  // ---- Detect '@' triggers and track caret while typing ----
  const onTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const caret = e.target.selectionStart ?? next.length;
    onChange(next);
    setCaretPos(caret);

    // If popover is open, check if it should close: whitespace after trigger.
    if (triggerPos !== null) {
      if (caret <= triggerPos) {
        closePopover();
        return;
      }
      const frag = next.slice(triggerPos, caret);
      if (/\s/.test(frag.slice(1))) {
        closePopover();
        return;
      }
      // Trigger '@' may have been deleted entirely.
      if (next[triggerPos] !== "@") {
        closePopover();
      }
      return;
    }

    // Otherwise look for a fresh '@' immediately before caret with
    // start-of-string or whitespace immediately before it.
    if (caret > 0 && next[caret - 1] === "@") {
      const prev = caret >= 2 ? next[caret - 2] : "";
      if (prev === "" || /\s/.test(prev)) {
        setTriggerPos(caret - 1);
        setPopoverOpen(true);
        setHighlightedIndex(0);
      }
    }
  };

  const onSelectAgent = useCallback(
    (id: AgentId) => {
      if (triggerPos === null) return;
      const before = value.slice(0, triggerPos);
      const after = value.slice(caretPos);
      const name = AGENTS[id].name;
      const insert = `@${name} `;
      const next = before + insert + after;
      onChange(next);
      closePopover();
      // Restore caret after the inserted mention.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          const pos = (before + insert).length;
          ta.focus();
          ta.setSelectionRange(pos, pos);
          setCaretPos(pos);
        }
      });
    },
    [triggerPos, caretPos, value, onChange, closePopover],
  );

  const doSubmit = useCallback(() => {
    const v = value.trim();
    if (!v) return;
    const parsed = parseMention(v);
    if (parsed && parsed.rest) {
      onSubmit(parsed.rest, parsed.id);
    } else {
      onSubmit(v, undefined);
    }
  }, [value, onSubmit]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Popover open: arrows / enter / esc drive the picker.
    if (popoverOpen && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) =>
          i <= 0 ? filtered.length - 1 : i - 1,
        );
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const pick = filtered[highlightedIndex] ?? filtered[0];
        if (pick) onSelectAgent(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
        return;
      }
    }
    // Plain submit: Enter without shift, or Cmd/Ctrl+Enter.
    if (
      (e.key === "Enter" && !e.shiftKey && !popoverOpen) ||
      (e.key === "Enter" && (e.metaKey || e.ctrlKey))
    ) {
      e.preventDefault();
      doSubmit();
    }
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const caret = e.currentTarget.selectionStart ?? 0;
    setCaretPos(caret);
  };

  const onClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const caret = e.currentTarget.selectionStart ?? 0;
    setCaretPos(caret);
    // If popover open and caret no longer in trigger range, close.
    if (triggerPos !== null && (caret <= triggerPos || value[triggerPos] !== "@")) {
      closePopover();
    }
  };

  // Mention chip hint underneath textarea.
  const mention = useMemo(() => parseMention(value.trim()), [value]);

  // -------- "bare" variant: just the textarea + popover --------
  if (variant === "bare") {
    return (
      <div className="relative">
        <AgentMentionPopover
          open={popoverOpen}
          query={query}
          onSelect={onSelectAgent}
          onClose={closePopover}
          highlightedIndex={highlightedIndex}
          onHighlightChange={setHighlightedIndex}
          onFilteredChange={setFiltered}
        />
        <textarea
          ref={textareaRef}
          rows={rows}
          value={value}
          onChange={onTextareaChange}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onClick={onClick}
          disabled={disabled}
          placeholder={placeholder}
          className={
            textareaClassName ??
            "w-full bg-transparent text-white placeholder-[#5C5C70] resize-none p-4 text-sm leading-relaxed outline-none"
          }
        />
        {mention && (
          <div
            className="mt-1 px-4 text-[11px] flex items-center gap-1.5"
            style={{ color: AGENTS[mention.id].color }}
          >
            <span aria-hidden>{AGENTS[mention.id].emoji}</span>
            <span>
              Sending to:{" "}
              <span className="font-medium">{AGENTS[mention.id].name}</span>
            </span>
          </div>
        )}
      </div>
    );
  }

  // -------- "followup" variant: bordered card with send button --------
  return (
    <div className="border-t border-[#23232E] p-3 shrink-0 relative">
      <div className="flex items-end gap-2 rounded-lg bg-[#0E0E16] border border-[#23232E] focus-within:border-[#7C5CFF]/50 transition-colors p-2 relative">
        <AgentMentionPopover
          open={popoverOpen}
          query={query}
          onSelect={onSelectAgent}
          onClose={closePopover}
          highlightedIndex={highlightedIndex}
          onHighlightChange={setHighlightedIndex}
          onFilteredChange={setFiltered}
        />
        <textarea
          ref={textareaRef}
          rows={rows}
          value={value}
          onChange={onTextareaChange}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onClick={onClick}
          disabled={disabled}
          placeholder={
            placeholder ??
            (disabled
              ? "The team is busy — Stop to interrupt"
              : "Follow up, or @-mention a teammate (Mike / Emma / Bob / Alex / Iris)…")
          }
          className="flex-1 bg-transparent text-sm text-white placeholder:text-[#7C7C90] resize-none outline-none max-h-32 leading-relaxed"
        />
        <button
          type="button"
          onClick={doSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "inline-flex items-center justify-center w-8 h-8 rounded-md text-white shrink-0",
            "bg-[#7C5CFF] hover:bg-[#8A6BFF] disabled:opacity-30 disabled:cursor-not-allowed",
          )}
          title="Send"
        >
          <ArrowUp size={14} />
        </button>
      </div>
      {mention && (
        <div
          className="mt-1.5 text-[11px] flex items-center gap-1.5"
          style={{ color: AGENTS[mention.id].color }}
        >
          <span aria-hidden>{AGENTS[mention.id].emoji}</span>
          <span>
            Sending to:{" "}
            <span className="font-medium">{AGENTS[mention.id].name}</span>
          </span>
        </div>
      )}
    </div>
  );
}
