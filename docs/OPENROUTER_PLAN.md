# Plan: free AI models through OpenRouter (for approval)

**Status, 2026-11-10: approved by the owner and built locally (steps 1-4, plus the helpers and admin tools of steps 7
and 8, all switched off).** Not deployed; no request has been sent to OpenRouter with your key. Next: step 5 (deploy
with AI off, then the admin model check), which needs the owner's approval. One change from the plan: each request
lists at most three models (chat: Gemma 4 31B, Nemotron 3.5 Super, then the free router), to stay within what
OpenRouter's fallback list is documented to handle; Gemma 4 26B leads the helpers.

## 1. What the audit found

**Your key.** The Worker has a secret named `openrouter-api-key` (only the name was checked, never the value). As a
secret it survives deploys and is only readable on the server. The code will read it as `env["openrouter-api-key"]`;
it is never sent to browsers, logs or the database.

**What already exists.** The assistant (`/assistant`) has a complete AI mode that was never switched on because there
was no Anthropic key (`src/assistant/ai.js`):
- The model only writes the wording. Search results, scores and what fits come from coHabit's code, through tools
  (`update_memory`, `search_rooms`, `search_roommates`, `propose_action`).
- Every answer the model records is checked like a form. Nothing is saved or sent without the student's Confirm.
- Invented numbers are removed before a reply is shown.
- Daily limits, and the guided (basic) chat as the fallback whenever AI is unavailable.

OpenRouter can plug into this design without changing those rules.

**OpenRouter's free models** (live list, 2026-11-10): 16 of 469 models cost $0. Their docs say:
- **Limits:** 20 requests a minute and **50 requests a day for the whole account**, across all free models and keys.
  It rises to 1,000 a day once at least $10 of credits has ever been bought. Over the limit, requests fail with 429.
- **Data:** OpenRouter stores no prompts by default. Free models' providers may log or train on prompts. Requests are
  only routed to such providers if the "model training" setting for free models is on in your OpenRouter privacy
  settings, so some free models may refuse requests while it's off.
- **Fallbacks:** a request can list several models; OpenRouter tries the next one if one fails or is rate limited.
  Listing only `:free` models keeps a request free. `openrouter/free` picks any free model that supports the request.
- **Spending:** each key can have a credit limit; OpenRouter recommends setting one.

| Free model | Context | Tool calls | Picked for |
| --- | --- | --- | --- |
| `google/gemma-4-31b-it:free` | 262k | Yes | **Chat (first choice)**: capable, follows instructions, tool calls and JSON |
| `nvidia/nemotron-3.5-super-vl:free` | 1M | Yes | **Chat (2nd)**, **admin summaries (1st)**: long input |
| `google/gemma-4-26b-a4b-it:free` | 262k | Yes | **Chat (3rd)**, **writing helpers (1st)**: faster |
| `nvidia/nemotron-3.5-lightning:free` | 1M | Yes | **Writing helpers (2nd)**: fast, short texts |
| `openrouter/free` | 200k | Yes | **Last resort everywhere**: any free model that fits |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | Yes | Spare: very large, likely slow; tested in step 5 |
| `thinkingmachines/inkling-2-small:free` | 1M | Yes | Spare: listed yesterday; tested in step 5 |
| `recursive/flint-v1.0:free`, `xingchen-agi/xing4.0-29b-a4b:free`, `dots-studio/dots-3-note-preview:free` | 262k–512k | Yes | Not picked: little-known or preview |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256k | Yes | Not picked: reasoning model, slower |
| `cohere/north-mini-code:free` | 256k | Yes | Not picked: made for code |
| `liquid/lfm-3-1.7b:free`, `liquid/lfm-2.5-2.6b:free` | 64k–262k | Yes | Not picked: too small for reliable tool use |
| `google/lyria-3-pro-preview`, `google/lyria-3-clip-preview` | | No | Not picked: music generation, not chat |

The picks come from the specs; step 5 confirms them with your key. Free models come and go, so the model lists live
in settings, not in the code, and the admin page shows which model answered.

## 2. Where people can use AI

All features follow the same rules: results come from coHabit's code; the AI only writes. Names, emails, account
ids and street addresses are never sent to it. Its output is checked (no invented numbers, no phone numbers,
emails or addresses). Nothing is saved or sent until the person confirms. When AI isn't available, the page works
as it does today.

| | Feature | Who | Phase |
| --- | --- | --- | --- |
| A | **Assistant chat** answers in plain language (today's guided chat stays as the fallback) | Renters | 1 |
| B | **"Describe what you want"** on Listings and My matches: a sentence like "furnished room near campus under $1,000 from June" fills the filters; the listings shown still come from the filters | Signed-in users | 2 |
| C | **"Help me write this"** in Connect: drafts a short intro from what the two have in common; the renter edits it before sending | Renters | 2 |
| D | **"Polish my description"** for landlords: rewrites a unit's description from its facts; checked for addresses and phone numbers; the landlord edits it before saving | Landlords | 2 |
| E | **Check-in themes**: groups the Quick check-in comments into themes with counts (comments are already anonymous) | Admin | 3 |

## 3. Staying free: the 50-request budget

- A chat reply usually takes 2–3 requests (the model asks for a search, then writes the answer). So 50 a day is about
  15–25 AI replies a day for the whole site.
- Suggested daily split:
  - Chat: up to 36 requests.
  - Helpers (B–D): up to 10.
  - Admin checks: 4.
- Suggested per person a day: 6 AI chat replies and 3 helper uses. Past a limit, the page says so and the guided chat
  or the manual form carries on.
- OpenRouter's own daily counter is the source of truth (read from OpenRouter, cached briefly). After a 429, AI pauses
  until the next UTC day. This needs no database change.
- **Hard guard:** the code refuses any model id that isn't free (`:free` or `openrouter/free`), so a paid model can't be
  called by mistake. Together with a credit limit on the key (your setting), nothing can be billed.
- Raising the limit to 1,000 a day means buying $10 of OpenRouter credits once. That costs money, so it's not in this
  plan; it's only an option for you.

## 4. Build steps

1. **OpenRouter connection** (`src/ai/openrouter.js`):
   - Sends requests to OpenRouter's chat API with your key and a fallback list of free models.
   - Converts the assistant's tools to OpenRouter's format.
   - Times out slow models, handles errors and limits (429, 402, 503), and records which model answered.
   - Never logs the key.
2. **Assistant on OpenRouter:**
   - Choose the provider from what's configured: the OpenRouter key if present; the Anthropic code stays but unused.
   - Shorter, more explicit instructions suited to smaller models, and stricter checks of what the model sends to tools.
   - The number check stays. If a reply can't be used, the guided chat answers instead.
3. **Switches and limits:**
   - On/off switches for chat and for the helpers, both **off** until step 6.
   - The daily split and per-person limits above, and the pause after a 429.
   - The admin page shows requests used and left today, the model that answered, and $0 cost.
4. **Tests:**
   - A stand-in for OpenRouter used by `npm test`, so tests make no real calls.
   - Covered: tool calls, broken tool arguments, invented numbers removed, fallbacks, 429/402/503 leading to the
     guided chat, paid model ids refused, limits, and the key never appearing in any response.
   - Then a local preview check and a local checkpoint.
5. **Live model check** (needs your approval to deploy):
   - Deploy with AI still off for users.
   - An admin-only "Check models" button sends one short tool-calling test to each picked model, about 8 free requests
     in all.
   - It reports whether the key works, the data setting allows free models, tool calls work, and how long each took.
   - Then I set the final model order.
6. **Turn on the chat** (needs your approval):
   - Switch AI chat on for renters.
   - Update the privacy page and add a short note in the chat: replies come from free third-party models through
     OpenRouter, which may keep messages to improve their models, so don't share personal details.
   - Watch usage for a few days.
7. **Phase 2 helpers** (B, C, D): built and tested locally, then deployed and switched on with your approval.
8. **Phase 3 check-in themes** (E): same process.

Each step ends with tests passing and a checkpoint. Nothing is deployed or switched on without your approval, and no
database migration is planned.

## 5. What I need from you

1. **Approve this plan** (or tell me what to change: models, features, limits).
2. **In your OpenRouter account** (you do these; I don't change account settings):
   - **Set a credit limit on this key**, the lowest it allows ($0 if accepted), so it can never spend money.
   - **Decide on the privacy setting for free models.** Switching on "model training" for free models lets their
     providers keep and use prompts; it may be required for free models to work. Step 5 shows whether it's needed.
3. **Accept the limit:** about 15–25 AI chat replies a day for the whole site, or decide later on the $10 option.
4. **Approve the privacy wording** when I send it in step 6.

## 6. Risks

- Free models can change, slow down or disappear. Mitigated by the fallback list, settings rather than code, and the
  guided chat.
- Quality is below paid models, so tool calls may sometimes be wrong. The checks reject bad tool calls and the guided
  chat answers instead.
- 50 requests a day runs out quickly if the pilot grows. The page then says so, and the guided chat carries on.
- Privacy: prompts may be kept by free models' providers. Only chat text, the student's answers and listing details
  are sent (never names, emails, ids or addresses), and the privacy page will say so.
- Text in a listing could try to instruct the model. Results only come from code, and nothing is saved or sent
  without the person's Confirm.
