// Sign-in with Google, and with email and password, handled by Better Auth (https://www.better-auth.com).
// One account system: users, Google links, password hashes, sessions, email-confirmation and reset tokens,
// OAuth state and rate-limit counters live in the D1 database bound as DB. See ACCOUNTS_SETUP.md.
// Email and password accounts are only on when coHabit can send email (src/email.js); otherwise only Google.
import { betterAuth } from "better-auth";
import { emails, mailer } from "./email.js";
import { hashPassword, iterationsFrom, verifyPassword } from "./password.js";

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

// Which side someone chose on the sign-up form. Read only on the email sign-up endpoint; the Worker has already
// checked the value (src/index.js), and nothing else can set an account type except the one-time choice.
const SIGNUP_TYPES = new Set(["renter", "landlord"]);
const signupFields = (ctx) => {
  if (ctx?.path !== "/sign-up/email") return { accountType: null, occupation: null, company: null };
  const as = SIGNUP_TYPES.has(ctx.body?.signupAs) ? ctx.body.signupAs : null;
  return {
    accountType: as,
    occupation: as === "renter" ? ctx.body?.occupation ?? null : null,
    company: as === "landlord" ? ctx.body?.company ?? null : null,
  };
};

export function authOptions(env) {
  const mail = mailer(env);
  const iterations = iterationsFrom(env);
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
        // Optional answers from the email sign-up form (checked by the Worker first; Google sign-ups leave them empty).
        occupation: { type: "string", required: false, input: true },
        company: { type: "string", required: false, input: true },
      },
    },
    // Email and password: only when an email can be sent, because new accounts must confirm their email.
    emailAndPassword: {
      enabled: !!mail,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60, // a reset link works once, for 1 hour
      revokeSessionsOnPasswordReset: true,
      password: { hash: (password) => hashPassword(password, iterations), verify: verifyPassword },
      sendResetPassword: async ({ user, url }) => mail && mail.send(emails.reset(user, url)),
      // Signing up with an email that already has an account gets the same answer as a new sign-up; the owner of
      // that email is told instead, so the form never reveals who has an account.
      onExistingUserSignUp: async ({ user }) => mail && mail.send(emails.alreadyRegistered(user, env.BETTER_AUTH_URL)),
      // The reset link went to their inbox, so the email is confirmed too.
      onPasswordReset: async ({ user }) => {
        await env.DB.prepare(`UPDATE "user" SET "emailVerified" = 1, "updatedAt" = ?2 WHERE id = ?1`).bind(user.id, new Date().toISOString()).run();
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true, // signing in before confirming sends a fresh link
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: async ({ user, url }) => mail && mail.send(emails.verify(user, url)),
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
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 10 },
        "/send-verification-email": { window: 60, max: 5 },
        "/verify-email": { window: 60, max: 10 },
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
          // Whatever arrives, a new user starts as an ordinary user with no photo. Only the email sign-up form sets
          // an account type (renter or landlord) and its optional answers; Google sign-ups choose a type afterwards.
          before: async (user, ctx) => ({ data: { ...user, image: null, role: "user", ...signupFields(ctx) } }),
        },
        update: {
          before: async (user) => {
            const { role, accountType, image, occupation, company, ...rest } = user;
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
