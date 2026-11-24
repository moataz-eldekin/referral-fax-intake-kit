/**
 * Sully API client: M1 (OpenAI-compatible Chat Completions at /openai/v1) and
 * Text to JSON (POST /v1/utils/text-to-json).
 *
 * - Server only. API keys never reach the browser.
 * - Plain fetch, so each request maps 1:1 to the curl in the Sully docs.
 * - No automatic retries: every completion is billable.
 * - Every call is recorded as an ApiCall (redacted headers, truncated body,
 *   status, latency, request ID, token usage, curl) for the developer panel.
 */
import { randomUUID } from "node:crypto";
import { getSullyConfig } from "./config";
import { describeSullyError } from "./errors";
import type { ApiCall, AppError, ToolCall } from "./types";

export const M1_PATH = "/openai/v1/chat/completions";
export const M1_MODEL = "sully-m1";
export const TEXT_TO_JSON_PATH = "/v1/utils/text-to-json";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: readonly unknown[];
  tool_choice?: "auto" | "none" | "required";
  response_format?: { type: "json_object" | "text" };
  max_completion_tokens?: number;
  temperature?: number;
  // M1's reasoning tokens count against max_completion_tokens. "none" keeps
  // short turns fast and stops the model spending the whole budget thinking.
  reasoning_effort?: "none" | "medium" | "high";
  stream?: boolean;
  stream_options?: { include_usage: boolean };
};

export type ChatResult = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  call: ApiCall;
};

/** Thrown for any failed Sully request. Carries a UI-safe message and the recorded call. */
export class SullyError extends Error {
  appError: AppError;
  call: ApiCall;
  constructor(appError: AppError, call: ApiCall) {
    super(appError.message);
    this.appError = appError;
    this.call = call;
  }
}

const TIMEOUT_MS = 120_000;
const BODY_PREVIEW_LIMIT = 2_000;
const RESPONSE_PREVIEW_LIMIT = 2_000;

/** POST /openai/v1/chat/completions without streaming. */
export async function chat(body: ChatRequest, label: string): Promise<ChatResult> {
  const { res, call, started } = await open(M1_PATH, { ...body, stream: false }, label);
  const text = await res.text();
  const parsed = safeJson(text) as
    | { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[]; usage?: Usage }
    | undefined;
  const choice = parsed?.choices?.[0];
  const done = finish(call, started, res, {
    preview: parsed ? JSON.stringify(parsed, null, 2) : text,
    usage: parsed?.usage,
  });
  if (!parsed) {
    throw new SullyError({ title: "Unexpected response", message: "Sully returned a response that is not JSON.", status: res.status, requestId: done.requestId }, { ...done, ok: false });
  }
  return {
    content: choice?.message?.content ?? "",
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? null,
    call: done,
  };
}

/**
 * POST /v1/utils/text-to-json: extract facts from text into the caller's JSON Schema.
 * One synchronous, billable request. Never retried automatically.
 */
export async function textToJson<T>(text: string, schema: object, label: string): Promise<{ data: T; call: ApiCall }> {
  const body = { text, schema };
  const { res, call, started } = await open(TEXT_TO_JSON_PATH, body, label);
  const raw = await res.text();
  const parsed = safeJson(raw) as { data?: T } | undefined;
  const done = finish(call, started, res, { preview: parsed ? JSON.stringify(parsed, null, 2) : raw });
  if (!parsed || parsed.data === undefined) {
    throw new SullyError(
      { title: "Unexpected response", message: "Text to JSON returned no data.", status: res.status, requestId: done.requestId },
      { ...done, ok: false },
    );
  }
  return { data: parsed.data, call: done };
}

// ---------- Request plumbing ----------

type Usage = { prompt_tokens?: number; completion_tokens?: number };
async function open(path: string, body: object, label: string): Promise<{ res: Response; call: ApiCall; started: number }> {
  const config = getSullyConfig();
  const started = Date.now();
  const call: ApiCall = {
    id: randomUUID(),
    label,
    method: "POST",
    path,
    requestHeaders: {
      "X-Account-Id": config.accountId ? `${"*".repeat(Math.max(0, config.accountId.length - 4))}${config.accountId.slice(-4)}` : "(not set)",
      "X-Api-Key": "[redacted]",
      "Content-Type": "application/json",
    },
    requestBody: truncate(JSON.stringify(body, null, 2), BODY_PREVIEW_LIMIT),
    curl: toCurl(path, body),
    demo: false,
    status: null,
    ok: false,
    latencyMs: 0,
    at: new Date().toISOString(),
  };
  if (config.demo || !config.accountId) {
    const appError: AppError = config.demo
      ? { title: "Needs your Sully keys", message: "Add SULLY_ACCOUNT_ID and SULLY_API_KEY to .env.local." }
      : { title: "Missing account ID", message: "SULLY_API_KEY is set but SULLY_ACCOUNT_ID is empty. Add it to .env.local and restart." };
    throw new SullyError(appError, { ...call, error: appError.message });
  }

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "X-Account-Id": config.accountId, "X-Api-Key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SullyError(describeSullyError({ status: null, message }), { ...call, latencyMs: Date.now() - started, error: message });
  }

  if (!res.ok) {
    const text = await res.text();
    const parsed = safeJson(text);
    const { code, message } = readErrorBody(parsed, text);
    const requestId = res.headers.get("x-request-id") ?? undefined;
    const failed: ApiCall = {
      ...call,
      status: res.status,
      latencyMs: Date.now() - started,
      requestId,
      responsePreview: truncate(parsed ? JSON.stringify(parsed, null, 2) : text, RESPONSE_PREVIEW_LIMIT),
      error: message ?? `HTTP ${res.status}`,
    };
    throw new SullyError(describeSullyError({ status: res.status, code, message, requestId }), failed);
  }
  return { res, call, started };
}

function finish(call: ApiCall, started: number, res: Response, extra: { preview?: string; usage?: Usage }): ApiCall {
  return {
    ...call,
    status: res.status,
    ok: res.ok,
    latencyMs: Date.now() - started,
    requestId: res.headers.get("x-request-id") ?? undefined,
    responsePreview: extra.preview ? truncate(extra.preview, RESPONSE_PREVIEW_LIMIT) : undefined,
    usage: extra.usage
      ? { promptTokens: extra.usage.prompt_tokens ?? 0, completionTokens: extra.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

/** OpenAI-style error body: {error:{code,message}}, with fallbacks. */
function readErrorBody(parsed: unknown, text: string): { code?: string; message?: string } {
  if (!isRecord(parsed)) return { message: text ? truncate(text, 300) : undefined };
  const err = parsed.error;
  if (isRecord(err)) return { code: str(err.code) ?? str(err.type), message: str(err.message) };
  return { code: str(parsed.code), message: str(parsed.message) ?? (typeof err === "string" ? err : undefined) };
}

/** A curl command a developer can paste into a terminal (env vars, never the real key). */
function toCurl(path: string, body: unknown): string {
  return [
    `curl "$SULLY_API_BASE_URL${path}"`,
    `  --header "X-Account-Id: $SULLY_ACCOUNT_ID"`,
    `  --header "X-Api-Key: $SULLY_API_KEY"`,
    `  --header "Content-Type: application/json"`,
    `  --data @- <<'JSON'`,
  ].join(" \\\n") + `\n${JSON.stringify(body, null, 2)}\nJSON`;
}

function safeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n... (${s.length - max} more characters)` : s;
}

/** A demo-mode ApiCall: the request is built but never sent. */
export function demoCall(label: string, body: unknown, response: unknown, path = M1_PATH): ApiCall {
  return {
    id: randomUUID(),
    label,
    method: "POST",
    path,
    requestHeaders: { "X-Account-Id": "(not set)", "X-Api-Key": "[redacted]", "Content-Type": "application/json" },
    requestBody: truncate(JSON.stringify(body, null, 2), BODY_PREVIEW_LIMIT),
    curl: toCurl(path, body),
    demo: true,
    status: 200,
    ok: true,
    latencyMs: 0,
    requestId: `demo_${randomUUID().slice(0, 8)}`,
    responsePreview: truncate(JSON.stringify(response, null, 2), RESPONSE_PREVIEW_LIMIT),
    note: "Demo mode: this request was not sent. The response is simulated.",
    at: new Date().toISOString(),
  };
}
