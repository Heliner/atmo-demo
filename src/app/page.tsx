import Link from "next/link";
import { Header } from "@/components/Header";
import { PromptBox } from "@/components/PromptBox";
import { db, ensureSchema } from "@/lib/db";
import { formatRelative } from "@/lib/utils";

interface ProjectRow {
  id: string;
  name: string;
  mode: string;
  status: string;
  created_at: number;
}

function statusTone(status: string): string {
  switch (status) {
    case "ready":
    case "done":
    case "completed":
    case "built":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "awaiting-approval":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "planning":
    case "running":
    case "building":
      return "bg-violet-500/15 text-violet-300 border-violet-500/30";
    case "stopped":
    case "failed":
    case "error":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    default:
      return "bg-[#14141C] text-zinc-300 border-[#23232E]";
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  await ensureSchema();
  const sp = await searchParams;
  const prompt = decodeURIComponent(sp.prompt ?? "");

  const rs = await db().execute(
    "SELECT id, name, mode, status, created_at FROM projects ORDER BY created_at DESC LIMIT 8",
  );
  const projects: ProjectRow[] = rs.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    mode: r.mode as string,
    status: r.status as string,
    created_at: Number(r.created_at),
  }));

  return (
    <div className="min-h-screen bg-[#07070A] text-white">
      <Header />

      <section className="mx-auto max-w-5xl px-6 pt-20 pb-14">
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-white text-center">
          What do you want to build today?
        </h1>
        <div className="mt-10 mx-auto max-w-3xl">
          <PromptBox initial={prompt} />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-white">
            Recent projects
          </h2>
          <span className="text-xs text-zinc-500">
            {projects.length} shown
          </span>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#23232E] p-12 text-center">
            <p className="text-zinc-400 text-sm">
              No projects yet. Describe something above to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className="group flex flex-col gap-3 rounded-2xl border border-[#23232E] bg-[#0E0E16] p-5 hover:border-[#3A3A4C] hover:-translate-y-0.5 transition-all min-h-[140px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white truncate flex-1">
                    {p.name}
                  </h3>
                  <span
                    className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusTone(p.status)}`}
                  >
                    {p.status}
                  </span>
                </div>
                <div className="flex-1" />
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span className="inline-flex items-center h-5 px-2 rounded-md bg-[#14141C] border border-[#23232E] text-[10px] text-zinc-300">
                    {p.mode}
                  </span>
                  <span>{formatRelative(p.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
