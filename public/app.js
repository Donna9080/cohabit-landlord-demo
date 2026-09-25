// coHabit landlord demo: two screens, switched by the address bar.
//   /                      → Landlord Dashboard
//   /properties/<id>       → Property and Tenants
// Cloudflare serves index.html for every address, so refreshing any page works.
(function () {
  const app = document.getElementById("app");
  const properties = (window.COHABIT_DATA && window.COHABIT_DATA.properties) || [];

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (name, size) =>
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const initials = (name) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function pill(status) {
    const kind = status === "All clear" ? "ok" : "warn";
    return `<span class="pill pill-${kind}"><span class="dot" aria-hidden="true"></span>${esc(status)}</span>`;
  }

  const footnote = `<p class="footnote">Demo for a class project. All names, addresses, and contact details are fictional sample data.</p>`;

  function dashboard() {
    const tenantTotal = properties.reduce((sum, p) => sum + p.tenants.length, 0);
    const cards = properties
      .map(
        (p) => `
      <li>
        <a class="card" href="/properties/${encodeURIComponent(p.id)}">
          <div class="card-top">
            <span class="icon-tile">${icon("house", 20)}</span>
            ${pill(p.status)}
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
      title: "Your properties",
      html: `
      <div class="heading">
        <h1 tabindex="-1">Your properties</h1>
        <p class="muted">${plural(properties.length, "sample property", "sample properties")} in Waltham, MA · ${plural(tenantTotal, "tenant", "tenants")}</p>
      </div>
      <ul class="grid" role="list">${cards}</ul>
      ${footnote}`,
    };
  }

  const backLink = `<a class="back" href="/">${icon("left", 16)} Back to dashboard</a>`;

  function propertyPage(p) {
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
      ${backLink}
      <div class="title-block">
        <div class="title-row">
          <h1 tabindex="-1">${esc(p.address)}</h1>
          ${pill(p.status)}
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
      ${footnote}`,
    };
  }

  function notFound() {
    return {
      title: "Property not found",
      html: `
      ${backLink}
      <div class="heading">
        <h1 tabindex="-1">Property not found</h1>
        <p class="muted">This address doesn't match any sample property. Go back to the dashboard to pick one.</p>
      </div>`,
    };
  }

  function route(path) {
    const clean = path.replace(/\/+$/, "") || "/";
    if (clean === "/" || clean === "/index.html") return dashboard();
    const m = clean.match(/^\/properties\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const p = properties.find((x) => x.id === id);
      if (p) return propertyPage(p);
    }
    return notFound();
  }

  function render(moveFocus) {
    const view = route(location.pathname);
    app.innerHTML = view.html;
    document.title = `${view.title} · coHabit demo`;
    if (moveFocus) {
      window.scrollTo(0, 0);
      const h1 = app.querySelector("h1");
      if (h1) h1.focus({ preventScroll: true });
    }
  }

  // Handle clicks on links inside the site without a full page reload.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || a.target) return;
    e.preventDefault();
    if (url.pathname !== location.pathname) history.pushState(null, "", url.pathname);
    render(true);
  });
  window.addEventListener("popstate", () => render(true));

  render(false);
})();
