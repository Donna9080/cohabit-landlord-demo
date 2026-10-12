// A stand-in for Anthropic's Messages API, used only by `npm test` (never by the real site).
// It records every request so the tests can check what would have been sent to the AI service,
// and it follows directives written in the test's chat message:
//   [[update_memory {...}]]  [[search_rooms]]  [[search_roommates]]  [[propose_action {...}]]
//   [[reply text]]  ends the turn with that text      [[refuse]]  answers with stop_reason "refusal"
//   [[invented_price]] / [[only_invented]]  replies containing prices that no tool returned
// Each directive is one model step; tool results come back before the next one runs.
import { createServer } from "node:http";

export function startFakeAnthropic(port) {
  const state = { mode: "ok", requests: [] };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", "request-id": "req_fake" });
      res.end(JSON.stringify(body));
    };
    if (!req.url.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "Not found" } });
    const body = JSON.parse(raw || "{}");
    state.requests.push({ url: req.url, headers: req.headers, body, raw });
    if (state.mode === "down") return send(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    if (req.headers["x-api-key"] !== "test-key-for-local-tests-only") return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });

    // This turn starts at the last student message (plain text); count the model steps since then.
    const msgs = body.messages || [];
    let start = msgs.length - 1;
    while (start >= 0 && !(msgs[start].role === "user" && typeof msgs[start].content === "string")) start--;
    const text = start >= 0 ? msgs[start].content : "";
    const step = msgs.slice(start + 1).filter((m) => m.role === "assistant").length;
    const directives = [...text.matchAll(/\[\[(\w+)(?:\s+([\s\S]*?))?\]\]/g)].map((m) => ({ name: m[1], arg: m[2] }));
    const d = directives[step] || { name: "reply", arg: "Hello from the test model. What's your monthly budget?" };

    const message = (content, stop_reason) =>
      send(200, {
        id: `msg_fake_${state.requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "thinking", thinking: "", signature: "fake-signature" }, ...content],
        stop_reason,
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400 },
      });
    if (d.name === "refuse") return message([], "refusal");
    // Replies with numbers that appear nowhere in the student's message, to test the grounding check.
    if (d.name === "invented_price") return message([{ type: "text", text: "R1 costs $7,777 a month. It is close to the commuter rail station." }], "end_turn");
    if (d.name === "only_invented") return message([{ type: "text", text: "$8,888." }], "end_turn");
    if (d.name === "reply" || body.tool_choice?.type === "none") return message([{ type: "text", text: d.name === "reply" ? d.arg : "Stopping here." }], "end_turn");
    return message([{ type: "tool_use", id: `toolu_fake_${state.requests.length}`, name: d.name, input: d.arg ? JSON.parse(d.arg) : {} }], "tool_use");
  });
  server.listen(port, "127.0.0.1");
  return { state, close: () => server.close() };
}
