// 代码执行沙箱 — Daytona 真容器
//
// 没有 mock 路径。没有 fallback。DAYTONA_API_KEY 没设就抛错。
// 一 project 一 sandbox, 内存 cache。Daytona 自带 autoStopInterval/autoDeleteInterval
// 控制 sandbox 生命周期, 我们不维护自己的 reaper。
//
// 每次执行前把 vfiles 增量同步进 sandbox 的 ~/project 目录(按 path+version 去重)。
import type { Sandbox } from "@daytona/sdk";
import { listLatestVFiles, readLatestVFile } from "./vfiles";

export type SandboxKind = "daytona";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration_ms: number;
  sandbox: SandboxKind;
}

type CacheEntry = {
  sbx: Sandbox;
  cwd: string;
  syncedVersions: Map<string, number>;
};

const CACHE = new Map<string, CacheEntry>();

let daytonaPromise: Promise<import("@daytona/sdk").Daytona> | null = null;

async function getDaytona() {
  if (!process.env.DAYTONA_API_KEY) {
    throw new Error(
      "DAYTONA_API_KEY is not set. Atoms 容器执行需要真实 Daytona 凭证 (.env.local 或 Vercel env)",
    );
  }
  if (!daytonaPromise) {
    daytonaPromise = (async () => {
      const { Daytona } = await import("@daytona/sdk");
      return new Daytona({
        apiKey: process.env.DAYTONA_API_KEY,
        apiUrl: process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
      });
    })();
  }
  return daytonaPromise;
}

async function getSandbox(projectId: string): Promise<CacheEntry> {
  const cached = CACHE.get(projectId);
  if (cached) return cached;

  const daytona = await getDaytona();
  const sbx = await daytona.create({
    language: "python",          // codeRun 用 Python kernel
    autoStopInterval: 10,        // 10min idle → Daytona 自动 stop
    autoDeleteInterval: 60,      // stop 后 60min 不动 → 删
    labels: { "atoms.project_id": projectId },
  });

  const home = (await sbx.getUserHomeDir()) ?? "/home/daytona";
  const workDir = `${home.replace(/\/$/, "")}/project`;
  await sbx.process.executeCommand(`mkdir -p ${workDir}`);

  const entry: CacheEntry = {
    sbx,
    cwd: workDir,
    syncedVersions: new Map(),
  };
  CACHE.set(projectId, entry);
  return entry;
}

async function syncVFiles(entry: CacheEntry, projectId: string): Promise<void> {
  const files = await listLatestVFiles(projectId);
  for (const f of files) {
    if (entry.syncedVersions.get(f.path) === f.version) continue;
    const full = await readLatestVFile(projectId, f.path);
    if (!full) continue;
    const remotePath = `${entry.cwd}/${f.path}`;
    const slash = remotePath.lastIndexOf("/");
    const dirname = slash > 0 ? remotePath.slice(0, slash) : entry.cwd;
    if (dirname !== entry.cwd) {
      await entry.sbx.process.executeCommand(`mkdir -p ${dirname}`);
    }
    await entry.sbx.fs.uploadFile(Buffer.from(full.content, "utf8"), remotePath);
    entry.syncedVersions.set(f.path, f.version);
  }
}

export async function runShell(
  projectId: string,
  command: string,
  timeoutSeconds = 30,
): Promise<RunResult> {
  const t0 = Date.now();
  const entry = await getSandbox(projectId);
  await syncVFiles(entry, projectId);
  const r = await entry.sbx.process.executeCommand(
    command,
    entry.cwd,
    undefined,
    timeoutSeconds,
  );
  // Daytona 的 ExecuteResponse 把 stdout+stderr 合并到 result; 没有独立 stderr。
  // 我们按 exitCode 把 result 投放到对应字段, 让前端 Shell tab 高亮失败。
  const out = r.result ?? "";
  const exitCode = r.exitCode ?? 0;
  return {
    stdout: exitCode === 0 ? out : "",
    stderr: exitCode === 0 ? "" : out,
    exitCode,
    duration_ms: Date.now() - t0,
    sandbox: "daytona",
  };
}

export async function runPython(
  projectId: string,
  code: string,
  timeoutSeconds = 30,
): Promise<RunResult> {
  const t0 = Date.now();
  const entry = await getSandbox(projectId);
  await syncVFiles(entry, projectId);
  const r = await entry.sbx.process.codeRun(code, undefined, timeoutSeconds);
  const out = r.result ?? "";
  const exitCode = r.exitCode ?? 0;
  return {
    stdout: exitCode === 0 ? out : "",
    stderr: exitCode === 0 ? "" : out,
    exitCode,
    duration_ms: Date.now() - t0,
    sandbox: "daytona",
  };
}
