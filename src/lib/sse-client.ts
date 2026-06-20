// 自定义 SSE 客户端 — 解析 plan/execute/race 的 13 种事件
// 我们没用 AI SDK 的 toDataStreamResponse(), 而是自定义 SSE 协议
// (event types 见 DELIVERY-SPEC §5.4), 所以前端要自己 parse.
//
// 用法:
//   const stop = streamSSE(url, body, {
//     onEvent: (ev) => { ... },
//     onError: (err) => { ... },
//     onDone: () => { ... },
//   });
//   // stop() 触发 AbortController, 后端 streamText 自然停

import type { PRD } from "@/lib/agents/orchestrate";
import type { UIEvent } from "@/lib/agents/tools";

// ---------------------------------------------------------------------------
// Event union (matches plan/route.ts + execute/route.ts + race/route.ts)
// ---------------------------------------------------------------------------
export type SSEEvent =
  | { type: "status"; content: string }
  | { type: "agent-message-start"; id: string; agent: string; kind?: string }
  | { type: "agent-message-chunk"; id: string; delta: string }
  | { type: "agent-message-end"; id: string }
  | { type: "prd"; id: string; agent: string; prd: PRD }
  | { type: "memories"; memories: { key: string; value: string; source_agent: string }[] }
  | { type: "awaiting-approval" }
  | { type: "auto-approve" }
  | { type: "tool-call-start"; id: string; agent: string; name: string; args: unknown }
  | { type: "tool-call-end"; id: string; agent: string; name: string; result: unknown }
  | { type: "ui-focus"; event: UIEvent }
  | { type: "files-snapshot"; files: { path: string; content: string; version: number; size: number }[] }
  | { type: "race-chunk"; model: string; delta: string }
  | { type: "race-done"; model: string; size: number }
  | { type: "race-error"; model: string; error: string }
  | { type: "error"; error: string; raw?: string }
  | { type: "done" }
  | { type: "unknown"; raw: string };

export interface StreamOpts {
  onEvent?: (ev: SSEEvent) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// streamSSE — POST a body, parse SSE response into typed SSEEvent stream.
// Returns a stop() that aborts the underlying fetch (which triggers
// req.signal.aborted on the server → streamText interrupts cleanly).
// ---------------------------------------------------------------------------
export function streamSSE(
  url: string,
  body: unknown,
  opts: StreamOpts = {},
): () => void {
  const ac = new AbortController();
  const externalSignal = opts.signal;
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", () => ac.abort(externalSignal.reason), { once: true });
  }

  (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body ?? {}),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`SSE ${res.status}: ${text || res.statusText}`);
      }
      if (!res.body) throw new Error("SSE: empty body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // SSE: events are separated by blank line; each line within an event
      // may be 'data: <json>' or comment lines (we ignore those).
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Split on \n keeping any trailing partial line in buf.
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.replace(/\r$/, "");
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let parsed: SSEEvent;
          try {
            parsed = JSON.parse(payload) as SSEEvent;
          } catch {
            parsed = { type: "unknown", raw: payload };
          }
          opts.onEvent?.(parsed);
          if (parsed.type === "done") opts.onDone?.();
        }
      }
      opts.onDone?.();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // 用户主动 Stop, 不视为错误
        opts.onDone?.();
        return;
      }
      opts.onError?.(e as Error);
    }
  })();

  return () => ac.abort();
}
