// Sign-in with Google, handled by Better Auth (https://www.better-auth.com).
// Users, Google account links, sessions, OAuth state and rate-limit counters
// live in the D1 database bound as DB. See ACCOUNTS_SETUP.md.
import { betterAuth } from "better-auth";

const DAY = 60 * 60 * 24;

// Strip Google tokens: coHabit only needs to know who signed in, not to call
// Google on the user's behalf, so nothing token-shaped is kept after login.
const noTokens = (account) => ({
  data: {
    ...account,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  },
});

export function authOptions(env) {
  return {
    appName: "coHabit",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.BETTER_AUTH_URL],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Default scopes are openid, email, profile. No offline access.
        prompt: "select_account",
      },
    },
    user: {
      additionalFields: {
        // Server-controlled. input:false means no Better Auth endpoint accepts them from the browser.
        role: { type: "string", required: false, defaultValue: "user", input: false },
        accountType: { type: "string", required: false, input: false, fieldName: "account_type" },
      },
    },
    account: {
      // One Google subject = one coHabit user. Never merge accounts because emails match.
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    session: {
      expiresIn: 7 * DAY,
      updateAge: DAY,
      // No cookie cache: every request re-reads the session and user row, so
      // sign-out, revocation and role changes take effect on the next request.
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
        "/callback/*": { window: 60, max: 20 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: env.BETTER_AUTH_URL?.startsWith("https://"),
    },
    onAPIError: { errorURL: "/signin-error" },
    databaseHooks: {
      user: {
        create: {
          // Whatever arrives, a new user starts as an ordinary user with no account type and no photo.
          before: async (user) => ({ data: { ...user, image: null, role: "user", accountType: null } }),
        },
        update: {
          before: async (user) => {
            const { role, accountType, image, ...rest } = user;
            return { data: rest };
          },
        },
      },
      account: {
        create: { before: async (account) => noTokens(account) },
        update: { before: async (account) => noTokens(account) },
      },
      session: {
        // IP is still used (in memory) for rate limiting; it is just not stored with the session.
        create: { before: async (s) => ({ data: { ...s, ipAddress: null, userAgent: null } }) },
      },
    },
    telemetry: { enabled: false },
  };
}

let cached;
export function getAuth(env) {
  // env is fixed for the life of an isolate, so build the auth object once.
  if (!cached || cached.env !== env) cached = { env, auth: betterAuth(authOptions(env)) };
  return cached.auth;
}
