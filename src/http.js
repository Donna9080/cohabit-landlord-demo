// Request and response helpers shared by every /api/* route (see src/index.js).

export const MAX_BODY = 16 * 1024;

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

export function json(data, status = 200, setCookies = []) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
  for (const c of setCookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(data), { status, headers });
}

export function withSecurityHeaders(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

// Cookie-authenticated writes must come from our own pages.
export function assertSameOrigin(request, env) {
  const expected = new URL(env.BETTER_AUTH_URL).origin;
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (origin !== expected || (site && site !== "same-origin")) {
    throw new HttpError(403, "forbidden_origin", "This request must come from the coHabit site.");
  }
}

export async function readJson(request, max = MAX_BODY) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.startsWith("application/json")) throw new HttpError(415, "unsupported_type", "Send JSON.");
  if (Number(request.headers.get("Content-Length") || 0) > max) throw new HttpError(413, "too_large", "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalid_json", "Request body is empty.");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "too_large", "Request too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

// Fixed one-minute window counter in D1, shared by every Worker instance.
export async function rateLimit(env, key, max, message = "Too many requests. Wait a minute and try again.") {
  const windowStart = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare(
    `INSERT INTO app_rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
       window_start = ?2
     RETURNING count`
  )
    .bind(key, windowStart)
    .first();
  if (row && row.count > max) throw new HttpError(429, "rate_limited", message);
}
