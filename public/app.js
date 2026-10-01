// coHabit: screens switched by the address bar. Cloudflare serves index.html for
// every address, so refreshing any page works. Data comes from /api/* (src/index.js).
//
//   /                        Front page (public)
//   /how-it-works            How coHabit works (public)
//   /privacy, /terms         Privacy policy and terms of use (public)
//   /listings                Active units, listing fields only (public)
//   /sample, /properties/<id>  Fictional sample dashboard (public, clearly labeled)
//   /welcome                 After Google sign-in: choose landlord or renter (once)
//   /account                 Your name, email, account type; delete my account
//   /landlord                A landlord's own units
//   /landlord/units/new      Add a unit
//   /landlord/units/<id>     Edit or delete a unit
//   /renter                  A renter's match preferences and matching units
//   /admin                   Read-only user list (admins only; enforced by the server)
(function () {
  const app = document.getElementById("app");
  const brandSub = document.getElementById("brand-sub");
  const accountEl = document.getElementById("account");
  const sample = (window.COHABIT_DATA && window.COHABIT_DATA.properties) || [];

  // ── Helpers ────────────────────────────────────────────────────────────────
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (name, size) =>
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const initials = (name) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const money = (n) => "$" + Number(n).toLocaleString("en-US");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (ymd) => {
    const [y, m, d] = String(ymd).split("-").map(Number);
    return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
  };
  const fmtJoined = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };

  class ApiError extends Error {
    constructor(status, data) {
      super((data && data.message) || "Something went wrong. Please try again.");
      this.status = status;
      this.code = data && data.error;
      this.field = data && data.field;
    }
  }

  async function api(path, { method = "GET", body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, { message: "Can't reach coHabit. Check your connection and try again." });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON error page; fall through with a generic message.
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  // ── Session ────────────────────────────────────────────────────────────────
  let me = { user: null, sessionExpired: false };
  async function loadMe() {
    try {
      me = await api("/api/me");
    } catch {
      me = { user: null, sessionExpired: false };
    }
    renderAccount();
  }

  async function signIn(next) {
    const callbackURL = "/welcome" + (next ? "?next=" + encodeURIComponent(next) : "");
    try {
      const data = await api("/api/auth/sign-in/social", { method: "POST", body: { provider: "google", callbackURL } });
      if (data && data.url) location.assign(data.url);
    } catch (e) {
      alert(e.message);
    }
  }

  async function signOut() {
    try {
      await api("/api/auth/sign-out", { method: "POST", body: {} });
    } catch {
      // Even if the server call fails, reload into a signed-out view.
    }
    me = { user: null, sessionExpired: false };
    renderAccount();
    navigate("/");
  }

  function renderAccount() {
    const u = me.user;
    if (!u) {
      accountEl.innerHTML = `<button class="btn btn-small" type="button" data-action="sign-in">Sign in</button>`;
      return;
    }
    const home = u.accountType === "landlord" ? "/landlord" : u.accountType === "renter" ? "/renter" : "/welcome";
    accountEl.innerHTML = `
      ${u.isAdmin ? `<a class="nav-link" href="/admin">Admin</a>` : ""}
      <a class="nav-link nav-home" href="${home}">${u.accountType === "landlord" ? "My units" : u.accountType === "renter" ? "My matches" : "Get started"}</a>
      <a class="nav-link who" href="/account" title="Your account: ${esc(u.email)}"><span class="avatar avatar-sm" aria-hidden="true">${esc(initials(u.name || u.email))}</span><span class="who-name">${esc(u.name)}</span></a>
      <button class="btn btn-small btn-quiet" type="button" data-action="sign-out">Sign out</button>`;
  }

  // ── Shared view pieces ───────────────────────────────────────────────────────
  const sampleFootnote = `<p class="footnote">All names, addresses, and contact details shown are fictional sample data.</p>`;
  const sampleTag = `<span class="tag">Fictional sample data</span>`;

  function statusPill(status) {
    return status === "active"
      ? `<span class="pill pill-ok"><span class="dot" aria-hidden="true"></span>Active</span>`
      : `<span class="pill pill-off"><span class="dot" aria-hidden="true"></span>Inactive</span>`;
  }

  function samplePill(status) {
    const kind = status === "All clear" ? "ok" : "warn";
    return `<span class="pill pill-${kind}"><span class="dot" aria-hidden="true"></span>${esc(status)}</span>`;
  }

  function messageView(title, text, actions = "", brand) {
    return {
      title,
      brand,
      html: `
      <div class="panel">
        <h1 tabindex="-1">${esc(title)}</h1>
        <p class="muted">${text}</p>
        ${actions ? `<div class="actions">${actions}</div>` : ""}
      </div>`,
    };
  }

  function signInView(next, brand) {
    const expired = me.sessionExpired;
    return {
      title: "Sign in",
      brand,
      html: `
      <div class="panel">
        <h1 tabindex="-1">${expired ? "Your session has ended" : "Sign in to continue"}</h1>
        <p class="muted">${expired ? "Sign in again to pick up where you left off." : "coHabit uses your Google account. We only get your name and email address."}</p>
        <div class="actions"><button class="btn" type="button" data-action="sign-in" data-next="${esc(next)}">${icon("google", 18)} Sign in with Google</button></div>
      </div>`,
    };
  }

  function errorView(e, brand) {
    if (e.status === 401) {
      me = { user: null, sessionExpired: e.code === "session_expired" };
      renderAccount();
      return signInView(location.pathname, brand);
    }
    if (e.status === 403) return messageView("Not available", esc(e.message), `<a class="btn btn-quiet" href="/">Go to home page</a>`, brand);
    if (e.status === 404) return messageView("Not found", esc(e.message), `<a class="btn btn-quiet" href="/">Go to home page</a>`, brand);
    return messageView("Something went wrong", esc(e.message), `<button class="btn btn-quiet" type="button" data-action="reload">Try again</button>`, brand);
  }

  // Signed-in + right account type, or a view explaining what to do.
  function gate(type, brand) {
    if (!me.user) return signInView(location.pathname, brand);
    if (!me.user.accountType) {
      navigate("/welcome?next=" + encodeURIComponent(location.pathname), true);
      return null;
    }
    if (type && me.user.accountType !== type) {
      const other = me.user.accountType === "landlord" ? "/landlord" : "/renter";
      return messageView(
        type === "landlord" ? "This area is for landlords" : "This area is for renters",
        `You signed up as a ${esc(me.user.accountType)}, so this page isn't available to you.`,
        `<a class="btn" href="${other}">Go to your ${me.user.accountType === "landlord" ? "dashboard" : "matches"}</a>`,
        brand
      );
    }
    return undefined;
  }

  // ── Public pages ─────────────────────────────────────────────────────────────
  const howSteps = `
    <div class="steps">
      <section class="step-col" aria-labelledby="how-landlords">
        <h2 id="how-landlords">${icon("building", 20)} For landlords</h2>
        <ol>
          <li><strong>Sign in with Google</strong> and choose “I'm a landlord”.</li>
          <li><strong>Add your units:</strong> the neighborhood, rent, rooms available and move-in date. No street address needed.</li>
          <li><strong>Keep them current.</strong> Active units show up for renters; set a unit to inactive to hide it.</li>
          <li><strong>Hear from renters.</strong> When a renter says they're interested, you get their name, email and note on your dashboard.</li>
        </ol>
      </section>
      <section class="step-col" aria-labelledby="how-renters">
        <h2 id="how-renters">${icon("user", 20)} For renters</h2>
        <ol>
          <li><strong>Sign in with Google</strong> and choose “I'm a renter”.</li>
          <li><strong>Answer a short questionnaire:</strong> budget range, move-in month, area, and how you like to live.</li>
          <li><strong>See matching rooms,</strong> ranked by budget, area, move-in and rooms. If you choose to, also see renters you'd get along with as roommates.</li>
        </ol>
      </section>
    </div>`;

  function home() {
    const u = me.user;
    const landlordHref = "/landlord";
    const renterHref = "/renter";
    return {
      title: "Welcome",
      brand: "",
      html: `
      <div class="home">
        <div class="hero">
          <p class="eyebrow">Shared student housing</p>
          <h1 tabindex="-1">Welcome to coHabit</h1>
          <p class="lead">Landlords list rooms. Renters find ones that fit.</p>
        </div>
        <div class="choices">
          <a class="choice" href="${landlordHref}">
            <span class="choice-top"><span class="choice-icon">${icon("building", 24)}</span></span>
            <span class="choice-text">
              <span class="choice-title">Landlord</span>
              <span class="choice-desc">List your units and keep rent, rooms and move-in dates up to date.</span>
            </span>
            <span class="choice-cta">${u && u.accountType === "landlord" ? "Open your dashboard" : "Open landlord dashboard"} ${icon("right", 16)}</span>
          </a>
          <a class="choice" href="${renterHref}">
            <span class="choice-top"><span class="choice-icon">${icon("user", 24)}</span></span>
            <span class="choice-text">
              <span class="choice-title">Renter</span>
              <span class="choice-desc">Answer a short questionnaire and see rooms that match your budget and timing.</span>
            </span>
            <span class="choice-cta">${u && u.accountType === "renter" ? "See your matches" : "Find a room"} ${icon("right", 16)}</span>
          </a>
        </div>
        <section class="how" aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          ${howSteps}
        </section>
        <p class="links"><a href="/listings">Browse current listings</a> · <a href="/sample">See a sample landlord dashboard</a></p>
        <p class="links small"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
      </div>`,
    };
  }

  function howItWorks() {
    return {
      title: "How it works",
      brand: "",
      html: `
      <div class="heading">
        <h1 tabindex="-1">How coHabit works</h1>
        <p class="muted">Anyone can look around. Sign in with Google when you want to save something.</p>
      </div>
      ${howSteps}
      <p class="links"><a href="/listings">Browse current listings</a> · <a href="/">Back to home</a></p>`,
    };
  }

  // Keep these two pages in step with ACCOUNTS_SETUP.md ("What is stored where").
  function privacy() {
    return {
      title: "Privacy",
      brand: "",
      html: `
      <article class="prose">
        <h1 tabindex="-1">Privacy policy</h1>
        <p class="muted">Last updated October 1, 2026. coHabit is a student project for shared student housing.</p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>From Google when you sign in:</strong> your name, your email address, and Google's ID for your account. We ask Google only for basic sign-in information (openid, email, profile). We do not keep Google access tokens or your profile photo, and we never see your Google password.</li>
          <li><strong>Your account type:</strong> whether you chose landlord or renter.</li>
          <li><strong>If you are a landlord:</strong> the units you add: name, general area, monthly rent, rooms available, move-in date, description and status.</li>
          <li><strong>If you are a renter:</strong> your questionnaire answers: budget range, move-in month, area, rooms needed, sleep schedule, cleanliness, noise, guests, pets and smoking. Also any “I'm interested” requests you send, with your note.</li>
          <li><strong>To keep you signed in:</strong> one cookie that holds your session. It can't be read by scripts and expires after 7 days without use.</li>
          <li><strong>To limit abuse:</strong> short-lived request counters that include your IP address. They are deleted within about a day.</li>
        </ul>
        <p>We do not ask for street addresses, phone numbers, government IDs, dates of birth, payment details or health information. Please don't put them in descriptions.</p>

        <h2>Who can see it</h2>
        <ul>
          <li><strong>Everyone:</strong> active units' listing details (name, area, rent, rooms, move-in date, description). Never the landlord's name or email.</li>
          <li><strong>Only you:</strong> your inactive units, and your questionnaire answers. Landlords cannot see your answers. Other renters cannot either, unless you turn on roommate matching.</li>
          <li><strong>Other renters, only if you turn on roommate matching:</strong> renters who also turned it on can see your first name, a compatibility score, and the things you have in common (for example “Both early birds”). They see your email address only if you tick the separate box to share it. Both are off by default and you can turn them off again at any time.</li>
          <li><strong>A landlord, only when you click “I'm interested” on their unit:</strong> that landlord sees your name, your email address and the note you wrote, so they can reply. You can withdraw the request at any time and it disappears from their list. Landlords never see your questionnaire answers.</li>
          <li><strong>Renters never see a landlord's name or email</strong> through coHabit. A renter only learns it if the landlord chooses to reply.</li>
          <li><strong>The coHabit admin:</strong> a list of users with name, email, account type, join date, and either a count of units or whether preferences are saved. Not your questionnaire answers.</li>
        </ul>

        <h2>How we use it</h2>
        <p>Only to run coHabit: to sign you in, show your units or preferences back to you, and match renters to active units. We don't sell or share your information, show ads, or use tracking or analytics cookies. Matching runs inside coHabit; your answers are not sent to any outside AI service.</p>

        <h2>Where it is kept</h2>
        <p>coHabit runs on Cloudflare, which stores the database and processes requests on our behalf, and keeps short-term technical logs. Google handles the sign-in step.</p>

        <h2>Your choices</h2>
        <p>You can edit or delete your units and edit your answers at any time. To delete your account and everything saved with it, sign in, click your name in the top bar, and use <a href="/account">Delete my account</a>. It takes effect immediately. You can also remove coHabit's access in your Google Account under Security → Your connections to third-party apps.</p>

        <p class="links"><a href="/terms">Terms of use</a> · <a href="/">Back to home</a></p>
      </article>`,
    };
  }

  function terms() {
    return {
      title: "Terms",
      brand: "",
      html: `
      <article class="prose">
        <h1 tabindex="-1">Terms of use</h1>
        <p class="muted">Last updated October 1, 2026. coHabit is a student project and is offered free of charge.</p>
        <ul>
          <li><strong>Listings are provided by landlords.</strong> coHabit does not verify landlords, units or renters, and is not a party to any lease or agreement. Check details yourself before making any commitment or payment.</li>
          <li><strong>Be accurate and lawful.</strong> Only list units you have the right to offer. Don't post street addresses, phone numbers, other people's personal information, or anything discriminatory, misleading or illegal.</li>
          <li><strong>Matches are suggestions.</strong> They are based on the budget, area, timing and rooms you entered, and are not a recommendation or guarantee.</li>
          <li><strong>No guarantees.</strong> The service is provided as is. It may change, be unavailable, or be shut down, and saved information may be removed.</li>
          <li><strong>Accounts.</strong> We may remove content or accounts that break these terms.</li>
        </ul>
        <p>How your information is handled is described in the <a href="/privacy">privacy policy</a>.</p>
        <p class="links"><a href="/privacy">Privacy policy</a> · <a href="/">Back to home</a></p>
      </article>`,
    };
  }

  function unitStats(u) {
    return `
      <dl class="stats">
        <div><dt>Rent</dt><dd>${money(u.monthly_rent)}/mo</dd></div>
        <div><dt>Rooms</dt><dd>${u.rooms_available}</dd></div>
        <div><dt>Move-in</dt><dd>${fmtDate(u.move_in_date)}</dd></div>
      </dl>`;
  }

  // ── "I'm interested": a renter contacts a unit's landlord ────────────────────
  // Unit ids this renter has already sent a request for (loaded on the renter and listings pages).
  let myInterests = new Set();
  const isRenter = () => !!me.user && me.user.accountType === "renter";

  async function loadMyInterests() {
    if (!isRenter()) return [];
    const { interests } = await api("/api/renter/interests");
    myInterests = new Set(interests.map((i) => i.unitId));
    return interests;
  }

  function interestState(unitId) {
    return myInterests.has(unitId)
      ? `<span class="saved small">Request sent</span><button class="btn btn-small btn-quiet" type="button" data-action="interest-withdraw" data-unit="${esc(unitId)}">Withdraw</button>`
      : `<button class="btn btn-small" type="button" data-action="interest-open" data-unit="${esc(unitId)}">I'm interested</button>`;
  }

  // What goes under a listing card, depending on who is looking.
  function interestFooter(u) {
    if (u.sample) return `<p class="small muted interest">Sample listing: there is no landlord to contact.</p>`;
    if (!me.user) return `<p class="small interest"><a href="/renter">Sign in as a renter</a> to tell the landlord you're interested.</p>`;
    if (!isRenter()) return "";
    return `<div class="interest" data-interest="${esc(u.id)}">${interestState(u.id)}</div>`;
  }

  function interestForm(unitId) {
    const id = esc(unitId);
    return `
      <form class="interest-form" data-unit="${id}" novalidate>
        <label class="small" for="note-${id}">Note to the landlord (optional)</label>
        <textarea id="note-${id}" name="message" maxlength="500" rows="3" placeholder="A line about you and when you'd like to move in"></textarea>
        <p class="hint">The landlord will see your name and your email (${esc(me.user.email)}) so they can reply. Don't include phone numbers.</p>
        <p class="field-error" role="alert"></p>
        <div class="actions">
          <button class="btn btn-small" type="submit">Send</button>
          <button class="btn btn-small btn-quiet" type="button" data-action="interest-cancel" data-unit="${id}">Cancel</button>
        </div>
      </form>`;
  }

  const interestBox = (unitId) => document.querySelector(`[data-interest="${CSS.escape(unitId)}"]`);

  function contactedHtml(interests) {
    if (!interests.length) return `<p class="empty">You haven't contacted any landlords yet. Click “I'm interested” on a room above.</p>`;
    return `<ul class="contacted" role="list">${interests
      .map(
        (i) => `
      <li>
        <div>
          <strong>${esc(i.unitName)}</strong> <span class="muted small">${esc(i.unitArea)} · sent ${esc(fmtJoined(i.createdAt))}</span>${i.listed ? "" : ` <span class="badge badge-sample">No longer listed</span>`}
          ${i.message ? `<p class="small desc">“${esc(i.message)}”</p>` : ""}
        </div>
        <button class="btn btn-small btn-quiet" type="button" data-action="interest-withdraw" data-unit="${esc(i.unitId)}">Withdraw</button>
      </li>`
      )
      .join("")}</ul>`;
  }

  async function refreshContacted() {
    const el = document.getElementById("contacted");
    const interests = await loadMyInterests();
    if (el) el.innerHTML = contactedHtml(interests);
  }

  async function sendInterest(form) {
    const unitId = form.dataset.unit;
    const btn = form.querySelector("[type=submit]");
    const errorEl = form.querySelector(".field-error");
    btn.disabled = true;
    errorEl.textContent = "";
    try {
      await api("/api/renter/interests", { method: "POST", body: { unit_id: unitId, message: form.elements.message.value } });
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      if (e.code !== "already_sent") {
        errorEl.textContent = e.message;
        btn.disabled = false;
        return;
      }
    }
    myInterests.add(unitId);
    const box = interestBox(unitId);
    if (box) box.innerHTML = interestState(unitId);
    refreshContacted().catch(() => {});
  }

  async function withdrawInterest(unitId) {
    if (!confirm("Withdraw your request? The landlord will no longer see it.")) return;
    try {
      await api(`/api/renter/interests/${encodeURIComponent(unitId)}`, { method: "DELETE" });
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      if (e.status !== 404) return alert(e.message);
    }
    myInterests.delete(unitId);
    const box = interestBox(unitId);
    if (box) box.innerHTML = interestState(unitId);
    refreshContacted().catch(() => {});
  }

  async function removeInterest(id, button) {
    if (!confirm("Remove this request from your list? The renter is not notified.")) return;
    button.disabled = true;
    try {
      await api(`/api/landlord/interests/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      if (e.status !== 404) {
        button.disabled = false;
        return alert(e.message);
      }
    }
    render(false);
  }

  function listingCard(u, extra = "") {
    return `
      <li>
        <article class="card">
          <div class="card-top">
            <span class="icon-tile">${icon("house", 20)}</span>
            <span class="card-tags">${u.sample ? `<span class="tag" title="Fictional listing for demonstration">Sample</span>` : ""}${extra}</span>
          </div>
          <div>
            <h2 class="card-title">${esc(u.name)}</h2>
            <p class="muted small">${esc(u.area)}</p>
          </div>
          ${u.description ? `<p class="small desc">${esc(u.description)}</p>` : ""}
          <hr />
          ${unitStats(u)}
          ${interestFooter(u)}
        </article>
      </li>`;
  }

  async function listings() {
    const [{ listings }] = await Promise.all([api("/api/listings"), loadMyInterests()]);
    return {
      title: "Listings",
      brand: "",
      html: `
      <div class="heading">
        <h1 tabindex="-1">Current listings</h1>
        <p class="muted">${plural(listings.length, "active unit", "active units")}. Renters: <a href="/renter">answer the questionnaire</a> to see which fit you best.</p>
      </div>
      ${listings.length ? `<ul class="grid" role="list">${listings.map((u) => listingCard(u)).join("")}</ul>` : `<p class="empty">No units are listed right now. Check back soon.</p>`}`,
    };
  }

  // ── Sample (fictional) dashboard: the original demo, kept as-is ──────────────
  function sampleDashboard() {
    const tenantTotal = sample.reduce((sum, p) => sum + p.tenants.length, 0);
    const cards = sample
      .map(
        (p) => `
      <li>
        <a class="card" href="/properties/${encodeURIComponent(p.id)}">
          <div class="card-top">
            <span class="icon-tile">${icon("house", 20)}</span>
            ${samplePill(p.status)}
          </div>
          <div>
            <h2 class="card-title">${esc(p.address)}</h2>
            <p class="muted small">${esc(p.city)}</p>
          </div>
          <hr />
          <dl class="stats">
            <div><dt>Tenants</dt><dd>${p.tenants.length}</dd></div>
            <div><dt>Lease ends</dt><dd>${esc(p.leaseEnd)}</dd></div>
          </dl>
          <span class="card-link">View property &amp; tenants ${icon("chevron", 16)}</span>
        </a>
      </li>`
      )
      .join("");

    return {
      title: "Sample dashboard",
      brand: "Sample",
      html: `
      <div class="heading">
        <div class="title-row"><h1 tabindex="-1">Sample landlord dashboard</h1>${sampleTag}</div>
        <p class="muted">${plural(sample.length, "sample property", "sample properties")} in Waltham, MA · ${plural(tenantTotal, "tenant", "tenants")}. This is a preview with made-up data. <a href="/landlord">Open your real dashboard</a>.</p>
      </div>
      <ul class="grid" role="list">${cards}</ul>
      ${sampleFootnote}`,
    };
  }

  const sampleBack = `<a class="back" href="/sample">${icon("left", 16)} Back to sample dashboard</a>`;

  function samplePropertyPage(p) {
    const rows = p.tenants
      .map(
        (t) => `
        <tr>
          <td><span class="person"><span class="avatar" aria-hidden="true">${esc(initials(t.name))}</span><span class="name">${esc(t.name)}</span></span></td>
          <td data-label="Room" class="room">${esc(t.room)}</td>
          <td data-label="Email"><a href="mailto:${esc(t.email)}">${esc(t.email)}</a></td>
          <td data-label="Phone"><a href="tel:${esc(t.phone.replace(/[^\d+]/g, ""))}">${esc(t.phone)}</a></td>
        </tr>`
      )
      .join("");

    return {
      title: p.address,
      brand: "Sample",
      html: `
      ${sampleBack}
      <div class="title-block">
        <div class="title-row">
          <h1 tabindex="-1">${esc(p.address)}</h1>
          ${samplePill(p.status)}
          ${sampleTag}
        </div>
        <p class="muted">${esc(p.city)}</p>
      </div>
      <dl class="facts">
        <div class="fact"><dt>Lease end date</dt><dd>${esc(p.leaseEnd)}</dd></div>
        <div class="fact"><dt>Tenants</dt><dd>${p.tenants.length} living here</dd></div>
      </dl>
      <section aria-labelledby="tenants-heading">
        <div class="section-heading">
          <h2 id="tenants-heading">Tenants</h2>
          <span class="muted small">${plural(p.tenants.length, "person", "people")}</span>
        </div>
        ${
          p.tenants.length
            ? `<table class="tenants">
          <thead><tr><th scope="col">Name</th><th scope="col">Room</th><th scope="col">Email</th><th scope="col">Phone</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : `<p class="empty">No tenants listed for this property.</p>`
        }
      </section>
      ${sampleFootnote}`,
    };
  }

  // ── Welcome: one-time landlord / renter choice ───────────────────────────────
  function welcome() {
    const next = new URLSearchParams(location.search).get("next") || "";
    if (!me.user) return signInView(next || "/welcome");
    const t = me.user.accountType;
    if (t) {
      const dest = t === "landlord" ? "/landlord" : "/renter";
      navigate(next.startsWith(dest) ? next : dest, true);
      return null;
    }
    return {
      title: "Welcome",
      brand: "",
      html: `
      <div class="home">
        <div class="hero">
          <p class="eyebrow">One quick question</p>
          <h1 tabindex="-1">Welcome, ${esc(me.user.name.split(" ")[0])}</h1>
          <p class="lead">How will you use coHabit? You can't change this later.</p>
        </div>
        <div class="choices">
          <button class="choice" type="button" data-action="choose-type" data-type="landlord">
            <span class="choice-top"><span class="choice-icon">${icon("building", 24)}</span></span>
            <span class="choice-text"><span class="choice-title">I'm a landlord</span><span class="choice-desc">I have rooms or units to list.</span></span>
            <span class="choice-cta">Continue as landlord ${icon("right", 16)}</span>
          </button>
          <button class="choice" type="button" data-action="choose-type" data-type="renter">
            <span class="choice-top"><span class="choice-icon">${icon("user", 24)}</span></span>
            <span class="choice-text"><span class="choice-title">I'm a renter</span><span class="choice-desc">I'm looking for a room and housemates.</span></span>
            <span class="choice-cta">Continue as renter ${icon("right", 16)}</span>
          </button>
        </div>
        <p class="form-error" id="choose-error" role="alert"></p>
      </div>`,
    };
  }

  async function chooseType(type, button) {
    const errorEl = document.getElementById("choose-error");
    document.querySelectorAll("[data-action=choose-type]").forEach((b) => (b.disabled = true));
    try {
      await api("/api/me/account-type", { method: "POST", body: { accountType: type } });
    } catch (e) {
      if (e.code !== "already_chosen") {
        errorEl.textContent = e.message;
        document.querySelectorAll("[data-action=choose-type]").forEach((b) => (b.disabled = false));
        return;
      }
    }
    await loadMe();
    render(true);
  }

  // ── Landlord ─────────────────────────────────────────────────────────────────
  async function landlordDashboard() {
    const blocked = gate("landlord", "Landlord portal");
    if (blocked !== undefined) return blocked;
    const [{ units }, { interests }] = await Promise.all([api("/api/landlord/units"), api("/api/landlord/interests")]);
    const active = units.filter((u) => u.status === "active").length;
    const interestRows = interests
      .map(
        (i) => `
        <tr>
          <td><span class="person"><span class="avatar" aria-hidden="true">${esc(initials(i.renterName || i.renterEmail))}</span><span class="name">${esc(i.renterName)}</span></span></td>
          <td data-label="Unit">${esc(i.unitName)}</td>
          <td data-label="Note" class="note">${i.message ? esc(i.message) : `<span class="muted">No note</span>`}</td>
          <td data-label="Email"><a href="mailto:${esc(i.renterEmail)}">${esc(i.renterEmail)}</a></td>
          <td data-label="Received">${esc(fmtJoined(i.createdAt))}</td>
          <td><button class="btn btn-small btn-quiet" type="button" data-action="interest-remove" data-id="${esc(i.id)}">Remove</button></td>
        </tr>`
      )
      .join("");
    const cards = units
      .map(
        (u) => `
      <li>
        <a class="card" href="/landlord/units/${encodeURIComponent(u.id)}">
          <div class="card-top">
            <span class="icon-tile">${icon("house", 20)}</span>
            ${statusPill(u.status)}
          </div>
          <div>
            <h2 class="card-title">${esc(u.name)}</h2>
            <p class="muted small">${esc(u.area)}</p>
          </div>
          <hr />
          ${unitStats(u)}
          <span class="card-link">Edit unit ${icon("chevron", 16)}</span>
        </a>
      </li>`
      )
      .join("");
    return {
      title: "Your units",
      brand: "Landlord portal",
      html: `
      <div class="heading-row">
        <div class="heading">
          <h1 tabindex="-1">Your units</h1>
          <p class="muted">${plural(units.length, "unit", "units")} · ${active} active and visible to renters</p>
        </div>
        <a class="btn" href="/landlord/units/new">${icon("plus", 18)} Add a unit</a>
      </div>
      ${
        units.length
          ? `<ul class="grid" role="list">${cards}</ul>`
          : `<div class="empty">You haven't added any units yet. <a href="/landlord/units/new">Add your first unit</a>. Want to see how it looks? <a href="/sample">View the sample dashboard</a>.</div>`
      }
      <section aria-labelledby="interests-heading">
        <div class="section-heading"><h2 id="interests-heading">Interested renters</h2><span class="muted small">${interests.length ? plural(interests.length, "request", "requests") : ""}</span></div>
        ${
          interests.length
            ? `<table class="tenants interests">
          <thead><tr><th scope="col">Renter</th><th scope="col">Unit</th><th scope="col">Note</th><th scope="col">Email</th><th scope="col">Received</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${interestRows}</tbody>
        </table>
        <p class="hint">Reply to a renter by email. Renters never see your email address unless you write to them.</p>`
            : `<p class="empty">No requests yet. When a renter clicks “I'm interested” on one of your active units, they show up here with their name, email and note.</p>`
        }
      </section>`,
    };
  }

  const field = (id, label, control, hint = "") => `
    <div class="field" data-field="${id}">
      <label for="f-${id}">${label}</label>
      ${control}
      ${hint ? `<p class="hint" id="h-${id}">${hint}</p>` : ""}
      <p class="field-error" id="e-${id}"></p>
    </div>`;
  const input = (id, attrs, value) =>
    `<input id="f-${id}" name="${id}" ${attrs} value="${esc(value ?? "")}" aria-describedby="h-${id} e-${id}" />`;
  const select = (id, options, value) =>
    `<select id="f-${id}" name="${id}" aria-describedby="e-${id}">${options
      .map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${esc(l)}</option>`)
      .join("")}</select>`;

  async function unitForm(id) {
    const blocked = gate("landlord", "Landlord portal");
    if (blocked !== undefined) return blocked;
    const isNew = !id;
    const u = isNew
      ? { name: "", area: "", monthly_rent: "", rooms_available: 1, move_in_date: "", description: "", status: "active" }
      : (await api(`/api/landlord/units/${encodeURIComponent(id)}`)).unit;
    return {
      title: isNew ? "Add a unit" : `Edit ${u.name}`,
      brand: "Landlord portal",
      html: `
      <a class="back" href="/landlord">${icon("left", 16)} Back to your units</a>
      <div class="heading"><h1 tabindex="-1">${isNew ? "Add a unit" : "Edit unit"}</h1></div>
      <form class="form" id="unit-form" novalidate data-unit-id="${esc(id || "")}">
        ${field("name", "Unit name", input("name", 'type="text" maxlength="80" required autocomplete="off"', u.name), "A short name renters will see, like “Sunny 3-bedroom near campus”. Don't use the street address.")}
        ${field("area", "General area", input("area", 'type="text" maxlength="80" required autocomplete="off"', u.area), "Neighborhood or city only, like “Waltham, MA”. Don't enter a street address.")}
        <div class="field-row">
          ${field("monthly_rent", "Monthly rent per room ($)", input("monthly_rent", 'type="number" min="1" max="50000" step="1" required inputmode="numeric"', u.monthly_rent))}
          ${field("rooms_available", "Rooms available", input("rooms_available", 'type="number" min="1" max="20" step="1" required inputmode="numeric"', u.rooms_available))}
        </div>
        <div class="field-row">
          ${field("move_in_date", "Move-in date", input("move_in_date", 'type="date" required', u.move_in_date))}
          ${field("status", "Status", select("status", [["active", "Active: shown to renters"], ["inactive", "Inactive: hidden"]], u.status))}
        </div>
        ${field("description", "Short description (optional)", `<textarea id="f-description" name="description" maxlength="1000" rows="4" aria-describedby="h-description e-description">${esc(u.description)}</textarea>`, "Up to 1,000 characters. Don't include phone numbers or addresses.")}
        <p class="form-error" id="form-error" role="alert"></p>
        <div class="actions">
          <button class="btn" type="submit">${isNew ? "Add unit" : "Save changes"}</button>
          <a class="btn btn-quiet" href="/landlord">Cancel</a>
          ${isNew ? "" : `<button class="btn btn-danger" type="button" data-action="delete-unit" data-id="${esc(id)}">Delete unit</button>`}
        </div>
      </form>`,
    };
  }

  function formData(form, numeric) {
    const out = {};
    for (const [k, v] of new FormData(form).entries()) out[k] = numeric.includes(k) && v !== "" ? Number(v) : v;
    return out;
  }

  function showErrors(form, e) {
    form.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    const formError = form.querySelector("#form-error");
    const fieldEl = e.field && form.querySelector(`#e-${e.field}`);
    if (fieldEl) {
      fieldEl.textContent = e.message;
      const control = form.querySelector(`#f-${e.field}`);
      control.setAttribute("aria-invalid", "true");
      control.focus();
      formError.textContent = "";
    } else {
      formError.textContent = e.message;
    }
  }

  async function submitUnit(form) {
    const id = form.dataset.unitId;
    const body = formData(form, ["monthly_rent", "rooms_available"]);
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api(id ? `/api/landlord/units/${encodeURIComponent(id)}` : "/api/landlord/units", { method: id ? "PUT" : "POST", body });
      navigate("/landlord");
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      showErrors(form, e);
      btn.disabled = false;
    }
  }

  async function deleteUnit(id) {
    if (!confirm("Delete this unit? This can't be undone.")) return;
    try {
      await api(`/api/landlord/units/${encodeURIComponent(id)}`, { method: "DELETE" });
      navigate("/landlord");
    } catch (e) {
      showView(errorView(e));
    }
  }

  // ── Renter ───────────────────────────────────────────────────────────────────
  const CHOICES = {
    sleep_schedule: ["Sleep schedule", [["early", "Early bird"], ["flexible", "Flexible"], ["late", "Night owl"]]],
    cleanliness: ["Cleanliness", [["relaxed", "Relaxed"], ["average", "Average"], ["tidy", "Very tidy"]]],
    noise: ["Noise at home", [["quiet", "Quiet"], ["moderate", "Some noise is fine"], ["lively", "Lively"]]],
    guests: ["Guests over", [["rarely", "Rarely"], ["sometimes", "Sometimes"], ["often", "Often"]]],
    pets: ["Pets", [["no_pets", "No pets, please"], ["ok_with_pets", "OK with pets"], ["have_pets", "I have a pet"]]],
    smoking: ["Smoking", [["no_smoking", "No smoking"], ["outside_ok", "OK outside"], ["smoker", "I smoke"]]],
  };

  function matchesHtml(data) {
    if (data.needsPreferences) return `<p class="empty">Save your preferences to see matching rooms.</p>`;
    if (!data.matches.length)
      return `<p class="empty">No rooms match yet. Try a wider budget or area, or <a href="/listings">browse all listings</a>.</p>`;
    return `<ul class="grid" role="list">${data.matches
      .map((m) =>
        listingCard(
          m.unit,
          `<span class="pill pill-ok" title="Match score out of 100">${m.score}% match</span>`
        ).replace("<hr />", `<ul class="reasons">${m.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul><hr />`)
      )
      .join("")}</ul>`;
  }

  function roommatesHtml(data) {
    if (data.needsPreferences) return `<p class="empty">Save your preferences to use roommate matching.</p>`;
    if (!data.optedIn)
      return `<p class="empty">Roommate matching is off. Tick “Show me to compatible renters” above and save to see renters you'd get along with. You only see people who turned it on too.</p>`;
    if (!data.roommates.length)
      return `<p class="empty">No compatible renters yet for your area and move-in month. Check back as more people join.</p>`;
    return `<ul class="grid" role="list">${data.roommates
      .map(
        (m) => `
      <li>
        <article class="card">
          <div class="card-top">
            <span class="person"><span class="avatar" aria-hidden="true">${esc(initials(m.firstName))}</span><span class="name">${esc(m.firstName)}</span></span>
            <span class="card-tags">${m.sample ? `<span class="tag" title="Fictional person for demonstration">Sample</span>` : ""}<span class="pill pill-ok" title="Compatibility score out of 100">${m.score}% compatible</span></span>
          </div>
          <div>
            <p class="small muted">What you have in common</p>
            <ul class="reasons">${m.shared.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
          </div>
          <hr />
          ${m.email ? `<a class="card-link" href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : `<span class="small muted">Hasn't shared contact details</span>`}
        </article>
      </li>`
      )
      .join("")}</ul>`;
  }

  async function renterPage() {
    const blocked = gate("renter", "Renter");
    if (blocked !== undefined) return blocked;
    const [{ preferences: p }, matches, mates, contacted] = await Promise.all([api("/api/renter/preferences"), api("/api/renter/matches"), api("/api/renter/roommates"), loadMyInterests()]);
    const v = p || { budget_min: "", budget_max: "", move_in_month: "", area: "", rooms_needed: 1 };
    const lifestyle = Object.entries(CHOICES)
      .map(([k, [label, opts]]) => field(k, label, select(k, (p ? [] : [["", "Choose…"]]).concat(opts), v[k] || "")))
      .join("");
    return {
      title: "Your matches",
      brand: "Renter",
      html: `
      <div class="heading">
        <h1 tabindex="-1">Find your room</h1>
        <p class="muted">${p ? `Preferences saved ${fmtJoined(p.updated_at)}. Edit them any time.` : "Answer these once. We'll save them so you can come back and edit them."}</p>
      </div>
      <form class="form" id="prefs-form" novalidate>
        <fieldset>
          <legend>The basics</legend>
          <div class="field-row">
            ${field("budget_min", "Budget from ($/month)", input("budget_min", 'type="number" min="0" max="50000" step="1" required inputmode="numeric"', v.budget_min))}
            ${field("budget_max", "Budget up to ($/month)", input("budget_max", 'type="number" min="1" max="50000" step="1" required inputmode="numeric"', v.budget_max))}
          </div>
          <div class="field-row">
            ${field("move_in_month", "Move-in month", input("move_in_month", 'type="month" required placeholder="2027-06"', v.move_in_month))}
            ${field("rooms_needed", "Rooms you need", input("rooms_needed", 'type="number" min="1" max="10" step="1" required inputmode="numeric"', v.rooms_needed), "More than 1 if you're moving with friends.")}
          </div>
          ${field("area", "Area", input("area", 'type="text" maxlength="80" required autocomplete="off"', v.area), "Neighborhood or city, like “Waltham”.")}
        </fieldset>
        <fieldset>
          <legend>How you like to live</legend>
          <p class="hint">Used for roommate matching. Room matches use the basics above.</p>
          <div class="field-grid">${lifestyle}</div>
        </fieldset>
        <fieldset>
          <legend>Roommate matching (optional)</legend>
          <label class="check"><input type="checkbox" id="f-roommate_visible" name="roommate_visible" ${p && p.roommate_visible ? "checked" : ""} />
            <span><strong>Show me to compatible renters.</strong> They see your first name, a compatibility score and what you have in common. Not your last name, and not answers you don't share.</span></label>
          <label class="check"><input type="checkbox" id="f-share_email" name="share_email" ${p && p.share_email ? "checked" : ""} ${p && p.roommate_visible ? "" : "disabled"} />
            <span><strong>Let my roommate matches see my email</strong> (${esc(me.user.email)}) so they can contact me.</span></label>
          <p class="hint">Both are off unless you tick them. You can turn them off again at any time.</p>
        </fieldset>
        <p class="form-error" id="form-error" role="alert"></p>
        <div class="actions">
          <button class="btn" type="submit">${p ? "Save changes" : "Save and see matches"}</button>
          <span class="saved small muted" id="saved" role="status"></span>
        </div>
      </form>
      <section aria-labelledby="matches-heading">
        <div class="section-heading"><h2 id="matches-heading">Matching rooms</h2><span class="muted small" id="match-count">${matches.matches.length ? plural(matches.matches.length, "match", "matches") : ""}</span></div>
        <div id="matches">${matchesHtml(matches)}</div>
      </section>
      <section aria-labelledby="contacted-heading">
        <div class="section-heading"><h2 id="contacted-heading">Landlords you've contacted</h2></div>
        <div id="contacted">${contactedHtml(contacted)}</div>
      </section>
      <section aria-labelledby="roommates-heading">
        <div class="section-heading"><h2 id="roommates-heading">Possible roommates</h2><span class="muted small" id="roommate-count">${mates.roommates.length ? plural(mates.roommates.length, "person", "people") : ""}</span></div>
        <div id="roommates">${roommatesHtml(mates)}</div>
      </section>`,
    };
  }

  async function submitPrefs(form) {
    const body = formData(form, ["budget_min", "budget_max", "rooms_needed"]);
    body.roommate_visible = form.elements.roommate_visible.checked;
    body.share_email = body.roommate_visible && form.elements.share_email.checked;
    const btn = form.querySelector("[type=submit]");
    const saved = document.getElementById("saved");
    btn.disabled = true;
    saved.textContent = "";
    try {
      await api("/api/renter/preferences", { method: "PUT", body });
      showErrors(form, { message: "" });
      const data = await api("/api/renter/matches");
      document.getElementById("matches").innerHTML = matchesHtml(data);
      document.getElementById("match-count").textContent = data.matches.length ? plural(data.matches.length, "match", "matches") : "";
      const mates = await api("/api/renter/roommates");
      document.getElementById("roommates").innerHTML = roommatesHtml(mates);
      document.getElementById("roommate-count").textContent = mates.roommates.length ? plural(mates.roommates.length, "person", "people") : "";
      saved.textContent = "Saved.";
      btn.textContent = "Save changes";
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      showErrors(form, e);
    }
    btn.disabled = false;
  }

  // ── Admin ────────────────────────────────────────────────────────────────────
  async function adminPage() {
    if (!me.user) return signInView("/admin", "Admin");
    const { users } = await api("/api/admin/users");
    const detail = (u) =>
      u.accountType === "landlord"
        ? plural(u.unitCount, "unit", "units")
        : u.accountType === "renter"
          ? u.hasPreferences
            ? "Preferences saved"
            : "No preferences yet"
          : "—";
    const rows = users
      .map(
        (u) => `
        <tr>
          <td><span class="person"><span class="avatar" aria-hidden="true">${esc(initials(u.name || u.email))}</span><span class="name">${esc(u.name)}${u.role === "admin" ? ` <span class="badge">Admin</span>` : ""}${u.isSample ? ` <span class="badge badge-sample">Sample</span>` : ""}</span></span></td>
          <td data-label="Email">${esc(u.email)}</td>
          <td data-label="Account type">${u.accountType ? esc(u.accountType[0].toUpperCase() + u.accountType.slice(1)) : "Not chosen yet"}</td>
          <td data-label="Joined">${esc(fmtJoined(u.joinedAt))}</td>
          <td data-label="Activity">${esc(detail(u))}</td>
        </tr>`
      )
      .join("");
    // Counts are real people only; fictional sample accounts are counted separately.
    const real = users.filter((u) => !u.isSample);
    const samples = users.length - real.length;
    const landlords = real.filter((u) => u.accountType === "landlord").length;
    const renters = real.filter((u) => u.accountType === "renter").length;
    return {
      title: "Users",
      brand: "Admin",
      html: `
      <div class="heading">
        <h1 tabindex="-1">Users</h1>
        <p class="muted">${plural(real.length, "person", "people")} · ${plural(landlords, "landlord", "landlords")} · ${plural(renters, "renter", "renters")}${samples ? ` · plus ${plural(samples, "fictional sample account", "fictional sample accounts")}` : ""}. Read only.</p>
      </div>
      <table class="tenants users">
        <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Account type</th><th scope="col">Joined</th><th scope="col">Activity</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    };
  }

  // ── Account: who you are, and delete my account ──────────────────────────────
  function accountPage() {
    const u = me.user;
    if (!u) return signInView("/account", "Account");
    const saved =
      u.accountType === "landlord"
        ? "all of your units"
        : u.accountType === "renter"
          ? "your questionnaire answers"
          : "anything you have saved";
    return {
      title: "Your account",
      brand: "Account",
      html: `
      <div class="heading"><h1 tabindex="-1">Your account</h1></div>
      <dl class="facts">
        <div class="fact"><dt>Name</dt><dd>${esc(u.name)}</dd></div>
        <div class="fact"><dt>Email</dt><dd class="wrap">${esc(u.email)}</dd></div>
        <div class="fact"><dt>Account type</dt><dd>${u.accountType ? esc(u.accountType[0].toUpperCase() + u.accountType.slice(1)) : "Not chosen yet"}${u.isAdmin ? ` <span class="badge">Admin</span>` : ""}</dd></div>
      </dl>
      ${u.accountType ? `<p class="links"><a href="${u.accountType === "landlord" ? "/landlord" : "/renter"}">${u.accountType === "landlord" ? "Go to your units" : "Go to your matches"}</a></p>` : ""}
      <p class="muted small">Your name and email come from Google. See the <a href="/privacy">privacy policy</a> for what coHabit keeps.</p>
      <form class="form danger-zone" id="delete-account-form" novalidate>
        <fieldset>
          <legend>Delete my account</legend>
          <p>This permanently deletes your coHabit account, ${saved}, and signs you out. It can't be undone. Your Google account is not affected.</p>
          ${field("confirm", "Type DELETE to confirm", input("confirm", 'type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"', ""))}
          <p class="form-error" id="form-error" role="alert"></p>
          <div class="actions"><button class="btn btn-danger" type="submit">Delete my account</button></div>
        </fieldset>
      </form>`,
    };
  }

  async function submitDeleteAccount(form) {
    const btn = form.querySelector("[type=submit]");
    const confirmText = form.elements.confirm.value.trim();
    if (confirmText !== "DELETE") return showErrors(form, { field: "confirm", message: "Type DELETE in capital letters to confirm." });
    btn.disabled = true;
    try {
      await api("/api/me/delete", { method: "POST", body: { confirm: confirmText } });
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      showErrors(form, e);
      btn.disabled = false;
      return;
    }
    me = { user: null, sessionExpired: false };
    renderAccount();
    history.replaceState(null, "", "/");
    showView(messageView("Your account was deleted", "Your account and everything saved with it have been removed. You're signed out.", `<a class="btn btn-quiet" href="/">Go to home page</a>`, ""), true);
  }

  function notFound() {
    return messageView("Page not found", "This page doesn't exist.", `<a class="btn btn-quiet" href="/">Go to home page</a>`, "");
  }

  // ── Router ───────────────────────────────────────────────────────────────────
  function route(path) {
    const clean = path.replace(/\/+$/, "") || "/";
    if (clean === "/" || clean === "/index.html") return home();
    if (clean === "/how-it-works") return howItWorks();
    if (clean === "/privacy") return privacy();
    if (clean === "/terms") return terms();
    if (clean === "/listings") return listings();
    if (clean === "/sample") return sampleDashboard();
    if (clean === "/welcome") return welcome();
    if (clean === "/account") return accountPage();
    if (clean === "/signin-error")
      return messageView("Sign-in didn't work", "Google sign-in was cancelled or failed. Please try again.", `<button class="btn" type="button" data-action="sign-in">Try again</button>`, "");
    if (clean === "/landlord") return landlordDashboard();
    if (clean === "/landlord/units/new") return unitForm(null);
    let m = clean.match(/^\/landlord\/units\/([^/]+)$/);
    if (m) return unitForm(safeDecode(m[1]));
    if (clean === "/renter") return renterPage();
    if (clean === "/admin") return adminPage();
    m = clean.match(/^\/properties\/([^/]+)$/);
    if (m) {
      const p = sample.find((x) => x.id === safeDecode(m[1]));
      return p ? samplePropertyPage(p) : messageView("Property not found", "This address doesn't match any sample property.", `<a class="btn btn-quiet" href="/sample">Back to sample dashboard</a>`, "Sample");
    }
    return notFound();
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }

  let renderSeq = 0;
  let pendingFocus = false;
  function showView(view, moveFocus = pendingFocus) {
    app.innerHTML = view.html;
    document.title = `${view.title} · coHabit`;
    brandSub.textContent = view.brand ?? "";
    app.setAttribute("aria-busy", "false");
    if (moveFocus) {
      window.scrollTo(0, 0);
      const h1 = app.querySelector("h1");
      if (h1) h1.focus({ preventScroll: true });
    }
    pendingFocus = false;
  }

  async function render(moveFocus) {
    const seq = ++renderSeq;
    pendingFocus = pendingFocus || moveFocus;
    let result;
    try {
      result = route(location.pathname);
    } catch (e) {
      result = errorView(e);
    }
    if (result && typeof result.then === "function") {
      app.setAttribute("aria-busy", "true");
      const t = setTimeout(() => {
        if (seq === renderSeq) app.innerHTML = `<p class="loading muted" role="status">Loading…</p>`;
      }, 150);
      try {
        result = await result;
      } catch (e) {
        result = e instanceof ApiError ? errorView(e) : errorView(new ApiError(0, null));
      }
      clearTimeout(t);
    }
    if (seq !== renderSeq || !result) return; // superseded, or navigated elsewhere
    showView(result);
  }

  function navigate(path, replace) {
    if (path !== location.pathname + location.search) history[replace ? "replaceState" : "pushState"](null, "", path);
    render(true);
  }

  // Links inside the site switch views without a full page reload.
  document.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]");
    if (action) {
      const a = action.dataset.action;
      if (a === "sign-in") signIn(action.dataset.next || (location.pathname === "/" ? "" : location.pathname));
      else if (a === "sign-out") signOut();
      else if (a === "choose-type") chooseType(action.dataset.type, action);
      else if (a === "delete-unit") deleteUnit(action.dataset.id);
      else if (a === "interest-open") {
        const box = interestBox(action.dataset.unit);
        box.innerHTML = interestForm(action.dataset.unit);
        box.querySelector("textarea").focus();
      } else if (a === "interest-cancel") interestBox(action.dataset.unit).innerHTML = interestState(action.dataset.unit);
      else if (a === "interest-withdraw") withdrawInterest(action.dataset.unit);
      else if (a === "interest-remove") removeInterest(action.dataset.id, action);
      else if (a === "reload") render(true);
      return;
    }
    const link = e.target.closest("a");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || link.target || url.pathname.startsWith("/api/")) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });

  document.addEventListener("submit", (e) => {
    if (e.target.id === "unit-form") {
      e.preventDefault();
      submitUnit(e.target);
    } else if (e.target.id === "prefs-form") {
      e.preventDefault();
      submitPrefs(e.target);
    } else if (e.target.id === "delete-account-form") {
      e.preventDefault();
      submitDeleteAccount(e.target);
    } else if (e.target.classList.contains("interest-form")) {
      e.preventDefault();
      sendInterest(e.target);
    }
  });

  // Email sharing only makes sense once roommate matching is on.
  document.addEventListener("change", (e) => {
    if (e.target.id !== "f-roommate_visible") return;
    const email = document.getElementById("f-share_email");
    email.disabled = !e.target.checked;
    if (!e.target.checked) email.checked = false;
  });

  window.addEventListener("popstate", () => render(true));

  loadMe().then(() => render(false));
})();
