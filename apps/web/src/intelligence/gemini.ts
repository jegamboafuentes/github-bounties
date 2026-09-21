import type { EnvMap } from "../auth/env";
import { readGeminiApiKey, readGeminiModel } from "./env";
import { parseIntelligenceJson, type IntelligenceModelOutput } from "./prompt";

export type GeminiHttp = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export const GEMINI_TIMEOUT_MS = 12_000;

export type GeminiGenerateResult =
  | { ok: true; output: IntelligenceModelOutput; model: string }
  | { ok: false; error: string };

export async function generateBountyIntelligence(args: {
  prompt: string;
  env?: EnvMap;
  http?: GeminiHttp;
  timeoutMs?: number;
}): Promise<GeminiGenerateResult> {
  const env = args.env ?? process.env;
  const apiKey = readGeminiApiKey(env);
  if (!apiKey) {
    return { ok: false, error: "missing_key" };
  }
  const model = readGeminiModel(env);
  const http = args.http ?? defaultHttp;
  const timeoutMs = args.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await http(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: args.prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      return { ok: false, error: `gemini_http_${res.status}` };
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const output = parseIntelligenceJson(text);
    if (!output) return { ok: false, error: "gemini_parse" };
    return { ok: true, output, model };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, error: aborted ? "gemini_timeout" : "gemini_fetch" };
  } finally {
    clearTimeout(timer);
  }
}

function defaultHttp(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) {
  return fetch(input, init);
}
