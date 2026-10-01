// coHabit: screens switched by the address bar. Cloudflare serves index.html for
// every address, so refreshing any page works. Data comes from /api/* (src/index.js).
//
//   /                        Front page (public)
//   /privacy, /terms         Privacy policy and terms of use (public)
//   /listings                Active units, listing fields only (public)
//   /sample, /properties/<id>  Fictional sample dashboard (public, clearly labeled)
//   /welcome                 After Google sign-in: choose landlord or renter (once)
//   /account                 Your name, email, account type; delete my account
//   /landlord                Dashboard: a landlord's own units and recent requests
//   /landlord/units/new      Add a unit
//   /landlord/units/<id>     One unit: details and the renters interested in it
//   /landlord/units/<id>/edit  Edit or delete a unit
//   /renter                  A renter's match preferences and matching units
//   /admin                   Read-only user list (admins only; enforced by the server)
(function () {
  const app = document.getElementById("app");
  const brandSub = document.getElementById("brand-sub");
  const accountEl = document.getElementById("account");
  const navEl = document.getElementById("nav");
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
      toast(e.message);
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

  // Top bar: the same links on every page and every screen size.
  function navItems() {
    const u = me.user;
    const items = [];
    if (u && u.accountType === "landlord") items.push(["/landlord", "Dashboard"]);
    else if (u && u.accountType === "renter") items.push(["/renter", "My matches"]);
    else if (u) items.push(["/welcome", "Get started"]);
    items.push(["/listings", "Listings"]);
    if (u && u.isAdmin) items.push(["/admin", "Admin"]);
    return items;
  }

  function renderAccount() {
    const u = me.user;
    const path = location.pathname.replace(/\/+$/, "") || "/";
    const current = (href) => (path === href || path.startsWith(href + "/") ? ' aria-current="page"' : "");
    navEl.innerHTML = navItems()
      .map(([href, label]) => `<a class="nav-item" href="${href}"${current(href)}>${label}</a>`)
      .join("");
    accountEl.innerHTML = u
      ? `<a class="nav-item who" href="/account"${current("/account")} title="Your account: ${esc(u.email)}"><span class="avatar avatar-sm" aria-hidden="true">${esc(initials(u.name || u.email))}</span><span class="who-name">${esc(u.name)}</span><span class="sr-only">Your account</span></a>
         <button class="btn btn-small btn-quiet" type="button" data-action="sign-out">Sign out</button>`
      : `<button class="btn btn-small" type="button" data-action="sign-in">Sign in</button>`;
  }

  // ── Messages: success banner on the next screen, and short pop-up notes ──────
  let flash = null;
  const setFlash = (text) => (flash = text);

  let toastTimer;
  function toast(text) {
    const el = document.getElementById("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 5000);
  }

  // ── Shared view pieces ───────────────────────────────────────────────────────
  const sampleFootnote = `<p class="footnote">All names, addresses, and contact details shown are fictional sample data.</p>`;
  const sampleTag = `<span class="tag">Fictional sample data</span>`;

  // An in-page "are you sure?" box. Resolves true only when the confirm button is pressed.
  function confirmDialog({ title, text, confirmLabel, danger = false }) {
    const dialog = document.getElementById("confirm");
    if (!dialog || !dialog.showModal) return Promise.resolve(window.confirm(`${title}\n\n${text}`));
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-text").textContent = text;
    const ok = document.getElementById("confirm-ok");
    ok.textContent = confirmLabel;
    ok.className = danger ? "btn btn-danger-solid" : "btn";
    // Answer on the click itself. (The dialog's own "close" event can arrive late when the page isn't being drawn.)
    return new Promise((resolve) => {
      const finish = (answer) => {
        dialog.removeEventListener("click", onClick);
        dialog.removeEventListener("cancel", onCancel);
        if (dialog.open) dialog.close();
        resolve(answer);
      };
      const onClick = (e) => {
        const button = e.target.closest("button");
        if (!button) return;
        e.preventDefault();
        finish(button.value === "ok");
      };
      const onCancel = (e) => {
        e.preventDefault(); // Escape key
        finish(false);
      };
      dialog.addEventListener("click", onClick);
      dialog.addEventListener("cancel", onCancel);
      dialog.showModal();
    });
  }

  function statusPill(status) {
    return status === "active"
      ? `<span class="pill pill-ok"><span class="dot" aria-hidden="true"></span>Active</span>`
      : `<span class="pill pill-off"><span class="dot" aria-hidden="true"></span>Inactive</span>`;
  }

  // One block for every "nothing here yet" situation: what it is, why, and what to do next.
  function emptyState(title, text, action = "") {
    return `<div class="empty"><p class="empty-title">${title}</p><p>${text}</p>${action ? `<div class="actions">${action}</div>` : ""}</div>`;
  }

  const tile = (label, value, note = "") =>
    `<div class="tile"><dt>${label}</dt><dd>${value}</dd>${note ? `<span class="tile-note">${note}</span>` : ""}</div>`;

  const sampleNotice = (extra = "") =>
    `<div class="notice notice-info" role="note"><span><strong>Sample data.</strong> Everything on this page is fictional and only shows how coHabit looks. ${extra}</span></div>`;

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
  function home() {
    const u = me.user;
    const role = u && u.accountType;
    const landlordCard = `
          <a class="choice" href="/landlord">
            <span class="choice-top"><span class="choice-icon">${icon("building", 24)}</span></span>
            <span class="choice-text">
              <span class="choice-title">${role === "landlord" ? "Your dashboard" : "I have rooms to rent"}</span>
              <span class="choice-desc">List your units, keep rent and move-in dates current, and hear from interested renters.</span>
            </span>
            <span class="choice-cta">${role === "landlord" ? "Open your dashboard" : "Go to the landlord dashboard"} ${icon("right", 16)}</span>
          </a>`;
    const renterCard = `
          <a class="choice" href="/renter">
            <span class="choice-top"><span class="choice-icon">${icon("user", 24)}</span></span>
            <span class="choice-text">
              <span class="choice-title">${role === "renter" ? "Your matches" : "I'm looking for a room"}</span>
              <span class="choice-desc">Answer a short questionnaire, see rooms that match, and contact the landlord.</span>
            </span>
            <span class="choice-cta">${role === "renter" ? "See your matches" : "Find a room"} ${icon("right", 16)}</span>
          </a>`;
    // Signed-in people only see the card for their own side.
    const cards = role === "landlord" ? landlordCard : role === "renter" ? renterCard : landlordCard + renterCard;
    return {
      title: "Welcome",
      html: `
      <div class="home">
        <div class="hero">
          <p class="eyebrow">Shared student housing</p>
          <h1 tabindex="-1">${u ? `Welcome back, ${esc((u.name || "").split(" ")[0] || "there")}` : "Welcome to coHabit"}</h1>
          <p class="lead">Landlords list rooms. Renters find ones that fit.</p>
        </div>
        <div class="choices${role ? " choices-one" : ""}">${cards}
        </div>
        <div class="actions home-actions">
          <a class="btn btn-quiet" href="/listings">Browse listings</a>
          <a class="btn btn-quiet" href="/sample">View a sample dashboard</a>
        </div>
      </div>`,
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
    if (!interests.length) return emptyState("No landlords contacted yet", "Click “I'm interested” on a room to send the landlord your name, email and a note.");
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
    if (!(await confirmDialog({ title: "Withdraw your request?", text: "The landlord will no longer see it. You can send a new one later.", confirmLabel: "Withdraw" }))) return;
    try {
      await api(`/api/renter/interests/${encodeURIComponent(unitId)}`, { method: "DELETE" });
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      if (e.status !== 404) return toast(e.message);
    }
    myInterests.delete(unitId);
    const box = interestBox(unitId);
    if (box) box.innerHTML = interestState(unitId);
    refreshContacted().catch(() => {});
  }

  async function removeInterest(id, button) {
    if (!(await confirmDialog({ title: "Remove this request?", text: "It disappears from your list. The renter is not notified.", confirmLabel: "Remove" }))) return;
    button.disabled = true;
    try {
      await api(`/api/landlord/interests/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      if (e.status !== 404) {
        button.disabled = false;
        return toast(e.message);
      }
    }
    setFlash("Request removed.");
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

  // Sorting and searching happen in the browser on the list already loaded.
  const sortSelect = (id, value, options) =>
    `<label class="sort" for="${id}"><span>Sort by</span><select id="${id}">${options
      .map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${l}</option>`)
      .join("")}</select></label>`;
  const byRent = (a, b) => a.monthly_rent - b.monthly_rent;
  const byDate = (a, b) => a.move_in_date.localeCompare(b.move_in_date);

  let lastListings = [];
  let listingSort = "date";
  let listingQuery = "";

  function listingsGrid() {
    const q = listingQuery.trim().toLowerCase();
    const list = lastListings.filter((u) => !q || `${u.area} ${u.name}`.toLowerCase().includes(q)).sort(listingSort === "rent" ? byRent : byDate);
    const count = document.getElementById("listing-count");
    if (count) count.textContent = q ? `${plural(list.length, "listing", "listings")} for “${listingQuery.trim()}”` : "";
    if (!list.length)
      return emptyState("No listings match your search", "Try a different area, or clear the search to see everything.", `<button class="btn btn-quiet" type="button" data-action="clear-search">Clear search</button>`);
    return `<ul class="grid" role="list">${list.map((u) => listingCard(u)).join("")}</ul>`;
  }

  async function listings() {
    const [{ listings }] = await Promise.all([api("/api/listings"), loadMyInterests()]);
    lastListings = listings;
    listingQuery = "";
    const hasSample = listings.some((u) => u.sample);
    return {
      title: "Listings",
      html: `
      <div class="heading">
        <h1 tabindex="-1">Listings</h1>
        <p class="muted">${plural(listings.length, "room listing", "room listings")} available now.${isRenter() ? "" : ` Looking for a room? <a href="/renter">See which ones match you</a>.`}</p>
      </div>
      ${hasSample ? `<div class="notice notice-info" role="note"><span>Listings tagged <span class="tag">Sample</span> are fictional and can't be contacted.</span></div>` : ""}
      ${
        listings.length
          ? `<div class="toolbar">
        <div class="field search"><label for="listing-search">Search by area or name</label><input id="listing-search" type="search" placeholder="Waltham" autocomplete="off" /></div>
        ${sortSelect("listing-sort", listingSort, [["date", "Soonest move-in"], ["rent", "Lowest rent"]])}
      </div>
      <p class="muted small" id="listing-count" role="status"></p>
      <div id="listing-grid">${listingsGrid()}</div>`
          : emptyState("No listings yet", "When a landlord adds an active unit, it shows up here.", `<a class="btn btn-quiet" href="/">Back to home</a>`)
      }`,
    };
  }

  // ── Sample (fictional) dashboard and tenant page ─────────────────────────────
  function sampleDashboard() {
    const tenantTotal = sample.reduce((sum, p) => sum + p.tenants.length, 0);
    const ending = sample.filter((p) => p.status !== "All clear").length;
    const cards = sample
      .map(
        (p) => `
      <li>
        <a class="card" href="/properties/${encodeURIComponent(p.id)}">
          <div class="card-top">
            <span class="icon-tile">${icon("house", 20)}</span>
            <span class="card-tags"><span class="tag">Sample</span>${samplePill(p.status)}</span>
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
          <span class="card-link">View tenants ${icon("chevron", 16)}</span>
        </a>
      </li>`
      )
      .join("");

    return {
      title: "Sample dashboard",
      html: `
      ${sampleNotice(`<a href="/landlord">Open your own dashboard</a>`)}
      <div class="heading">
        <h1 tabindex="-1">Sample landlord dashboard</h1>
        <p class="muted">Choose a property to see who lives there.</p>
      </div>
      <dl class="tiles">
        ${tile("Properties", sample.length)}
        ${tile("Tenants", tenantTotal)}
        ${tile("Leases ending soon", ending)}
      </dl>
      <ul class="grid" role="list">${cards}</ul>`,
    };
  }

  const sampleBack = `<a class="back" href="/sample">${icon("left", 16)} Sample dashboard</a>`;

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
      html: `
      ${sampleBack}
      ${sampleNotice()}
      <div class="title-block">
        <div class="title-row">
          <h1 tabindex="-1">${esc(p.address)}</h1>
          ${samplePill(p.status)}
        </div>
        <p class="muted">${esc(p.city)}</p>
      </div>
      <dl class="tiles">
        ${tile("Lease end date", esc(p.leaseEnd))}
        ${tile("Tenants", p.tenants.length, "living here")}
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
            : emptyState("No tenants listed", "This sample property has no tenants.")
        }
      </section>`,
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

  // ── Landlord: dashboard → unit page (details + interested renters) → dashboard ─
  const requestsLabel = (n) => (n ? plural(n, "request", "requests") : "No requests yet");

  async function landlordDashboard() {
    const blocked = gate("landlord");
    if (blocked !== undefined) return blocked;
    const [{ units }, { interests }] = await Promise.all([api("/api/landlord/units"), api("/api/landlord/interests")]);
    const active = units.filter((u) => u.status === "active").length;
    const perUnit = new Map();
    for (const i of interests) perUnit.set(i.unitId, (perUnit.get(i.unitId) || 0) + 1);
    const cards = units
      .map((u) => {
        const n = perUnit.get(u.id) || 0;
        return `
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
          <span class="card-link">${n ? `${requestsLabel(n)} · view` : "View unit"} ${icon("chevron", 16)}</span>
        </a>
      </li>`;
      })
      .join("");
    const recent = interests
      .slice(0, 5)
      .map(
        (i) => `
      <li>
        <span class="person"><span class="avatar" aria-hidden="true">${esc(initials(i.renterName || i.renterEmail))}</span>
          <span><span class="name">${esc(i.renterName)}</span><span class="muted small block">${esc(i.unitName)} · ${esc(fmtJoined(i.createdAt))}</span></span></span>
        <a class="btn btn-small btn-quiet" href="/landlord/units/${encodeURIComponent(i.unitId)}">View</a>
      </li>`
      )
      .join("");
    return {
      title: "Dashboard",
      html: `
      <div class="heading-row">
        <div class="heading">
          <h1 tabindex="-1">Your units</h1>
          <p class="muted">Choose a unit to see its details and the renters interested in it.</p>
        </div>
        <a class="btn" href="/landlord/units/new">${icon("plus", 18)} Add a unit</a>
      </div>
      ${
        units.length
          ? `<dl class="tiles">
        ${tile("Units", units.length)}
        ${tile("Active", active, "visible to renters")}
        ${tile("Requests", interests.length, "from renters")}
      </dl>
      <ul class="grid" role="list">${cards}</ul>
      <section aria-labelledby="recent-heading">
        <div class="section-heading"><h2 id="recent-heading">Recent requests</h2></div>
        ${
          interests.length
            ? `<ul class="rows" role="list">${recent}</ul>${interests.length > 5 ? `<p class="hint">Showing the 5 newest. Open a unit to see all of its requests.</p>` : ""}`
            : emptyState("No requests yet", "When a renter clicks “I'm interested” on one of your active units, they appear here with their name, email and note.")
        }
      </section>`
          : emptyState(
              "Add your first unit",
              "List a room or unit with its area, rent and move-in date. Active units are shown to renters right away.",
              `<a class="btn" href="/landlord/units/new">${icon("plus", 18)} Add a unit</a><a class="btn btn-quiet" href="/sample">View a sample dashboard</a>`
            )
      }`,
    };
  }

  async function unitPage(id) {
    const blocked = gate("landlord");
    if (blocked !== undefined) return blocked;
    const [{ unit: u }, { interests }] = await Promise.all([api(`/api/landlord/units/${encodeURIComponent(id)}`), api("/api/landlord/interests")]);
    const mine = interests.filter((i) => i.unitId === u.id);
    const people = mine
      .map(
        (i) => `
      <li class="request">
        <div class="request-top">
          <span class="person"><span class="avatar" aria-hidden="true">${esc(initials(i.renterName || i.renterEmail))}</span>
            <span><span class="name">${esc(i.renterName)}</span><a class="small block" href="mailto:${esc(i.renterEmail)}">${esc(i.renterEmail)}</a></span></span>
          <span class="muted small">${esc(fmtJoined(i.createdAt))}</span>
        </div>
        <p class="request-note">${i.message ? `“${esc(i.message)}”` : `<span class="muted">No note.</span>`}</p>
        <div class="actions">
          <a class="btn btn-small" href="mailto:${esc(i.renterEmail)}">Reply by email</a>
          <button class="btn btn-small btn-quiet" type="button" data-action="interest-remove" data-id="${esc(i.id)}">Remove</button>
        </div>
      </li>`
      )
      .join("");
    return {
      title: u.name,
      html: `
      <a class="back" href="/landlord">${icon("left", 16)} Dashboard</a>
      <div class="heading-row">
        <div class="title-block">
          <div class="title-row">
            <h1 tabindex="-1">${esc(u.name)}</h1>
            ${statusPill(u.status)}
          </div>
          <p class="muted">${esc(u.area)}${u.status === "active" ? "" : " · hidden from renters"}</p>
        </div>
        <a class="btn" href="/landlord/units/${encodeURIComponent(u.id)}/edit">Edit unit</a>
      </div>
      <dl class="tiles">
        ${tile("Rent", money(u.monthly_rent), "per room, per month")}
        ${tile("Rooms available", u.rooms_available)}
        ${tile("Move-in date", fmtDate(u.move_in_date))}
      </dl>
      ${u.description ? `<section aria-labelledby="desc-heading"><div class="section-heading"><h2 id="desc-heading">Description</h2></div><p class="desc">${esc(u.description)}</p></section>` : ""}
      <section aria-labelledby="requests-heading">
        <div class="section-heading"><h2 id="requests-heading">Interested renters</h2><span class="muted small">${mine.length ? plural(mine.length, "request", "requests") : ""}</span></div>
        ${
          mine.length
            ? `<ul class="requests" role="list">${people}</ul><p class="hint">Renters don't see your email address unless you write to them.</p>`
            : emptyState(
                "No requests for this unit yet",
                u.status === "active" ? "Renters who click “I'm interested” on this unit appear here with their name, email and note." : "This unit is inactive, so renters can't see it. Set it to active to start receiving requests.",
                u.status === "active" ? "" : `<a class="btn btn-quiet" href="/landlord/units/${encodeURIComponent(u.id)}/edit">Edit unit</a>`
              )
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
    const blocked = gate("landlord");
    if (blocked !== undefined) return blocked;
    const isNew = !id;
    const u = isNew
      ? { name: "", area: "", monthly_rent: "", rooms_available: 1, move_in_date: "", description: "", status: "active" }
      : (await api(`/api/landlord/units/${encodeURIComponent(id)}`)).unit;
    const backHref = isNew ? "/landlord" : `/landlord/units/${encodeURIComponent(id)}`;
    return {
      title: isNew ? "Add a unit" : `Edit ${u.name}`,
      html: `
      <a class="back" href="${backHref}">${icon("left", 16)} ${isNew ? "Dashboard" : "Back to unit"}</a>
      <div class="heading">
        <h1 tabindex="-1">${isNew ? "Add a unit" : "Edit unit"}</h1>
        <p class="muted">${isNew ? "Renters see everything here except the status." : esc(u.name)}</p>
      </div>
      <form class="form" id="unit-form" novalidate data-unit-id="${esc(id || "")}">
        <fieldset>
          <legend>Listing details</legend>
          ${field("name", "Unit name", input("name", 'type="text" maxlength="80" required autocomplete="off"', u.name), "A short name renters will see, like “Sunny 3-bedroom near campus”. Don't use the street address.")}
          ${field("area", "General area", input("area", 'type="text" maxlength="80" required autocomplete="off"', u.area), "Neighborhood or city only, like “Waltham, MA”.")}
          <div class="field-row">
            ${field("monthly_rent", "Monthly rent per room ($)", input("monthly_rent", 'type="number" min="1" max="50000" step="1" required inputmode="numeric"', u.monthly_rent))}
            ${field("rooms_available", "Rooms available", input("rooms_available", 'type="number" min="1" max="20" step="1" required inputmode="numeric"', u.rooms_available))}
          </div>
          <div class="field-row">
            ${field("move_in_date", "Move-in date", input("move_in_date", 'type="date" required', u.move_in_date))}
            ${field("status", "Status", select("status", [["active", "Active: shown to renters"], ["inactive", "Inactive: hidden"]], u.status))}
          </div>
          ${field("description", "Short description (optional)", `<textarea id="f-description" name="description" maxlength="1000" rows="4" aria-describedby="h-description e-description">${esc(u.description)}</textarea>`, "Up to 1,000 characters. Leave out phone numbers and addresses.")}
        </fieldset>
        <p class="form-error" id="form-error" role="alert"></p>
        <div class="actions">
          <button class="btn" type="submit">${isNew ? "Add unit" : "Save changes"}</button>
          <a class="btn btn-quiet" href="${backHref}">Cancel</a>
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
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const { unit } = await api(id ? `/api/landlord/units/${encodeURIComponent(id)}` : "/api/landlord/units", { method: id ? "PUT" : "POST", body });
      setFlash(id ? "Changes saved." : "Unit added. It's now on your dashboard.");
      navigate(`/landlord/units/${encodeURIComponent(unit.id)}`);
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      showErrors(form, e);
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function deleteUnit(id) {
    if (!(await confirmDialog({ title: "Delete this unit?", text: "Its requests from renters are deleted too. This can't be undone.", confirmLabel: "Delete unit", danger: true }))) return;
    try {
      await api(`/api/landlord/units/${encodeURIComponent(id)}`, { method: "DELETE" });
      setFlash("Unit deleted.");
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

  let lastMatches = null;
  let matchSort = "best";

  function matchesHtml(data) {
    lastMatches = data;
    if (data.needsPreferences) return emptyState("Save your preferences first", "Fill in the questionnaire and save to see rooms that match.");
    if (!data.matches.length)
      return emptyState("No rooms match yet", "Try a wider budget, a different area or another month.", `<button class="btn btn-quiet" type="button" data-action="edit-prefs">Edit preferences</button><a class="btn btn-quiet" href="/listings">Browse all listings</a>`);
    const list = [...data.matches];
    if (matchSort === "rent") list.sort((a, b) => byRent(a.unit, b.unit));
    else if (matchSort === "date") list.sort((a, b) => byDate(a.unit, b.unit));
    return `<ul class="grid" role="list">${list
      .map((m) =>
        listingCard(
          m.unit,
          `<span class="pill pill-ok" title="Match score out of 100">${m.score}% match</span>`
        ).replace("<hr />", `<ul class="reasons">${m.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul><hr />`)
      )
      .join("")}</ul>`;
  }

  function roommatesHtml(data) {
    if (data.needsPreferences) return emptyState("Save your preferences first", "Roommate matching uses your lifestyle answers.");
    if (!data.optedIn)
      return emptyState(
        "Roommate matching is off",
        "Turn on “Show me to compatible renters” in your preferences to see renters you'd get along with. You only see people who turned it on too.",
        `<button class="btn btn-quiet" type="button" data-action="edit-prefs">Edit preferences</button>`
      );
    if (!data.roommates.length)
      return emptyState("No compatible renters yet", "Nobody else has your area and move-in month right now. Check back as more people join.");
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

  // Saved answers at a glance, so the long form only opens when the renter wants to change something.
  function prefsSummary(p) {
    const life = Object.entries(CHOICES)
      .map(([k, [label, opts]]) => {
        const answer = (opts.find((o) => o[0] === p[k]) || [])[1];
        return answer && `${label}: ${answer.toLowerCase()}`;
      })
      .filter(Boolean);
    return `
      <section class="summary" aria-labelledby="prefs-heading">
        <div class="heading-row">
          <div class="section-heading"><h2 id="prefs-heading">Your preferences</h2><span class="muted small">saved ${esc(fmtJoined(p.updated_at))}</span></div>
          <button class="btn btn-quiet" type="button" data-action="edit-prefs" aria-expanded="false" aria-controls="prefs-form">Edit preferences</button>
        </div>
        <dl class="tiles">
          ${tile("Budget", `${money(p.budget_min)} to ${money(p.budget_max)}`, "per month")}
          ${tile("Move-in", fmtDate(p.move_in_month))}
          ${tile("Area", esc(p.area))}
          ${tile("Rooms needed", p.rooms_needed)}
        </dl>
        <ul class="reasons" aria-label="How you like to live">
          ${life.map((l) => `<li>${esc(l)}</li>`).join("")}
          <li>${p.roommate_visible ? (p.share_email ? "Roommate matching on, email shared" : "Roommate matching on") : "Roommate matching off"}</li>
        </ul>
      </section>`;
  }

  async function renterPage() {
    const blocked = gate("renter");
    if (blocked !== undefined) return blocked;
    const [{ preferences: p }, matches, mates, contacted] = await Promise.all([api("/api/renter/preferences"), api("/api/renter/matches"), api("/api/renter/roommates"), loadMyInterests()]);
    const v = p || { budget_min: "", budget_max: "", move_in_month: "", area: "", rooms_needed: 1 };
    const lifestyle = Object.entries(CHOICES)
      .map(([k, [label, opts]]) => field(k, label, select(k, (p ? [] : [["", "Choose…"]]).concat(opts), v[k] || "")))
      .join("");
    return {
      title: "Your matches",
      html: `
      <div class="heading">
        <h1 tabindex="-1">${p ? "Your matches" : "Find your room"}</h1>
        <p class="muted">${p ? "Rooms and renters that fit the preferences you saved." : "Answer these once. We'll save them so you can come back and edit them."}</p>
      </div>
      ${p ? prefsSummary(p) : ""}
      <form class="form" id="prefs-form" novalidate${p ? " hidden" : ""}>
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
          ${p ? `<button class="btn btn-quiet" type="button" data-action="edit-prefs">Cancel</button>` : ""}
        </div>
      </form>
      <section aria-labelledby="matches-heading">
        <div class="heading-row">
          <div class="section-heading"><h2 id="matches-heading">Matching rooms</h2><span class="muted small" id="match-count">${matches.matches.length ? plural(matches.matches.length, "match", "matches") : ""}</span></div>
          ${matches.matches.length > 1 ? sortSelect("match-sort", matchSort, [["best", "Best match"], ["rent", "Lowest rent"], ["date", "Soonest move-in"]]) : ""}
        </div>
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

  // Open or close the questionnaire on the renter page.
  function togglePrefsForm() {
    const form = document.getElementById("prefs-form");
    if (!form) return;
    form.hidden = !form.hidden;
    const opener = document.querySelector('.summary [data-action="edit-prefs"]');
    if (opener) {
      opener.setAttribute("aria-expanded", String(!form.hidden));
      opener.textContent = form.hidden ? "Edit preferences" : "Close";
    }
    if (!form.hidden) {
      form.scrollIntoView({ block: "start", behavior: "smooth" });
      form.querySelector("input").focus({ preventScroll: true });
    }
  }

  async function submitPrefs(form) {
    const body = formData(form, ["budget_min", "budget_max", "rooms_needed"]);
    body.roommate_visible = form.elements.roommate_visible.checked;
    body.share_email = body.roommate_visible && form.elements.share_email.checked;
    const btn = form.querySelector("[type=submit]");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await api("/api/renter/preferences", { method: "PUT", body });
      setFlash("Preferences saved. Your matches are up to date.");
      render(true);
    } catch (e) {
      if (e.status === 401) return showView(errorView(e));
      showErrors(form, e);
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ── Admin ────────────────────────────────────────────────────────────────────
  async function adminPage() {
    if (!me.user) return signInView("/admin");
    const { users } = await api("/api/admin/users");
    const detail = (u) =>
      u.accountType === "landlord"
        ? plural(u.unitCount, "unit", "units")
        : u.accountType === "renter"
          ? u.hasPreferences
            ? "Preferences saved"
            : "No preferences yet"
          : "Not started";
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
    return {
      title: "Users",
      html: `
      <div class="heading">
        <h1 tabindex="-1">Users</h1>
        <p class="muted">Everyone who has signed in. Read only.</p>
      </div>
      <dl class="tiles">
        ${tile("People", real.length)}
        ${tile("Landlords", real.filter((u) => u.accountType === "landlord").length)}
        ${tile("Renters", real.filter((u) => u.accountType === "renter").length)}
        ${samples ? tile("Sample accounts", samples, "fictional, not counted") : ""}
      </dl>
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
    return messageView("Page not found", "This page doesn't exist or has moved.", `<a class="btn" href="/">Go to home page</a>`);
  }

  // ── Router ───────────────────────────────────────────────────────────────────
  function route(path) {
    const clean = path.replace(/\/+$/, "") || "/";
    if (clean === "/" || clean === "/index.html" || clean === "/how-it-works") return home();
    if (clean === "/privacy") return privacy();
    if (clean === "/terms") return terms();
    if (clean === "/listings") return listings();
    if (clean === "/sample") return sampleDashboard();
    if (clean === "/welcome") return welcome();
    if (clean === "/account") return accountPage();
    if (clean === "/signin-error")
      return messageView("Sign-in didn't work", "Google sign-in was cancelled or failed. Nothing was changed.", `<button class="btn" type="button" data-action="sign-in">Try again</button><a class="btn btn-quiet" href="/">Go to home page</a>`);
    if (clean === "/landlord") return landlordDashboard();
    if (clean === "/landlord/units/new") return unitForm(null);
    let m = clean.match(/^\/landlord\/units\/([^/]+)\/edit$/);
    if (m) return unitForm(safeDecode(m[1]));
    m = clean.match(/^\/landlord\/units\/([^/]+)$/);
    if (m) return unitPage(safeDecode(m[1]));
    if (clean === "/renter") return renterPage();
    if (clean === "/admin") return adminPage();
    m = clean.match(/^\/properties\/([^/]+)$/);
    if (m) {
      const p = sample.find((x) => x.id === safeDecode(m[1]));
      return p ? samplePropertyPage(p) : messageView("Property not found", "This address doesn't match any sample property.", `<a class="btn" href="/sample">Back to sample dashboard</a>`);
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
    const notice = flash
      ? `<div class="notice notice-success" role="status"><span>${esc(flash)}</span><button class="notice-close" type="button" data-action="dismiss-notice" aria-label="Dismiss message">×</button></div>`
      : "";
    flash = null;
    app.innerHTML = notice + view.html;
    document.title = `${view.title} · coHabit`;
    app.setAttribute("aria-busy", "false");
    renderAccount();
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
        if (seq === renderSeq) app.innerHTML = `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Loading…</div>`;
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
      else if (a === "dismiss-notice") action.closest(".notice").remove();
      else if (a === "edit-prefs") togglePrefsForm();
      else if (a === "clear-search") {
        listingQuery = "";
        document.getElementById("listing-search").value = "";
        document.getElementById("listing-grid").innerHTML = listingsGrid();
      }
      return;
    }
    const link = e.target.closest("a");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((link.getAttribute("href") || "").startsWith("#")) return; // in-page jumps such as "Skip to content"
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

  // Sorting and searching lists.
  document.addEventListener("change", (e) => {
    if (e.target.id === "match-sort") {
      matchSort = e.target.value;
      document.getElementById("matches").innerHTML = matchesHtml(lastMatches);
    } else if (e.target.id === "listing-sort") {
      listingSort = e.target.value;
      document.getElementById("listing-grid").innerHTML = listingsGrid();
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id !== "listing-search") return;
    listingQuery = e.target.value;
    document.getElementById("listing-grid").innerHTML = listingsGrid();
  });

  window.addEventListener("popstate", () => render(true));

  loadMe().then(() => render(false));
})();
