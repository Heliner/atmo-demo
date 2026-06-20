"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackFileExplorer,
} from "@codesandbox/sandpack-react";
import { vfilesToSandpack, type SandpackBundle } from "@/lib/vfiles-to-sandpack";
import type { VFile } from "@/lib/sandbox/vfiles";
import type { SchemaInfo } from "@/lib/sandbox/sqlbox";
import {
  Monitor,
  Code as CodeIcon,
  Database,
  Terminal as TerminalIcon,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AppViewerTab = "preview" | "code" | "database" | "console";

export interface ConsoleError {
  message: string;
  agent?: string;
  ts: number;
}

export interface MemoryDisplay {
  key: string;
  value: string;
  source_agent: string;
}

export interface ShellEntry {
  id: string;
  agent: string;
  name: "run_command" | "run_python";
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  sandbox?: string;
  durationMs?: number;
  ts: number;
}

export function AppViewer({
  vfiles,
  projectId,
  schema,
  memories,
  consoleErrors,
  shellHistory,
  activeTab,
  activeFile,
  activeTable,
  onTabChange,
  onSelectFile,
  onSelectTable,
}: {
  vfiles: VFile[];
  projectId: string;
  schema: SchemaInfo[];
  memories: MemoryDisplay[];
  consoleErrors: ConsoleError[];
  shellHistory: ShellEntry[];
  activeTab: AppViewerTab;
  activeFile?: string;
  activeTable?: string;
  onTabChange: (tab: AppViewerTab) => void;
  onSelectFile: (path: string) => void;
  onSelectTable: (table: string) => void;
}) {
  // Parent ↔ iframe postMessage bridge for window.atomsDb. The Sandpack iframe
  // is cross-origin so it can't fetch /api directly; the injected atoms-sdk.js
  // posts { kind:'atoms-db', op, sql, reqId } here and we forward to
  // POST /api/projects/:id/db/run.
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data = ev.data;
      if (!data || data.kind !== "atoms-db" || !data.reqId) return;
      const reply = (payload: { data?: unknown; error?: string }) => {
        try {
          // Use the string form of targetOrigin — the options-object form is
          // not universally supported on cross-origin Window targets.
          (ev.source as Window | null)?.postMessage(
            { kind: "atoms-db-result", reqId: data.reqId, ...payload },
            "*",
          );
        } catch {
          /* iframe gone */
        }
      };
      (async () => {
        try {
          const r = await fetch(`/api/projects/${projectId}/db/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              op: data.op,
              sql: data.sql,
              params: data.params,
            }),
          });
          const body = await r.json();
          reply({ data: body });
        } catch (e) {
          reply({ error: String((e as Error)?.message ?? e) });
        }
      })();
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [projectId]);

  const bundle = useMemo(
    () => vfilesToSandpack(vfiles, { activeFile }),
    [vfiles, activeFile],
  );

  // Re-mount Sandpack when files materially change. We key on path+version
  // so an empty bundle vs a built bundle yields a fresh iframe.
  const bundleKey = useMemo(
    () => vfiles.map((v) => `${v.path}@${v.version}`).join("|") || "empty",
    [vfiles],
  );

  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = () => setRefreshTick((t) => t + 1);

  const tabs: { id: AppViewerTab; label: string; icon: React.ReactNode }[] = [
    { id: "preview", label: "Preview", icon: <Monitor size={14} /> },
    { id: "code", label: "Code", icon: <CodeIcon size={14} /> },
    { id: "database", label: "Database", icon: <Database size={14} /> },
    { id: "console", label: "Shell", icon: <TerminalIcon size={14} /> },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#0A0A12]">
      {/* ─── top bar: 4 tabs + URL pill + refresh ────────────────────── */}
      <div className="flex items-center gap-2 px-3 h-14 border-b border-[#23232E] bg-[#0E0E16]/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors",
                activeTab === t.id
                  ? "bg-[#23232E] text-white"
                  : "text-[#9090A0] hover:text-white hover:bg-[#14141C]",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-3 flex-1 min-w-0 max-w-md">
          <div className="flex items-center gap-2 px-3 h-7 rounded-md bg-[#14141C] border border-[#23232E] text-xs text-[#9090A0] truncate">
            <div className="flex items-center gap-1 shrink-0">
              <span className="w-2 h-2 rounded-full bg-[#FF5F57]" />
              <span className="w-2 h-2 rounded-full bg-[#FEBC2E]" />
              <span className="w-2 h-2 rounded-full bg-[#28C840]" />
            </div>
            <span className="ml-2 text-[#39C5BB]">●</span>
            <span className="truncate">atoms-cloud://preview/index.html</span>
          </div>
        </div>

        <button
          onClick={refresh}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[#9090A0] hover:text-white hover:bg-[#14141C] transition-colors"
          title="Refresh"
        >
          <RotateCw size={14} />
        </button>
      </div>

      {/* ─── tab panes ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "preview" && (
          <PreviewPane bundle={bundle} bundleKey={`${bundleKey}#${refreshTick}`} />
        )}
        {activeTab === "code" && <CodePane bundle={bundle} bundleKey={bundleKey} />}
        {activeTab === "database" && (
          <DatabasePane
            projectId={projectId}
            schema={schema}
            activeTable={activeTable}
            onSelectTable={onSelectTable}
          />
        )}
        {activeTab === "console" && (
          <ShellPane
            shellHistory={shellHistory}
            consoleErrors={consoleErrors}
            memories={memories}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PreviewPane — Sandpack iframe rendering index.html as the entry.
// ─────────────────────────────────────────────────────────────────────
function PreviewPane({
  bundle,
  bundleKey,
}: {
  bundle: SandpackBundle;
  bundleKey: string;
}) {
  return (
    <div className="h-full w-full bg-white flex flex-col">
      <SandpackProvider
        key={bundleKey}
        files={bundle.files}
        template="static"
        theme="dark"
        options={{ autorun: true, autoReload: true }}
      >
        <SandpackPreview
          style={{ height: "100%", border: "none" }}
          showOpenInCodeSandbox={false}
          showRefreshButton
        />
      </SandpackProvider>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CodePane — Sandpack file explorer + editor (no preview).
// ─────────────────────────────────────────────────────────────────────
function CodePane({
  bundle,
  bundleKey,
}: {
  bundle: SandpackBundle;
  bundleKey: string;
}) {
  return (
    <div className="h-full flex flex-col">
      <SandpackProvider
        key={bundleKey}
        files={bundle.files}
        template="static"
        theme="dark"
        options={{ activeFile: bundle.activeFile }}
      >
        <SandpackLayout style={{ height: "100%", border: "none" }}>
          <SandpackFileExplorer style={{ minWidth: 180 }} />
          <SandpackCodeEditor
            style={{ flex: 1 }}
            showLineNumbers
            showTabs
            closableTabs
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DatabasePane — left tree of tables, right pane fetches /db?table=...
// ─────────────────────────────────────────────────────────────────────
function DatabasePane({
  projectId,
  schema,
  activeTable,
  onSelectTable,
}: {
  projectId: string;
  schema: SchemaInfo[];
  activeTable?: string;
  onSelectTable: (t: string) => void;
}) {
  // Live schema: server-rendered initial value, kept fresh by polling
  // so the iframe's runtime CREATE/INSERT calls (via atomsDb) show up
  // here within a couple of seconds without a page reload.
  const [liveSchema, setLiveSchema] = useState<SchemaInfo[]>(schema);
  const [refreshing, setRefreshing] = useState(false);

  const refetch = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/db`, { cache: "no-store" });
      if (r.ok) {
        const body = await r.json();
        if (Array.isArray(body.schemas)) setLiveSchema(body.schemas);
      }
    } catch {
      /* network blip; next tick will retry */
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
    const t = setInterval(refetch, 3000);
    return () => clearInterval(t);
  }, [refetch]);

  // Always render the header so the Refresh button is reachable
  // even when the schema is empty.
  const focused = activeTable ?? liveSchema[0]?.name;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 h-9 border-b border-[#23232E] shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-[#7C7C90]">
          atomsDb · {liveSchema.length} table{liveSchema.length === 1 ? "" : "s"}
        </div>
        <button
          onClick={() => void refetch()}
          disabled={refreshing}
          className="inline-flex items-center gap-1 text-[10px] text-[#9090A0] hover:text-white px-2 py-1 rounded hover:bg-[#14141C] disabled:opacity-50"
          title="Refresh"
        >
          <RotateCw size={10} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      {liveSchema.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-8">
          <div className="max-w-xs">
            <Database size={28} className="mx-auto text-[#7C7C90] mb-3" />
            <div className="text-sm text-white font-medium">No tables yet</div>
            <div className="text-xs text-[#7C7C90] mt-1.5">
              Tables created by Bob or your running app (via window.atomsDb) appear here.
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <aside className="w-[220px] border-r border-[#23232E] overflow-y-auto py-2">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-[#7C7C90]">
              Tables
            </div>
            {liveSchema.map((t) => (
              <button
                key={t.name}
                onClick={() => onSelectTable(t.name)}
                className={cn(
                  "w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors",
                  focused === t.name
                    ? "bg-[#23232E] text-white"
                    : "text-[#9090A0] hover:bg-[#14141C] hover:text-white",
                )}
              >
                <span className="font-mono truncate">{t.name}</span>
                <span className="text-[10px] text-[#7C7C90]">
                  {t.rowCount} row{t.rowCount === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </aside>
          <main className="flex-1 min-w-0 overflow-auto">
            {focused ? (
              <TableViewer projectId={projectId} table={focused} schema={liveSchema} />
            ) : (
              <div className="p-6 text-sm text-[#7C7C90]">Pick a table.</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function TableViewer({
  projectId,
  table,
  schema,
}: {
  projectId: string;
  table: string;
  schema: SchemaInfo[];
}) {
  const [data, setData] = useState<{
    columns: string[];
    rows: unknown[][];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tableMeta = useMemo(
    () => schema.find((s) => s.name === table),
    [schema, table],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    fetch(`/api/projects/${projectId}/db?table=${encodeURIComponent(table)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({ error: "bad json" }));
        if (cancelled) return;
        if (!r.ok) {
          setErr(body.error || `HTTP ${r.status}`);
        } else {
          setData(body);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, table]);

  return (
    <div className="p-4">
      <div className="flex items-baseline gap-3 mb-3">
        <h3 className="text-base text-white font-mono">{table}</h3>
        {tableMeta && (
          <span className="text-xs text-[#7C7C90]">
            {tableMeta.rowCount} row{tableMeta.rowCount === 1 ? "" : "s"} ·{" "}
            {tableMeta.columns.length} columns
          </span>
        )}
      </div>

      {tableMeta && (
        <div className="rounded-md border border-[#23232E] bg-[#0E0E16] p-3 mb-4">
          <div className="text-[10px] uppercase tracking-wider text-[#7C7C90] mb-2">
            Schema
          </div>
          <div className="flex flex-wrap gap-2">
            {tableMeta.columns.map((c) => (
              <span
                key={c.name}
                className="text-xs font-mono px-2 py-0.5 rounded bg-[#14141C] border border-[#23232E] text-[#D5D5DF]"
              >
                {c.name}
                <span className="text-[#7C7C90] ml-1">:{c.type || "?"}</span>
                {c.pk && <span className="text-[#FFB23F] ml-1">pk</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-xs text-[#7C7C90]">Loading rows…</div>
      )}
      {err && (
        <div className="text-xs text-[#FF5F57] rounded-md border border-[#FF5F57]/40 bg-[#FF5F57]/5 p-3">
          {err}
        </div>
      )}
      {data && data.rows.length === 0 && !loading && (
        <div className="text-xs text-[#7C7C90]">No rows.</div>
      )}
      {data && data.rows.length > 0 && (
        <div className="overflow-auto rounded-md border border-[#23232E]">
          <table className="min-w-full text-xs font-mono">
            <thead className="bg-[#14141C] text-[#9090A0]">
              <tr>
                {data.columns.map((c) => (
                  <th
                    key={c}
                    className="text-left px-3 py-2 border-b border-[#23232E]"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr
                  key={i}
                  className="hover:bg-[#14141C]/60 border-b border-[#23232E]/60 last:border-0"
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="px-3 py-2 text-[#D5D5DF] whitespace-pre-wrap break-words max-w-xs"
                    >
                      {cell === null
                        ? <span className="text-[#7C7C90]">NULL</span>
                        : typeof cell === "object"
                          ? JSON.stringify(cell)
                          : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ShellPane — terminal-style renderer for run_command/run_python history,
// runtime errors from preview iframe postMessage, and a folded memory chip.
// ─────────────────────────────────────────────────────────────────────
function ShellPane({
  shellHistory,
  consoleErrors,
  memories,
}: {
  shellHistory: ShellEntry[];
  consoleErrors: ConsoleError[];
  memories: MemoryDisplay[];
}) {
  const [memOpen, setMemOpen] = useState(false);
  const empty =
    shellHistory.length === 0 && consoleErrors.length === 0;

  return (
    <div className="h-full flex flex-col bg-[#0A0A12]">
      {/* fixed header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-[#23232E] bg-[#0E0E16]/80 backdrop-blur flex items-center gap-3">
        <TerminalIcon size={13} className="text-emerald-400" />
        <div className="text-xs font-mono text-[#D5D5DF]">
          Shell
          <span className="text-[#7C7C90] ml-2">
            — {shellHistory.length} command{shellHistory.length === 1 ? "" : "s"} run
          </span>
        </div>
        {memories.length > 0 && (
          <button
            onClick={() => setMemOpen((v) => !v)}
            className="ml-auto text-[10px] uppercase tracking-wider text-[#7C7C90] hover:text-white border border-[#23232E] rounded px-2 py-0.5"
            title="Active memories"
          >
            Active memories · {memories.length}
          </button>
        )}
      </div>

      {/* folded active memories strip */}
      {memOpen && memories.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-b border-[#23232E] bg-[#0E0E16] space-y-1">
          {memories.map((m, i) => (
            <div
              key={i}
              className="text-[11px] font-mono text-[#D5D5DF] flex gap-2"
            >
              <span className="text-[#7C5CFF] shrink-0">{m.key}</span>
              <span className="text-[#7C7C90]">=</span>
              <span className="text-[#D5D5DF] truncate">{m.value}</span>
              <span className="text-[10px] text-[#7C7C90] ml-auto shrink-0">
                {m.source_agent}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* terminal scroll area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {empty && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-xs">
              <TerminalIcon size={28} className="mx-auto text-[#7C7C90] mb-3" />
              <div className="text-sm text-white font-medium">
                Shell is quiet
              </div>
              <div className="text-xs text-[#7C7C90] mt-1.5">
                When an agent runs a command or Python snippet, it shows up here.
              </div>
            </div>
          </div>
        )}

        {shellHistory.length > 0 && (
          <div className="space-y-3">
            {shellHistory.map((e, i) => (
              <div
                key={e.id}
                className={cn(
                  "pb-3",
                  i < shellHistory.length - 1 && "border-b border-[#1B1B26]",
                )}
              >
                <div className="text-emerald-400 whitespace-pre-wrap break-words">
                  <span className="text-[#7C7C90] mr-2 select-none">
                    {e.agent}
                  </span>
                  <span className="text-emerald-300">$</span>{" "}
                  {e.name === "run_python" ? (
                    <span>
                      python -c{" "}
                      <span className="text-[#D5D5DF]">{`"${e.command}"`}</span>
                    </span>
                  ) : (
                    <span className="text-[#D5D5DF]">{e.command}</span>
                  )}
                </div>
                {e.stdout && e.stdout.length > 0 && (
                  <pre className="text-zinc-300 whitespace-pre-wrap break-words mt-1">
                    {e.stdout}
                  </pre>
                )}
                {e.stderr && e.stderr.length > 0 && (
                  <pre className="text-rose-400 whitespace-pre-wrap break-words mt-1">
                    {e.stderr}
                  </pre>
                )}
                <div className="text-zinc-500 mt-1">
                  exit {e.exitCode ?? "?"}
                  {e.sandbox ? ` · ${e.sandbox}` : ""}
                  {typeof e.durationMs === "number"
                    ? ` · ${e.durationMs}ms`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        )}

        {consoleErrors.length > 0 && (
          <section className="mt-6">
            <div className="text-[10px] uppercase tracking-wider text-[#7C7C90] mb-2">
              Runtime errors
            </div>
            <div className="space-y-2">
              {consoleErrors.map((e, i) => (
                <div
                  key={i}
                  className="rounded-md border border-[#FF5F57]/40 bg-[#FF5F57]/5 p-3 text-xs"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[#FF8B85] font-medium">
                      {e.agent ?? "runtime"}
                    </span>
                    <button
                      className="text-[10px] text-[#9090A0] hover:text-white border border-[#23232E] rounded px-2 py-0.5 disabled:opacity-50"
                      disabled
                      title="Resolve — coming soon"
                    >
                      Resolve
                    </button>
                  </div>
                  <pre className="text-[#D5D5DF] whitespace-pre-wrap break-words font-mono">
                    {e.message}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
