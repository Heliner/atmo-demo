"use client";

import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackFileExplorer,
} from "@codesandbox/sandpack-react";
import type { SandpackBundle } from "@/lib/vfiles-to-sandpack";

export function PreviewClient({
  bundle,
  projectId,
}: {
  bundle: SandpackBundle;
  projectId: string;
}) {
  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between px-5 h-12 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-violet-400 font-semibold">⚛︎ Atoms Demo</span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-400">project</span>
          <code className="text-xs bg-zinc-800 px-2 py-0.5 rounded">{projectId}</code>
        </div>
        <a href={`/preview/${projectId}`} className="text-xs text-zinc-400 hover:text-white">
          Refresh
        </a>
      </header>
      <SandpackProvider
        files={bundle.files}
        template={bundle.template}
        theme="dark"
        options={{ activeFile: bundle.activeFile, autorun: true, autoReload: true }}
      >
        <SandpackLayout style={{ height: "calc(100vh - 48px)", border: "none" }}>
          <SandpackFileExplorer style={{ minWidth: 180 }} />
          <SandpackCodeEditor style={{ flex: 1 }} showLineNumbers showTabs closableTabs />
          <SandpackPreview
            style={{ flex: 1.4 }}
            showOpenInCodeSandbox={false}
            showRefreshButton
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}
