import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText, type ModelMessage, type LanguageModel } from "ai";

const BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export const MODELS = {
  pro: process.env.DOUBAO_MODEL_PRO || "ep-20260305202828-gc8n7",
  std: process.env.DOUBAO_MODEL_STD || "ep-20260506171031-d8xnm",
  lite: process.env.DOUBAO_MODEL_LITE || "ep-20260506170930-gb5tx",
} as const;

export type ModelKey = keyof typeof MODELS;

// 单价: cents per 1M tokens. 占位价, 后续用真豆包公开价更新
export const PRICING: Record<ModelKey, { in_cents_per_1m: number; out_cents_per_1m: number }> = {
  pro: { in_cents_per_1m: 80, out_cents_per_1m: 240 },
  std: { in_cents_per_1m: 30, out_cents_per_1m: 90 },
  lite: { in_cents_per_1m: 10, out_cents_per_1m: 30 },
};

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

function provider() {
  if (_provider) return _provider;
  const apiKey = process.env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error("DOUBAO_API_KEY not set");
  _provider = createOpenAICompatible({
    name: "doubao",
    baseURL: BASE_URL,
    apiKey,
  });
  return _provider;
}

function resolveModelId(key: ModelKey | string): string {
  if (key in MODELS) return MODELS[key as ModelKey];
  return key;
}

export function getModel(key: ModelKey | string = "pro"): LanguageModel {
  return provider().chatModel(resolveModelId(key)) as unknown as LanguageModel;
}

// providerOptions: 透传豆包专有参数 (thinking 关闭加速)
export const DOUBAO_PROVIDER_OPTIONS = {
  doubao: {
    thinking: { type: "disabled" as const },
  },
};

// 兼容老接口: 简单 chat (非流式)
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  model?: ModelKey | string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function chat(opts: ChatOpts): Promise<string> {
  const result = await generateText({
    model: getModel(opts.model),
    messages: opts.messages as ModelMessage[],
    temperature: opts.temperature ?? 0.4,
    maxOutputTokens: Math.min(opts.maxTokens ?? 8192, 16384),
    providerOptions: DOUBAO_PROVIDER_OPTIONS,
    abortSignal: opts.signal,
  });
  return result.text;
}

// 兼容老接口: 流式 text 输出 (异步生成器)
export async function* chatStream(opts: ChatOpts): AsyncGenerator<string, void, void> {
  const result = await streamText({
    model: getModel(opts.model),
    messages: opts.messages as ModelMessage[],
    temperature: opts.temperature ?? 0.4,
    maxOutputTokens: Math.min(opts.maxTokens ?? 8192, 16384),
    providerOptions: DOUBAO_PROVIDER_OPTIONS,
    abortSignal: opts.signal,
  });
  for await (const delta of result.textStream) {
    yield delta;
  }
}

// 新接口: 透传 streamText (用于 tool loop)
export { streamText, generateText };

// 计费 helper
export function computeCost(
  modelKey: ModelKey,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[modelKey];
  const inCents = (inputTokens / 1_000_000) * p.in_cents_per_1m;
  const outCents = (outputTokens / 1_000_000) * p.out_cents_per_1m;
  return Math.round(inCents + outCents);
}

export function modelKeyFromId(id: string): ModelKey {
  for (const k of Object.keys(MODELS) as ModelKey[]) {
    if (MODELS[k] === id) return k;
  }
  return "pro";
}
