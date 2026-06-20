import { listLatestVFiles } from "@/lib/sandbox/vfiles";
import { vfilesToSandpack } from "@/lib/vfiles-to-sandpack";
import { PreviewClient } from "@/components/PreviewClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const files = await listLatestVFiles(id);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-200">
      {files.length === 0 ? (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center text-sm text-zinc-400">
            <p>No files yet — run /api/projects/:id/execute first.</p>
            <code className="mt-2 inline-block text-xs bg-zinc-800 px-2 py-0.5 rounded">
              {id}
            </code>
          </div>
        </div>
      ) : (
        <PreviewClient bundle={vfilesToSandpack(files)} projectId={id} />
      )}
    </main>
  );
}
