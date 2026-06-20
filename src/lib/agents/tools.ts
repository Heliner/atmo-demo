import { tool } from "ai";
import { z } from "zod";
import { writeVFile, readLatestVFile, listLatestVFiles } from "@/lib/sandbox/vfiles";
import { execSql } from "@/lib/sandbox/sqlbox";
import { runShell, runPython } from "@/lib/sandbox/runner";

// UI-event payload returned by presentation tools.
// ProjectClient inspects __ui_event on tool-result to switch tab / highlight.
export interface UIEvent {
  __ui_event: "focus_file" | "show_table" | "show_preview" | "show_console";
  path?: string;
  line?: number;
  table?: string;
}

export function makeTools(projectId: string) {
  return {
    // -----------------------------------------------------------------
    // Mutation tools — write project state
    // -----------------------------------------------------------------
    write_file: tool({
      description:
        "Write a file into the project's virtual file sandbox. Overwrites if path exists (append-only versioning under the hood). Use this to build the app file by file. Paths are project-root-relative, e.g. 'index.html', 'style.css', 'app.js'. Always start the project with 'index.html' as the entry.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe("Project-relative path, e.g. 'index.html' or 'src/app.js'."),
        content: z.string().describe("Full file content."),
      }),
      execute: async ({ path, content }) => {
        const f = await writeVFile(projectId, path, content);
        return {
          success: true,
          path: f.path,
          version: f.version,
          size: f.size,
        };
      },
    }),

    exec_sql: tool({
      description:
        "Execute a single SQL statement against the project's SANDBOX database (a real per-project SQLite). Use CREATE TABLE to design schema, INSERT to seed sample rows, SELECT for verification. The user will see schema + rows in the right panel's Database tab.",
      inputSchema: z.object({
        sql: z.string().min(1).describe("A single SQL statement."),
      }),
      execute: async ({ sql }) => {
        try {
          const r = await execSql(projectId, sql);
          return { success: true, ...r };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      },
    }),

    // -----------------------------------------------------------------
    // Read-only filesystem tools — inspect what was written earlier
    // -----------------------------------------------------------------
    read_file: tool({
      description:
        "Read the latest version of a file from the project's virtual file sandbox. Use before write_file when you need to MODIFY existing code (so you can preserve other code). Use to investigate a runtime error reported by the user.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Project-relative path."),
      }),
      execute: async ({ path }) => {
        const f = await readLatestVFile(projectId, path);
        if (!f) {
          return { success: false, error: `File not found: ${path}` };
        }
        return {
          success: true,
          path: f.path,
          content: f.content,
          version: f.version,
          size: f.size,
        };
      },
    }),

    list_files: tool({
      description:
        "List every file currently in the project's virtual file sandbox with paths and sizes. Use to remind yourself what exists before editing or to verify a write succeeded.",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await listLatestVFiles(projectId);
        return {
          success: true,
          count: files.length,
          files: files.map((f) => ({
            path: f.path,
            size: f.size,
            version: f.version,
          })),
        };
      },
    }),

    // -----------------------------------------------------------------
    // Code execution tools — abstracted via lib/sandbox/runner.ts
    // Backed by a real per-project Daytona Linux sandbox.
    // -----------------------------------------------------------------
    run_command: tool({
      description:
        "Run a shell command in a real Linux container (Daytona). Use for npm install, build steps, ls/cat/pwd, or investigating environment. Returns stdout, stderr, exitCode, and sandbox kind.",
      inputSchema: z.object({
        command: z.string().min(1).describe("Shell command to execute."),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max execution time in seconds (default 30)."),
      }),
      execute: async ({ command, timeout_seconds = 30 }) => {
        try {
          const r = await runShell(projectId, command, timeout_seconds);
          return { success: r.exitCode === 0, ...r };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      },
    }),

    run_python: tool({
      description:
        "Run a Python snippet in the project's Daytona sandbox via its IPython kernel. Use for quick data/computation needs. Returns stdout, stderr, exitCode.",
      inputSchema: z.object({
        code: z.string().min(1).describe("Python source code."),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max execution time in seconds (default 30)."),
      }),
      execute: async ({ code, timeout_seconds = 30 }) => {
        try {
          const r = await runPython(projectId, code, timeout_seconds);
          return { success: r.exitCode === 0, ...r };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      },
    }),

    // -----------------------------------------------------------------
    // Presentation tools — guide the user's eye, no DB mutation
    // -----------------------------------------------------------------
    focus_file: tool({
      description:
        "Switch the right panel to Code tab and focus on a file. Optionally highlight a line. Call this after writing a file you want the user to read, or when investigating an error at a specific line.",
      inputSchema: z.object({
        path: z.string().describe("File path that was previously written."),
        line: z.number().int().positive().optional().describe("1-indexed line to highlight."),
      }),
      execute: async ({ path, line }): Promise<UIEvent> => ({
        __ui_event: "focus_file",
        path,
        line,
      }),
    }),

    show_table: tool({
      description:
        "Switch the right panel to Database tab and focus on a table. Call after creating a table or inserting rows the user should inspect.",
      inputSchema: z.object({
        table: z.string().describe("Table name created via exec_sql."),
      }),
      execute: async ({ table }): Promise<UIEvent> => ({
        __ui_event: "show_table",
        table,
      }),
    }),

    show_preview: tool({
      description:
        "Switch the right panel to Preview tab and force-refresh the iframe. Call when you've finished a batch of file writes and want the user to try the running app.",
      inputSchema: z.object({}),
      execute: async (): Promise<UIEvent> => ({
        __ui_event: "show_preview",
      }),
    }),

    show_console: tool({
      description:
        "Switch the right panel to Console tab. Call when investigating a runtime error reported by the user.",
      inputSchema: z.object({}),
      execute: async (): Promise<UIEvent> => ({
        __ui_event: "show_console",
      }),
    }),
  };
}

export type ToolName =
  | "write_file"
  | "exec_sql"
  | "read_file"
  | "list_files"
  | "run_command"
  | "run_python"
  | "focus_file"
  | "show_table"
  | "show_preview"
  | "show_console";

export function isUIEvent(result: unknown): result is UIEvent {
  return (
    !!result &&
    typeof result === "object" &&
    "__ui_event" in (result as Record<string, unknown>)
  );
}
