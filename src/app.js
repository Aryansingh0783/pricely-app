/* ==========================================================================
   PRICELY — application shell
   The UI is a thin skin over engine.mjs. It NEVER does arithmetic itself:
   every rupee on screen comes from a pure engine function.

   INTERACTION CONTRACT — read this before adding a control.
   Every interactive element declares ONE attribute pair:
       data-act="<action>"  [data-val="<argument>"]
   Delegation matches exactly `[data-act]`, scoped inside #app.
   Nothing else in the DOM may use data-act.

   This rule exists because the previous version delegated over a list of
   attributes that included [data-theme] — and <html> carries data-theme for
   theming. closest() walked up to <html> on any stray click and flipped the
   theme. One namespace, one selector, that whole class of bug is gone.
   ========================================================================== */

const S = {
  tab: "today",
  quote: { serviceId: "gel-mani", hands: 2, length: "S", coats: 2, addons: [],
           overridePaise: null, nails: null },   // null = "all nails of `hands`" 
  job: { nails: {}, serviceId: "gel-mani", addons: [], timerStart: null, elapsed: 0,
         method: "UPI", client: "",
         /* Micro-usage: WHICH nails each add-on covers, as a map of nail keys
            ({"L:thumb":1}). Missing = "every nail selected for the job".
            A set rather than a count so the picture and the price can never
            disagree — they read the same object. */
         addonNails: {},
         paintAddon: null },   // add-on currently being assigned by tapping nails
  pricingView: "calc",   // calc | list — the merged Pricing tab
  /* How much of each product a nail actually takes, and how much we trust it.
     { [productId]: { qtyPerNail, source, unitsSinceOpen, calibrations } } */
  usage: {},
  usageSheetId: null,    // which product's "how far does it go?" sheet is open
  pendingCalib: null,    // a measurement awaiting her confirmation
  sheet: null,
  toast: null,
  theme: localStorage.getItem("nsos.theme") || "light",
  assumptions: { ...NS.DEFAULT_ASSUMPTIONS },
  // HER price list, in paise, keyed by service id. This is the primary input.
  myPrices: { ...NS.DEFAULT_PRICES },
  showRecommended: false,   // the engine's opinion is opt-in, never imposed
  // HER catalogue: services/add-ons she creates, items she stocks.
  custom: { services: [], addons: [], products: [] },
  // Per-service overrides of the seeded numbers: { [id]: { minutes, materialPaise } }
  overrides: {},
  dashPeriod: "week",       // week | month | all
  armReset: false,          // two-tap confirm for "reset stats"
  armErase: false,          // two-tap confirm for "erase everything"
  jobs: [],
};

/* ---------------------------------------------------------- storage ----- */
const KEY = "nsos.v1";
const SCHEMA = 2;
const save = () => localStorage.setItem(KEY, JSON.stringify({
  schema: SCHEMA,
  assumptions: S.assumptions, myPrices: S.myPrices,
  showRecommended: S.showRecommended, jobs: S.jobs,
  custom: S.custom, overrides: S.overrides, dashPeriod: S.dashPeriod,
  pricingView: S.pricingView, usage: S.usage,
  /* The in-progress job. She works mid-appointment on a phone that locks and
     a PWA that can be evicted from memory at any moment — losing the nail
     selection and timer to a reload is a real failure, not an edge case. */
  draft: { job: S.job, quote: S.quote },
}));

/**
 * addonNails migration / normaliser.
 *
 * v1 stored a NUMBER of nail-units per add-on; v2 stores WHICH nails.
 * Runs on every load and accepts anything, because storage can hold data from
 * an older build, a half-finished write, or a hand-edited export.
 *
 * number -> claim nails in a stable order until the old weight is covered
 * object -> keep, dropping non-positive entries
 * other  -> {}
 */
function normalizeAddonNails(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw)) {
    if (v && typeof v === "object") {
      const map = {};
      for (const [k, on] of Object.entries(v)) if (on > 0) map[k] = 1;
      out[id] = map;
    } else if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      const map = {}; let acc = 0;
      for (const k of Object.keys(nailPreset(2))) {
        if (acc >= v) break;
        map[k] = 1;
        acc += NS.DEFAULT_ASSUMPTIONS.nailWeights[k.split(":")[1]] ?? 1;
      }
      out[id] = map;
    }
    // anything else (null, string, NaN) is simply dropped
  }
  return out;
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (d.assumptions) S.assumptions = { ...NS.DEFAULT_ASSUMPTIONS, ...d.assumptions };
    if (d.myPrices) S.myPrices = { ...NS.DEFAULT_PRICES, ...d.myPrices };
    if (typeof d.showRecommended === "boolean") S.showRecommended = d.showRecommended;
    if (Array.isArray(d.jobs)) S.jobs = d.jobs;
    if (d.custom) S.custom = { services: [], addons: [], products: [], ...d.custom };
    if (d.overrides) S.overrides = d.overrides;
    if (d.dashPeriod) S.dashPeriod = d.dashPeriod;
    if (d.pricingView) S.pricingView = d.pricingView;
    if (d.usage) S.usage = d.usage;

    // Restore the in-progress job, normalising anything an older build wrote.
    // `d.job` is read too: a pre-v2 build may have persisted it at the root.
    const draftJob = d.draft?.job ?? d.job;
    if (draftJob && typeof draftJob === "object") {
      S.job = {
        ...S.job, ...draftJob,
        nails: draftJob.nails && typeof draftJob.nails === "object" ? draftJob.nails : {},
        addons: Array.isArray(draftJob.addons) ? draftJob.addons : [],
        addonNails: normalizeAddonNails(draftJob.addonNails),
        paintAddon: null,          // never restore into a modal-ish sub-mode
        timerStart: null,          // a timer that ran while the app was closed is meaningless
        elapsed: Number.isFinite(draftJob.elapsed) ? draftJob.elapsed : 0,
        client: typeof draftJob.client === "string" ? draftJob.client : "",
      };
      // An add-on with no surviving service must not linger.
      S.job.addons = S.job.addons.filter((id) => svc(id));
      for (const id of Object.keys(S.job.addonNails)) {
        if (!S.job.addons.includes(id)) delete S.job.addonNails[id];
      }
    }
    if (d.draft?.quote && typeof d.draft.quote === "object") {
      S.quote = { ...S.quote, ...d.draft.quote, overridePaise: null };
      if (!svc(S.quote.serviceId)) S.quote.serviceId = "gel-mani";
    }
    if (!svc(S.job.serviceId)) S.job.serviceId = "gel-mani";
  } catch { /* first run */ }
}
const myPrice = (id) => S.myPrices[id] ?? NS.DEFAULT_PRICES[id] ?? 0;
/** The quote's nail map; null means "every nail of S.quote.hands". */
const qNails = () => S.quote.nails ?? nailPreset(S.quote.hands);
/* ---- which nails an add-on covers ------------------------------------- */
/** The job's nail map (falls back to the quote's hands preset). */
const jobNailMap = () =>
  Object.values(S.job.nails).some((v) => v > 0) ? S.job.nails : nailPreset(S.quote.hands);
/** The nail set for one add-on. Undefined = every nail in the job. */
const addonNailMap = (id) => S.job.addonNails[id] ?? jobNailMap();
/** Is this add-on on this specific nail? */
const addonOnNail = (id, key) => (addonNailMap(id)[key] || 0) > 0 && (jobNailMap()[key] || 0) > 0;
/** Weighted nail-units an add-on covers — never more than the job itself. */
function addonUnitsFor(id) {
  const job = jobNailMap(), map = addonNailMap(id);
  const keys = Object.keys(map).filter((k) => map[k] > 0 && (job[k] || 0) > 0);
  return NS.nailUnits(keys.map((k) => ({ finger: k.split(":")[1], length: S.quote.length })),
                      S.assumptions);
}
const addonUnitsMap = (ids) => Object.fromEntries(ids.map((id) => [id, addonUnitsFor(id)]));
/** Keep add-on assignments inside the job's nail selection. */
function pruneAddonNails() {
  const job = jobNailMap();
  for (const [id, map] of Object.entries(S.job.addonNails)) {
    if (!map || typeof map !== "object") continue;
    for (const k of Object.keys(map)) if (!(job[k] > 0)) delete map[k];
  }
}

/* ---- how each material looks on a nail --------------------------------- */
/* Distinct, legible swatches so she can tell at a glance what is going where.
   Custom add-ons cycle a fallback palette keyed off their id. */
const MATERIAL = {
  chrome:  { fill: "linear-gradient(135deg,#E8E8EE,#B9BCC6 45%,#F3F3F7 60%,#9AA0AC)", dot: "#B9BCC6", name: "Chrome" },
  stones:  { fill: "radial-gradient(circle at 30% 30%,#FFF 0 18%,transparent 19%),radial-gradient(circle at 68% 55%,#FFF 0 14%,transparent 15%),linear-gradient(#E9B7C6,#D98FA8)", dot: "#FFFFFF", name: "Stones" },
  french:  { fill: "linear-gradient(#FFFFFF 0 28%,#F0C7D3 28%)", dot: "#FFFFFF", name: "French" },
  "art-3d":{ fill: "linear-gradient(135deg,#F2C879,#D9A23F 60%,#F7E0A8)", dot: "#D9A23F", name: "3D art" },
  "cat-eye":{ fill: "linear-gradient(120deg,#4A323C,#8A737B 45%,#2E1B22)", dot: "#4A323C", name: "Cat eye" },
  ombre:   { fill: "linear-gradient(#F7C6D1,#C9184A)", dot: "#E77792", name: "Ombré" },
};
const FALLBACK_SWATCHES = ["#7C9CBF", "#8FAF7E", "#C79A6B", "#9C7EAF", "#6BB0A8"];
function materialFor(id) {
  if (MATERIAL[id]) return MATERIAL[id];
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const c = FALLBACK_SWATCHES[h % FALLBACK_SWATCHES.length];
  return { fill: c, dot: c, name: svc(id)?.name || "Add-on" };
}

/* ---- usage discovery -------------------------------------------------- */
const allProducts = () => [...NS.PRODUCTS, ...S.custom.products];
const productById = (id) => allProducts().find((p) => p.id === id);
/** Her per-nail usage for a product, plus where the number came from. */
function usageFor(product) {
  const u = S.usage[product.id];
  if (u?.qtyPerNail > 0) return { qtyPerNail: u.qtyPerNail, source: u.source,
                                  unitsSinceOpen: u.unitsSinceOpen || 0,
                                  calibrations: u.calibrations || 0 };
  // Fall back to the recipe's documented default for this product.
  for (const sv of NS.SERVICES) {
    const line = sv.lines.find((l) => l.productId === product.id && l.basis === NS.BASIS.PER_NAIL);
    if (line) return { qtyPerNail: line.qtyPerBasis, source: NS.USAGE_SOURCE.DEFAULT,
                       unitsSinceOpen: S.usage[product.id]?.unitsSinceOpen || 0, calibrations: 0 };
  }
  return { qtyPerNail: 0, source: NS.USAGE_SOURCE.DEFAULT, unitsSinceOpen: 0, calibrations: 0 };
}
const SOURCE_LABEL = {
  DEFAULT:    { tag: "", cls: "", text: "typical starting figure" },
  ESTIMATED:  { tag: "your estimate", cls: "accent", text: "from how long a pot lasts you" },
  CALIBRATED: { tag: "measured", cls: "pos", text: "worked out from a pot that ran out" },
};

/* ------------------------------------------------------------ helpers --- */
const $ = (s, r = document) => r.querySelector(s);
const money = (p, o) => NS.formatINR(p, o);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const svc = (id) =>
  NS.SERVICES.find((s) => s.id === id) ||
  S.custom.services.find((s) => s.id === id) ||
  S.custom.addons.find((s) => s.id === id);
/* Functions, not constants — her custom entries must appear on every screen
   the moment she saves them. */
const baseServices = () => [...NS.SERVICES.filter((s) => s.kind !== "ADDON"), ...S.custom.services];
const addonList = () => [...NS.SERVICES.filter((s) => s.kind === "ADDON"), ...S.custom.addons];
const newId = (name) =>
  "c-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) +
  "-" + Date.now().toString(36).slice(-4);
const fmtT = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
/** act("go","today") -> ` data-act="go" data-val="today"` */
const act = (a, v) => ` data-act="${a}"${v === undefined ? "" : ` data-val="${esc(v)}"`}`;

/* ---- nail selection helpers (shared by Quote and Job) ------------------ */
/** All-selected map for N hands: { "L:thumb":1, ... } */
function nailPreset(hands) {
  const m = {};
  for (const side of ["L", "R"]) {
    if (hands === 1 && side === "L") continue;
    for (const f of NS.FINGERS) m[`${side}:${f}`] = 1;
  }
  return m;
}
/** Map -> engine selection array. Accent (2) counts the same as selected. */
const selFromMap = (map, length) =>
  Object.entries(map || {}).filter(([, v]) => v > 0)
    .map(([k]) => ({ finger: k.split(":")[1], length }));
/**
 * The two-hand picker — one source of truth for both screens.
 *
 * @param {object} map        nail selection map
 * @param {string} actName    action fired when a nail is tapped
 * @param {object} [opt]
 * @param {string[]} [opt.addons]  add-ons to paint onto the nails
 * @param {string} [opt.paint]     add-on being assigned (tap toggles IT, not the nail)
 */
function nailPickerHTML(map, actName, opt = {}) {
  const { addons = [], paint = null } = opt;
  const paintMat = paint ? materialFor(paint) : null;

  const nail = (side, f) => {
    const k = `${side}:${f}`;
    const v = map[k] || 0;
    // Which add-ons land on this nail, in chip order.
    const on = addons.filter((id) => addonOnNail(id, k));
    const lead = on.length ? materialFor(on[0]) : null;
    const inPaint = !!paint;
    const painted = inPaint && addonOnNail(paint, k);
    const selectable = (jobNailMap()[k] || 0) > 0;

    const style = lead && v
      ? `background:${lead.fill};box-shadow:var(--shadow-3)`
      : "";
    const label = `${side === "L" ? "Left" : "Right"} ${f}` +
      (inPaint
        ? `, ${paintMat.name} ${painted ? "applied — tap to remove" : "not applied — tap to apply"}`
        : v === 2 ? ", accent" : v ? ", selected" : ", not selected");

    return `<button class="nail n-${f}${inPaint && !selectable ? " nail-off" : ""}"
      ${act(inPaint ? "paintnail" : actName, k)}
      data-on="${v ? 1 : 0}" data-accent="${v === 2 ? 1 : 0}"
      ${painted ? 'data-painted="1"' : ""}
      ${inPaint ? `style="--paint:${paintMat.dot}"` : ""}
      role="switch" aria-checked="${inPaint ? painted : v > 0}"
      aria-label="${esc(label)}"${style ? ` style="${style}"` : ""}>
      ${on.length && v ? `<span class="mats" aria-hidden="true">${
        on.slice(0, 3).map((id) => `<i style="background:${materialFor(id).dot}"></i>`).join("")
      }</span>` : ""}
      ${v === 2 && !on.length ? "★" : ""}</button>`;
  };

  const hand = (side) => `<div class="hand">
    ${side === "L" ? `<span class="hand-label">Left</span>` : ""}
    ${NS.FINGERS.map((f) => nail(side, f)).join("")}
    ${side === "R" ? `<span class="hand-label" style="text-align:left">Right</span>` : ""}</div>`;

  return `<div class="hands${paint ? " painting" : ""}">${hand("L")}${hand("R")}</div>` +
    (paint ? `<div class="paintbar">
        <span class="swatch-dot" style="background:${paintMat.dot}"></span>
        <span class="grow t-sm">Tap nails to apply <b>${esc(paintMat.name)}</b></span>
        <button class="btn light accent sm"${act("paintall")}>All</button>
        <button class="btn subtle sm"${act("paintnone")}>None</button>
        <button class="btn primary sm"${act("paintdone")}>Done</button>
      </div>` : "");
}

/**
 * Price one service + add-ons.
 *
 * HER price is the answer. The engine's recommendation is computed alongside
 * but never substituted in — it only appears if she asks to see it.
 */
function priceField(q) {
  const bad = q.health.flags.includes("BELOW_FLOOR") || q.health.flags.includes("BELOW_COST");
  return `<div class="row" style="gap:2px;align-items:baseline">
    <span class="t-h1 num${bad ? " neg" : ""}">₹</span>
    <input class="bigprice${bad ? " flagged" : ""}" type="number" inputmode="numeric" min="0" id="bigprice"
      data-override data-listed="${q.priced.rawPaise}" value="${Math.round(q.pricePaise / 100)}"
      aria-label="Price for this job"></div>`;
}

function quoteFor({ serviceId, hands, length, coats, addons, overridePaise = null,
                    nails = null, addonUnits = null }) {
  const A = S.assumptions;
  const base = svc(serviceId);
  // An explicit per-nail selection (a map like {"L:thumb":1}) beats the blunt
  // hands count. Accent nails (value 2) count the same as selected for cost.
  const selection = nails ? selFromMap(nails, length) : NS.fullHands(hands, length);
  const units = NS.nailUnits(selection, A);
  const handCount = nails
    ? (new Set(Object.keys(nails).filter((k) => nails[k] > 0).map((k) => k[0])).size || 1)
    : hands;
  const factor = NS.sizeFactor(units, A.serviceFixedTimePct);
  const ctx = { nailUnits: units, hands: handCount, coats };

  const parts = [];
  let direct = 0, minutes = 0, baseHours = 0;

  const add = (service, isAddon, ownUnits) => {
    const ov = S.overrides[service.id] || {};
    const stdMinutes = ov.minutes ?? service.minutes;
    // MICRO-USAGE: an add-on may cover fewer nails than the service under it.
    const u = ownUnits != null ? ownUnits : units;
    const f = NS.sizeFactor(u, A.serviceFixedTimePct);
    const mins = NS.scaledServiceMinutes(stdMinutes, u, A.serviceFixedTimePct);
    let partDirect, cost = null;

    if (service.custom || ov.materialPaise != null) {
      // Her own number: total material spend for a full set, scaled to usage.
      const mat = service.custom ? service.materialPaise : ov.materialPaise;
      partDirect = Math.round(mat * f);
    } else {
      // Seeded recipe: itemised bill of materials through the cost engine.
      const h = NS.hydrate(service, allProducts(), NS.DURABLES);
      // Swap the recipe's default per-nail quantity for whatever she has
      // established for that product (estimated or measured).
      const lines = h.lines.map((l) => {
        if (l.basis !== NS.BASIS.PER_NAIL) return l;
        const own = S.usage[l.product.id];
        return own?.qtyPerNail > 0 ? { ...l, qtyPerBasis: own.qtyPerNail } : l;
      });
      cost = NS.costJob({ lines, durables: h.durables,
        ctx: { ...ctx, nailUnits: u, coats: isAddon ? service.defaultCoats : coats, hours: mins / 60 },
        assumptions: A });
      partDirect = cost.directPaise;
    }

    direct += partDirect; minutes += mins;
    if (!isAddon) baseHours = (mins + A.setupMinutes) / 60;
    parts.push({ service, cost, isAddon, minutes: mins, directPaise: partDirect,
                 units: u, factor: f,
                 chargePaise: isAddon ? Math.round(myPrice(service.id) * f) : 0 });
  };
  add(base, false);
  for (const a of addons) { const s = svc(a); if (s) add(s, true, addonUnits?.[a]); }

  const hours = NS.chairHours({ serviceMinutes: minutes, setupMinutes: A.setupMinutes });
  // Custom services have no market band — leave it empty rather than invent one.
  const market = base.marketLow != null
    ? { lowPaise: NS.toPaise(base.marketLow), highPaise: NS.toPaise(base.marketHigh) }
    : {};

  // --- HER price -------------------------------------------------------
  const priced = NS.composePrice({
    mode: A.pricingMode,
    basePricePaise: myPrice(base.id),
    hourlyRatePaise: A.myHourlyRatePaise,
    baseHours,
    // Each add-on already carries its own micro-usage factor; pass the scaled
    // amount and neutralise the global factor for them.
    addonPricesPaise: addons.map((a) => {
      const part = parts.find((pt) => pt.isAddon && pt.service.id === a);
      return part ? Math.round(myPrice(a) * part.factor) : myPrice(a);
    }),
    addonFactor: 1,
    factor, roundToPaise: A.roundToPaise, overridePaise,
  });

  // --- the second opinion, computed but not applied --------------------
  const rec = NS.proposePrices({ directPaise: direct, hours, assumptions: A, market });
  const health = NS.priceHealth({
    pricePaise: priced.pricePaise, recommendedPaise: rec.recommendedPaise,
    floorPaise: rec.floorPaise, absorbedPaise: rec.absorbedPaise,
    directPaise: direct, hours, market,
  });

  return { base, parts, directPaise: direct, minutes, hours, units, factor,
           market, priced, rec, health,
           pricePaise: priced.pricePaise, recommendedPaise: rec.recommendedPaise };
}

/* =========================================================== SCREENS ==== */

function screenToday() {
  const now = Date.now(), week = 7 * 864e5;
  const recent = S.jobs.filter((j) => now - j.at < week);
  const rev = recent.reduce((s, j) => s + j.pricePaise, 0);
  const contrib = recent.reduce((s, j) => s + j.contributionPaise, 0);
  const hrs = recent.reduce((s, j) => s + j.hours, 0);
  const cph = hrs > 0 ? Math.round(contrib / hrs) : 0;
  const util = S.assumptions.billableHoursMonthly > 0
    ? (hrs * 4.33) / S.assumptions.billableHoursMonthly : 0;

  const services = baseServices().map((s) => {
    const q = quoteFor({ serviceId: s.id, hands: 2, length: "S", coats: s.defaultCoats, addons: [] });
    const done = S.jobs.filter((j) => j.serviceId === s.id);
    // Judge HER price, not a price we invented for her.
    const price = done.length ? Math.round(done.reduce((a, j) => a + j.pricePaise, 0) / done.length)
                              : q.pricePaise;
    const o = NS.jobOutcome({ pricePaise: price, directPaise: q.directPaise, hours: q.hours });
    return { id: s.id, name: s.name, samples: done.length, hours: q.hours, pricePaise: price,
             floorPaise: q.rec.floorPaise, absorbedPaise: q.rec.absorbedPaise, directPaise: q.directPaise,
             contributionPerHourPaise: o.contributionPerHourPaise };
  });
  const recs = NS.recommend({ services, products: [], utilisation: util || 1, assumptions: S.assumptions });

  const spark = Array.from({ length: 12 }, (_, i) => {
    const j = S.jobs[S.jobs.length - 12 + i];
    return j ? Math.min(100, Math.round((j.contributionPerHourPaise / 200000) * 100)) : 8;
  });

  return `
  <div class="section-head"><div><div class="t-pre dim">This week</div>
    <h1 class="t-h1" style="margin:2px 0 0">${recent.length ? "Here's how it's going" : "Let's get started"}</h1></div></div>

  <div class="grid-2">
    <div class="card kpi"><div class="lbl">Revenue</div>
      <div class="val num">${money(rev)}</div>
      <div class="delta muted">${recent.length} job${recent.length === 1 ? "" : "s"}</div></div>
    <div class="card inverse kpi"><div class="lbl">Per chair-hour</div>
      <div class="val num">${money(cph)}</div>
      <div class="delta muted">${hrs.toFixed(1)} h worked</div></div>
    <div class="card kpi"><div class="lbl">Contribution</div>
      <div class="val num">${money(contrib)}</div>
      <div class="delta muted">after materials</div></div>
    <div class="card kpi"><div class="lbl">Materials</div>
      <div class="val num">${rev ? Math.round(((rev - contrib) / rev) * 100) : 0}%</div>
      <div class="delta muted">of revenue</div></div>
  </div>

  ${recs.length ? `<div class="section-head"><h2 class="t-t1">Needs attention</h2>
    <span class="tag">${recs.length}</span></div>
  <div class="stack">${recs.slice(0, 4).map((r) => `
    <div class="alert ${r.severity === "URGENT" ? "urgent" : r.severity === "WARN" ? "warnbg" : "infobg"}">
      <span class="dot" style="background:${r.severity === "URGENT" ? "var(--color-destructive)" : r.severity === "WARN" ? "var(--color-warning)" : "var(--color-accent)"}"></span>
      <div class="grow"><div class="t-headline">${esc(r.title)}</div>
      <div class="t-sm muted" style="margin-top:2px">${esc(r.explanation)}</div>
      ${r.suggestedPricePaise ? `<div class="t-sm" style="margin-top:6px"><b>Suggested: ${money(r.suggestedPricePaise)}</b></div>` : ""}</div>
      <div class="row" style="flex-direction:column;align-items:flex-end;gap:6px">
        <span class="tag">${r.id}</span>
        ${r.entityId ? `<button class="btn primary sm"${act("fix", r.entityType + ":" + r.entityId)}>Fix</button>` : ""}
      </div>
    </div>`).join("")}</div>` : ""}

  <div class="section-head"><h2 class="t-t1">Contribution per hour</h2><span class="t-sm dim">last 12 jobs</span></div>
  <div class="card"><div class="bars">${spark.map((v, i) =>
    `<i class="${i >= spark.length - 3 ? "hi" : ""}" style="height:${Math.max(v, 8)}%"></i>`).join("")}</div></div>

  <div class="section-head"><h2 class="t-t1">Recent jobs</h2>
    ${S.jobs.length ? `<button class="btn subtle accent sm"${act("go", "insights")}>See all</button>` : ""}</div>
  ${S.jobs.length ? `<div class="list">${S.jobs.slice(-6).reverse().map((j) => `
    <div class="list-row"><span class="swatch">${esc((j.client || "W").charAt(0).toUpperCase())}</span>
      <div class="grow"><div class="t-headline">${esc(j.title)}</div>
        <div class="t-sm dim">${esc(j.client || "Walk-in")} · ${j.hours.toFixed(2)} h · ${money(j.contributionPerHourPaise)}/hr</div></div>
      <div class="num t-t3">${money(j.pricePaise)}</div></div>`).join("")}</div>`
    : `<div class="card empty"><div class="t-t2">No jobs logged yet</div>
       <p class="t-sm muted" style="max-width:34ch;margin:8px auto 20px">Log one job and this screen starts telling you which of your services actually pays.</p>
       <button class="btn accent"${act("newjob")}>Log your first job</button></div>`}`;
}

function screenQuote() {
  const q = quoteFor({ ...S.quote, nails: qNails() });
  q.selCount = Object.values(qNails()).filter((v) => v > 0).length;
  const A = S.assumptions;
  const bad = q.health.flags.includes("BELOW_FLOOR") || q.health.flags.includes("BELOW_COST");
  const FLAG_TEXT = {
    BELOW_FLOOR: "Below your cost floor",
    BELOW_COST:  "Doesn't cover cost + overhead",
    BELOW_MARKET:`Under the local rate (${money(q.market.lowPaise)}+)`,
    ABOVE_MARKET:`Above the local rate (${money(q.market.highPaise)})`,
  };

  return `
  <div class="section-head"><div><div class="t-pre dim">Quick quote</div>
    <h1 class="t-h1" style="margin:2px 0 0">Your price, explained</h1></div></div>

  <div class="stack-lg">
    <div>
      <div class="t-pre dim" style="margin-bottom:10px">Service</div>
      <div class="row wrap">${baseServices().map((s) => `
        <button class="chip" aria-pressed="${S.quote.serviceId === s.id}"${act("qservice", s.id)}>${esc(s.name)}</button>`).join("")}</div>
    </div>

    <div class="row-between wrap" style="gap:var(--space-4)">
      <div><div class="t-pre dim" style="margin-bottom:10px">Hands</div>
        <div class="seg">${[1, 2].map((h) => {
          const preset = nailPreset(h);
          const cur = qNails();
          const match = Object.keys({ ...preset, ...cur }).every((k) => (preset[k] > 0) === (cur[k] > 0));
          return `<button aria-pressed="${match}"${act("qhands", h)}>${h === 1 ? "One" : "Both"}</button>`;
        }).join("")}</div></div>
      <div><div class="t-pre dim" style="margin-bottom:10px">Coats</div>
        <div class="stepper"><button${act("qcoats", -1)}>−</button><span class="v">${S.quote.coats}</span><button${act("qcoats", 1)}>+</button></div></div>
    </div>

    <div><div class="row-between" style="margin-bottom:12px">
        <span class="t-pre dim">Or pick the exact nails</span>
        <span class="t-sm muted">${q.selCount} selected · ${q.units.toFixed(2)} nail-units</span></div>
      <div class="card">${nailPickerHTML(qNails(), "qnail")}
        <div class="row" style="justify-content:center;margin-top:14px">
          <span class="t-sm dim">tap = select · tap again = accent ★ · price follows every tap</span></div></div></div>

    <div><div class="t-pre dim" style="margin-bottom:10px">Length</div>
      <div class="seg block">${["XS", "S", "M", "L", "XL"].map((l) => `
        <button aria-pressed="${S.quote.length === l}"${act("qlen", l)}>${l}</button>`).join("")}</div></div>

    <div><div class="t-pre dim" style="margin-bottom:10px">Add-ons</div>
      <div class="row wrap">${addonList().map((a) => {
        const on = S.quote.addons.includes(a.id);
        // Advertise the ACTUAL delta after rounding, not the raw list price.
        const withIt = quoteFor({ ...S.quote, overridePaise: null, nails: qNails(),
          addons: [...new Set([...S.quote.addons, a.id])] }).pricePaise;
        const delta = withIt - quoteFor({ ...S.quote, overridePaise: null, nails: qNails() }).pricePaise;
        return `<button class="chip dark" aria-pressed="${on}"${act("qaddon", a.id)}>
          ${esc(a.name)} <span class="price">${on ? "✓" : "+" + money(delta)}</span></button>`;
      }).join("")}</div></div>

    <div class="card flat">
      <div class="t-pre dim" style="margin-bottom:12px">What this job costs you</div>
      <table class="breakdown">
        <tr><td>Materials + equipment</td><td>${money(q.directPaise, { decimals: true })}</td></tr>
        <tr class="sub"><td>Chair time ${Math.round(q.hours * 60)} min @ ${money(Math.round(q.rec.overheadRatePaisePerHour))}/hr overhead</td>
          <td>${money(q.rec.overheadPaise)}</td></tr>
        <tr class="sub"><td>Total cost to serve</td><td>${money(q.rec.absorbedPaise)}</td></tr>
        <tr><td><b>You keep</b> (after materials)</td><td><b>${money(q.health.contributionPaise)}</b></td></tr>
        <tr class="total"><td>Per hour of your time</td>
          <td class="${q.health.contributionPerHourPaise < 25000 ? "neg" : ""}">${money(q.health.contributionPerHourPaise)}/hr</td></tr>
      </table>
      ${q.health.flags.length ? `<div class="row wrap" style="margin-top:12px">${q.health.flags.map((f) =>
        `<span class="tag ${f === "BELOW_FLOOR" || f === "BELOW_COST" ? "neg" : "warn"}">${esc(FLAG_TEXT[f] || f)}</span>`).join("")}</div>` : ""}
    </div>

    <div class="card">
      <div class="row-between">
        <div class="grow"><div class="t-headline">Show recommended price</div>
          <div class="t-sm muted" style="margin-top:2px">A second opinion from your cost + time targets. Never applied automatically.</div></div>
        <button class="switch"${act("togglerec")} role="switch" aria-checked="${S.showRecommended}"></button>
      </div>
      ${S.showRecommended ? `<table class="breakdown" style="margin-top:14px">
        <tr><td>Recommended</td><td class="rec"><b>${money(q.recommendedPaise)}</b></td></tr>
        <tr class="sub"><td>Your price</td><td>${money(q.pricePaise)}</td></tr>
        <tr class="sub"><td>${q.health.gapToRecommendedPaise >= 0 ? "You could add" : "You're above it by"}</td>
          <td>${money(Math.abs(q.health.gapToRecommendedPaise))} (${Math.abs(Math.round(q.health.gapPct))}%)</td></tr>
        ${q.market.lowPaise != null ? `<tr class="sub"><td>Local rate for this service</td><td>${money(q.market.lowPaise)} – ${money(q.market.highPaise)}</td></tr>` : ""}
      </table>
      <div class="row" style="margin-top:12px">
        <button class="btn light accent sm"${act("userec")}>Use ${money(q.recommendedPaise)}</button></div>` : ""}
    </div>
  </div>

  <div class="pricebar">
    <div class="row-between">
      <div>
        ${priceField(q)}
        <div class="t-sm muted">${Math.round(q.hours * 60)} min · ${money(q.health.contributionPerHourPaise)}/hr${
          S.quote.overridePaise != null ? ` · <button class="btn subtle accent sm" style="padding:0"${act("clearoverride")}>reset</button>` : ""}</div>
        <button class="btn subtle accent sm" style="padding-left:0"${act("sheet", "why")}>Where it goes ⌄</button>
      </div>
      <div class="row">
        <button class="btn outline"${act("copy")}>Copy</button>
        <button class="btn accent"${act("book")}>Book it</button>
      </div>
    </div>
  </div>`;
}

function screenPricing() {
  const seg = `<div class="seg block" style="margin-bottom:var(--space-5)">
    <button aria-pressed="${S.pricingView === "calc"}"${act("pview", "calc")}>Calculate &amp; log</button>
    <button aria-pressed="${S.pricingView === "list"}"${act("pview", "list")}>My price list</button>
  </div>`;
  return seg + (S.pricingView === "list" ? screenPrices() : screenJob());
}

function screenJob() {
  const sel = Object.entries(S.job.nails).filter(([, v]) => v)
    .map(([k]) => ({ finger: k.split(":")[1], length: S.quote.length }));
  const count = sel.length;
  const accents = Object.entries(S.job.nails).filter(([, v]) => v === 2).length;
  // THE FIX: the job's own nail selection now drives the price. Previously the
  // picker updated the nail-units label while the ₹ silently stayed full-set.
  const jobUnits = NS.nailUnits(selFromMap(jobNailMap(), S.quote.length), S.assumptions);
  const q = quoteFor({ ...S.quote, serviceId: S.job.serviceId, addons: S.job.addons,
                       overridePaise: S.quote.overridePaise,
                       nails: count ? S.job.nails : null,
                       addonUnits: addonUnitsMap(S.job.addons) });
  const secs = S.job.timerStart ? Math.floor((Date.now() - S.job.timerStart) / 1000) : S.job.elapsed;

  return `
  <div class="section-head"><div><div class="t-pre dim">New job</div>
    <h1 class="t-h1" style="margin:2px 0 0">Log it fast</h1></div>
    <button class="btn ${S.job.timerStart ? "destructive" : "primary"} sm"${act("timer")} id="timerbtn">
      ${S.job.timerStart ? "⏹ " + fmtT(secs) : secs ? "▶ " + fmtT(secs) : "⏱ Start"}</button></div>

  <div class="stack-lg">
    <div><div class="t-pre dim" style="margin-bottom:10px">Service</div>
      <div class="row wrap">${baseServices().map((s) => `
        <button class="chip" aria-pressed="${S.job.serviceId === s.id}"${act("jservice", s.id)}>${esc(s.name)}</button>`).join("")}</div></div>

    <div><div class="row-between" style="margin-bottom:12px">
        <span class="t-pre dim">Nails</span>
        <span class="t-sm muted">${count} selected${accents ? ` · ${accents} accent` : ""} · ${NS.nailUnits(sel, S.assumptions).toFixed(2)} nail-units</span></div>
      <div class="card">${nailPickerHTML(S.job.nails, "nail",
          { addons: S.job.addons, paint: S.job.paintAddon })}
        ${S.job.paintAddon ? "" : `<div class="row" style="justify-content:center;margin-top:16px">
          <button class="btn outline sm"${act("nailall")}>All 10</button>
          <button class="btn subtle sm"${act("nailnone")}>Clear</button>
          <span class="t-sm dim">tap twice = accent</span></div>`}
        ${!S.job.paintAddon && S.job.addons.length ? `<div class="row wrap legend">
          ${S.job.addons.map((id) => {
            const m = materialFor(id);
            return `<button class="legend-chip"${act("paint", id)}>
              <span class="swatch-dot" style="background:${m.dot}"></span>${esc(m.name)}
              <span class="dim">${addonUnitsFor(id).toFixed(1)}</span></button>`;
          }).join("")}</div>` : ""}
      </div></div>

    <div><div class="t-pre dim" style="margin-bottom:10px">Add-ons</div>
      <div class="row wrap">${addonList().map((a) => `
        <button class="chip dark" aria-pressed="${S.job.addons.includes(a.id)}"${act("jaddon", a.id)}>${esc(a.name)}</button>`).join("")}</div>

      ${S.job.addons.length ? `<div class="card" style="margin-top:var(--space-3)">
        <div class="t-pre dim" style="margin-bottom:10px">How many nails does each cover?</div>
        ${S.job.addons.map((id) => {
          const a = svc(id); if (!a) return "";
          const used = addonUnitsFor(id, jobUnits);
          const part = q.parts.find((pt) => pt.isAddon && pt.service.id === id);
          const mat = part ? part.directPaise : 0;
          const charge = part ? part.chargePaise : 0;
          const profit = charge - mat;
          const margin = charge > 0 ? (profit / charge) * 100 : 0;
          const m = materialFor(id);
          const active = S.job.paintAddon === id;
          return `<div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--color-border-subtle)">
            <div class="grow"><div class="row" style="gap:6px">
              <span class="swatch-dot" style="background:${m.dot}"></span>
              <span class="t-headline">${esc(a.name)}</span>
              <span class="tag">${used.toFixed(1)} nails</span></div>
              <div class="t-sm dim" style="margin-top:2px">
                uses ${money(mat, { decimals: true })} · charge ${money(charge)} ·
                <b class="${profit < 0 ? "neg" : "pos"}">keep ${money(profit)}</b> · ${margin.toFixed(0)}% margin</div></div>
            <button class="btn ${active ? "accent" : "outline"} sm"${act("paint", id)}>
              ${active ? "Done" : "Pick nails"}</button>
          </div>`;
        }).join("")}
        <div class="t-note dim" style="margin-top:10px">Tiny amounts still cost something —
          and still deserve a charge. One nail of chrome is pennies of powder but real minutes of your time.</div>
        ${(() => {
          // Which products behind these add-ons are still running on a generic
          // default? Say so plainly and offer the one-tap fix.
          const guessed = [];
          for (const pt of q.parts) {
            if (!pt.isAddon || !pt.cost) continue;
            for (const it of pt.cost.items) {
              const pr = productById(it.productId);
              if (pr && usageFor(pr).source === NS.USAGE_SOURCE.DEFAULT
                  && !guessed.some((g) => g.id === pr.id)) guessed.push(pr);
            }
          }
          return guessed.length ? `<div class="alert infobg" style="margin-top:12px">
            <span class="dot" style="background:var(--color-accent)"></span>
            <div class="grow"><div class="t-headline">These use a typical figure, not yours</div>
              <div class="t-sm muted" style="margin-top:2px">
                ${esc(guessed.slice(0, 3).map((g) => g.name).join(", "))}. Tell the app roughly how many
                clients a pack lasts and this cost becomes yours.</div>
              <div class="row wrap" style="margin-top:8px">${guessed.slice(0, 3).map((g) =>
                `<button class="btn light accent sm"${act("usageopen", g.id)}>Set ${esc(g.name)}</button>`).join("")}</div>
            </div></div>` : "";
        })()}
      </div>` : ""}
    </div>

    <div class="field"><label for="client">Client (optional)</label>
      <input class="input" id="client" placeholder="Walk-in" autocomplete="off"
        value="${esc(S.job.client)}" data-bind="client"></div>

    <div><div class="t-pre dim" style="margin-bottom:10px">Paid by</div>
      <div class="seg block">${["Cash", "UPI", "Card"].map((m) => `
        <button aria-pressed="${S.job.method === m}"${act("jpay", m)}>${m}</button>`).join("")}</div></div>
  </div>

  <div class="pricebar"><div class="row-between">
    <div>${priceField(q)}
      <div class="t-sm muted">${Math.round(q.hours * 60)} min · ${money(q.health.contributionPerHourPaise)}/hr · you keep ${money(q.health.contributionPaise)}</div></div>
    <button class="btn accent lg"${act("save")}>Save job</button></div></div>`;
}

function screenPrices() {
  const A = S.assumptions;
  const hourly = A.pricingMode === NS.PRICING_MODE.HOURLY;

  const row = (sv) => {
    const isAddon = sv.kind === "ADDON";
    const ov = S.overrides[sv.id] || {};
    const q = quoteFor({ serviceId: isAddon ? "gel-mani" : sv.id, hands: 2, length: "S",
                         coats: sv.defaultCoats, addons: isAddon ? [sv.id] : [] });
    let price = q.pricePaise, direct = q.directPaise, hours = q.hours, rec = q.recommendedPaise;
    const effMinutes = ov.minutes ?? sv.minutes;
    if (isAddon) {
      const bare = quoteFor({ serviceId: "gel-mani", hands: 2, length: "S", coats: 2, addons: [] });
      price = myPrice(sv.id); direct = q.directPaise - bare.directPaise;
      hours = effMinutes / 60; rec = q.recommendedPaise - bare.recommendedPaise;
    }
    const o = NS.jobOutcome({ pricePaise: price, directPaise: direct, hours });
    const low = sv.marketLow != null ? NS.toPaise(sv.marketLow) : null;
    const high = sv.marketHigh != null ? NS.toPaise(sv.marketHigh) : null;
    const under = low != null && price < low, over = high != null && price > high;
    // What the cost field shows: her override/custom number, else the computed one.
    const matShown = sv.custom ? sv.materialPaise
                   : ov.materialPaise != null ? ov.materialPaise : direct;
    const matIsAuto = !sv.custom && ov.materialPaise == null;
    const mini = (label, attr, val, extra = "") => `
      <div style="text-align:center">
        <div class="t-note dim" style="margin-bottom:3px">${label}</div>
        <input class="priceinput" style="width:72px" type="number" inputmode="numeric" min="0"
          ${attr} value="${val}" ${extra}></div>`;
    return `
    <div class="list-row" id="row-${sv.id}" style="align-items:flex-start">
      <div class="grow">
        <div class="row" style="gap:6px">
          <span class="t-headline">${esc(sv.name)}</span>
          ${sv.custom ? `<span class="tag">yours</span>
            <button class="btn subtle sm" style="min-height:24px;padding:0 6px"${act("delcustom", sv.id)} aria-label="Delete ${esc(sv.name)}">✕</button>` : ""}
        </div>
        <div class="t-sm dim" style="margin-top:3px">
          ${Math.round(hours * 60)} min · costs ${money(direct)}${matIsAuto ? "" : " (yours)"} · you keep ${money(o.contributionPaise)}
          · <b class="${o.contributionPerHourPaise < 25000 ? "neg" : ""}">${money(o.contributionPerHourPaise)}/hr</b></div>
        ${S.showRecommended ? `<div class="t-sm rec" style="margin-top:4px">
          Recommended ${money(rec)}${low != null ? ` · local ${money(low)}–${money(high)}` : ""}</div>` : ""}
        ${under ? `<span class="tag warn" style="margin-top:6px">Under the local rate</span>` : ""}
        ${over ? `<span class="tag warn" style="margin-top:6px">Above the local rate</span>` : ""}
        <div class="row" style="gap:8px;margin-top:10px">
          ${mini("Price ₹", `data-price="${sv.id}" id="price-${sv.id}" aria-label="Your price for ${esc(sv.name)}"`,
                 Math.round(myPrice(sv.id) / 100), hourly && !isAddon ? "disabled" : "")}
          ${mini("Minutes", `data-minutes="${sv.id}" id="min-${sv.id}" aria-label="Minutes for ${esc(sv.name)}"`, effMinutes)}
          ${mini("Cost ₹", `data-matcost="${sv.id}" id="mat-${sv.id}" aria-label="Material cost for ${esc(sv.name)}" placeholder="auto"`,
                 Math.round(matShown / 100))}
        </div>
      </div>
    </div>`;
  };

  return `
  <div class="section-head"><div><div class="t-pre dim">Your prices</div>
    <h1 class="t-h1" style="margin:2px 0 0">You set them</h1></div>
    <button class="btn outline sm"${act("go", "stock")}>Stock</button></div>

  <div class="card" style="margin-bottom:var(--space-4)">
    <div class="t-pre dim" style="margin-bottom:10px">How you charge</div>
    <div class="seg block">
      <button aria-pressed="${!hourly}"${act("mode", "FLAT")}>Per client</button>
      <button aria-pressed="${hourly}"${act("mode", "HOURLY")}>Per hour + add-ons</button>
    </div>
    <p class="t-sm muted" style="margin:12px 0 0">${hourly
      ? "Each service is priced as your hourly rate × the time it takes. Add-ons keep their own price."
      : "A flat price per service, the way most freelance artists quote. Partial jobs scale down automatically."}</p>
    ${hourly ? `<div class="row-between" style="margin-top:14px">
      <div class="grow"><div class="t-headline">Your hourly rate</div>
        <div class="t-sm muted" style="margin-top:2px">What you charge for an hour in the chair.</div></div>
      <input class="priceinput" type="number" inputmode="numeric" min="0" step="25"
        value="${Math.round(A.myHourlyRatePaise / 100)}" data-set="myHourlyRatePaise" id="set-myHourlyRatePaise"></div>` : ""}
  </div>

  <div class="card" style="margin-bottom:var(--space-4)">
    <div class="row-between">
      <div class="grow"><div class="t-headline">Show recommended prices</div>
        <div class="t-sm muted" style="margin-top:2px">Compare against what your costs and income target imply.</div></div>
      <button class="switch"${act("togglerec")} role="switch" aria-checked="${S.showRecommended}"></button></div>
  </div>

  <div class="section-head"><h2 class="t-t1">Services</h2>
    <div class="row">
      ${S.showRecommended ? `<button class="btn light accent sm"${act("useallrec")}>Use all recommended</button>` : ""}
      <button class="btn primary sm"${act("sheet", "addservice")}>+ Add</button></div></div>
  <div class="list">${baseServices().map(row).join("")}</div>

  <div class="section-head"><h2 class="t-t1">Add-ons</h2>
    <button class="btn primary sm"${act("sheet", "addaddon")}>+ Add</button></div>
  <div class="list">${addonList().map(row).join("")}</div>

  <div class="card flat" style="margin-top:var(--space-4)">
    <div class="t-headline">Tune any service to how YOU work</div>
    <p class="t-sm muted" style="margin:6px 0 0">Minutes and material cost are editable on every row.
    Clear the cost field on a built-in service to go back to the automatic calculation from your stock prices.</p></div>

  <div class="card flat" style="margin-top:var(--space-4)">
    <div class="t-headline">These are yours</div>
    <p class="t-sm muted" style="margin:6px 0 0">Nothing here overwrites your prices unless you tap it.
    Defaults are typical East Delhi rates for a freelance artist — a starting point, not a target.</p></div>`;
}


function screenStock() {
  const rows = NS.PRODUCTS.map((p) => {
    const wast = p.wastagePct ?? (p.costClass === "DISCRETE" ? S.assumptions.wastageDiscrete
      : p.isBuilder ? S.assumptions.wastageBuilder : S.assumptions.wastageGel);
    const eff = NS.effectiveUnitCostMicro({ landedPaise: p.landedPaise, baseQty: p.baseQty,
      residuePct: p.residuePct, wastagePct: wast });
    const nom = NS.nominalUnitCostMicro(p.landedPaise, p.baseQty);
    return { p, eff, nom, uplift: Math.round((eff / nom - 1) * 100), wast };
  });
  const equip = NS.DURABLES.reduce((s, d) => s + d.costPaise, 0);
  const invest = NS.PRODUCTS.reduce((s, p) => s + p.landedPaise, 0) + equip;
  return `
  <div class="section-head"><div><div class="t-pre dim">Stock</div>
    <h1 class="t-h1" style="margin:2px 0 0">${NS.PRODUCTS.length + S.custom.products.length} items</h1></div>
    <button class="btn primary sm"${act("sheet", "additem")}>+ Add item</button></div>

  <div class="grid-2" style="margin-bottom:var(--space-6)">
    <div class="card kpi"><div class="lbl">Invested</div><div class="val num">${money(invest)}</div>
      <div class="delta muted">products + equipment</div></div>
    <div class="card kpi"><div class="lbl">Equipment</div><div class="val num">${money(equip)}</div>
      <div class="delta muted">amortised, not per-client</div></div>
  </div>

  <div class="card flat" style="margin-bottom:var(--space-4)">
    <div class="t-headline">Real cost, not sticker cost</div>
    <p class="t-sm muted" style="margin:6px 0 0">Bottles are never used to zero. Every price below is corrected for
    unreachable residue and wastage — that's the gap between what you paid and what a use actually costs you.</p>
    <p class="t-sm muted" style="margin:10px 0 0"><b>Don't know how much you use per nail?</b>
    You don't have to. Tap the per-nail figure on any item and just say roughly how many clients
    a pack lasts you — or keep logging jobs and let the app work it out when the pot runs out.</p></div>

  <div class="list">${rows.map(({ p, eff, nom, uplift, wast }) => {
    const u = usageFor(p);
    const perNail = Math.round((u.qtyPerNail * eff) / 1e6);
    const src = SOURCE_LABEL[u.source];
    return `
    <div class="list-row" id="row-${p.id}"><span class="swatch">${esc(p.category.charAt(0))}</span>
      <div class="grow"><div class="t-headline">${esc(p.name)}</div>
        <div class="t-sm dim">${esc(p.pack)} · ${money(p.landedPaise)} · ${Math.round(wast * 100)}% wastage</div>
        ${u.qtyPerNail > 0 ? `<button class="btn subtle accent sm" style="padding:0;margin-top:4px"${act("usageopen", p.id)}>
          ${money(perNail, { decimals: true })}/nail${src.tag ? ` · ${src.tag}` : " · tap to set"} ›</button>` : ""}</div>
      <div style="text-align:right">
        <div class="num t-t3">${money(Math.round(eff / 1e6), { decimals: true })}<span class="t-note dim">/${p.baseUnit.toLowerCase()}</span></div>
        <div class="t-note dim"><s>${money(Math.round(nom / 1e6), { decimals: true })}</s> +${uplift}%</div></div></div>`;
  }).join("")}</div>

  ${S.custom.products.length ? `
  <div class="section-head"><h2 class="t-t1">Your items</h2><span class="t-sm dim">tips, art, stones, anything</span></div>
  <div class="list">${S.custom.products.map((p) => {
    const per = p.baseQty > 0 ? p.landedPaise / p.baseQty : 0;
    const perUse = p.usesPerItem > 1 ? per / p.usesPerItem : per;
    return `<div class="list-row"><span class="swatch">${esc(p.category.charAt(0))}</span>
      <div class="grow"><div class="t-headline">${esc(p.name)}</div>
        <div class="t-sm dim">${esc(p.category)} · ${money(p.landedPaise)} for ${p.baseQty} ${p.baseUnit.toLowerCase()}${p.usesPerItem > 1 ? ` · ${p.usesPerItem} uses each` : ""}</div></div>
      <div style="text-align:right"><div class="num t-t3">${money(Math.round(perUse), { decimals: true })}<span class="t-note dim">/${p.usesPerItem > 1 ? "use" : p.baseUnit.toLowerCase()}</span></div></div>
      <button class="btn subtle sm" style="min-height:28px;padding:0 8px"${act("delitem", p.id)} aria-label="Delete ${esc(p.name)}">✕</button>
    </div>`;
  }).join("")}</div>` : ""}

  <div class="section-head"><h2 class="t-t1">Equipment</h2></div>
  <div class="list">${NS.DURABLES.map((d) => `
    <div class="list-row"><span class="swatch">⚙</span>
      <div class="grow"><div class="t-headline">${esc(d.name)}</div>
        <div class="t-sm dim">${money(d.costPaise)} over ${d.lifeUnits.toLocaleString("en-IN")} services</div></div>
      <div class="num t-t3">${money(NS.durableCostPaise(d), { decimals: true })}<span class="t-note dim">/job</span></div></div>`).join("")}</div>`;
}

function screenDash() {
  const spans = { week: 7 * 864e5, month: 30 * 864e5, all: Infinity };
  const now = Date.now();
  const jobs = S.jobs.filter((j) => now - j.at < spans[S.dashPeriod]);
  const rev = jobs.reduce((a, j) => a + j.pricePaise, 0);
  const contrib = jobs.reduce((a, j) => a + j.contributionPaise, 0);
  const hrs = jobs.reduce((a, j) => a + j.hours, 0);
  const cph = hrs > 0 ? Math.round(contrib / hrs) : 0;
  const mats = rev - contrib;

  // group by service
  const byService = Object.values(jobs.reduce((m, j) => {
    const k = j.serviceId || j.title;
    m[k] = m[k] || { name: svc(j.serviceId)?.name || j.title, jobs: 0, rev: 0, contrib: 0, hrs: 0 };
    m[k].jobs++; m[k].rev += j.pricePaise; m[k].contrib += j.contributionPaise; m[k].hrs += j.hours;
    return m;
  }, {})).sort((a, b) => b.rev - a.rev);

  // payment split
  const byMethod = Object.values(jobs.reduce((m, j) => {
    const k = j.method || "Other";
    m[k] = m[k] || { name: k, rev: 0, jobs: 0 };
    m[k].rev += j.pricePaise; m[k].jobs++; return m;
  }, {})).sort((a, b) => b.rev - a.rev);

  const spark = jobs.slice(-14).map((j) =>
    Math.min(100, Math.round((j.contributionPerHourPaise / 100000) * 100)));

  const label = { week: "This week", month: "Last 30 days", all: "All time" }[S.dashPeriod];

  return `
  <div class="section-head"><div><div class="t-pre dim">Dashboard</div>
    <h1 class="t-h1" style="margin:2px 0 0">${label}</h1></div></div>

  <div class="seg block" style="margin-bottom:var(--space-4)">
    ${["week", "month", "all"].map((k) => `<button aria-pressed="${S.dashPeriod === k}"${act("dashperiod", k)}>
      ${{ week: "Week", month: "Month", all: "All" }[k]}</button>`).join("")}</div>

  <div class="grid-2">
    <div class="card kpi"><div class="lbl">Revenue</div><div class="val num">${money(rev)}</div>
      <div class="delta muted">${jobs.length} job${jobs.length === 1 ? "" : "s"}</div></div>
    <div class="card inverse kpi"><div class="lbl">Per chair-hour</div><div class="val num">${money(cph)}</div>
      <div class="delta muted">${hrs.toFixed(1)} h in the chair</div></div>
    <div class="card kpi"><div class="lbl">You kept</div><div class="val num">${money(contrib)}</div>
      <div class="delta muted">after materials</div></div>
    <div class="card kpi"><div class="lbl">Materials</div><div class="val num">${money(mats)}</div>
      <div class="delta muted">${rev ? Math.round((mats / rev) * 100) : 0}% of revenue</div></div>
  </div>

  ${jobs.length ? `
  <div class="section-head"><h2 class="t-t1">₹/hour, recent jobs</h2></div>
  <div class="card"><div class="bars">${spark.map((v, i) =>
    `<i class="${i >= spark.length - 3 ? "hi" : ""}" style="height:${Math.max(v, 8)}%"></i>`).join("")}</div></div>

  <div class="section-head"><h2 class="t-t1">By service</h2></div>
  <div class="list">${byService.map((r) => `
    <div class="list-row"><div class="grow">
      <div class="t-headline">${esc(r.name)}</div>
      <div class="t-sm dim">${r.jobs} job${r.jobs === 1 ? "" : "s"} · ${r.hrs.toFixed(1)} h · kept ${money(r.contrib)}</div></div>
      <div style="text-align:right"><div class="num t-t3">${money(r.rev)}</div>
        <div class="t-note dim">${money(r.hrs > 0 ? Math.round(r.contrib / r.hrs) : 0)}/hr</div></div></div>`).join("")}</div>

  <div class="section-head"><h2 class="t-t1">Paid by</h2></div>
  <div class="list">${byMethod.map((r) => `
    <div class="list-row"><div class="grow"><div class="t-headline">${esc(r.name)}</div>
      <div class="t-sm dim">${r.jobs} job${r.jobs === 1 ? "" : "s"}</div></div>
      <div class="num t-t3">${money(r.rev)}</div></div>`).join("")}</div>`
  : `<div class="card empty" style="margin-top:var(--space-4)"><div class="t-t2">Nothing in this period</div>
     <p class="t-sm muted" style="max-width:34ch;margin:8px auto 20px">Log jobs and this becomes your business at a glance.</p>
     <button class="btn accent"${act("newjob")}>Log a job</button></div>`}

  <div class="section-head"><h2 class="t-t1">Ranking & data</h2></div>
  <div class="stack">
    <button class="btn outline block"${act("go", "insights")}>Full service ranking →</button>
    <button class="btn outline block"${act("export")}>Export backup</button>
    <button class="btn ${S.armReset ? "destructive" : "light destructive"} block"${act("resetstats")}>
      ${S.armReset ? "Tap again to erase all logged jobs" : "Reset stats (clear logged jobs)"}</button>
    <p class="t-sm dim" style="text-align:center;margin:0">Reset clears jobs and their stats only — your prices,
    services, items and settings stay exactly as they are.</p>
  </div>`;
}

function screenInsights() {
  const bare = quoteFor({ serviceId: "gel-mani", hands: 2, length: "S", coats: 2, addons: [] });
  const rows = baseServices().concat(addonList()).map((sv) => {
    const isAddon = sv.kind === "ADDON";
    const q = quoteFor({ serviceId: isAddon ? "gel-mani" : sv.id, hands: 2, length: "S",
                         coats: sv.defaultCoats, addons: isAddon ? [sv.id] : [] });
    let direct = q.directPaise, hours = q.hours, price = q.pricePaise, rec = q.recommendedPaise;
    if (isAddon) {
      direct = q.directPaise - bare.directPaise;
      hours = (S.overrides[sv.id]?.minutes ?? sv.minutes) / 60;
      price = myPrice(sv.id);
      rec = q.recommendedPaise - bare.recommendedPaise;
    }
    const done = S.jobs.filter((j) => j.serviceId === sv.id);
    if (done.length) price = Math.round(done.reduce((a, j) => a + j.pricePaise, 0) / done.length);
    const o = NS.jobOutcome({ pricePaise: price, directPaise: direct, hours });
    return { sv, price, rec, direct, hours, cph: o.contributionPerHourPaise, jobs: done.length };
  }).sort((a, b) => b.cph - a.cph);

  const best = rows[0]?.cph || 1;
  const median = rows.length ? rows[Math.floor(rows.length / 2)].cph : 0;

  return `
  <div class="section-head"><div><div class="t-pre dim">Insights</div>
    <h1 class="t-h1" style="margin:2px 0 0">What actually pays</h1></div></div>

  <div class="card inverse" style="margin-bottom:var(--space-4)">
    <div class="t-pre" style="opacity:.6">At your prices, your time is worth</div>
    <div class="t-d3 num" style="margin:6px 0">${money(median)}<span class="t-t2">/hr</span></div>
    <div class="t-sm muted">Median across your service list, after materials. This is the number that
    decides whether the business is worth the hours — not margin %.</div></div>

  <div class="list">${rows.map((r) => `
    <div class="list-row"><div class="grow">
      <div class="row-between"><span class="t-headline">${esc(r.sv.name)}${r.sv.kind === "ADDON" ? ` <span class="tag accent">add-on</span>` : ""}</span>
        <span class="num t-t3">${money(r.cph)}<span class="t-note dim">/hr</span></span></div>
      <div style="height:6px;border-radius:99px;background:var(--color-surface-sunken);margin:8px 0 6px;overflow:hidden">
        <div style="height:100%;width:${Math.max(4, Math.round((r.cph / best) * 100))}%;background:${r.cph < best * 0.5 ? "var(--color-destructive)" : "var(--color-accent)"};border-radius:99px"></div></div>
      <div class="t-sm dim">${money(r.price)} · ${Math.round(r.hours * 60)} min · materials ${money(r.direct)}${r.jobs ? ` · ${r.jobs} logged` : ""}${
        S.showRecommended ? ` · <span class="rec">rec ${money(r.rec)}</span>` : ""}</div>
    </div></div>`).join("")}</div>

  <div class="card flat" style="margin-top:var(--space-4)">
    <div class="t-headline">Read this as a ranking, not a verdict</div>
    <p class="t-sm muted" style="margin:6px 0 0">The work at the top earns most per hour of your time.
    If a service near the bottom is what brings clients in the door, it may still be worth keeping —
    just know what it's costing you in hours.</p></div>`;
}

function screenSettings() {
  const a = S.assumptions;
  const R = NS.targetHourlyRatePaise(a), O = NS.overheadRatePaisePerHour(a);
  const F = (k, label, val, note, step = 1) => `
    <div class="card" style="margin-bottom:var(--space-3)">
      <div class="row-between"><div class="grow"><div class="t-headline">${label}</div>
        <div class="t-sm muted" style="margin-top:2px">${note}</div></div>
        <input class="input" style="width:120px;text-align:right" type="number" inputmode="decimal"
          step="${step}" value="${val}" data-set="${k}" id="set-${k}"></div></div>`;
  return `
  <div class="section-head"><div><div class="t-pre dim">Settings</div>
    <h1 class="t-h1" style="margin:2px 0 0">Assumptions</h1></div>
    <button class="btn outline sm"${act("theme")}>${S.theme === "dark" ? "☀︎ Light" : "☾ Dark"}</button></div>

  <div class="card inverse" style="margin-bottom:var(--space-6)">
    <div class="t-pre" style="opacity:.6">Rate implied by your goals</div>
    <div class="t-d3 num" style="margin:6px 0">${money(Math.round(R))}<span class="t-t2">/hr</span></div>
    <div class="t-sm muted">(take-home ${money(a.targetTakeHomePaise)} + overhead ${money(a.overheadPoolPaise)}) ÷ ${a.billableHoursMonthly} billable hours.
    Overhead alone absorbs ${money(Math.round(O))}/hr. This drives the <b>recommended</b> price only —
    your own prices live under Prices.</div></div>

  <div class="card flat" style="margin-bottom:var(--space-4)">
    <div class="t-headline">These do not change what you charge</div>
    <p class="t-sm muted" style="margin:6px 0 0">Everything on this screen feeds the recommendation and the
    cost analysis. Your prices are only ever changed by you, on the Prices screen.</p></div>

  <div class="t-pre dim" style="margin-bottom:10px">What you want the business to earn</div>
  ${F("targetTakeHomePaise", "Monthly take-home target", a.targetTakeHomePaise / 100, "What you want to earn per month, in ₹. Default ₹20,000 — realistic starting out in East Delhi.", 1000)}
  ${F("billableHoursMonthly", "Billable hours per month", a.billableHoursMonthly, "Hours actually in the chair — not hours available. Default 48 ≈ 11 clients a week.", 4)}
  ${F("overheadPoolPaise", "Monthly overhead pool", a.overheadPoolPaise / 100, "Power, data, Instagram ads, packaging, sanitisation, travel. Default ₹5,000 for home-based work.", 500)}

  <div class="t-pre dim" style="margin:var(--space-6) 0 10px">Consumption assumptions</div>
  ${F("residuePct", "Unreachable residue", a.residuePct, "Product left in the bottle neck and brush well. Default 0.05 = 5%.", 0.01)}
  ${F("wastageGel", "Gel / polish wastage", a.wastageGel, "Over-dispensing, brush wipe, drips. Default 0.10 = 10%.", 0.01)}
  ${F("wastageBuilder", "Builder / acrylic wastage", a.wastageBuilder, "Beads dispensed generously then filed off. Default 0.15 = 15%.", 0.01)}
  ${F("setupMinutes", "Setup + cleanup minutes", a.setupMinutes, "Sanitise, tray prep, station wipe-down. Unbilled but real.", 5)}
  ${F("serviceFixedTimePct", "Fixed share of service time", a.serviceFixedTimePct, "Portion that doesn't shrink on a smaller job — consult, soak, hand prep. Default 0.20 = 20%.", 0.05)}

  <div class="card flat" style="margin-top:var(--space-6)">
    <div class="t-headline">History never changes</div>
    <p class="t-sm muted" style="margin:6px 0 0">Editing anything here affects future quotes only. Every saved job
    keeps a frozen snapshot of the cost and assumptions it was priced with, so last month's numbers stay honest.</p></div>

  <div class="row" style="margin-top:var(--space-4);gap:var(--space-2)">
    <button class="btn outline"${act("export")}>Export backup</button>
    <button class="btn subtle"${act("reset")}>Reset assumptions</button></div>`;
}

/* --------------------------------------------------------- why-sheet ---- */
function sheetWhy() {
  const q = quoteFor({ ...S.quote, nails: qNails() });
  const lines = [];
  const estimates = [];
  for (const p of q.parts) {
    if (p.cost) for (const i of p.cost.items) lines.push(i);
    else estimates.push({ name: p.service.name, costPaise: p.directPaise });
  }
  const merged = Object.values(lines.reduce((m, i) => {
    m[i.name] = m[i.name] || { name: i.name, costPaise: 0, qty: 0, unit: i.unit };
    m[i.name].costPaise += i.costPaise; m[i.name].qty += i.qty; return m;
  }, {})).sort((a, b) => b.costPaise - a.costPaise);
  const dur = q.parts.reduce((s, p) => s + (p.cost ? p.cost.durablesPaise : 0), 0);

  return `<div class="grabber"></div>
    <div class="section-head" style="margin-top:0"><h2 class="t-h3">Where ${money(q.pricePaise)} goes</h2>
      <button class="btn subtle sm"${act("close")}>Close</button></div>
    <table class="breakdown">
      ${merged.map((i) => `<tr><td>${esc(i.name)} <span class="dim">${i.qty.toFixed(2)} ${i.unit.toLowerCase()}</span></td>
        <td>${money(i.costPaise, { decimals: true })}</td></tr>`).join("")}
      ${estimates.map((e) => `<tr><td>${esc(e.name)} <span class="dim">materials — your estimate</span></td>
        <td>${money(e.costPaise, { decimals: true })}</td></tr>`).join("")}
      <tr class="sub"><td>Equipment amortisation</td><td>${money(dur, { decimals: true })}</td></tr>
      <tr><td><b>Materials + equipment</b></td><td><b>${money(q.directPaise, { decimals: true })}</b></td></tr>
      <tr class="sub"><td>Chair time ${Math.round(q.hours * 60)} min @ ${money(Math.round(q.rec.overheadRatePaisePerHour))}/hr overhead</td>
        <td>${money(q.rec.overheadPaise)}</td></tr>
      <tr class="sub"><td>Total cost to serve</td><td>${money(q.rec.absorbedPaise)}</td></tr>
      <tr><td>Your price</td><td><b>${money(q.pricePaise)}</b></td></tr>
      <tr class="total"><td>You keep, per hour</td>
        <td class="${q.health.contributionPerHourPaise < 25000 ? "neg" : ""}">${money(q.health.contributionPerHourPaise)}/hr</td></tr>
    </table>

    ${S.showRecommended ? `
    <div class="t-pre dim" style="margin:var(--space-6) 0 10px">Second opinion</div>
    <table class="breakdown">
      ${Object.values(q.rec.models).map((m) => `<tr><td>${esc(m.label)} <span class="dim">${esc(m.note)}</span>
        ${m.recommended ? `<span class="tag accent">used</span>` : ""}</td><td>${money(m.pricePaise)}</td></tr>`).join("")}
      ${q.market.lowPaise != null ? `<tr class="sub"><td>Local rate for this service</td><td>${money(q.market.lowPaise)} – ${money(q.market.highPaise)}</td></tr>` : ""}
    </table>` : `
    <div class="card flat" style="margin-top:var(--space-4)">
      <div class="row-between"><div class="grow"><div class="t-headline">Want a second opinion?</div>
        <div class="t-sm muted" style="margin-top:2px">See what your costs and income target would suggest.</div></div>
      <button class="switch"${act("togglerec")} role="switch" aria-checked="false"></button></div></div>`}

    <div class="card flat" style="margin-top:var(--space-4)">
      <div class="t-headline">Materials are ${Math.round((q.directPaise / Math.max(q.pricePaise, 1)) * 100)}% of this price</div>
      <p class="t-sm muted" style="margin:6px 0 0">Buying 20% cheaper product saves ${money(Math.round(q.directPaise * 0.2))}.
      Finishing 10 minutes sooner is worth ${money(Math.round(q.health.contributionPerHourPaise / 6))}.
      Time is the bigger lever, by a lot.</p></div>`;
}

/* -------------------------------------------------------- form sheets --- */
/* Uncontrolled inputs with plain ids — typing never triggers a render; values
   are read once on Save. Inputs here must NOT carry data-set/data-price attrs. */

const formField = (id, label, opt = {}) => `
  <div class="field" style="margin-bottom:var(--space-3)">
    <label for="${id}">${label}</label>
    <input class="input" id="${id}" type="${opt.type || "number"}" ${opt.type === "text" ? "" : 'inputmode="numeric" min="0"'}
      value="${opt.value ?? ""}" placeholder="${opt.placeholder || ""}" autocomplete="off"></div>`;

function sheetAddService(kind) {
  const isAddon = kind === "ADDON";
  return `<div class="grabber"></div>
    <div class="section-head" style="margin-top:0">
      <h2 class="t-h3">New ${isAddon ? "add-on" : "service"}</h2>
      <button class="btn subtle sm"${act("close")}>Close</button></div>
    ${formField("ns-name", "Name", { type: "text", placeholder: isAddon ? "e.g. Foil Art, Charms, Velvet" : "e.g. Acrylic Set, Pedicure, Nail Art Only" })}
    ${formField("ns-min", "Time it takes (minutes, full set)", { value: isAddon ? 15 : 60 })}
    ${formField("ns-mat", "What the materials cost you (₹ per job)", { value: isAddon ? 20 : 80 })}
    ${formField("ns-price", "Your price (₹)", { value: isAddon ? 150 : 500 })}
    <div class="card flat" style="margin:var(--space-2) 0 var(--space-4)">
      <p class="t-sm muted" style="margin:0">The app will show what you keep and your ₹/hour from these,
      and update them live as you change the price later. Everything stays editable on the Prices screen.</p></div>
    <button class="btn accent lg block"${act(isAddon ? "saveaddon" : "savesvc")}>Save ${isAddon ? "add-on" : "service"}</button>`;
}

function sheetAddItem() {
  const cats = ["Tips/Nails", "Gel", "Polish", "Art", "Stones/Charms", "Tools", "Other"];
  return `<div class="grabber"></div>
    <div class="section-head" style="margin-top:0">
      <h2 class="t-h3">New stock item</h2>
      <button class="btn subtle sm"${act("close")}>Close</button></div>
    ${formField("ni-name", "Name", { type: "text", placeholder: "e.g. Coffin Tips XL, Foil Sheets, 4mm Pearls" })}
    <div class="field" style="margin-bottom:var(--space-3)"><label for="ni-cat">Category</label>
      <select class="input" id="ni-cat">${cats.map((c) => `<option>${c}</option>`).join("")}</select></div>
    ${formField("ni-price", "What you paid (₹)", { value: 200 })}
    ${formField("ni-qty", "Quantity in the pack", { value: 100 })}
    <div class="field" style="margin-bottom:var(--space-3)"><label for="ni-unit">Unit</label>
      <select class="input" id="ni-unit"><option>pc</option><option>ml</option><option>g</option></select></div>
    ${formField("ni-uses", "Uses per piece (1 = single use)", { value: 1 })}
    <div class="card flat" style="margin:var(--space-2) 0 var(--space-4)">
      <p class="t-sm muted" style="margin:0">The app works out cost per use. Use that number when setting a
      service's material cost — e.g. tips at ₹0.70 each × 10 nails = ₹7 per set.</p></div>
    <button class="btn accent lg block"${act("saveitem")}>Save item</button>`;
}

/**
 * "How far does it go?" — the answer to "how would she know how much was used?"
 *
 * She never enters grams. She answers the question she already knows from
 * experience, or she lets the app measure it when a pot runs out.
 */
function sheetUsage() {
  const p = productById(S.usageSheetId);
  if (!p) return `<div class="grabber"></div><div class="empty">Item not found</div>`;
  const A = S.assumptions;
  const u = usageFor(p);
  const unit = p.baseUnit.toLowerCase();
  const clients = NS.clientsPerContainer({
    baseQty: p.baseQty, qtyPerNail: u.qtyPerNail, residuePct: p.residuePct ?? A.residuePct });
  const wast = p.wastagePct ?? (p.isBuilder ? A.wastageBuilder : A.wastageGel);
  const eff = NS.effectiveUnitCostMicro({ landedPaise: p.landedPaise, baseQty: p.baseQty,
    residuePct: p.residuePct ?? A.residuePct, wastagePct: wast });
  const perNail = Math.round((u.qtyPerNail * eff) / 1e6);
  const src = SOURCE_LABEL[u.source];
  const ready = u.unitsSinceOpen >= 10;

  return `<div class="grabber"></div>
    <div class="section-head" style="margin-top:0">
      <h2 class="t-h3">How far does it go?</h2>
      <button class="btn subtle sm"${act("close")}>Close</button></div>

    <div class="card inverse" style="margin-bottom:var(--space-4)">
      <div class="t-pre" style="opacity:.6">${esc(p.name)}</div>
      <div class="t-d3 num" style="margin:6px 0">${money(perNail, { decimals: true })}<span class="t-t2"> per nail</span></div>
      <div class="t-sm muted">${u.qtyPerNail.toFixed(3)} ${unit} a nail · about
        <b>${clients < 1 ? clients.toFixed(1) : Math.round(clients)}</b> full sets from one ${esc(p.pack || "container")}
        ${src.tag ? `· <span class="tag ${src.cls}">${src.tag}</span>` : ""}</div>
      <div class="t-note" style="opacity:.55;margin-top:6px">${src.text}</div></div>

    <div class="t-pre dim" style="margin-bottom:10px">1 · Just tell it what you know</div>
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="row-between"><div class="grow">
        <div class="t-headline">How many clients does one ${esc(p.pack || "pack")} last?</div>
        <div class="t-sm muted" style="margin-top:2px">A rough number is fine — "about 40" beats a perfect guess at grams.</div></div>
        <input class="priceinput" type="number" inputmode="numeric" min="0" step="1"
          id="u-clients" value="${clients > 0 ? Math.round(clients) : ""}" placeholder="40"></div>
      <button class="btn accent block" style="margin-top:var(--space-3)"${act("usesave")}>Use this</button>
    </div>

    <div class="t-pre dim" style="margin-bottom:10px">2 · Or let it measure itself</div>
    <div class="card" style="margin-bottom:var(--space-4)">
      <div class="t-headline">Logged so far: ${u.unitsSinceOpen.toFixed(0)} nails</div>
      <p class="t-sm muted" style="margin:6px 0 0">Keep logging jobs. When this ${esc(p.pack || "pot")} runs out,
      tap below — the app knows how many nails it did, so it can work out the real usage
      with no weighing at all.${u.calibrations ? ` Measured ${u.calibrations} time${u.calibrations > 1 ? "s" : ""} so far.` : ""}</p>
      <button class="btn ${ready ? "primary" : "outline"} block" style="margin-top:var(--space-3)"
        ${act("usefinish")} ${ready ? "" : "disabled"}>
        ${ready ? "This one is finished — work it out" : `Needs ~${Math.max(0, 10 - Math.round(u.unitsSinceOpen))} more nails logged`}</button>
    </div>

    <div class="t-pre dim" style="margin-bottom:10px">3 · Or set it exactly</div>
    <div class="card">
      <div class="row-between"><div class="grow">
        <div class="t-headline">${unit} per nail</div>
        <div class="t-sm muted" style="margin-top:2px">Only if you've actually weighed it.</div></div>
        <input class="priceinput" type="number" inputmode="decimal" min="0" step="0.005"
          id="u-qty" value="${u.qtyPerNail || ""}" placeholder="0.02"></div>
      <button class="btn outline block" style="margin-top:var(--space-3)"${act("useexact")}>Set exactly</button>
    </div>`;
}

/** Shown when a measurement looks thin or wild — never applied silently. */
function sheetCalibCheck() {
  const c = S.pendingCalib;
  if (!c) return `<div class="grabber"></div><div class="empty">Nothing to check</div>`;
  const p = productById(c.id);
  const unit = p ? p.baseUnit.toLowerCase() : "";
  return `<div class="grabber"></div>
    <div class="section-head" style="margin-top:0">
      <h2 class="t-h3">Does this look right?</h2>
      <button class="btn subtle sm"${act("close")}>Close</button></div>
    <div class="alert warnbg" style="margin-bottom:var(--space-4)">
      <span class="dot" style="background:var(--color-warning)"></span>
      <div class="grow"><div class="t-headline">${c.thinSample
        ? `Only ${Math.round(c.units)} nails were logged against this ${esc(p?.pack || "pot")}`
        : "That's very different from what you were using"}</div>
        <div class="t-sm muted" style="margin-top:2px">${c.thinSample
          ? "If you used it on clients before you started logging, the maths will read far too high. Only accept this if every single use was logged here."
          : `It works out ${Math.abs(Math.round(c.driftPct))}% ${c.driftPct > 0 ? "higher" : "lower"} than your current figure.`}</div></div></div>
    <table class="breakdown">
      <tr><td>You were using</td><td>${c.before ? c.before.toFixed(3) + " " + unit : "—"} a nail</td></tr>
      <tr><td>This works out to</td><td><b>${c.measured.toFixed(3)} ${unit}</b> a nail</td></tr>
      <tr class="sub"><td>Nails logged against it</td><td>${Math.round(c.units)}</td></tr>
      <tr class="sub"><td>Confidence</td><td>${c.confidence}</td></tr>
    </table>
    <div class="stack" style="margin-top:var(--space-5)">
      <button class="btn accent block"${act("calibaccept")}>Yes, use the measured figure</button>
      <button class="btn outline block"${act("calibreject")}>No, keep what I had and start counting again</button>
    </div>`;
}

const SHEETS = {
  why: () => sheetWhy(),
  usage: () => sheetUsage(),
  calibcheck: () => sheetCalibCheck(),
  addservice: () => sheetAddService("SERVICE"),
  addaddon: () => sheetAddService("ADDON"),
  additem: () => sheetAddItem(),
};

/* ------------------------------------------------------------ chrome ---- */
const ICONS = {
  today: `<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>`,
  pricing: `<path d="M3 6h18M3 12h18M3 18h11"/><circle cx="19" cy="18" r="2.5"/>`,
  dash: `<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>`,
  quote: `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`,
  stock: `<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>`,
  insights: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
  settings: `<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>`,
};
/* pointer-events:none on the icon so e.target is always the button itself */
const ico = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none">${ICONS[k]}</svg>`;

const TABS = [["today", "Today"], ["quote", "Quote"], null, ["pricing", "Pricing"], ["dash", "Dashboard"]];
const NAV = [["today", "Today"], ["quote", "Quote"], ["pricing", "Pricing & cost"],
             ["dash", "Dashboard"], ["stock", "Stock"], ["insights", "Insights"], ["settings", "Settings"]];

function chrome(body) {
  const titles = { today: "Today", quote: "Quote", pricing: "Pricing & Cost Calculation",
                   dash: "Dashboard", stock: "Stock", insights: "Insights", settings: "Settings" };
  return `
  <nav class="sidebar">
    <div class="brand" style="align-items:center">
      <span class="brand-mark"></span>
      <div><div class="wordmark">Pricely</div>
        <div class="brand-tag">Nail Studio Inventory</div></div>
    </div>
    ${NAV.map(([k, l]) => `<button class="side-link"${act("go", k)} ${S.tab === k ? 'aria-current="page"' : ""}>
      ${ico(k)} ${l}</button>`).join("")}
  </nav>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark"></span> ${titles[S.tab]}</div>
      <div class="row">
        <button class="btn subtle sm"${act("theme")} aria-label="Toggle theme">${S.theme === "dark" ? "☀︎" : "☾"}</button>
        <button class="btn primary sm"${act("go", "settings")}>Assumptions</button></div>
    </header>
    <main class="main" id="main">${body}</main>
  </div>
  <nav class="tabbar">${TABS.map((t) => t
    ? `<button class="tab"${act("go", t[0])} ${S.tab === t[0] ? 'aria-current="page"' : ""}>${ico(t[0])}<span style="pointer-events:none">${t[1]}</span></button>`
    : `<button class="tab fab"${act("newjob")} aria-label="New job"><span style="pointer-events:none">+</span></button>`).join("")}</nav>
  ${S.sheet && SHEETS[S.sheet] ? `<div class="scrim"${act("close")}><div class="sheet"${act("noop")}>${SHEETS[S.sheet]()}</div></div>` : ""}
  ${S.toast ? `<div class="toast">${esc(S.toast)}</div>` : ""}
  <div class="progress" id="progress" aria-hidden="true"></div>`;
}

/* ------------------------------------------------------------ render ---- */
const SCREENS = { today: screenToday, quote: screenQuote, pricing: screenPricing,
                  dash: screenDash, stock: screenStock, insights: screenInsights, settings: screenSettings };

/**
 * Re-render, preserving what the user was doing:
 *   • scroll position  (otherwise every tap jumps the page to the top)
 *   • focus + caret    (otherwise typing is impossible)
 * @param {{resetScroll?:boolean}} [opt]
 */
/* Reveal animations run ONLY when the screen actually changes. The app
   re-renders on every tap, so a blanket entrance animation would strobe. */
let lastRenderedScreen = null;
let unfreezeRaf = 0;
let lastShownPrice = null;

function render(opt = {}) {
  document.documentElement.dataset.theme = S.theme;

  const y = window.scrollY;
  const ae = document.activeElement;
  const focusKey = ae && ae.id && ae !== document.body ? ae.id : null;
  const selStart = focusKey && ae.selectionStart != null ? ae.selectionStart : null;

  /* Freeze transitions across the swap. The node under the user's finger is
     about to be destroyed and rebuilt; without this it animates into its new
     state while still being pressed, which reads as a wobble. Cleared after
     two frames — one to paint the new DOM, one to let styles settle. */
  const app = $("#app");
  app.classList.add("no-motion");
  app.innerHTML = chrome(SCREENS[S.tab]());

  const want = opt.resetScroll ? 0 : y;
  if (window.scrollY !== want) window.scrollTo(0, want);

  if (unfreezeRaf) cancelAnimationFrame(unfreezeRaf);
  unfreezeRaf = requestAnimationFrame(() => {
    unfreezeRaf = requestAnimationFrame(() => {
      unfreezeRaf = 0;
      const el = document.getElementById("app");
      if (el) el.classList.remove("no-motion");
      // Deferred to here on purpose: anything applied before the freeze lifts
      // would be swallowed by `.no-motion`.
      pulsePriceIfChanged();
    });
  });

  if (focusKey) {
    const el = document.getElementById(focusKey);
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart != null && el.setSelectionRange) {
        try { el.setSelectionRange(selStart, selStart); } catch { /* number inputs */ }
      }
    }
  }

  const screenKey = S.tab + ":" + (S.tab === "pricing" ? S.pricingView : "");
  const entered = screenKey !== lastRenderedScreen;
  lastRenderedScreen = screenKey;
  if (entered) revealOnce(screenKey);
  syncScrollChrome();
  if (S.tab === "pricing" || S.tab === "quote") saveDraftSoon();
}

/**
 * The price is the most-read number in the app. When it moves — a nail tapped,
 * an add-on toggled — it should be impossible to miss, without a flash that
 * fires on every unrelated re-render. So: compare, then pulse only on change.
 */
function pulsePriceIfChanged() {
  if (reducedMotion()) return;
  const el = document.getElementById("bigprice") ||
             document.querySelector(".pricebar .big");
  if (!el) { lastShownPrice = null; return; }
  const now = el.value ?? el.textContent;
  if (lastShownPrice !== null && now !== lastShownPrice) {
    el.classList.remove("priced");
    void el.offsetWidth;
    el.classList.add("priced");
  }
  lastShownPrice = now;
}

/* ------------------------------------------------------------- motion --- */
const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Screens whose entrance has already played. The app re-renders on every tap,
   so without this the reveal would replay constantly; and a screen revisited
   later should not re-animate either. Once per screen, per session. */
const revealedScreens = new Set();
let revealObserver = null;

/**
 * Reveal blocks as they enter the viewport — ONCE.
 *
 * IntersectionObserver rather than a scroll handler: the browser does the
 * geometry off the main thread, and each element unobserves itself the moment
 * it fires, so nothing accumulates. The observer is torn down on every render
 * before a new one is built, which is what keeps this leak-free across the
 * hundreds of re-renders a single job entry produces.
 */
function revealOnce(screenKey) {
  if (revealObserver) { revealObserver.disconnect(); revealObserver = null; }
  const main = document.getElementById("main");
  if (!main) return;

  // Already seen, or motion is unwanted: show everything immediately.
  if (revealedScreens.has(screenKey) || reducedMotion() ||
      typeof IntersectionObserver !== "function") {
    settleFigures(screenKey);
    return;
  }
  revealedScreens.add(screenKey);

  const blocks = [...main.children].slice(0, 12);   // cap the work on long screens
  blocks.forEach((el, i) => {
    el.classList.add("pre-reveal");
    el.style.setProperty("--i", Math.min(i, 5));    // capped stagger
  });

  revealObserver = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("revealed");
      e.target.classList.remove("pre-reveal");
      obs.unobserve(e.target);                      // once only, then forget it
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.01 });

  for (const el of blocks) revealObserver.observe(el);
  settleFigures(screenKey);

  // Safety net: if the observer never fires (element hidden, tab backgrounded),
  // nothing may stay invisible. Money on screen beats a nice entrance.
  setTimeout(() => {
    for (const el of blocks) {
      el.classList.remove("pre-reveal");
      el.classList.add("revealed");
    }
  }, 1200);
}

/**
 * KPI figures settle into place — the ELEMENT animates, never the digits.
 *
 * A count-up shows ₹0 climbing to ₹700, which means the screen displays a
 * false amount of money for half a second and can stick there if interrupted.
 * Not a trade worth making in a tool whose job is telling her what she earned.
 */
function settleFigures(screenKey) {
  if (reducedMotion() || (screenKey && !revealedScreens.has(screenKey))) return;
  for (const el of document.querySelectorAll(".kpi .val")) {
    el.classList.remove("settle");
    void el.offsetWidth;            // restart the animation cleanly
    el.classList.add("settle");
  }
}

/* One passive, rAF-throttled scroll listener for the whole app — progress bar
   and header compression. It never writes scroll position, so it cannot fight
   render()'s scroll restoration. */
let scrollQueued = false;
function syncScrollChrome() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const y = window.scrollY || 0;
  const bar = document.getElementById("progress");
  if (bar) bar.style.setProperty("--p", max > 40 ? Math.min(1, y / max).toFixed(3) : 0);
  const top = document.querySelector(".topbar");
  if (top) {
    // Hysteresis: without a dead band, a scroll position sitting near the
    // threshold flips the header open/shut on every re-render.
    const on = top.classList.contains("compressed");
    if (!on && y > 40) top.classList.add("compressed");
    else if (on && y < 16) top.classList.remove("compressed");
  }
}
window.addEventListener("scroll", () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; syncScrollChrome(); });
}, { passive: true });

/* Release observers and pending writes when the app is backgrounded or closed
   — iOS kills PWAs aggressively and a pending debounce would lose the draft. */
window.addEventListener("pagehide", () => {
  if (revealObserver) { revealObserver.disconnect(); revealObserver = null; }
  clearTimeout(draftTimer);
  try { save(); } catch { /* quota */ }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { clearTimeout(draftTimer); try { save(); } catch {} }
});

/* The draft is saved on a trailing debounce — writing to localStorage on every
   tap would stutter the nail picker on a low-end phone. Flushed on pagehide. */
let draftTimer = null;
function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { try { save(); } catch { /* quota */ } }, 400);
}

function toast(msg) {
  S.toast = msg; render();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { S.toast = null; render(); }, 2200);
}

/* ------------------------------------------------------------ actions --- */
const readNum = (id) => {
  const v = parseFloat(document.getElementById(id)?.value);
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const readText = (id) => (document.getElementById(id)?.value || "").trim();

/* One handler per action. Adding a control means adding a key here — there is
   no attribute-matching guesswork left to get wrong. */
const ACTIONS = {
  noop:  () => false,                                     // swallow (sheet body)
  close: () => { S.sheet = null; return true; },
  go:    (v) => { S.tab = v; return { resetScroll: true }; },
  newjob: () => { S.tab = "pricing"; S.pricingView = "calc"; return { resetScroll: true }; },
  sheet: (v) => { S.sheet = v; return true; },
  theme: () => { S.theme = S.theme === "dark" ? "light" : "dark";
                 localStorage.setItem("nsos.theme", S.theme); return true; },

  /* Changing the job clears a one-off override — it was priced for the old job. */
  qservice: (v) => { S.quote.serviceId = v; S.quote.coats = svc(v).defaultCoats;
                     S.quote.overridePaise = null; return true; },
  qhands:   (v) => { S.quote.hands = +v; S.quote.nails = null;   // preset wins again
                     S.quote.overridePaise = null; return true; },
  qnail:    (v) => { const m = { ...qNails() };
                     m[v] = ((m[v] || 0) + 1) % 3;
                     S.quote.nails = m; S.quote.overridePaise = null; return true; },
  qlen:     (v) => { S.quote.length = v; S.quote.overridePaise = null; return true; },
  qcoats:   (v) => { S.quote.coats = Math.max(1, Math.min(5, S.quote.coats + +v));
                     S.quote.overridePaise = null; return true; },
  qaddon:   (v) => { const i = S.quote.addons.indexOf(v);
                     i < 0 ? S.quote.addons.push(v) : S.quote.addons.splice(i, 1);
                     S.quote.overridePaise = null; return true; },
  clearoverride: () => { S.quote.overridePaise = null; return true; },

  togglerec: () => { S.showRecommended = !S.showRecommended; save(); return true; },
  mode: (v) => { S.assumptions.pricingMode = v; save(); return true; },
  dashperiod: (v) => { S.dashPeriod = v; save(); return true; },
  pview: (v) => { S.pricingView = v; save(); return { resetScroll: true }; },

  /* ---- usage discovery ---- */
  usageopen: (v) => { S.usageSheetId = v; S.sheet = "usage"; return true; },

  usesave: () => {
    const p = productById(S.usageSheetId);
    const n = readNum("u-clients");
    if (!p || !n || n <= 0) { toast("How many clients, roughly?"); return false; }
    const qty = NS.usagePerNailFromLife({
      baseQty: p.baseQty, clientsPerContainer: n,
      residuePct: p.residuePct ?? S.assumptions.residuePct });
    S.usage[p.id] = { ...(S.usage[p.id] || {}), qtyPerNail: qty,
                      source: NS.USAGE_SOURCE.ESTIMATED };
    S.sheet = null; save(); render();
    toast(`${p.name}: about ${n} sets a ${p.pack || "pack"}`);
    return false;
  },

  useexact: () => {
    const p = productById(S.usageSheetId);
    const q = readNum("u-qty");
    if (!p || !q || q <= 0) { toast("Enter a quantity"); return false; }
    S.usage[p.id] = { ...(S.usage[p.id] || {}), qtyPerNail: q,
                      source: NS.USAGE_SOURCE.ESTIMATED };
    S.sheet = null; save(); render(); toast("Saved");
    return false;
  },

  /* The moment the app stops guessing: a pot ran out. */
  usefinish: () => {
    const p = productById(S.usageSheetId);
    if (!p) return false;
    const cur = S.usage[p.id] || {};
    const before = usageFor(p).qtyPerNail;
    const r = NS.calibrateUsage({
      baseQty: p.baseQty,
      nailUnitsConsumed: cur.unitsSinceOpen || 0,
      previousQtyPerNail: cur.source === NS.USAGE_SOURCE.CALIBRATED ? cur.qtyPerNail : null,
      referenceQtyPerNail: before || null,
      residuePct: p.residuePct ?? S.assumptions.residuePct,
    });
    if (!r.ok) { toast("Log a few jobs with it first"); return false; }
    // A thin or wild sample must not silently overwrite a sane figure.
    if (r.thinSample || r.suspicious) {
      S.pendingCalib = { id: p.id, measured: r.measured, applied: r.applied,
                         before, units: cur.unitsSinceOpen, ...r };
      S.sheet = "calibcheck"; render();
      return false;
    }
    S.usage[p.id] = {
      qtyPerNail: r.applied,
      source: NS.USAGE_SOURCE.CALIBRATED,
      unitsSinceOpen: 0,                       // a fresh pot starts a fresh count
      calibrations: (cur.calibrations || 0) + 1,
    };
    S.sheet = null; save(); render();
    toast(`Measured from ${Math.round(cur.unitsSinceOpen)} nails`);
    return false;
  },

  calibaccept: () => {
    const c = S.pendingCalib; if (!c) return true;
    const cur = S.usage[c.id] || {};
    S.usage[c.id] = { qtyPerNail: c.applied, source: NS.USAGE_SOURCE.CALIBRATED,
                      unitsSinceOpen: 0, calibrations: (cur.calibrations || 0) + 1 };
    S.pendingCalib = null; S.sheet = null; save(); render(); toast("Measured figure saved");
    return false;
  },
  calibreject: () => {
    const c = S.pendingCalib; if (!c) return true;
    // Keep her figure, but reset the counter so the next pot measures cleanly.
    S.usage[c.id] = { ...(S.usage[c.id] || {}), unitsSinceOpen: 0 };
    S.pendingCalib = null; S.sheet = null; save(); render(); toast("Kept your figure — counting restarted");
    return false;
  },

  /* ---- micro-usage: WHICH nails an add-on lands on ---- */
  /** Enter/leave assignment mode for one add-on. */
  paint: (v) => { S.job.paintAddon = S.job.paintAddon === v ? null : v; return true; },
  paintdone: () => { S.job.paintAddon = null; return true; },
  /** Toggle the active add-on on one nail. Only nails in the job can take it. */
  paintnail: (v) => {
    const id = S.job.paintAddon; if (!id) return true;
    if (!(jobNailMap()[v] > 0)) { toast("That nail isn't part of this job"); return false; }
    const map = { ...addonNailMap(id) };
    if (map[v] > 0) delete map[v]; else map[v] = 1;
    S.job.addonNails[id] = map;
    return true;
  },
  paintall: () => {
    const id = S.job.paintAddon; if (!id) return true;
    S.job.addonNails[id] = { ...jobNailMap() };
    return true;
  },
  paintnone: () => {
    const id = S.job.paintAddon; if (!id) return true;
    S.job.addonNails[id] = {};
    return true;
  },

  /* Fix — jump from a "Needs attention" card to the exact thing to change.
     SERVICE → Prices, row highlighted, price input focused so she can type
     the new number immediately. PRODUCT → Stock, row highlighted. */
  fix: (v) => {
    const sep = v.indexOf(":");
    const type = v.slice(0, sep), id = v.slice(sep + 1);
    S.tab = type === "PRODUCT" ? "stock" : "pricing";
    if (type !== "PRODUCT") S.pricingView = "list";
    render({ resetScroll: true });
    const row = document.getElementById("row-" + id);
    if (row) {
      row.classList.add("flash");
      if (row.scrollIntoView) row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.addEventListener("animationend", () => row.classList.remove("flash"), { once: true });
    }
    if (type === "SERVICE") {
      const input = document.getElementById("price-" + id);
      if (input) { input.focus({ preventScroll: true }); if (input.select) input.select(); }
    }
    return false;
  },

  /* ---- her catalogue ---- */
  savesvc: () => ACTIONS._saveService("SERVICE"),
  saveaddon: () => ACTIONS._saveService("ADDON"),
  _saveService: (kind) => {
    const name = readText("ns-name");
    const minutes = readNum("ns-min"), mat = readNum("ns-mat"), price = readNum("ns-price");
    if (!name) { toast("Give it a name"); return false; }
    if (!minutes || minutes < 1) { toast("How many minutes does it take?"); return false; }
    if (mat == null || price == null) { toast("Fill in cost and price"); return false; }
    const id = newId(name);
    const entry = { id, name, kind, custom: true, scope: "FULL_SET",
                    minutes, defaultCoats: 1, materialPaise: Math.round(mat * 100),
                    marketLow: null, marketHigh: null };
    (kind === "ADDON" ? S.custom.addons : S.custom.services).push(entry);
    S.myPrices[id] = Math.round(price * 100);
    S.sheet = null; save(); render(); toast(`${name} added`);
    return false;
  },
  delcustom: (v) => {
    for (const key of ["services", "addons"]) {
      const i = S.custom[key].findIndex((x) => x.id === v);
      if (i >= 0) S.custom[key].splice(i, 1);
    }
    delete S.myPrices[v]; delete S.overrides[v];
    S.quote.addons = S.quote.addons.filter((a) => a !== v);
    S.job.addons = S.job.addons.filter((a) => a !== v);
    if (S.quote.serviceId === v) S.quote.serviceId = "gel-mani";
    if (S.job.serviceId === v) S.job.serviceId = "gel-mani";
    save(); render(); toast("Removed");
    return false;
  },

  /* ---- her stock items ---- */
  saveitem: () => {
    const name = readText("ni-name");
    const price = readNum("ni-price"), qty = readNum("ni-qty"), uses = readNum("ni-uses");
    if (!name) { toast("Give it a name"); return false; }
    if (!price || !qty || qty < 1) { toast("Fill in price and quantity"); return false; }
    S.custom.products.push({
      id: newId(name), name,
      category: document.getElementById("ni-cat")?.value || "Other",
      landedPaise: Math.round(price * 100), baseQty: qty,
      baseUnit: (document.getElementById("ni-unit")?.value || "pc").toUpperCase(),
      usesPerItem: Math.max(1, Math.round(uses || 1)),
    });
    S.sheet = null; save(); render(); toast(`${name} added to stock`);
    return false;
  },
  delitem: (v) => {
    const i = S.custom.products.findIndex((x) => x.id === v);
    if (i >= 0) S.custom.products.splice(i, 1);
    save(); render(); toast("Removed");
    return false;
  },

  /* ---- reset stats: two taps, 4-second window, jobs only ---- */
  resetstats: () => {
    if (!S.armReset) {
      S.armReset = true;
      setTimeout(() => { if (S.armReset) { S.armReset = false; render(); } }, 4000);
      return true;
    }
    S.armReset = false;
    S.jobs = [];
    save(); render(); toast("Stats cleared — prices and settings untouched");
    return false;
  },

  /* Applying a recommendation is always an explicit, reversible tap. */
  userec: () => {
    const q = quoteFor({ ...S.quote, overridePaise: null, nails: qNails() });
    S.quote.overridePaise = q.recommendedPaise;
    toast(`Using ${money(q.recommendedPaise)} for this quote`);
    return true;
  },
  useallrec: () => {
    const bare = quoteFor({ serviceId: "gel-mani", hands: 2, length: "S", coats: 2, addons: [] });
    for (const sv of NS.SERVICES) {
      const isAddon = sv.kind === "ADDON";
      const q = quoteFor({ serviceId: isAddon ? "gel-mani" : sv.id, hands: 2, length: "S",
                           coats: sv.defaultCoats, addons: isAddon ? [sv.id] : [] });
      S.myPrices[sv.id] = isAddon ? Math.max(0, q.recommendedPaise - bare.recommendedPaise)
                                  : q.recommendedPaise;
    }
    save(); render(); toast("Prices set to recommended");
    return false;
  },

  jservice: (v) => { S.job.serviceId = v; return true; },
  jaddon:   (v) => { const i = S.job.addons.indexOf(v);
                     if (i < 0) S.job.addons.push(v);
                     else { S.job.addons.splice(i, 1); delete S.job.addonNails[v];
                            if (S.job.paintAddon === v) S.job.paintAddon = null; }
                     return true; },
  jpay:     (v) => { S.job.method = v; return true; },
  nail:     (v) => { S.job.nails[v] = ((S.job.nails[v] || 0) + 1) % 3; pruneAddonNails(); return true; },
  nailall:  () => { for (const s of ["L", "R"]) for (const f of NS.FINGERS) S.job.nails[`${s}:${f}`] = 1;
                    return true; },
  nailnone: () => { S.job.nails = {}; pruneAddonNails(); return true; },

  timer: () => {
    if (S.job.timerStart) { S.job.elapsed = Math.floor((Date.now() - S.job.timerStart) / 1000); S.job.timerStart = null; }
    else S.job.timerStart = Date.now() - S.job.elapsed * 1000;
    return true;
  },

  copy: () => {
    const q = quoteFor({ ...S.quote, nails: qNails() });
    const names = [q.base.name, ...S.quote.addons.map((a) => svc(a).name)].join(" + ");
    const txt = `${names} — ${money(q.pricePaise)}. Approx ${Math.round(q.hours * 60)} min.`;
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    toast("Quote copied");
    return false;
  },

  book: () => {
    S.job.serviceId = S.quote.serviceId;
    S.job.addons = [...S.quote.addons];
    // Carry the EXACT nail selection, accents included — not a preset.
    S.job.nails = { ...qNails() };
    S.job.addonNails = {}; S.job.paintAddon = null;   // add-ons re-cover every nail
    S.tab = "pricing"; S.pricingView = "calc";
    return { resetScroll: true };
  },

  save: () => {
    const nailCount = Object.values(S.job.nails).filter((v) => v > 0).length;
    const q = quoteFor({ ...S.quote, serviceId: S.job.serviceId, addons: S.job.addons,
                         overridePaise: S.quote.overridePaise,
                         nails: nailCount ? S.job.nails : null,
                         addonUnits: addonUnitsMap(S.job.addons) });
    const timed = S.job.timerStart ? (Date.now() - S.job.timerStart) / 36e5 : S.job.elapsed / 3600;
    const hours = timed > 0.05 ? timed + S.assumptions.setupMinutes / 60 : q.hours;
    const o = NS.jobOutcome({ pricePaise: q.pricePaise, directPaise: q.directPaise, hours,
      feePct: S.job.method === "Card" ? 0.02 : 0 });
    S.jobs.push({
      at: Date.now(), serviceId: S.job.serviceId,
      title: [q.base.name, ...S.job.addons.map((a) => svc(a).name)].join(" + "),
      client: S.job.client.trim(),
      pricePaise: q.pricePaise, hours, method: S.job.method, addons: [...S.job.addons],
      nailCount: nailCount || 10,
      contributionPaise: o.contributionPaise, contributionPerHourPaise: o.contributionPerHourPaise,
      // SNAPSHOT — frozen forever
      snapshot: { directPaise: q.directPaise, overheadPaise: q.rec.overheadPaise,
                  absorbedPaise: q.rec.absorbedPaise, recommendedPaise: q.recommendedPaise,
                  assumptions: { ...S.assumptions }, engineVersion: NS.ENGINE_VERSION },
    });
    // Every job teaches the app a little: bank the nail-units each product saw,
    // so that when a pot finally runs out we can back-solve the real usage.
    for (const part of q.parts) {
      if (!part.cost) continue;
      for (const item of part.cost.items) {
        const cur = S.usage[item.productId] || {};
        S.usage[item.productId] = {
          ...cur,
          unitsSinceOpen: (cur.unitsSinceOpen || 0) + part.units,
        };
      }
    }
    save();
    S.job = { nails: {}, serviceId: S.job.serviceId, addons: [], timerStart: null,
              elapsed: 0, method: S.job.method, client: "", addonNails: {}, paintAddon: null };
    S.tab = "today";
    render({ resetScroll: true });
    toast("Job saved");
    return false;
  },

  export: () => {
    const blob = new Blob([JSON.stringify({ assumptions: S.assumptions, jobs: S.jobs }, null, 2)],
                          { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pricely-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Backup downloaded");
    return false;
  },

  reset: () => { S.assumptions = { ...NS.DEFAULT_ASSUMPTIONS };
                 S.myPrices = { ...NS.DEFAULT_PRICES };
                 save(); render(); toast("Reset to defaults"); return false; },
};

/* Delegation: ONE selector, scoped to #app. Nothing outside #app uses data-act. */
$("#app").addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const handler = ACTIONS[el.dataset.act];
  if (!handler) return;
  e.preventDefault();
  const result = handler(el.dataset.val);
  if (result) render(result === true ? {} : result);
});

/* Text inputs bind to state WITHOUT re-rendering — otherwise typing is broken. */
$("#app").addEventListener("input", (e) => {
  const k = e.target.dataset?.bind;
  if (k) S.job[k] = e.target.value;
});

/* Numeric fields commit on blur/change, then re-derive the whole app. */
$("#app").addEventListener("change", (e) => {
  const el = e.target;
  const v = parseFloat(el.value);
  const valid = Number.isFinite(v) && v >= 0;

  if (el.dataset?.price !== undefined) {                 // her price list
    if (!valid) { render(); return; }
    S.myPrices[el.dataset.price] = Math.round(v * 100);
    save(); render(); return;
  }
  if (el.dataset?.minutes !== undefined) {               // her time standard
    const id = el.dataset.minutes, cs = svc(id);
    if (!valid || v < 1) { render(); return; }
    if (cs?.custom) cs.minutes = Math.round(v);
    else S.overrides[id] = { ...S.overrides[id], minutes: Math.round(v) };
    save(); render(); return;
  }
  if (el.dataset?.matcost !== undefined) {               // her material cost
    const id = el.dataset.matcost, cs = svc(id);
    if (el.value.trim() === "" && !cs?.custom) {
      // empty on a built-in = back to the automatic recipe cost
      if (S.overrides[id]) { delete S.overrides[id].materialPaise;
        if (!Object.keys(S.overrides[id]).length) delete S.overrides[id]; }
      save(); render(); return;
    }
    if (!valid) { render(); return; }
    if (cs?.custom) cs.materialPaise = Math.round(v * 100);
    else S.overrides[id] = { ...S.overrides[id], materialPaise: Math.round(v * 100) };
    save(); render(); return;
  }
  if (el.dataset?.override !== undefined) {              // one-off price, either screen
    const typed = Math.round(v * 100);
    const listed = Number(el.dataset.listed);
    // Rounding means a ₹845 raw price displays as ₹850 — treat anything inside
    // one rounding step as "she typed the list price back in".
    const step = S.assumptions.roundToPaise || 1;
    S.quote.overridePaise = !valid || Math.abs(typed - listed) < step ? null : typed;
    render(); return;
  }
  const k = el.dataset?.set;                             // assumptions
  if (!k) return;
  if (!valid) { render(); return; }
  S.assumptions[k] = k.endsWith("Paise") ? Math.round(v * 100) : v;
  save(); render();
});

/* The running timer patches ONE text node. A full re-render here would steal
   focus from the client field every second. */
setInterval(() => {
  if (!S.job.timerStart || S.tab !== "job") return;
  const btn = document.getElementById("timerbtn");
  if (btn) btn.textContent = "⏹ " + fmtT(Math.floor((Date.now() - S.job.timerStart) / 1000));
}, 1000);

load();
render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
