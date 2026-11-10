// Local preview only: runs the OpenRouter stand-in (tests/fake-openrouter.mjs) so the AI features can be tried on
// `wrangler dev` without calling OpenRouter. Start it, then run wrangler dev with
//   --var openrouter-api-key:test-openrouter-key-for-local-tests-only
//   --var OPENROUTER_BASE_URL:http://127.0.0.1:8796/api/v1
// (the address is only honored for a localhost site). Usage: node tests/fake-openrouter-preview.mjs [port]
import { startFakeOpenRouter } from "./fake-openrouter.mjs";

const port = Number(process.argv[2] || 8796);
startFakeOpenRouter(port);
console.log(`OpenRouter stand-in on http://127.0.0.1:${port}/api/v1`);
