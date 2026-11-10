// A stand-in for OpenRouter's API (OpenAI-format chat completions and the key endpoint), used only by `npm test`
// (never by the real site). It records every request so the tests can check what would have been sent, and it
// answers like a free model would:
//   - Assistant chat (requests with tools): follows directives in the student's last message, one per step:
//       [[update_memory {...}]]  [[search_rooms]]  calls that tool
//       [[reply text]]           ends the turn with that text
//       [[tool_text]]            "answers" with a tool call written out as text (smaller models do this)
//       [[invented_price]]       answers with a price nobody gave
//   - Helpers and admin requests: canned answers chosen by what the system prompt asks for, including values a
//     careless model might add (unknown choices, invented prices, a phone number, an address), so the tests can
//     check that coHabit drops them.
//   state.mode "429" answers every chat request with a rate-limit error.
import { createServer } from "node:http";

export const FAKE_OPENROUTER_KEY = "test-openrouter-key-for-local-tests-only";

export function startFakeOpenRouter(port) {
  const state = { mode: "ok", requests: [], freeUsed: 0 };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const authed = req.headers.authorization === `Bearer ${FAKE_OPENROUTER_KEY}`;
    if (req.url === "/api/v1/key" && req.method === "GET") {
      if (!authed) return send(401, { error: { code: 401, message: "No auth credentials found" } });
      return send(200, { data: { label: "sk-or-v1-abc...xyz", limit: 0, limit_remaining: 0, usage: 0, is_free_tier: true, free_model_daily_requests: { used: state.freeUsed, limit: 50, remaining: 50 - state.freeUsed } } });
    }
    if (req.url !== "/api/v1/chat/completions" || req.method !== "POST") return send(404, { error: { code: 404, message: "Not found" } });
    const body = JSON.parse(raw || "{}");
    state.requests.push({ headers: req.headers, body, raw });
    if (!authed) return send(401, { error: { code: 401, message: "No auth credentials found" } });
    if (state.mode === "429") return send(429, { error: { code: 429, message: "Rate limit exceeded: free-models-per-day", metadata: { error_type: "rate_limit_exceeded" } } });
    const SUPPORTED = ["models", "messages", "max_tokens", "temperature", "tools", "tool_choice", "response_format", "provider"];
    if (body.provider?.require_parameters && Object.keys(body).some((k) => !SUPPORTED.includes(k)))
      return send(404, { error: { code: 404, message: "No endpoints found that can handle the requested parameters." } });
    state.freeUsed++;
    const models = body.models || [body.model];
    const model = models[0];
    const reply = (message, finish = "stop") =>
      send(200, { id: `gen-fake-${state.requests.length}`, model, choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }], usage: { prompt_tokens: 700, completion_tokens: 90, total_tokens: 790, cost: 0 } });
    const text = (t) => reply({ content: t });
    const system = (body.messages || []).find((m) => m.role === "system")?.content || "";

    // Admin model check: the Gemma models call the tool, the others answer in words.
    if ((body.tools || []).some((t) => t.function?.name === "record_budget")) {
      if (/gemma/.test(model)) return reply({ content: null, tool_calls: [{ id: "call_check", type: "function", function: { name: "record_budget", arguments: '{"budget":1200}' } }] }, "tool_calls");
      return text("Your budget is $1,200 a month.");
    }
    // Assistant chat: directives in the student's last message.
    if (body.tools?.length) {
      const msgs = body.messages;
      let start = msgs.length - 1;
      while (start >= 0 && msgs[start].role !== "user") start--;
      const said = start >= 0 ? String(msgs[start].content) : "";
      const step = msgs.slice(start + 1).filter((m) => m.role === "assistant").length;
      const directives = [...said.matchAll(/\[\[(\w+)(?:\s+([\s\S]*?))?\]\]/g)].map((m) => ({ name: m[1], arg: m[2] }));
      const d = directives[step] || { name: "reply", arg: "Hi from the free test model. What's your monthly budget?" };
      if (d.name === "tool_text") return text('update_memory {"budget_max": 1000}');
      // A price that appears nowhere in the student's message or the tool results, to test the number check.
      if (d.name === "invented_price") return text("Noted, up to $1,200 a month. R1 costs $7,777 a month. When do you want to move in?");
      if (d.name === "reply" || body.tool_choice === "none") return text(d.name === "reply" ? d.arg : "Stopping here.");
      return reply({ content: "", tool_calls: [{ id: `call_${state.requests.length}`, type: "function", function: { name: d.name, arguments: d.arg || "{}" } }] }, "tool_calls");
    }
    // Helpers
    if (/housing questionnaire/.test(system)) return text('```json\n{"budget_max": 1200, "move_in_month": "2027-06", "area": "Moody Street", "pets": "no_pets", "sleep_schedule": "sideways", "rooms_needed": "two"}\n```');
    if (/search filters/.test(system)) return text('{"hood": "the highlands", "kind": "studio", "max_rent": 1500, "furnished": true, "lease": "forever", "rooms": 7}');
    if (/first message from one university student/.test(system)) return text("Hi {name}! I saw we both like a quiet home and keep things tidy. Call me at 617-555-0100. Want to talk about rooming together?");
    if (/listing description/.test(system)) return text("Bright, quiet room with a big window and a shared kitchen. Rent is just $999 with free parking! It's at 14 Elm Street. Email me at owner@example.test. Great for a grad student who likes a calm house.");
    if (/Group these anonymous comments/.test(system)) return text('{"themes":[{"title":"Hard to find roommates","count":2,"summary":"People want an easier way to meet compatible roommates. Contact me at x@y.test"},{"title":"Prices","count":99,"summary":"Rents feel high near campus."}]}');
    return text("I'm not sure.");
  });
  server.listen(port, "127.0.0.1");
  return { state, close: () => server.close() };
}
