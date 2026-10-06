// Import of external rental listings from an authorized source, as a CSV file.
// This file only reads and checks rows; src/index.js does the database work.
// Nothing here fills in missing values: anything the source didn't give stays blank.
import { inMassachusetts } from "./validate.js";

export const IMPORT_LIMIT = 50; // listings per import
export const MAX_ROWS = 500; // rows per file
export const PRIORITY_CITIES = ["Boston", "Cambridge", "Somerville", "Waltham", "Newton", "Belmont"];
export const COLUMNS = [
  "source_name", "source_listing_id", "source_url", "property_name", "address", "city", "zip",
  "rent", "rent_basis", "fees", "bedrooms", "bathrooms", "available_date", "listing_status",
  "source_posted_date", "source_updated_date", "retrieved_date",
  "latitude", "longitude", "coordinates_permitted", "photo_url", "photo_license",
];

// RFC 4180 CSV: commas, double-quoted fields, "" for a quote inside quotes, CRLF or LF line ends.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const blank = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const clean = (v) => blank(String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+/g, " "));

function isoDate(v) {
  const t = blank(v);
  if (!t) return { value: null };
  let y, m, d;
  let mm = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) [, y, m, d] = mm;
  else if ((mm = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, m, d, y] = mm;
  else return { error: true };
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return { error: true };
  return { value: iso };
}

function money(v) {
  const t = blank(v);
  if (!t) return { value: null };
  if (/\d\s*(-|–|to)\s*\$?\d/.test(t)) return { error: "is a range; give one rent per listing" };
  const n = Number(t.replace(/[$,\s]|\/mo(nth)?$/gi, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return { error: "is not a rent amount" };
  return { value: Math.round(n) };
}

function count(v, field) {
  const t = blank(v);
  if (!t) return { value: null };
  if (field === "bedrooms" && /^studio$/i.test(t)) return { value: 0 };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 20 || (n * 2) % 1 !== 0) return { error: `${field} is not a number of rooms` };
  return { value: n };
}

// Massachusetts ZIP codes: 01001-02791, plus 05501 and 05544 (Andover).
const isMaZip = (z) => (z >= "01001" && z <= "02791") || z === "05501" || z === "05544";

const EXCLUDED_STATUS = /^(rented|leased|expired|unavailable|off[- ]?market|inactive|pending|sold|closed|removed)$/i;
const ACTIVE_STATUS = /^(active|available|for rent|listed)$/i;
const YES = /^(yes|y|true|1)$/i;
const NO = /^(no|n|false|0)$/i;

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

// Check one row. Returns { listing, errors, warnings, excluded }.
function checkRow(raw, { today, defaultSource }) {
  const errors = [];
  const warnings = [];
  const get = (k) => clean(raw[k]);
  const L = {};

  L.source_name = get("source_name") || defaultSource;
  if (!L.source_name) errors.push("source name is missing");
  else if (L.source_name.length > 80) errors.push("source name is too long");
  L.source_listing_id = get("source_listing_id");
  if (L.source_listing_id && L.source_listing_id.length > 120) errors.push("source listing id is too long");

  const url = get("source_url");
  L.source_url = url ? normalizeUrl(url) : null;
  if (!url) errors.push("source URL is missing");
  else if (!L.source_url || L.source_url.length > 500) errors.push("source URL must be a full https:// link");

  L.property_name = get("property_name");
  L.address = get("address");
  if (!L.property_name && !L.address) errors.push("needs a property name or an address");
  if (L.property_name && L.property_name.length > 120) errors.push("property name is too long");
  if (L.address && L.address.length > 200) errors.push("address is too long");

  L.city = get("city");
  if (L.city && L.city.length > 80) errors.push("city is too long");
  const zip = get("zip");
  L.zip = zip ? (zip.match(/^(\d{5})(-\d{4})?$/) || [])[1] || null : null;
  if (zip && !L.zip) errors.push("ZIP is not a 5-digit ZIP code");
  else if (L.zip && !isMaZip(L.zip)) errors.push("ZIP is not in Massachusetts");
  if (!L.city && !L.zip) errors.push("needs a city or a ZIP");

  const rent = money(raw.rent);
  if (rent.error) errors.push(`rent ${rent.error}`);
  L.rent = rent.value ?? null;
  const basis = get("rent_basis");
  if (!basis) L.rent_basis = null;
  else if (/^(unit|whole( unit)?|apartment|entire)$/i.test(basis)) L.rent_basis = "unit";
  else if (/^(room|per room|bedroom|bed)$/i.test(basis)) L.rent_basis = "room";
  else errors.push("rent basis must be unit or room");
  if (L.rent != null && !L.rent_basis) warnings.push("rent basis not given: shown as 'not stated'");

  L.fees = get("fees");
  if (L.fees && L.fees.length > 300) errors.push("fees text is too long");
  for (const f of ["bedrooms", "bathrooms"]) {
    const c = count(raw[f], f);
    if (c.error) errors.push(c.error);
    L[f] = c.value ?? null;
  }

  const avail = get("available_date");
  if (avail && /^(now|available now|immediately)$/i.test(avail)) {
    L.available_date = null;
    warnings.push("'available now' has no date: left blank");
  } else {
    const d = isoDate(avail);
    if (d.error) errors.push("available date is not a date (use YYYY-MM-DD)");
    L.available_date = d.value ?? null;
  }
  for (const [field, label] of [["source_posted_date", "posted date"], ["source_updated_date", "updated date"], ["retrieved_date", "retrieved date"]]) {
    const d = isoDate(raw[field]);
    if (d.error) errors.push(`${label} is not a date (use YYYY-MM-DD)`);
    else if (d.value && d.value > today) errors.push(`${label} is in the future`);
    L[field] = d.value ?? null;
  }
  if (!L.retrieved_date) L.retrieved_date = today;

  const status = get("listing_status");
  const excluded = !!status && EXCLUDED_STATUS.test(status);
  if (status && !excluded && !ACTIVE_STATUS.test(status)) errors.push(`status '${status}' is not active or available`);
  if (!status) warnings.push("no listing status given: treated as available");

  // Coordinates only when the source allows showing them.
  const lat = blank(raw.latitude);
  const lng = blank(raw.longitude);
  const permitted = clean(raw.coordinates_permitted);
  L.lat = null;
  L.lng = null;
  if (lat || lng) {
    if (!permitted || NO.test(permitted)) warnings.push("coordinates not marked as permitted: not used");
    else if (YES.test(permitted)) {
      const a = Number(lat);
      const b = Number(lng);
      if (!Number.isFinite(a) || !Number.isFinite(b)) errors.push("coordinates are not numbers");
      else if (!inMassachusetts(a, b)) errors.push("coordinates are outside Massachusetts");
      else {
        L.lat = Math.round(a * 1e6) / 1e6;
        L.lng = Math.round(b * 1e6) / 1e6;
      }
    } else errors.push("coordinates_permitted must be yes or no");
  }

  // Photos only with a reuse license.
  const photo = get("photo_url");
  const license = get("photo_license");
  L.photo_url = null;
  L.photo_license = null;
  if (photo && !license) warnings.push("photo has no reuse license: not used");
  else if (photo) {
    const p = normalizeUrl(photo);
    if (!p || p.length > 500) errors.push("photo URL must be a full https:// link");
    else if (license.length > 200) errors.push("photo license text is too long");
    else {
      L.photo_url = p;
      L.photo_license = license;
    }
  }
  return { listing: L, errors, warnings, excluded };
}

// Recently posted or updated first; listings without any source date come after dated ones.
const recency = (l) => l.source_updated_date || l.source_posted_date || "";
const cityRank = (l) => {
  const i = PRIORITY_CITIES.findIndex((c) => c.toLowerCase() === String(l.city || "").toLowerCase());
  return i < 0 ? PRIORITY_CITIES.length : i;
};

/**
 * Check a whole file. existing = { urls: Set, ids: Set("source|id") } already in the database.
 * Row statuses: ready (will be imported), excluded (rented/expired/...), duplicate, invalid, over_limit.
 */
export function previewImport(csvText, { today, defaultSource = null, existing = { urls: new Set(), ids: new Set() }, limit = IMPORT_LIMIT }) {
  const table = parseCsv(csvText);
  if (!table.length) return { error: "The file is empty." };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  if (!header.includes("source_url")) return { error: "The first line must be the column names, including source_url. Download the template." };
  const body = table.slice(1);
  if (body.length > MAX_ROWS) return { error: `The file has ${body.length} rows; the limit is ${MAX_ROWS}.` };
  const unknownColumns = header.filter((h) => h && !COLUMNS.includes(h));

  const seenUrls = new Set();
  const seenIds = new Set();
  const rows = body.map((cells, i) => {
    const raw = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""]));
    const { listing, errors, warnings, excluded } = checkRow(raw, { today, defaultSource });
    let status = errors.length ? "invalid" : excluded ? "excluded" : "ready";
    const reasons = errors.length ? errors : excluded ? [`listing status is '${clean(raw.listing_status)}'`] : [];
    if (status === "ready") {
      const idKey = listing.source_listing_id ? `${listing.source_name.toLowerCase()}|${listing.source_listing_id}` : null;
      if (existing.urls.has(listing.source_url) || (idKey && existing.ids.has(idKey))) {
        status = "duplicate";
        reasons.push("already imported");
      } else if (seenUrls.has(listing.source_url) || (idKey && seenIds.has(idKey))) {
        status = "duplicate";
        reasons.push("appears earlier in this file");
      }
      seenUrls.add(listing.source_url);
      if (idKey) seenIds.add(idKey);
    }
    return { row: i + 2, status, reasons, warnings, listing };
  });

  // Choose up to `limit` ready rows: priority cities first, then most recently posted or updated.
  const ready = rows.filter((r) => r.status === "ready");
  ready
    .slice()
    .sort((a, b) => cityRank(a.listing) - cityRank(b.listing) || recency(b.listing).localeCompare(recency(a.listing)) || a.row - b.row)
    .forEach((r, i) => {
      if (i >= limit) {
        r.status = "over_limit";
        r.reasons.push(`only ${limit} listings are imported at a time`);
      }
    });

  const summary = { received: rows.length, ready: 0, excluded: 0, duplicate: 0, invalid: 0, over_limit: 0 };
  for (const r of rows) summary[r.status]++;
  return { rows, summary, unknownColumns, limit };
}
