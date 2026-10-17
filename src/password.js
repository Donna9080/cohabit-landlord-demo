// Password hashing for email and password accounts, with the Web Crypto API built into Workers.
// PBKDF2-SHA256 with a random 16-byte salt per password. Each stored hash records its own settings
// ("pbkdf2-sha256$<iterations>$<salt>$<hash>"), so the iteration count can be raised later without breaking
// existing passwords. Better Auth's default (scrypt in plain JavaScript) is far too slow for a Worker.
//
// Cost: about 20 ms of CPU per password check at 100,000 iterations. The Workers Free plan allows 10 ms of CPU
// per request, so check this on the live site before turning password sign-in on (see ACCOUNTS_SETUP.md).

const PREFIX = "pbkdf2-sha256";
export const DEFAULT_ITERATIONS = 100_000;
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 1_000_000;

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export const iterationsFrom = (env) => {
  const n = Number(env?.PASSWORD_HASH_ITERATIONS);
  return Number.isInteger(n) && n >= MIN_ITERATIONS && n <= MAX_ITERATIONS ? n : DEFAULT_ITERATIONS;
};

export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${PREFIX}$${iterations}$${toB64(salt)}$${toB64(await derive(password, salt, iterations))}`;
}

export async function verifyPassword({ hash, password }) {
  const [prefix, iterations, salt, expected] = String(hash || "").split("$");
  const n = Number(iterations);
  if (prefix !== PREFIX || !Number.isInteger(n) || n < MIN_ITERATIONS || n > MAX_ITERATIONS || !salt || !expected) return false;
  const got = await derive(password, fromB64(salt), n);
  const want = fromB64(expected);
  // Compare every byte, so the time taken doesn't reveal where they differ.
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.max(got.length, want.length); i++) diff |= (got[i] ?? 0) ^ (want[i] ?? 0);
  return diff === 0;
}
