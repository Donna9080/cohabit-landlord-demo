// AI helpers on OpenRouter's free models, and the admin's AI tools (docs/OPENROUTER_PLAN.md).
//
//   POST /api/ai/help          { task, ... } for signed-in people, while the admin's "helpers" switch is on:
//     preferences       renters: a sentence -> values for the My matches questionnaire (checked like the form)
//     listing_filters   a sentence -> filters for the demo listings (only listed values are kept)
//     intro             renters: a draft first message for Connect, from what the two have in common
//     unit_description  landlords: a clearer description from the unit's own facts
//   GET  /api/admin/ai         switches, today's free requests, models, last check (admin)
//   POST /api/admin/ai         { chat?, helpers?, resume? } switch AI on or off (admin, recorded)
//   POST /api/admin/ai/check   one short tool-calling test per chosen model (admin)
//   POST /api/admin/ai/themes  themes in the Quick check-in comments (admin)
//
// The model only writes; nothing is saved or sent until the person does it. What it returns is checked: only allowed
// values, no invented numbers, and no email addresses, phone numbers, links or street addresses. Nobody's name,
// email, account id or address is sent to it (an intro draft uses "{name}", filled in here afterwards).
import { HOODS } from "../assistant/demo-base.js";
import { allowedNumbers, groundReply } from "../assistant/ai.js";
import { applyUpdates, emptyMemory } from "../assistant/memory.js";
import { HttpError, rateLimit, readJson } from "../http.js";
import { EMAIL, InvalidInput, PHONE, hasAddress } from "../validate.js";
import { aiBlock, aiBudget, aiSettings, countHelperUse, countRequests, helperUsesToday, pauseStatement, setSetting } from "./budget.js";
import { OpenRouterError, chatCompletion, isFreeModel, keyStatus, modelsFor, openRouterConfigured, replyText } from "./openrouter.js";

const today = () => new Date().toISOString().slice(0, 10);
const HOOD_NAMES = Object.values(HOODS).map((h) => h.name);
const KINDS = ["Private room", "Shared room", "Studio", "Whole apartment", "Sublet", "Lease takeover", "Replacing a roommate"];
const LIFESTYLE = {
  sleep_schedule: ["early", "flexible", "late"],
  cleanliness: ["relaxed", "average", "tidy"],
  noise: ["quiet", "moderate", "lively"],
  guests: ["rarely", "sometimes", "often"],
  pets: ["no_pets", "ok_with_pets", "have_pets"],
  smoking: ["no_smoking", "outside_ok", "smoker"],
};
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

const UNAVAILABLE = {
  not_configured: "AI help isn't set up on this site.",
  off: "AI help is switched off right now.",
  paused: "AI help has reached today's free limit. Try again tomorrow (UTC).",
  site_limit: "AI help has reached today's limit for coHabit. Try again tomorrow (UTC).",
  person_limit: "You've used today's AI help. Try again tomorrow (UTC).",
  failed: "AI help didn't work this time. Try again in a moment, or fill it in yourself.",
};
const unavailable = (reason) => new HttpError(409, "ai_unavailable", UNAVAILABLE[reason] || UNAVAILABLE.failed);

const shortText = (body, field, { max, required = false }) => {
  const v = body?.[field];
  if (v == null || v === "") {
    if (required) throw new InvalidInput(field, "Write a sentence first.");
    return "";
  }
  if (typeof v !== "string") throw new InvalidInput(field, "Must be text.");
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (required && s.length < 3) throw new InvalidInput(field, "Write a sentence first.");
  if (s.length > max) throw new InvalidInput(field, `Keep it under ${max} characters.`);
  if (EMAIL.test(s) || PHONE.test(s)) throw new InvalidInput(field, "Leave out email addresses and phone numbers.");
  if (hasAddress(s)) throw new InvalidInput(field, "Leave out street addresses and ZIP codes. A town or neighborhood is fine.");
  return s;
};

// A JSON object from a model reply (some wrap it in a code block or add a sentence).
function jsonFrom(message) {
  const text = replyText(message);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Written text: no contact details, links or addresses, and only numbers that were in the input.
function cleanWriting(text, sources, max) {
  // Sentences with contact details, links or an address are dropped whole; then any sentence with a number that
  // wasn't in the input (the assistant's own check).
  const kept = String(text || "")
    .replace(/\*\*|__|^#+\s*/gm, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => s.trim() && !hasAddress(s) && !PHONE.test(s) && !EMAIL.test(s) && !new RegExp(URL_RE.source, "i").test(s))
    .join(" ");
  let t = groundReply(kept, allowedNumbers(sources)).text.replace(/[ \t]{2,}/g, " ").trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "").trim();
  return t.length >= 20 ? t : null;
}

// One helper request: counted against today's free requests and the person's helper uses.
async function helperCall(env, db, user, args) {
  const writes = [countHelperUse(db, user.id)];
  try {
    const out = await chatCompletion(env, { use: "helper", maxTokens: 500, temperature: 0.4, timeoutMs: 20_000, ...args });
    writes.push(countRequests(db, "helper", 1, out.usage));
    return out;
  } catch (e) {
    writes.push(countRequests(db, "helper", 1));
    if (e instanceof OpenRouterError) {
      console.error("AI helper unavailable:", e.reason, e.status || "", e.detail);
      if (e.reason === "rate_limited") writes.push(pauseStatement(db, e.retryAfter));
      throw unavailable("failed");
    }
    throw e;
  } finally {
    await db.batch(writes);
  }
}

const TASKS = {
  async preferences({ env, db, user, body }) {
    const text = shortText(body, "text", { max: 300, required: true });
    const out = await helperCall(env, db, user, {
      json: true,
      messages: [
        {
          role: "system",
          content: `Turn a student's sentence into a JSON object for a housing questionnaire. Today is ${today()}. Use only what the sentence says; leave out anything it doesn't say. Keys: budget_max (integer, US dollars a month), budget_min (integer), move_in_month ("YYYY-MM"; if no year is given, the next such month from today), area (one Massachusetts town or neighborhood, never a street address), rooms_needed (integer), ${Object.entries(LIFESTYLE).map(([k, v]) => `${k} (${v.join(" | ")})`).join(", ")}. Reply with the JSON object only.`,
        },
        { role: "user", content: text },
      ],
    });
    const j = jsonFrom(out.message) || {};
    const input = {};
    for (const k of ["budget_max", "budget_min", "move_in_month", "rooms_needed", ...Object.keys(LIFESTYLE)]) if (j[k] != null && j[k] !== "") input[k] = j[k];
    if (typeof j.area === "string" && j.area.trim()) input.areas = [j.area.trim()];
    // Checked exactly like answers in the chat: wrong types, past months, addresses and unknown values are dropped.
    const r = applyUpdates(emptyMemory(), input, today());
    const v = r.memory.v;
    const fields = { ...Object.fromEntries(["budget_max", "budget_min", "move_in_month", "rooms_needed", ...Object.keys(LIFESTYLE)].filter((k) => v[k] != null).map((k) => [k, v[k]])) };
    if (v.areas?.length) fields.area = v.areas.join(", ").slice(0, 80);
    if (!Object.keys(fields).length) throw new HttpError(422, "nothing_found", "Couldn't find a budget, month, area or lifestyle answer in that. Try saying it another way.");
    return { fields, model: out.model };
  },

  async listing_filters({ env, db, user, body }) {
    const text = shortText(body, "text", { max: 300, required: true });
    const out = await helperCall(env, db, user, {
      json: true,
      messages: [
        {
          role: "system",
          content: `Turn a person's sentence about the room they want in Waltham into search filters, as a JSON object. Today is ${today()}. Use only what the sentence says; leave out anything it doesn't say. Keys: hood (one of: ${HOOD_NAMES.join(", ")}), kind (one of: ${KINDS.join(", ")}), max_rent (integer, US dollars a month per person), move_in_month ("YYYY-MM"; if no year is given, the next such month from today), lease ("short" up to 6 months, "academic" 7 to 10 months, "year" a year or more), furnished (true or false), rooms (2 or 3, only if they need that many rooms in one place). Reply with the JSON object only.`,
        },
        { role: "user", content: text },
      ],
    });
    const j = jsonFrom(out.message) || {};
    const f = {};
    const plain = (s) => String(s || "").toLowerCase().replace(/^the\s+/, "").trim();
    const hood = HOOD_NAMES.find((h) => plain(h) === plain(j.hood));
    if (hood) f.hood = hood;
    const kind = KINDS.find((k) => k.toLowerCase() === String(j.kind || "").toLowerCase().trim());
    if (kind) f.kind = kind;
    const rent = Math.round(Number(j.max_rent));
    if (Number.isFinite(rent) && rent >= 100 && rent <= 20000) f.maxRent = rent;
    const r = applyUpdates(emptyMemory(), j.move_in_month ? { move_in_month: j.move_in_month } : {}, today());
    if (r.memory.v.move_in_month) f.month = r.memory.v.move_in_month;
    if (["short", "academic", "year"].includes(j.lease)) f.lease = j.lease;
    if (typeof j.furnished === "boolean") f.furnished = String(j.furnished);
    if ([2, 3].includes(Number(j.rooms))) f.rooms = String(Number(j.rooms));
    if (!Object.keys(f).length) throw new HttpError(422, "nothing_found", "Couldn't turn that into filters. Try naming a neighborhood, a rent or a month.");
    return { filters: f, model: out.model };
  },

  async intro({ env, db, user, body }) {
    const first = typeof body?.firstName === "string" ? body.firstName.trim() : "";
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{0,29}$/.test(first)) throw new InvalidInput("firstName", "A first name is needed.");
    const shared = (Array.isArray(body?.shared) ? body.shared : []).slice(0, 6).map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 80) : "")).filter((s) => s && !EMAIL.test(s) && !PHONE.test(s));
    const note = shortText(body, "note", { max: 200 });
    const out = await helperCall(env, db, user, {
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content:
            'Write a short, friendly first message from one university student to another who might become their roommate. 2 to 4 sentences, under 80 words, plain text. Start with exactly "Hi {name}!" using the literal placeholder {name}. Mention one or two of the things they have in common from the list. Don\'t invent facts, numbers, places or dates. No email addresses, phone numbers, links or addresses. End by suggesting they talk about rooming together.',
        },
        { role: "user", content: `Things we have in common: ${shared.join("; ") || "we're both looking for a roommate"}.${note ? `\nSomething I'd like to mention: ${note}` : ""}` },
      ],
    });
    let text = cleanWriting(replyText(out.message), [...shared, note], 500);
    if (!text) throw unavailable("failed");
    text = text.replace(/\{name\}/gi, first);
    if (!text.includes(first)) text = `Hi ${first}! ${text}`.slice(0, 500);
    return { text, model: out.model };
  },

  async unit_description({ env, db, user, body }) {
    const facts = {
      name: shortText(body, "name", { max: 80 }),
      area: shortText(body, "area", { max: 80 }),
      monthly_rent: Number.isFinite(Number(body?.monthly_rent)) && Number(body.monthly_rent) > 0 ? Math.round(Number(body.monthly_rent)) : null,
      rooms_available: Number.isInteger(Number(body?.rooms_available)) && Number(body.rooms_available) > 0 ? Number(body.rooms_available) : null,
      move_in_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.move_in_date || "")) ? body.move_in_date : null,
      description: shortText(body, "description", { max: 1000 }),
    };
    if (!facts.description && !facts.name) throw new InvalidInput("description", "Write a few words about the place first.");
    const out = await helperCall(env, db, user, {
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content:
            "Rewrite a landlord's room listing description for university students: clear, friendly and honest, 2 to 5 sentences, under 120 words, plain text. Use only the facts given. Don't add amenities, prices, distances, dates or rules that aren't given. No street address, phone number, email or link. Don't mention the rent or move-in date (they're shown separately).",
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    });
    const text = cleanWriting(replyText(out.message), [JSON.stringify(facts)], 1000);
    if (!text) throw unavailable("failed");
    return { text, model: out.model };
  },
};

// Who each helper is for (null: anyone signed in).
const TASK_FOR = { preferences: "renter", listing_filters: null, intro: "renter", unit_description: "landlord" };

export async function handleAiHelp({ request, env, db, user }) {
  const body = await readJson(request);
  const task = TASKS[body?.task];
  if (!task) throw new InvalidInput("task", "Unknown kind of help.");
  const only = TASK_FOR[body.task];
  if (only && user.accountType !== only) throw new HttpError(403, "forbidden", only === "renter" ? "This is for renters." : "This is for landlords.");
  const block = await aiBlock(env, db, "helper", 1);
  if (block) throw unavailable(block);
  if ((await helperUsesToday(db, user.id)) >= aiBudget(env).helperPerUser) throw unavailable("person_limit");
  await rateLimit(env, `h:u:${user.id}`, 3, "Wait a moment before asking again.");
  return task({ env, db, user, body });
}

// ── Admin ────────────────────────────────────────────────────────────────────
const CHECK_TOOL = [
  {
    type: "function",
    function: {
      name: "record_budget",
      description: "Record the student's monthly budget in US dollars.",
      parameters: { type: "object", additionalProperties: false, properties: { budget: { type: "integer" } }, required: ["budget"] },
    },
  },
];

async function adminCall(env, db, args) {
  try {
    const out = await chatCompletion(env, args);
    await countRequests(db, "admin", 1, out.usage).run();
    return { out };
  } catch (e) {
    await countRequests(db, "admin", 1).run();
    if (e instanceof OpenRouterError) {
      if (e.reason === "rate_limited") await pauseStatement(db, e.retryAfter).run();
      return { error: e };
    }
    throw e;
  }
}

export async function handleAdminAi({ request, env, db, admin, path, method, reply }) {
  const audit = (action, detail) =>
    db.prepare(`INSERT INTO admin_audit (id, admin_user_id, action, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(crypto.randomUUID(), admin.id, action, detail, Date.now());
  const status = async () => {
    const [s, key] = await Promise.all([aiSettings(db), keyStatus(env, { fresh: true })]);
    return {
      configured: openRouterConfigured(env),
      switches: { chat: s.chat, helpers: s.helpers },
      pausedUntil: s.pausedUntil,
      lastModel: s.lastModel,
      lastCheck: s.lastCheck,
      models: { chat: modelsFor(env, "chat"), helper: modelsFor(env, "helper"), summary: modelsFor(env, "summary") },
      budget: aiBudget(env),
      openRouter: key,
    };
  };
  if (path === "/api/admin/ai" && method === "GET") return reply(await status());

  if (path === "/api/admin/ai" && method === "POST") {
    const body = await readJson(request);
    const writes = [];
    for (const k of ["chat", "helpers"]) {
      if (body?.[k] === undefined) continue;
      if (typeof body[k] !== "boolean") throw new InvalidInput(k, "Must be true or false.");
      if (body[k] && !openRouterConfigured(env)) throw new HttpError(409, "not_configured", "There's no OpenRouter key on this site.");
      writes.push(setSetting(db, `ai_${k}`, body[k] ? "1" : "0"), audit(`ai_${k}_${body[k] ? "on" : "off"}`, null));
    }
    if (body?.resume === true) writes.push(setSetting(db, "ai_paused_until", new Date(0).toISOString()), audit("ai_resume", null));
    if (!writes.length) throw new InvalidInput("chat", "Nothing to change.");
    await db.batch(writes);
    return reply(await status());
  }

  if ((path === "/api/admin/ai/check" || path === "/api/admin/ai/themes") && method === "POST") {
    if (!openRouterConfigured(env)) throw new HttpError(409, "not_configured", "There's no OpenRouter key on this site.");
    const block = await aiBlock(env, db, "admin", 1);
    if (block && block !== "off") throw unavailable(block);
  }

  // One short tool-calling test per chosen model (not the free router), each sent to that model only.
  if (path === "/api/admin/ai/check" && method === "POST") {
    const ids = [...new Set([...modelsFor(env, "chat"), ...modelsFor(env, "helper"), ...modelsFor(env, "summary")])].filter((m) => m !== "openrouter/free" && isFreeModel(m));
    const left = aiBudget(env).admin - ((await db.prepare(`SELECT replies FROM assistant_usage WHERE day = ?1 AND user_id = 'or:admin'`).bind(today()).first())?.replies || 0);
    const results = [];
    for (const model of ids.slice(0, Math.max(0, left))) {
      const t = Date.now();
      const { out, error } = await adminCall(env, db, {
        models: [model],
        messages: [
          { role: "system", content: "You are being tested. Use the record_budget tool to record what the student says." },
          { role: "user", content: "My budget is $1,200 a month." },
        ],
        tools: CHECK_TOOL,
        maxTokens: 200,
        timeoutMs: 25_000,
      });
      const call = out?.message?.tool_calls?.[0];
      let args = null;
      try {
        args = call ? JSON.parse(call.function?.arguments || "{}") : null;
      } catch {}
      results.push({
        model,
        answeredBy: out?.model || null,
        ok: !!out,
        toolCall: call?.function?.name === "record_budget" && Number(args?.budget) === 1200,
        seconds: Math.round((Date.now() - t) / 100) / 10,
        problem: error ? error.reason : !call ? "answered without using the tool" : null,
      });
    }
    const check = { at: new Date().toISOString(), results, skipped: ids.length - results.length };
    await db.batch([setSetting(db, "ai_last_check", JSON.stringify(check)), audit("ai_check_models", `${results.length} models`)]);
    return reply({ check, status: await status() });
  }

  // Themes in the Quick check-in comments. Comments are anonymous; contact details are removed from the output.
  if (path === "/api/admin/ai/themes" && method === "POST") {
    const { results } = await db
      .prepare(`SELECT comment FROM survey_responses WHERE comment IS NOT NULL AND comment != '' AND demo = 0 ORDER BY created_at DESC LIMIT 150`)
      .all();
    const comments = results.map((r) => String(r.comment).replace(new RegExp(EMAIL.source, "g"), "").slice(0, 500));
    if (comments.length < 3) throw new HttpError(409, "too_few", `There are ${comments.length} comments so far. Themes need at least 3.`);
    let total = 0;
    const listed = comments.filter((c) => (total += c.length) < 24_000);
    const { out, error } = await adminCall(env, db, {
      use: "summary",
      json: true,
      maxTokens: 900,
      timeoutMs: 40_000,
      messages: [
        {
          role: "system",
          content:
            'Group these anonymous comments from a student housing site\'s feedback survey into at most 6 themes. For each theme: a short title (under 8 words), how many of the comments mention it, and a one-sentence summary. Don\'t quote names, emails, phone numbers or addresses. Reply with JSON only: {"themes":[{"title":"...","count":1,"summary":"..."}]}',
        },
        { role: "user", content: listed.map((c, i) => `${i + 1}. ${c}`).join("\n") },
      ],
    });
    if (error) throw unavailable("failed");
    const j = jsonFrom(out.message);
    const scrub = (s, max) => String(s || "").replace(new RegExp(EMAIL.source, "g"), "").replace(URL_RE, "").slice(0, max).trim();
    const themes = (Array.isArray(j?.themes) ? j.themes : [])
      .slice(0, 6)
      .map((t) => ({ title: scrub(t?.title, 60), count: Math.max(0, Math.min(listed.length, Math.round(Number(t?.count) || 0))), summary: scrub(t?.summary, 220) }))
      .filter((t) => t.title && !PHONE.test(t.summary));
    if (!themes.length) throw unavailable("failed");
    await audit("ai_checkin_themes", `${listed.length} comments`).run();
    return reply({ themes, comments: listed.length, model: out.model });
  }
  throw new HttpError(404, "not_found", "Not found.");
}

// For /api/config: whether helper buttons should show (configured, switched on, not paused for the day).
export async function helpersAvailable(env, db) {
  if (!openRouterConfigured(env)) return false;
  const s = await aiSettings(db);
  return s.helpers && !s.pausedUntil;
}
