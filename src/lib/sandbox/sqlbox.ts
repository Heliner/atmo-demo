import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import path from "node:path";
import { loadSandboxBlob, saveSandboxBlob } from "@/lib/db";

let _SQL: SqlJsStatic | null = null;

async function getSQL(): Promise<SqlJsStatic> {
  if (_SQL) return _SQL;
  _SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), "node_modules/sql.js/dist", file),
  });
  return _SQL;
}

export interface ExecResult {
  kind: "create" | "insert" | "update" | "delete" | "select" | "other";
  message: string;
  table?: string;
  rowsAffected?: number;
  columns?: string[];
  rows?: unknown[][];
}

interface OpenedDb {
  db: Database;
  release: () => Promise<void>;
}

// 在 server 内存里加载某 project 的 sql.js DB; 用完 release() 时持久化回 sandbox_dbs.blob
async function openProjectDb(projectId: string): Promise<OpenedDb> {
  const SQL = await getSQL();
  const blob = await loadSandboxBlob(projectId);
  const db = new SQL.Database(blob ?? undefined);
  let dirty = false;
  const original = {
    run: db.run.bind(db),
    exec: db.exec.bind(db),
  };
  db.run = ((sql: string, params?: unknown[]) => {
    dirty = true;
    return original.run(sql, params as never);
  }) as Database["run"];
  db.exec = ((sql: string) => {
    dirty = true;
    return original.exec(sql);
  }) as Database["exec"];
  return {
    db,
    release: async () => {
      try {
        if (dirty) {
          const out = db.export();
          await saveSandboxBlob(projectId, out);
        }
      } finally {
        db.close();
      }
    },
  };
}

function classifyKind(sql: string): ExecResult["kind"] {
  const head = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (head === "CREATE") return "create";
  if (head === "INSERT") return "insert";
  if (head === "UPDATE") return "update";
  if (head === "DELETE") return "delete";
  if (head === "SELECT" || head === "WITH") return "select";
  return "other";
}

function extractTableName(sql: string): string | undefined {
  const m =
    sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`']?(\w+)["`']?/i) ||
    sql.match(/INSERT\s+INTO\s+["`']?(\w+)["`']?/i) ||
    sql.match(/UPDATE\s+["`']?(\w+)["`']?/i) ||
    sql.match(/DELETE\s+FROM\s+["`']?(\w+)["`']?/i) ||
    sql.match(/FROM\s+["`']?(\w+)["`']?/i);
  return m?.[1];
}

export async function execSql(projectId: string, sql: string): Promise<ExecResult> {
  const opened = await openProjectDb(projectId);
  try {
    const kind = classifyKind(sql);
    const table = extractTableName(sql);

    if (kind === "select") {
      const stmt = opened.db.prepare(sql);
      const cols = stmt.getColumnNames();
      const rows: unknown[][] = [];
      while (stmt.step()) {
        const row = stmt.get();
        rows.push(row);
        if (rows.length >= 200) break;
      }
      stmt.free();
      return {
        kind: "select",
        message: `Returned ${rows.length} row(s)`,
        table,
        columns: cols,
        rows,
      };
    }

    opened.db.run(sql);
    const affected = (opened.db as unknown as { getRowsModified?: () => number }).getRowsModified?.() ?? 0;
    let message = `OK`;
    if (kind === "create") message = `Created table ${table ?? ""}`.trim();
    if (kind === "insert") message = `Inserted ${affected} row(s) into ${table ?? "table"}`;
    if (kind === "update") message = `Updated ${affected} row(s) in ${table ?? "table"}`;
    if (kind === "delete") message = `Deleted ${affected} row(s) from ${table ?? "table"}`;
    return { kind, message, table, rowsAffected: affected };
  } finally {
    await opened.release();
  }
}

// 给 Database tab 读 schema + rows 用
export interface SchemaInfo {
  name: string;
  columns: { name: string; type: string; pk: boolean; notnull: boolean }[];
  rowCount: number;
}

export async function listSchema(projectId: string): Promise<SchemaInfo[]> {
  const opened = await openProjectDb(projectId);
  try {
    const tablesStmt = opened.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const out: SchemaInfo[] = [];
    while (tablesStmt.step()) {
      const name = (tablesStmt.get()[0] as string) ?? "";
      const colsStmt = opened.db.prepare(`PRAGMA table_info("${name}")`);
      const cols: SchemaInfo["columns"] = [];
      while (colsStmt.step()) {
        const r = colsStmt.get();
        cols.push({
          name: r[1] as string,
          type: r[2] as string,
          notnull: Number(r[3]) === 1,
          pk: Number(r[5]) === 1,
        });
      }
      colsStmt.free();
      const countStmt = opened.db.prepare(`SELECT COUNT(*) FROM "${name}"`);
      countStmt.step();
      const rowCount = Number(countStmt.get()[0]);
      countStmt.free();
      out.push({ name, columns: cols, rowCount });
    }
    tablesStmt.free();
    return out;
  } finally {
    await opened.release();
  }
}

export async function selectTable(
  projectId: string,
  table: string,
  limit = 100,
): Promise<{ columns: string[]; rows: unknown[][] }> {
  const opened = await openProjectDb(projectId);
  try {
    if (!/^[A-Za-z_]\w*$/.test(table)) throw new Error("invalid table name");
    const stmt = opened.db.prepare(`SELECT * FROM "${table}" LIMIT ${limit}`);
    const columns = stmt.getColumnNames();
    const rows: unknown[][] = [];
    while (stmt.step()) rows.push(stmt.get());
    stmt.free();
    return { columns, rows };
  } finally {
    await opened.release();
  }
}
