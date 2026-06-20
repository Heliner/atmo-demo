import { generateText, streamText, stepCountIs, type ModelMessage } from "ai";
import { getModel, DOUBAO_PROVIDER_OPTIONS } from "@/lib/llm/doubao";
import {
  MIKE_SYSTEM,
  EMMA_SYSTEM,
  BOB_SYSTEM,
  ALEX_SYSTEM,
  memorySection,
} from "./prompts";
import { makeTools } from "./tools";

export interface PRDPreference {
  key: string;
  value: string;
}

export interface PRDEntity {
  name: string;
  purpose: string;
}

export interface PRD {
  title: string;
  one_liner: string;
  target_user: string;
  core_value: string;
  primary_screen: string;
  tasks: string[];
  data_entities?: PRDEntity[];
  preferences?: PRDPreference[];
}

export interface MemoryEntry {
  key: string;
  value: string;
  source_agent: string;
}

// ---------------------------------------------------------------------------
// Mike — short warm intro
// ---------------------------------------------------------------------------
export async function mikeIntro(idea: string) {
  return generateText({
    model: getModel("std"),
    system: MIKE_SYSTEM,
    prompt: idea,
    temperature: 0.7,
    maxOutputTokens: 300,
    providerOptions: DOUBAO_PROVIDER_OPTIONS,
  });
}

// ---------------------------------------------------------------------------
// Emma — stream PRD JSON
// ---------------------------------------------------------------------------
export function emmaPlanStream(idea: string, signal?: AbortSignal) {
  return streamText({
    model: getModel("pro"),
    system: EMMA_SYSTEM,
    prompt: idea,
    temperature: 0.3,
    maxOutputTokens: 1500,
    providerOptions: DOUBAO_PROVIDER_OPTIONS,
    abortSignal: signal,
  });
}

// ---------------------------------------------------------------------------
// Bob — tool-using architect (exec_sql + show_table)
// ---------------------------------------------------------------------------
export function bobBuildStream(
  projectId: string,
  prd: PRD,
  memories: MemoryEntry[],
  signal?: AbortSignal,
) {
  const allTools = makeTools(projectId);
  return streamText({
    model: getModel("std"),
    system: BOB_SYSTEM + memorySection(memories),
    messages: [
      {
        role: "user",
        content:
          "Design the schema and seed sample rows for this product.\n\nPRD:\n" +
          JSON.stringify(prd, null, 2),
      },
    ] satisfies ModelMessage[],
    tools: {
      exec_sql: allTools.exec_sql,
      run_python: allTools.run_python,
      run_command: allTools.run_command,
      read_file: allTools.read_file,
      list_files: allTools.list_files,
      show_table: allTools.show_table,
    },
    stopWhen: stepCountIs(14),
    temperature: 0.4,
    maxOutputTokens: 3000,
    providerOptions: DOUBAO_PROVIDER_OPTIONS,
    abortSignal: signal,
  });
}

// ---------------------------------------------------------------------------
// Alex — tool-using engineer (write_file + show_preview + focus_file)
// ---------------------------------------------------------------------------
export function alexBuildStream(
  projectId: string,
  prd: PRD,
  memories: MemoryEntry[],
  schemaSummary: string,
  signal?: AbortSignal,
) {
  const allTools = makeTools(projectId);
  return streamText({
    model: getModel("pro"),
    system: ALEX_SYSTEM + memorySection(memories),
    messages: [
      {
        role: "user",
        content: `Build this product.

PRD:
${JSON.stringify(prd, null, 2)}

Schema notes from Bob:
${schemaSummary}

Now write index.html, optionally style.css and app.js, then call show_preview().`,
      },
    ] satisfies ModelMessage[],
    tools: {
      write_file: allTools.write_file,
      read_file: allTools.read_file,
      list_files: allTools.list_files,
      run_command: allTools.run_command,
      run_python: allTools.run_python,
      show_preview: allTools.show_preview,
      show_console: allTools.show_console,
      focus_file: allTools.focus_file,
    },
    stopWhen: stepCountIs(16),
    temperature: 0.5,
    maxOutputTokens: 16384,
    providerOptions: DOUBAO_PROVIDER_OPTIONS,
    abortSignal: signal,
  });
}

// ---------------------------------------------------------------------------
// JSON / HTML extraction helpers (Emma + legacy)
// ---------------------------------------------------------------------------
export function extractJSON<T = unknown>(raw: string): T | null {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export function extractHTML(raw: string): string {
  const fence = raw.match(/```(?:html)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : raw).trim();
  const docIdx = body.search(/<!DOCTYPE/i);
  return docIdx >= 0 ? body.slice(docIdx) : body;
}

export const RACE_MODELS: { key: "pro" | "std" | "lite"; label: string; tag: string }[] = [
  { key: "pro", label: "Doubao Pro", tag: "Heavyweight" },
  { key: "std", label: "Doubao Std", tag: "Balanced" },
  { key: "lite", label: "Doubao Lite", tag: "Lightning" },
];
