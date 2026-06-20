import { createClient, type Client } from "@libsql/client";

let _client: Client | null = null;

export function db(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_URL || "file:./atoms-demo.db";
  const authToken = process.env.TURSO_TOKEN;
  _client = createClient({ url, authToken });
  return _client;
}

const SCHEMA = `
-- Phase 0 · 已落地的 4 张表
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'team',
  theme TEXT DEFAULT 'dark',
  status TEXT NOT NULL DEFAULT 'created',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  -- kind: chat | plan | status | file | race-pick | user | tool-call | tool-result
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, created_at);

-- legacy: 旧版单文件 HTML, 渐进迁出到 vfiles
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id, version DESC);

CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  candidates TEXT NOT NULL,
  winner_idx INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Phase 1 · v2 新增 4 张表

-- 文件沙箱: 多文件 + 同 path 多版本
CREATE TABLE IF NOT EXISTS vfiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vfiles_lookup ON vfiles(project_id, path, version DESC);

-- DB 沙箱: 每个 project 一个 sql.js 序列化 BLOB
CREATE TABLE IF NOT EXISTS sandbox_dbs (
  project_id TEXT PRIMARY KEY,
  blob BLOB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 短期记忆 (项目内, prompt 注入版)
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id, created_at);

-- Agent 计费
CREATE TABLE IF NOT EXISTS agent_billing (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  -- kind: chat | tool-loop | race
  kind TEXT NOT NULL DEFAULT 'chat',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_billing_project ON agent_billing(project_id, created_at);
`;

let _initialized = false;
export async function ensureSchema() {
  if (_initialized) return;
  const c = db();
  // Strip line comments so stray "-- header" lines between statements
  // don't accidentally hide a following CREATE TABLE behind a startsWith("--") skip.
  const stripped = SCHEMA.replace(/^\s*--.*$/gm, "");
  for (const stmt of stripped.split(";").map((s) => s.trim()).filter(Boolean)) {
    await c.execute(stmt);
  }
  _initialized = true;
}

// helpers ---------------------------------------------------------------

export async function loadSandboxBlob(projectId: string): Promise<Uint8Array | null> {
  const rs = await db().execute({
    sql: "SELECT blob FROM sandbox_dbs WHERE project_id = ? LIMIT 1",
    args: [projectId],
  });
  if (rs.rows.length === 0) return null;
  const raw = rs.rows[0].blob as ArrayBuffer | Uint8Array;
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
}

export async function saveSandboxBlob(projectId: string, blob: Uint8Array): Promise<void> {
  await db().execute({
    sql: `
      INSERT INTO sandbox_dbs (project_id, blob, version, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        blob = excluded.blob,
        version = sandbox_dbs.version + 1,
        updated_at = excluded.updated_at
    `,
    args: [projectId, blob, Date.now()],
  });
}

export async function loadMemories(
  projectId: string,
): Promise<{ key: string; value: string; source_agent: string }[]> {
  const rs = await db().execute({
    sql: "SELECT key, value, source_agent FROM memories WHERE project_id = ? ORDER BY created_at ASC",
    args: [projectId],
  });
  return rs.rows.map((r) => ({
    key: r.key as string,
    value: r.value as string,
    source_agent: r.source_agent as string,
  }));
}

export async function saveMemory(
  projectId: string,
  key: string,
  value: string,
  sourceAgent: string,
): Promise<void> {
  const { nanoid } = await import("nanoid");
  await db().execute({
    sql: "INSERT INTO memories (id, project_id, key, value, source_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [nanoid(10), projectId, key, value, sourceAgent, Date.now()],
  });
}
