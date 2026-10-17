// Account emails: confirm your email, reset your password, and "you already have an account".
//
// coHabit has no email provider yet, so on the live site these can't be sent and password sign-up stays off
// (Google sign-in works as before). For local development and tests, DEV_EMAIL_OUTBOX=1 (only ever set locally)
// keeps each email in a local test inbox instead of sending it: GET /api/dev/outbox, shown at /dev/inbox.
// What a provider would need is in ACCOUNTS_SETUP.md ("Email and password accounts").

// The local test inbox only runs on a local address, even if the variable were set by mistake elsewhere.
export const devOutboxOn = (env) => env.DEV_EMAIL_OUTBOX === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.BETTER_AUTH_URL || "");

// Returns a sender, or null when there is no way to send email (so email sign-up and resets stay off).
// No email provider is set up yet; one would be added here.
export function mailer(env) {
  if (devOutboxOn(env)) return { kind: "local test inbox", send: (msg) => saveToOutbox(env.DB, msg) };
  return null;
}

// Email and password accounts are on only where an email can be sent and, outside local development, only when
// the owner switches them on (PASSWORD_ACCOUNTS=on) after checking delivery and speed on the live site.
export const passwordAccountsOn = (env) => !!mailer(env) && (devOutboxOn(env) || env.PASSWORD_ACCOUNTS === "on");

async function saveToOutbox(db, { to, subject, text }) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS dev_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`INSERT INTO dev_outbox (to_email, subject, body, created_at) VALUES (?1, ?2, ?3, ?4)`).bind(to.toLowerCase(), subject, text, Date.now()),
  ]);
  console.log(`[local test inbox] to ${to}: ${subject}`);
}

export async function readOutbox(db, to) {
  try {
    const { results } = await db
      .prepare(`SELECT id, to_email AS "to", subject, body, created_at AS "createdAt" FROM dev_outbox ${to ? "WHERE to_email = ?1" : ""} ORDER BY id DESC LIMIT 50`)
      .bind(...(to ? [to.toLowerCase()] : []))
      .all();
    return results;
  } catch {
    return []; // nothing sent yet
  }
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const sign = "\n\nThe coHabit team\n\nYou're getting this because someone entered this email address on coHabit. If it wasn't you, you can ignore it.";

export const emails = {
  verify: (user, url) => ({
    to: user.email,
    subject: "Confirm your email to finish signing up for coHabit",
    text: `Hi ${firstName(user.name)},\n\nConfirm your email to finish creating your coHabit account:\n\n${url}\n\nThe link works once and expires in 24 hours.${sign}`,
  }),
  reset: (user, url) => ({
    to: user.email,
    subject: "Reset your coHabit password",
    text: `Hi ${firstName(user.name)},\n\nUse this link to choose a new password:\n\n${url}\n\nThe link works once and expires in 1 hour. Your password stays the same until you choose a new one.${sign}`,
  }),
  alreadyRegistered: (user, origin) => ({
    to: user.email,
    subject: "You already have a coHabit account",
    text: `Hi ${firstName(user.name)},\n\nSomeone tried to create a coHabit account with this email, but you already have one. Sign in here:\n\n${origin}/signin\n\nIf you usually use Google, choose "Continue with Google". To set a password, choose "Forgot password?" on the sign-in page.${sign}`,
  }),
};
