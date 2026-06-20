"use client";
import { useEffect, useMemo, useState } from "react";
import { AGENTS, ROSTER, type AgentId } from "@/lib/agents/roles";
import { AgentAvatar } from "@/components/AgentAvatar";
import { cn } from "@/lib/utils";

export interface AgentMentionPopoverProps {
  open: boolean;
  query: string;
  onSelect: (agentId: AgentId) => void;
  onClose: () => void;
  // Optional external highlight; if omitted, popover manages its own.
  highlightedIndex?: number;
  onHighlightChange?: (idx: number) => void;
  onFilteredChange?: (ids: AgentId[]) => void;
}

// ---------------------------------------------------------------------------
// AgentMentionPopover — keyboard handling lives in the parent (AgentMentionInput).
// Filter: case-insensitive substring on name/title. Highlight resets on
// filter changes. Parent may override highlightedIndex by passing props.
// ---------------------------------------------------------------------------
export function AgentMentionPopover({
  open,
  query,
  onSelect,
  highlightedIndex,
  onHighlightChange,
  onFilteredChange,
}: AgentMentionPopoverProps) {
  const filtered = useMemo<AgentId[]>(() => {
    const q = query.trim().toLowerCase();
    return ROSTER.filter((id) => {
      const a = AGENTS[id];
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q)
      );
    });
  }, [query]);

  // Internal highlight state (used when parent didn't pass highlightedIndex).
  const [internalIdx, setInternalIdx] = useState(0);
  useEffect(() => {
    setInternalIdx(0);
  }, [filtered.length, query]);

  // Notify parent of filtered list (e.g. so it can validate Enter selection).
  useEffect(() => {
    onFilteredChange?.(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.join(",")]);

  const active = highlightedIndex ?? internalIdx;
  const setActive = (i: number) => {
    if (onHighlightChange) onHighlightChange(i);
    else setInternalIdx(i);
  };

  if (!open) return null;
  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full mb-2 left-2 w-[360px] max-w-[calc(100%-1rem)] rounded-lg bg-[#0E0E16] border border-[#23232E] shadow-2xl py-2 px-3 text-xs text-[#7C7C90] z-30">
        No agents match “{query}”
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-full mb-2 left-2 w-[360px] max-w-[calc(100%-1rem)] rounded-lg bg-[#0E0E16] border border-[#23232E] shadow-2xl py-1 z-30 overflow-hidden"
      role="listbox"
    >
      {filtered.map((id, idx) => {
        const a = AGENTS[id];
        const isActive = idx === active;
        return (
          <button
            key={id}
            type="button"
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => setActive(idx)}
            onMouseDown={(e) => {
              // mousedown so the textarea doesn't blur before we fire.
              e.preventDefault();
              onSelect(id);
            }}
            className={cn(
              "w-full flex items-start gap-3 px-3 py-2 text-left transition-colors",
              isActive ? "bg-[#14141C]" : "hover:bg-[#14141C]/70",
            )}
          >
            <AgentAvatar agent={id} size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: a.color }}
                >
                  {a.name}
                </span>
                <span className="text-[11px] text-[#7C7C90] truncate">
                  {a.title}
                </span>
              </div>
              <div className="text-[11px] text-[#9090A0] leading-snug truncate">
                {a.blurb}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
