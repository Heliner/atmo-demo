// vfiles → Sandpack files map 适配
//
// vfiles 形如 [{ path: "index.html", content: "...", version, size }]
// Sandpack 期待 { "/index.html": { code: "..." } }  // 注意前导 "/"
//
// 还要决定 entry / activeFile / template:
// - template:
//   * 'vanilla' for plain HTML+CSS+JS  (我们的默认)
//   * 'static'  same family, 没 entry file 要求, 也行
// - entry:  '/index.html' 作为 iframe 入口
// - activeFile: 默认 '/index.html' (Code tab 起手显示)
//
// 还会注入隐藏的 /atoms-sdk.js (window.atomsDb postMessage 桥), Alex 的 index.html
// 自己加 <script src="./atoms-sdk.js"></script> 引用它。
import { ATOMS_SDK_JS } from "@/lib/sandpack-sdk";

export interface VFile {
  path: string;
  content: string;
  version?: number;
  size?: number;
}

export interface SandpackFiles {
  [path: string]: { code: string; hidden?: boolean; active?: boolean };
}

export interface SandpackBundle {
  files: SandpackFiles;
  entry: string;
  activeFile: string;
  template: "vanilla" | "static";
}

function ensureLeadingSlash(p: string): string {
  return p.startsWith("/") ? p : "/" + p;
}

export function vfilesToSandpack(vfiles: VFile[], opts?: { activeFile?: string }): SandpackBundle {
  const files: SandpackFiles = {};
  for (const f of vfiles) {
    files[ensureLeadingSlash(f.path)] = { code: f.content };
  }

  // entry / activeFile selection
  const entry =
    "/index.html" in files
      ? "/index.html"
      : Object.keys(files).find((p) => p.endsWith(".html")) ?? "/index.html";

  // index.html may not exist yet during streaming; supply an empty placeholder
  if (!files[entry]) {
    files[entry] = { code: EMPTY_INDEX_HTML };
  }

  let activeFile = opts?.activeFile ? ensureLeadingSlash(opts.activeFile) : entry;
  if (!(activeFile in files)) activeFile = entry;
  files[activeFile] = { ...files[activeFile], active: true };

  // Hidden SDK file. Alex's index.html includes <script src="./atoms-sdk.js">
  // explicitly (taught in ALEX_SYSTEM). The real bridge bug was a postMessage
  // targetOrigin form — that's fixed in AppViewer; inline injection caused
  // HTML-parser corruption and was rolled back.
  files["/atoms-sdk.js"] = { code: ATOMS_SDK_JS, hidden: true };

  return {
    files,
    entry,
    activeFile,
    // "static" = no remote bundler; iframe renders index.html directly.
    // Works offline + no codesandbox.io dependency. Perfect for our
    // single-page-HTML output convention.
    template: "static",
  };
}

const EMPTY_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Building…</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-zinc-300 flex items-center justify-center min-h-screen">
  <div class="text-sm opacity-60">Alex is wiring up your app…</div>
</body>
</html>`;
