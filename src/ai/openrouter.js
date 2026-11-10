// OpenRouter: free AI models for coHabit (see docs/OPENROUTER_PLAN.md).
//
// The key is the Worker secret "openrouter-api-key". It is read only here, sent only to OpenRouter, and never
// logged, stored or returned to a browser. Only free models can be called: every model id must end in ":free"
// or be OpenRouter's free router ("openrouter/free"), and anything else is dropped before a request is made, so
// nothing can be billed even if a variable is mistyped.
//
// OpenRouter's free tier allows 20 requests a minute and 50 a day for the whole account (src/ai/budget.js keeps
// coHabit inside that). Requests list up to three free models; OpenRouter tries the next one if one fails or is
// busy, and the reply says which model answered.

export const OPENROUTER_KEY = "openrouter-api-key";
const API = "https://openrouter.ai/api/v1";

const keyOf = (env) => {
  const k = env?.[OPENROUTER_KEY] ?? env?.OPENROUTER_API_KEY;
  return typeof k === "string" && k.trim().length > 20 ? k.trim() : null;
};
export const openRouterConfigured = (env) => !!keyOf(env);

export const isFreeModel = (id) => typeof id === "string" && (id === "openrouter/free" || /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i.test(id));

// Free models chosen on 2026-11-10 from OpenRouter's model list (docs/OPENROUTER_PLAN.md). Each use can be changed
// without a code change with a Worker variable holding a comma-separated list (AI_MODELS_CHAT, AI_MODELS_HELPER,
// AI_MODELS_SUMMARY); ids that aren't free are ignored, and at most three are used.
export const DEFAULT_MODELS = {
  chat: ["google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free", "openrouter/free"],
  helper: ["google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-lightning:free", "openrouter/free"],
  summary: ["nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-31b-it:free", "openrouter/free"],
};
const MAX_MODELS = 3;

export function modelsFor(env, use) {
  const raw = env?.[`AI_MODELS_${use.toUpperCase()}`];
  const listed = typeof raw === "string" && raw.trim() ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_MODELS[use] || [];
  const free = [...new Set(listed.filter(isFreeModel))].slice(0, MAX_MODELS);
  return free.length ? free : DEFAULT_MODELS[use] || [];
}

// A different address is only honored for local tests (a stand-in server on this machine), as for Anthropic.
function apiBase(env) {
  let local = false;
  try {
    local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(env.BETTER_AUTH_URL).origin);
  } catch {}
  return local && env.OPENROUTER_BASE_URL ? env.OPENROUTER_BASE_URL.replace(/\/+$/, "") : API;
}

// reason: key | rate_limited | no_credits | no_provider | bad_request | unreachable | timeout | service_error |
// not_configured | bad_output. retryAfter: seconds, when OpenRouter says.
export class OpenRouterError extends Error {
  constructor(reason, { status = null, detail = "", retryAfter = null } = {}) {
    super(reason);
    this.reason = reason;
    this.status = status;
    this.detail = String(detail).slice(0, 300);
    this.retryAfter = retryAfter;
  }
}

const reasonFor = (status) =>
  status === 401 || status === 403 ? "key" : status === 429 ? "rate_limited" : status === 402 ? "no_credits" : status === 404 || status === 503 ? "no_provider" : status === 400 || status === 422 ? "bad_request" : "service_error";

const headers = (env) => ({
  Authorization: `Bearer ${keyOf(env)}`,
  "Content-Type": "application/json",
  // Optional: names the app on OpenRouter's side. No user data.
  "HTTP-Referer": (() => {
    try {
      return new URL(env.BETTER_AUTH_URL).origin;
    } catch {
      return "https://cohabit-landlord-demo.dolgorsureng.workers.dev";
    }
  })(),
  "X-Title": "coHabit",
});

// One chat completion. messages/tools in OpenAI's format (OpenRouter's normalized API).
// Returns { message, finish, model, usage: { input, output } }.
export async function chatCompletion(env, { use, models, messages, tools, toolChoice, maxTokens = 800, temperature = 0.3, json = false, timeoutMs = 25_000 }) {
  if (!openRouterConfigured(env)) throw new OpenRouterError("not_configured");
  const list = (models || modelsFor(env, use)).filter(isFreeModel).slice(0, MAX_MODELS);
  if (!list.length) throw new OpenRouterError("bad_request", { detail: "No free model to use." });
  const body = {
    models: list,
    messages,
    max_tokens: maxTokens,
    temperature,
    ...(tools?.length
      ? { tools, tool_choice: toolChoice || "auto", parallel_tool_calls: false, provider: { require_parameters: true } }
      : {}),
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  let res;
  try {
    res = await fetch(`${apiBase(env)}/chat/completions`, { method: "POST", headers: headers(env), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new OpenRouterError(e?.name === "TimeoutError" ? "timeout" : "unreachable", { detail: e?.message });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const status = res.ok ? Number(data?.error?.code) || 502 : res.status;
    const retry = Number(res.headers.get("retry-after"));
    throw new OpenRouterError(reasonFor(status), { status, detail: data?.error?.message || res.statusText, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null });
  }
  const choice = data?.choices?.[0];
  if (!choice?.message) throw new OpenRouterError("bad_output", { detail: "No message in the reply." });
  const u = data.usage || {};
  return {
    message: choice.message,
    finish: choice.finish_reason || choice.native_finish_reason || null,
    model: typeof data.model === "string" ? data.model : list[0],
    usage: { input: Number(u.prompt_tokens) || 0, output: Number(u.completion_tokens) || 0 },
  };
}

// The text of a reply, without any reasoning a model printed between <think> tags.
export const replyText = (message) => {
  const c = message?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("") : "";
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^<think>[\s\S]*$/i, "").trim();
};

// The account's free-request counter and key limit, from OpenRouter (cached for a minute per Worker instance).
// Only these numbers are kept; the key itself and its label are never returned.
let keyCache = { at: 0, value: null };
export async function keyStatus(env, { fresh = false } = {}) {
  if (!openRouterConfigured(env)) return null;
  if (!fresh && keyCache.value && Date.now() - keyCache.at < 60_000) return keyCache.value;
  try {
    const res = await fetch(`${apiBase(env)}/key`, { headers: headers(env), signal: AbortSignal.timeout(8_000) });
    const d = (await res.json().catch(() => null))?.data;
    if (!res.ok || !d) return { ok: false, status: res.status };
    const daily = d.free_model_daily_requests || {};
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const value = {
      ok: true,
      freeToday: { used: num(daily.used), limit: num(daily.limit), remaining: num(daily.remaining) },
      creditLimit: num(d.limit),
      creditLimitRemaining: num(d.limit_remaining),
      usage: num(d.usage),
      freeTier: typeof d.is_free_tier === "boolean" ? d.is_free_tier : null,
    };
    keyCache = { at: Date.now(), value };
    return value;
  } catch {
    return { ok: false, status: null };
  }
}
export const forgetKeyStatus = () => (keyCache = { at: 0, value: null });
