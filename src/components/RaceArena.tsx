"use client";
import { useEffect, useRef, useState } from "react";
import { Trophy, Loader2, Check } from "lucide-react";
import { streamSSE } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Race Mode UI — 3 lanes, one per Doubao tier. The /race SSE writes files
// into vfiles under "race-<key>/<path>"; we sniff write_file tool-calls in
// the stream for the index.html content and pump it straight into a live
// iframe. After the user clicks Pick we POST /race/winner which copies the
// winner's files back to the bare paths and flips project status to 'built'.
// ---------------------------------------------------------------------------

const RACE_KEYS = ["pro", "std", "lite"] as const;
type RaceKey = (typeof RACE_KEYS)[number];

interface Candidate {
  key: RaceKey;
  label: string;
  tag: string;
  html: string;
  log: string[];
  done: boolean;
  error?: string;
}

const INITIAL_CANDIDATES: Candidate[] = [
  { key: "pro", label: "Doubao Pro", tag: "Heavyweight", html: "", log: [], done: false },
  { key: "std", label: "Doubao Std", tag: "Balanced", html: "", log: [], done: false },
  { key: "lite", label: "Doubao Lite", tag: "Lightning", html: "", log: [], done: false },
];

export function RaceArena({
  projectId,
  onWinnerPicked,
}: {
  projectId: string;
  onWinnerPicked: (winner: string) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>(INITIAL_CANDIDATES);
  const [winnerKey, setWinnerKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const startedRef = useRef(false);
  const startTs = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

  // Kick off the race exactly once.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startTs.current = Date.now();
    const tick = setInterval(
      () => setElapsed((Date.now() - startTs.current) / 1000),
      100,
    );

    const stop = streamSSE(
      `/api/projects/${projectId}/race`,
      {},
      {
        onEvent: (ev) => {
          // SSE event shapes are documented in race/route.ts.
          const e = ev as unknown as { type: string; model?: RaceKey; [k: string]: unknown };
          switch (e.type) {
            case "race-start":
              setCandidates((cs) =>
                cs.map((c) =>
                  c.key === e.model
                    ? { ...c, log: [...c.log, "started"] }
                    : c,
                ),
              );
              return;
            case "race-text-delta": {
              const delta = String(e.delta ?? "");
              if (!delta) return;
              setCandidates((cs) =>
                cs.map((c) => {
                  if (c.key !== e.model) return c;
                  const tail = c.log.length ? c.log[c.log.length - 1] : "";
                  const log =
                    tail.startsWith("…") && tail.length < 80
                      ? [...c.log.slice(0, -1), (tail + delta).slice(0, 200)]
                      : [...c.log, ("…" + delta).slice(0, 200)];
                  return { ...c, log };
                }),
              );
              return;
            }
            case "race-tool-call": {
              const name = String(e.name ?? "");
              const args = (e.args ?? {}) as { path?: string; content?: string };
              setCandidates((cs) =>
                cs.map((c) => {
                  if (c.key !== e.model) return c;
                  const log = [...c.log, `→ ${name}${args.path ? ` ${args.path}` : ""}`];
                  let html = c.html;
                  if (
                    name === "write_file" &&
                    typeof args.path === "string" &&
                    (args.path === "index.html" ||
                      args.path.endsWith("/index.html")) &&
                    typeof args.content === "string"
                  ) {
                    html = args.content;
                  }
                  return { ...c, html, log };
                }),
              );
              return;
            }
            case "race-tool-result": {
              const name = String(e.name ?? "");
              setCandidates((cs) =>
                cs.map((c) =>
                  c.key === e.model
                    ? { ...c, log: [...c.log, `✓ ${name}`] }
                    : c,
                ),
              );
              return;
            }
            case "race-done":
              setCandidates((cs) =>
                cs.map((c) =>
                  c.key === e.model ? { ...c, done: true } : c,
                ),
              );
              return;
            case "race-error":
              setCandidates((cs) =>
                cs.map((c) =>
                  c.key === e.model
                    ? { ...c, done: true, error: String(e.error ?? "error") }
                    : c,
                ),
              );
              return;
            case "done":
              clearInterval(tick);
              return;
          }
        },
        onError: (err) => {
          setCandidates((cs) =>
            cs.map((c) =>
              c.done
                ? c
                : { ...c, done: true, error: err.message },
            ),
          );
        },
        onDone: () => {
          clearInterval(tick);
        },
      },
    );

    return () => {
      clearInterval(tick);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(key: RaceKey) {
    if (winnerKey || picking) return;
    setPicking(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/race/winner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winner: key }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`winner pick failed: ${res.status} ${text}`);
      }
      setWinnerKey(key);
      // Give the banner a beat, then let the parent refresh into AppViewer.
      setTimeout(() => onWinnerPicked(key), 1200);
    } catch (e) {
      setCandidates((cs) =>
        cs.map((c) =>
          c.key === key
            ? { ...c, error: (e as Error).message }
            : c,
        ),
      );
    } finally {
      setPicking(false);
    }
  }

  const winnerLabel = winnerKey
    ? candidates.find((c) => c.key === winnerKey)?.label ?? winnerKey
    : null;

  return (
    <div className="flex flex-col h-full bg-[#0A0A12]">
      <div className="flex items-center gap-3 px-6 h-14 border-b border-[#23232E] bg-[#0E0E16]/80 backdrop-blur">
        <Trophy size={16} className="text-[#FFB23F]" />
        <div className="text-sm font-medium text-white">Race Mode</div>
        <div className="text-xs text-[#9090A0]">
          Same prompt · 3 models · winner takes all
        </div>
        <div className="ml-auto text-xs text-[#7C7C90] font-mono">
          {elapsed.toFixed(1)}s
        </div>
      </div>

      {winnerLabel && (
        <div className="px-6 py-2 border-b border-[#FFB23F]/40 bg-[#FFB23F]/10 text-sm text-[#FFD79A] flex items-center gap-2">
          <Trophy size={14} className="text-[#FFB23F]" />
          <span>
            Winner: <strong>{winnerLabel}</strong> — files promoted, switching to your project view…
          </span>
        </div>
      )}

      <div className="flex-1 overflow-hidden grid grid-cols-3 gap-3 p-3">
        {candidates.map((c) => (
          <Lane
            key={c.key}
            cand={c}
            isWinner={winnerKey === c.key}
            disabled={!!winnerKey && winnerKey !== c.key}
            picking={picking}
            onPick={() => pick(c.key)}
          />
        ))}
      </div>
    </div>
  );
}

function Lane({
  cand,
  isWinner,
  disabled,
  picking,
  onPick,
}: {
  cand: Candidate;
  isWinner: boolean;
  disabled: boolean;
  picking: boolean;
  onPick: () => void;
}) {
  const isEmpty = cand.html.length < 50;
  const canPick = cand.done && !cand.error && !disabled && !isWinner && !picking;
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl bg-[#0E0E16] border overflow-hidden transition-all",
        isWinner
          ? "border-[#FFB23F] shadow-[0_0_0_3px_rgba(255,178,63,0.18)]"
          : disabled
            ? "border-[#23232E] opacity-50"
            : "border-[#23232E]",
      )}
    >
      <div className="flex items-center justify-between px-3 h-10 border-b border-[#23232E]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white text-sm">{cand.label}</span>
          <span className="text-[10px] text-[#7C7C90] uppercase tracking-wider">
            {cand.tag}
          </span>
        </div>
        {cand.error ? (
          <span className="text-[10px] text-red-400">error</span>
        ) : cand.done ? (
          <span className="text-[10px] text-[#39C5BB] inline-flex items-center gap-1">
            <Check size={10} /> done
          </span>
        ) : (
          <span className="text-[10px] text-[#7C5CFF] inline-flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> streaming
          </span>
        )}
      </div>

      <div className="flex-1 bg-white overflow-hidden relative">
        {isEmpty ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-zinc-500 gap-2 p-3">
            {cand.error ? (
              <span className="text-red-500">{cand.error}</span>
            ) : (
              <>
                <Loader2 size={16} className="animate-spin text-zinc-400" />
                <span>thinking…</span>
              </>
            )}
            {cand.log.length > 0 && (
              <div className="mt-2 w-full max-h-24 overflow-hidden text-[10px] font-mono text-zinc-400 text-left">
                {cand.log.slice(-4).map((l, i) => (
                  <div key={i} className="truncate">
                    {l}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <iframe
            srcDoc={cand.html}
            sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
            className="w-full h-full border-0"
            title={cand.label}
          />
        )}
      </div>

      <div className="p-2 border-t border-[#23232E] bg-[#0A0A12]">
        <button
          onClick={onPick}
          disabled={!canPick}
          className={cn(
            "w-full h-9 rounded-md text-sm font-medium inline-flex items-center justify-center gap-2",
            isWinner
              ? "bg-[#FFB23F] text-black"
              : "bg-[#14141C] border border-[#23232E] text-white hover:bg-[#1c1c28] disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {isWinner ? (
            <>
              <Trophy size={14} /> Picked
            </>
          ) : (
            <>Pick this one</>
          )}
        </button>
      </div>
    </div>
  );
}
