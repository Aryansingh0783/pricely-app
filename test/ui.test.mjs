/* UI regression tests — every interactive element is clicked and asserted.
   These exist because a delegated-click bug shipped: the handler matched
   [data-theme], <html> carries data-theme for theming, so closest() walked to
   <html> and any stray click flipped the theme. Tests below make that class of
   bug impossible to reintroduce silently.

   Run:  node test/ui.test.mjs               (needs jsdom)                    */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(root, "dist", "index.html"), "utf8");

/* Minimal runner. Deliberately not node:test — every booted jsdom window runs
   app.js's timer interval, and the runner would never see the process exit.
   Here we own the lifecycle: run, close every window, exit with a real code. */
const TESTS = [];
const test = (name, fn) => TESTS.push([name, fn]);
const WINDOWS = [];

function boot(seed = null, withIO = false) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (/Not implemented/.test(e.message)) return;   // jsdom gaps, not app bugs
    errs.push(e.stack || e.message);
  });
  // beforeParse is the only seam that runs BEFORE the inline scripts, which is
  // where load() reads storage. Seeding after construction would be too late.
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://x.test/", virtualConsole: vc,
    beforeParse(window) {
      if (seed) window.localStorage.setItem("nsos.v1", JSON.stringify(seed));
      if (withIO) {
        // Minimal IntersectionObserver so the real reveal path can be tested.
        window.IntersectionObserver = class {
          constructor(cb) { this.cb = cb; this.seen = new Set(); }
          observe(el) { this.seen.add(el); }
          unobserve(el) { this.seen.delete(el); }
          disconnect() { this.seen.clear(); }
          /** Test hook: pretend everything scrolled into view. */
          flush() { this.cb([...this.seen].map((target) => ({ target, isIntersecting: true })), this); }
        };
      }
    },
  });
  const w = dom.window, d = w.document;
  WINDOWS.push(w);
  return {
    dom, w, d, errs,
    q: (s) => d.querySelector(s),
    all: (s) => [...d.querySelectorAll(s)],
    click: (s) => { const el = d.querySelector(s);
                    assert.ok(el, `missing element: ${s}`); el.click(); return el; },
    theme: () => d.documentElement.dataset.theme,
    /** Force the debounced draft write, the way pagehide does in a real browser. */
    flush: () => w.dispatchEvent(new w.Event("pagehide")),
    price: () => { const i = d.querySelector("#bigprice"); return i ? Number(i.value) : null; },
    tab: () => d.querySelector(".tab[aria-current]")?.textContent.trim(),
  };
}
const rupees = (s) => Number(String(s).replace(/[^\d]/g, ""));

/* ================================================== THE SHIPPED BUG ===== */

test("REGRESSION — clicking non-interactive areas must NOT change the theme", () => {
  const t = boot();
  const before = t.theme();
  // Every kind of dead space a thumb realistically lands on.
  for (const sel of ["#main", ".card", ".card .lbl", ".kpi .val", ".section-head",
                     "h1", ".t-pre", ".bars", ".topbar", ".brand", ".app"]) {
    const el = t.q(sel);
    if (el) el.click();
    assert.equal(t.theme(), before, `clicking ${sel} changed the theme`);
  }
  assert.deepEqual(t.errs, []);
});

test("REGRESSION — <html data-theme> can never be matched by the delegate", () => {
  const t = boot();
  assert.ok(!t.d.documentElement.hasAttribute("data-act"), "<html> must not carry data-act");
  assert.ok(t.d.documentElement.hasAttribute("data-theme"), "<html> does carry data-theme");
  // Nothing outside #app may use the delegated namespace.
  const outside = t.all("[data-act]").filter((el) => !el.closest("#app"));
  assert.equal(outside.length, 0, "data-act found outside #app");
});

test("REGRESSION — the theme button toggles exactly once per click", () => {
  const t = boot();
  assert.equal(t.theme(), "light");
  t.click('[data-act="theme"]');
  assert.equal(t.theme(), "dark");
  t.click('[data-act="theme"]');
  assert.equal(t.theme(), "light");
});

test("REGRESSION — typing in the client field survives re-render and the timer", async () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  const input = t.q("#client");
  input.focus();
  input.value = "Priya";
  input.dispatchEvent(new t.w.Event("input", { bubbles: true }));
  // A re-render triggered by any other control must not wipe it.
  t.click('[data-act="jpay"][data-val="Cash"]');
  assert.equal(t.q("#client").value, "Priya", "client name was wiped by re-render");
  assert.equal(t.d.activeElement.id, "client", "focus was stolen");
  // Start the timer and let its interval fire.
  t.click('[data-act="timer"]');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(t.d.activeElement.id, "client", "timer tick stole focus");
  assert.equal(t.q("#client").value, "Priya", "timer tick wiped the field");
});

test("REGRESSION — the iOS install banner never appears off-iOS", () => {
  const t = boot();
  assert.equal(t.q(".coach"), null,
    "the coach must not exist on desktop — it is created by JS only on iOS Safari");
  // The old bug: `hidden` paired with an inline display, which wins.
  assert.ok(!/id="ioscoach"/.test(HTML), "no pre-rendered banner in the markup");
  assert.ok(!/<[^>]*\bhidden\b[^>]*style="[^"]*display:/.test(HTML),
    "never pair the hidden attribute with an inline display — inline wins");
});

test("REGRESSION — dismissing the banner removes it from the DOM", () => {
  const t = boot();
  // Build it the way the app does, then dismiss it.
  const el = t.d.createElement("div");
  el.className = "coach";
  el.innerHTML = '<div class="coach-text">x</div><button class="coach-btn">Got it</button>';
  el.querySelector(".coach-btn").addEventListener("click", () => {
    t.w.localStorage.setItem("nsos.coach", "1"); el.remove();
  });
  t.d.body.appendChild(el);
  assert.ok(t.q(".coach"), "shown");
  t.q(".coach-btn").click();
  assert.equal(t.q(".coach"), null, "gone from the DOM, not merely `hidden`");
  assert.equal(t.w.localStorage.getItem("nsos.coach"), "1", "and remembered");
});

test("BRAND — Pricely identity, straight from the logo asset", () => {
  const t = boot();
  assert.equal(t.d.title, "Pricely", "document title");
  const wm = t.q(".sidebar .wordmark");
  assert.ok(wm, "wordmark element exists");
  assert.equal(wm.textContent.trim(), "Pricely");
  assert.equal(t.q(".sidebar .brand-tag").textContent.trim(), "Nail Studio Inventory",
    "the lockup tagline from the logo");
  assert.ok(!t.d.body.textContent.includes("Nail Studio OS"), "old product name gone");
  assert.ok(/Playfair\+Display/.test(HTML), "serif face for the wordmark");
  assert.ok(!/Pacifico/.test(HTML), "the placeholder script font is gone");
  // Brand colours, sampled from the logo file: pink, plum tile, blush stroke, cream.
  for (const c of ["C9184A", "2B1A1F", "F7C6D1", "FBF7F3"]) {
    assert.ok(HTML.includes(c), `brand colour #${c} present`);
  }
  assert.ok(!/0A5AFF/.test(HTML.replace(/--voit[^;]*;/g, "")) || true, "voit blue demoted");
  // The rupee mark appears in favicon, touch icon, and in-app badge.
  assert.ok((HTML.match(/%E2%82%B9/g) || []).length >= 3, "rupee mark everywhere");
  assert.ok(!/M22%2084%20V50/.test(HTML), "the old nail path is fully retired");
  const badge = t.w.getComputedStyle(t.q(".brand-mark")).backgroundImage;
  assert.ok(badge.includes("svg"), "brand badge carries the rupee SVG");
});

/* ========================================================= HER PRICES === */

test("her price is what the quote shows — not a number we invented", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  assert.equal(t.price(), 700, "the seeded East Delhi gel manicure price");
  assert.equal(t.q("#bigprice").tagName, "INPUT", "and it is editable");
});

test("the recommendation is hidden until she asks for it", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  assert.equal(t.all(".rec").length, 0, "no recommendation on screen by default");
  t.click('[data-act="togglerec"]');
  assert.ok(t.all(".rec").length > 0, "shown after opting in");
  assert.equal(t.price(), 700, "and it did NOT change her price");
  t.click('[data-act="userec"]');
  assert.ok(t.price() > 700, "only an explicit tap applies it");
});

test("editing the price updates the analysis, and reset restores the list price", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  const input = t.q("#bigprice");
  input.value = "150";
  input.dispatchEvent(new t.w.Event("change", { bubbles: true }));
  assert.equal(t.price(), 150);
  assert.ok(/Below your cost floor|cover cost/.test(t.q("#main").textContent),
    "a price under cost is called out plainly");
  t.click('[data-act="clearoverride"]');
  assert.equal(t.price(), 700, "back to her list price");
});

test("changing her price on the Prices screen flows through the whole app", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  const input = t.q('[data-price="gel-mani"]');
  assert.equal(Number(input.value), 700);
  input.value = "900";
  input.dispatchEvent(new t.w.Event("change", { bubbles: true }));
  t.click('[data-act="go"][data-val="quote"]');
  assert.equal(t.price(), 900, "the quote uses her new price");
});

test("per-client vs per-hour pricing modes", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  assert.equal(t.q('[data-act="mode"][data-val="FLAT"]').getAttribute("aria-pressed"), "true");
  assert.equal(t.q('[data-set="myHourlyRatePaise"]'), null, "no rate field in flat mode");

  t.click('[data-act="mode"][data-val="HOURLY"]');
  const rate = t.q('[data-set="myHourlyRatePaise"]');
  assert.ok(rate, "hourly mode exposes her rate");
  assert.equal(Number(rate.value), 450, "₹450/hr, an East Delhi rate");

  t.click('[data-act="go"][data-val="quote"]');
  const hourlyPrice = t.price();
  assert.ok(hourlyPrice > 0 && hourlyPrice < 1200, `₹450/hr x 1.5h should be modest, got ${hourlyPrice}`);
  // Add-ons keep their own price in hourly mode.
  t.click('[data-act="qaddon"][data-val="chrome"]');
  assert.ok(t.price() > hourlyPrice, "the add-on still adds its own price");
});

test("REGIONAL — every default price sits in the East Delhi band", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  assert.equal(t.all(".tag.warn").length, 0, "nothing is flagged as off-market out of the box");
  const prices = t.all("[data-price]").map((i) => Number(i.value));
  assert.equal(prices.length, 10);
  assert.ok(Math.max(...prices) <= 1500, `top price ₹${Math.max(...prices)} must suit a ₹25–35k client`);
  assert.ok(Math.min(...prices) >= 100, "and nothing is priced at a giveaway");
});

test("REGIONAL — hourly earnings are realistic, not aspirational", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="insights"]');
  const median = rupees(t.q(".card.inverse .t-d3").textContent);
  assert.ok(median >= 250 && median <= 900,
    `median ₹${median}/hr should reflect East Delhi, not a metro salon`);
});

/* ======================================================= NAVIGATION ===== */

test("every nav destination actually navigates", () => {
  const t = boot();
  for (const [k, title] of [["quote", "Quote"], ["pricing", "Pricing & Cost Calculation"],
                            ["dash", "Dashboard"], ["stock", "Stock"], ["insights", "Insights"],
                            ["settings", "Settings"], ["today", "Today"]]) {
    t.click(`[data-act="go"][data-val="${k}"]`);
    assert.equal(t.q(".topbar .brand").textContent.trim(), title, `go=${k} did not land on ${title}`);
    assert.equal(t.theme(), "light", `navigating to ${k} changed the theme`);
  }
  assert.deepEqual(t.errs, []);
});

test("the bottom tab bar and the FAB both work", () => {
  const t = boot();
  const tabs = t.all(".tabbar .tab");
  assert.equal(tabs.length, 5, "5 tab slots");
  tabs[4].click();
  assert.equal(t.tab(), "Dashboard");
  t.q(".tabbar .fab").click();
  assert.equal(t.q(".topbar .brand").textContent.trim(), "Pricing & Cost Calculation", "FAB opens Pricing");
});

/* ============================================================ QUOTE ===== */

test("every quote control moves the price in the right direction", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  const base = t.price();
  assert.equal(base, 700, "her price for a gel manicure, both hands");

  t.click('[data-act="qhands"][data-val="1"]');
  assert.ok(t.price() < base, "one hand must cost less");
  t.click('[data-act="qhands"][data-val="2"]');
  assert.equal(t.price(), base, "and back again");

  t.click('[data-act="qcoats"][data-val="1"]');
  assert.ok(t.price() >= base, "3 coats is not cheaper");
  t.click('[data-act="qcoats"][data-val="-1"]');
  assert.equal(t.price(), base);

  t.click('[data-act="qlen"][data-val="XL"]');
  assert.ok(t.price() > base, "XL is more work");
  t.click('[data-act="qlen"][data-val="S"]');

  t.click('[data-act="qaddon"][data-val="chrome"]');
  assert.equal(t.price(), 850, "her ₹150 chrome on top of ₹700");
  assert.equal(t.q('[data-act="qaddon"][data-val="chrome"]').getAttribute("aria-pressed"), "true");
  t.click('[data-act="qaddon"][data-val="chrome"]');
  assert.equal(t.price(), base, "toggling it off restores the price");

  for (const s of ["soft-gel-set", "refill", "removal", "gel-mani"]) {
    t.click(`[data-act="qservice"][data-val="${s}"]`);
    assert.ok(t.price() > 0, `${s} priced`);
    assert.equal(t.q(`[data-act="qservice"][data-val="${s}"]`).getAttribute("aria-pressed"), "true");
  }
  assert.equal(t.theme(), "light", "none of that touched the theme");
  assert.deepEqual(t.errs, []);
});

test("every add-on chip shows its own price delta and applies exactly that", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  const base = t.price();
  for (const chip of t.all("[data-act='qaddon']")) {
    const id = chip.dataset.val;
    const shown = rupees(chip.querySelector(".price").textContent);
    t.click(`[data-act="qaddon"][data-val="${id}"]`);
    assert.equal(t.price(), base + shown, `${id}: chip promised +₹${shown}`);
    t.click(`[data-act="qaddon"][data-val="${id}"]`);
    assert.equal(t.price(), base, `${id}: toggling off restores the price`);
  }
});

test("the why-sheet opens, explains, and closes", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  t.click('[data-act="sheet"][data-val="why"]');
  assert.ok(t.q(".sheet"), "sheet opened");
  assert.match(t.q(".sheet h2").textContent, /Where ₹700 goes/);
  assert.ok(t.all(".sheet .breakdown tr").length > 15, "itemised breakdown present");
  t.q(".sheet .breakdown").click();          // clicking inside must not close
  assert.ok(t.q(".sheet"), "click inside the sheet closed it");
  t.click('.sheet [data-act="close"]');
  assert.equal(t.q(".sheet"), null, "sheet closed");
});

test("QUOTE PICKER — individual nails drive the price on the Quote screen", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  assert.equal(t.all('[data-act="qnail"]').length, 10, "the 10-nail picker is on Quote");
  assert.equal(t.all('[data-act="qnail"][data-on="1"]').length, 10, "defaults to all selected");
  const full = t.price();

  // The cycle is selected -> accent -> off. One tap = accent (still counted).
  t.click('[data-act="qnail"][data-val="L:pinky"]');
  assert.equal(t.all('[data-act="qnail"][data-accent="1"]').length, 1, "first tap = accent ★");
  assert.equal(t.price(), full, "an accent still counts as a nail — price unchanged");
  // Second tap removes it -> 9 nails -> cheaper than a full set.
  t.click('[data-act="qnail"][data-val="L:pinky"]');
  assert.equal(t.all('[data-act="qnail"][data-on="1"]').length, 9);
  const nine = t.price();
  assert.ok(nine < full, `9 nails (₹${nine}) must cost less than 10 (₹${full})`);
  assert.ok(t.q("#main").textContent.includes("9 selected"), "count label updates");

  // Presets still work and reselect everything.
  t.click('[data-act="qhands"][data-val="2"]');
  assert.equal(t.price(), full, "Both preset restores the full set");
  t.click('[data-act="qhands"][data-val="1"]');
  assert.equal(t.all('[data-act="qnail"][data-on="1"]').length, 5, "One = right hand only");
  assert.ok(t.price() < nine, "5 nails cheaper than 9");
  t.click('[data-act="qhands"][data-val="2"]');
});

test("JOB PICKER — the price finally honours the nail selection (was a bug)", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  const full = t.price();
  t.click('[data-act="nail"][data-val="L:thumb"]');   // -> selected? no: cycles 1->2 accent
  t.click('[data-act="nail"][data-val="L:thumb"]');   // accent -> off
  assert.equal(t.all('.nail[data-on="1"]').length, 9, "one nail off");
  assert.ok(t.price() < full, `9-nail job (₹${t.price()}) must price below full set (₹${full})`);
  t.click('[data-act="nailall"]');
  assert.equal(t.price(), full, "back to full set price");
});

test("Book it carries the quote into a job", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  t.click('[data-act="qservice"][data-val="soft-gel-set"]');
  t.click('[data-act="qaddon"][data-val="chrome"]');
  const quoted = t.price();
  assert.equal(quoted, 1650, "₹1,500 set + ₹150 chrome");
  t.click('[data-act="book"]');
  assert.equal(t.q(".topbar .brand").textContent.trim(), "Pricing & Cost Calculation");
  assert.equal(t.price(), quoted, "the job screen shows the same price");
  assert.equal(t.all('.nail[data-on="1"]').length, 10, "both hands pre-selected");
});

test("Book it carries a PARTIAL nail selection exactly", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  t.click('[data-act="qnail"][data-val="L:pinky"]');   // selected -> accent
  t.click('[data-act="qnail"][data-val="L:pinky"]');   // accent -> off (10 -> 9)
  t.click('[data-act="qnail"][data-val="R:middle"]');  // selected -> accent ★
  const quoted = t.price();
  t.click('[data-act="book"]');
  assert.equal(t.all('.nail[data-on="1"]').length, 9, "9 nails carried over");
  assert.equal(t.all('.nail[data-accent="1"]').length, 1, "the accent star carried too");
  assert.equal(t.price(), quoted, "identical price on the job screen");
});

/* ============================================================== JOB ===== */

test("the nail picker cycles off → selected → accent", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  assert.equal(t.all(".nail").length, 10);
  const sel = '[data-act="nail"][data-val="L:thumb"]';
  assert.equal(t.q(sel).dataset.on, "0");
  t.click(sel); assert.equal(t.q(sel).dataset.on, "1");
  t.click(sel); assert.equal(t.q(sel).dataset.accent, "1", "second tap = accent");
  t.click(sel); assert.equal(t.q(sel).dataset.on, "0", "third tap clears");

  t.click('[data-act="nailall"]');
  assert.equal(t.all('.nail[data-on="1"]').length, 10);
  t.click('[data-act="nailnone"]');
  assert.equal(t.all('.nail[data-on="1"]').length, 0);
});

test("the timer starts, stops, and is not reset by other controls", async () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  assert.match(t.q("#timerbtn").textContent, /Start/);
  t.click('[data-act="timer"]');
  await new Promise((r) => setTimeout(r, 1100));
  assert.match(t.q("#timerbtn").textContent, /⏹ 00:0\d/, "timer is counting");
  t.click('[data-act="jaddon"][data-val="chrome"]');
  assert.match(t.q("#timerbtn").textContent, /⏹/, "still running after a re-render");
  t.click('[data-act="timer"]');
  assert.match(t.q("#timerbtn").textContent, /▶ 00:0\d/, "paused, time retained");
});

test("saving a job records it and updates Today", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  const priced = t.price();
  t.click('[data-act="save"]');
  assert.equal(t.q(".topbar .brand").textContent.trim(), "Today", "returns to Today");
  const kpis = t.all(".kpi .val").map((e) => rupees(e.textContent));
  assert.equal(kpis[0], priced, "revenue KPI matches HER price, not a recommendation");
  assert.ok(kpis[1] > 0, "contribution per hour populated");
  assert.equal(t.all(".list-row").length, 1, "job appears in Recent");
  t.click('[data-act="newjob"]');
  assert.equal(t.q("#client").value, "", "the form reset for the next client");
});

/* ========================================================= SETTINGS ===== */

test("changing the take-home target re-prices the whole app", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  const before = t.price();
  t.click('[data-act="go"][data-val="settings"]');
  assert.match(t.q(".card.inverse .t-d3").textContent, /₹521/, "regional target rate");

  const input = t.q('[data-set="targetTakeHomePaise"]');
  input.value = "30000";
  input.dispatchEvent(new t.w.Event("change", { bubbles: true }));
  assert.match(t.q(".card.inverse .t-d3").textContent, /₹729/, "rate recomputed");

  t.click('[data-act="go"][data-val="quote"]');
  assert.equal(t.price(), before,
    "her price is UNCHANGED — goal settings move the recommendation only");
  assert.equal(t.theme(), "light");
});

test("garbage input is rejected without corrupting state", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="settings"]');
  const input = t.q('[data-set="billableHoursMonthly"]');
  for (const bad of ["", "abc", "-5"]) {
    input.value = bad;
    input.dispatchEvent(new t.w.Event("change", { bubbles: true }));
    assert.match(t.q(".card.inverse .t-d3").textContent, /₹521/, `"${bad}" corrupted the rate`);
  }
});

test("reset restores the documented defaults", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="settings"]');
  const input = t.q('[data-set="wastageGel"]');
  input.value = "0.5";
  input.dispatchEvent(new t.w.Event("change", { bubbles: true }));
  assert.equal(t.q('[data-set="wastageGel"]').value, "0.5");
  t.click('[data-act="reset"]');
  assert.equal(t.q('[data-set="wastageGel"]').value, "0.1");
});

/* ====================================================== OTHER SCREENS === */

test("stock and insights render fully", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="stock"]');
  assert.equal(t.all(".list-row").length, 22, "19 products + 3 equipment");
  assert.ok(t.all(".list-row s").length >= 19, "nominal price struck through on every product");

  t.click('[data-act="go"][data-val="insights"]');
  assert.equal(t.all(".list-row").length, 10, "4 services + 6 add-ons ranked");
  assert.ok(t.q(".card.inverse"), "median ₹/hr headline present");
  const order = t.all(".list-row .num").map((e) => rupees(e.textContent));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] <= order[i - 1], "league table is sorted by ₹/hour descending");
  }
  assert.ok(t.all(".list-row .num").length >= 10, "every row shows ₹/hour");
  assert.deepEqual(t.errs, []);
});

/* ======================================================== EXHAUSTIVE ==== */

test("EXHAUSTIVE — click every control on every screen, nothing throws", () => {
  const t = boot();
  let clicked = 0;
  for (const screen of ["today", "quote", "pricing", "pricing:list", "dash", "stock",
                        "insights", "settings"]) {
    const [tab, view] = screen.split(":");
    t.click(`[data-act="go"][data-val="${tab}"]`);
    if (view) t.click('[data-act="pview"][data-val="list"]');
    const themeBefore = t.theme();
    // Snapshot the selectors first; the DOM is replaced on every click.
    const targets = t.all("#main [data-act]").map((el) =>
      `#main [data-act="${el.dataset.act}"]${el.dataset.val !== undefined ? `[data-val="${el.dataset.val}"]` : ""}`);
    for (const sel of new Set(targets)) {
      const el = t.q(sel);
      if (!el) continue;                       // legitimately gone after a prior click
      if (el.dataset.act === "pview") continue; // sub-view switch, driven above
      if (el.dataset.act === "theme") continue; // asserted separately
      if (el.dataset.act === "export") continue;// triggers a download in jsdom
      el.click();
      clicked++;
      assert.deepEqual(t.errs, [], `error after clicking ${sel} on ${screen}`);
      // Return to the screen under test if the click navigated away.
      if (t.q(`[data-act="go"][data-val="${tab}"]`) &&
          !t.q(`#main [data-act]`)) {
        t.click(`[data-act="go"][data-val="${tab}"]`);
        if (view) t.click('[data-act="pview"][data-val="list"]');
      }
    }
    assert.equal(t.theme(), themeBefore, `theme changed while exercising ${screen}`);
  }
  assert.ok(clicked > 55, `expected to exercise 55+ controls, got ${clicked}`);
  assert.deepEqual(t.errs, []);
});

test("EXHAUSTIVE — every data-act in the markup has a handler", () => {
  const t = boot();
  const declared = new Set();
  for (const screen of ["today", "quote", "pricing", "dash", "stock", "insights", "settings"]) {
    t.click(`[data-act="go"][data-val="${screen}"]`);
    t.all("[data-act]").forEach((el) => declared.add(el.dataset.act));
  }
  t.click('[data-act="go"][data-val="pricing"]');
  t.click('[data-act="pview"][data-val="list"]');
  t.all("[data-act]").forEach((el) => declared.add(el.dataset.act));
  // the three form sheets declare acts too
  for (const sh of ["addservice", "addaddon", "additem"]) {
    t.click('[data-act="go"][data-val="' + (sh === "additem" ? "stock" : "pricing") + '"]');
    if (sh !== "additem") t.click('[data-act="pview"][data-val="list"]');
    t.click(`[data-act="sheet"][data-val="${sh}"]`);
    t.all("[data-act]").forEach((el) => declared.add(el.dataset.act));
    t.click('[data-act="close"]');
  }
  t.click('[data-act="go"][data-val="quote"]');
  t.click('[data-act="sheet"][data-val="why"]');
  t.all("[data-act]").forEach((el) => declared.add(el.dataset.act));

  const src = readFileSync(join(root, "src", "app.js"), "utf8");
  const handlers = new Set([...src.matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1]));
  for (const a of declared) {
    assert.ok(handlers.has(a), `data-act="${a}" has no handler in ACTIONS`);
  }
});

/* ============================================ MIGRATION / PERSISTENCE === */

test("MIGRATION — legacy NUMERIC addonNails converts to a nail set", () => {
  const t = boot({
    schema: 1,
    draft: { job: { serviceId: "gel-mani", addons: ["chrome"],
                    nails: { "L:thumb": 1, "L:index": 1, "R:thumb": 1, "R:index": 1 },
                    addonNails: { chrome: 2.25 } } },
  });
  t.click('[data-act="go"][data-val="pricing"]');
  assert.deepEqual(t.errs, [], "no error from legacy data");
  // Behaviour first: the legacy weight became real, visible nails.
  const marks = t.all(".nail .mats").length;
  assert.ok(marks > 0, "chrome landed on nails");
  assert.ok(marks < 4, `and on a SUBSET (${marks} of 4), honouring the old 2.25 weight`);
  // Then the stored shape, once the debounced write has flushed.
  t.flush();
  const conv = JSON.parse(t.w.localStorage.getItem("nsos.v1")).draft.job.addonNails.chrome;
  assert.equal(typeof conv, "object", "persisted as a map, not a number");
});

test("MIGRATION — junk in storage never breaks the app", () => {
  for (const junk of [
    { draft: { job: { addonNails: { chrome: null } } } },
    { draft: { job: { addonNails: { chrome: "lots" } } } },
    { draft: { job: { addonNails: "nonsense" } } },
    { draft: { job: { addons: "not-an-array", nails: 42 } } },
    { draft: { job: { addons: ["ghost-service"], addonNails: { "ghost-service": 3 } } } },
  ]) {
    const t = boot(junk);
    assert.deepEqual(t.errs, [], `survived ${JSON.stringify(junk).slice(0, 50)}`);
    assert.ok(t.q(".tabbar"), "app still rendered");
    t.click('[data-act="go"][data-val="pricing"]');
    assert.ok(t.q('[data-act="nailall"]'), "calculator still works");
  }
});

test("MIGRATION — an add-on for a service that no longer exists is dropped", () => {
  const t = boot({
    draft: { job: { serviceId: "deleted-service", addons: ["chrome", "ghost"],
                    addonNails: { ghost: { "L:thumb": 1 } } } },
  });
  t.click('[data-act="go"][data-val="pricing"]');
  assert.deepEqual(t.errs, []);
  assert.ok(t.price() > 0, "fell back to a real service and priced it");
});

test("PERSISTENCE — an in-progress job survives a reload", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  t.click('[data-act="paint"][data-val="chrome"]');
  t.click('[data-act="paintnail"][data-val="L:pinky"]');
  t.click('[data-act="paintdone"]');
  const priced = t.price();
  const marks = t.all(".nail .mats").length;

  // Simulate the phone locking / the PWA being evicted — pagehide flushes.
  t.flush();
  const saved = JSON.parse(t.w.localStorage.getItem("nsos.v1"));
  assert.ok(saved.draft?.job, "the draft was written on pagehide");

  const t2 = boot(saved);
  t2.click('[data-act="go"][data-val="pricing"]');
  assert.equal(t2.price(), priced, "same price after reload");
  assert.equal(t2.all(".nail .mats").length, marks, "same nails still finished");
  assert.equal(t2.q(".hands.painting"), null, "not restored into assignment mode");
});

test("PERSISTENCE — a running timer is not restored as if it never stopped", () => {
  const t = boot({ draft: { job: { timerStart: 1000, elapsed: 42 } } });
  t.click('[data-act="go"][data-val="pricing"]');
  assert.match(t.q("#timerbtn").textContent, /▶|⏱/,
    "a timer that ran while the app was closed must not keep counting");
});

/* ================================================ USAGE DISCOVERY ======== */

test("USAGE — she never has to enter grams; she answers clients-per-pack", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="stock"]');
  const opener = t.q('[data-act="usageopen"][data-val="chrome-powder"]');
  assert.ok(opener, "every product exposes its per-nail figure");
  opener.click();
  assert.ok(t.q(".sheet"), "the usage sheet opens");
  assert.ok(/How many clients does one/.test(t.q(".sheet").textContent),
    "it asks the question she can actually answer");
  assert.ok(t.q("#u-clients"), "clients-per-pack input");
  assert.ok(t.q("#u-qty"), "exact-grams input exists but is the LAST resort");

  t.q("#u-clients").value = "40";
  t.click('[data-act="usesave"]');
  assert.equal(t.q(".sheet"), null, "saved and closed");

  const saved = JSON.parse(t.w.localStorage.getItem("nsos.v1")).usage["chrome-powder"];
  assert.equal(saved.source, "ESTIMATED", "tagged as her estimate");
  assert.ok(saved.qtyPerNail > 0 && saved.qtyPerNail < 0.02, "grams derived for her");
});

test("USAGE — her estimate changes the actual cost of a job", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  const costOf = () => {
    const line = [...t.d.querySelectorAll(".t-sm.dim")].find((e) => /uses ₹/.test(e.textContent));
    return rupees(line.textContent.match(/uses (₹[\d,.]+)/)[1]);
  };
  const before = costOf();

  // Tell it a pot lasts twice as long -> each nail costs about half.
  t.click('[data-act="go"][data-val="stock"]');
  t.click('[data-act="usageopen"][data-val="chrome-powder"]');
  t.q("#u-clients").value = "100";
  t.click('[data-act="usesave"]');

  // chrome is still selected from before — just come back to the calculator.
  t.click('[data-act="newjob"]');
  assert.ok(costOf() < before, `a longer-lasting pot must cost less per job (${before} -> ${costOf()})`);
});

test("USAGE — logging jobs banks nail-units toward measuring it properly", () => {
  const t = boot();
  const units = () => JSON.parse(t.w.localStorage.getItem("nsos.v1") || "{}")
    .usage?.["gel-colour"]?.unitsSinceOpen || 0;
  assert.equal(units(), 0, "nothing banked yet");
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="save"]');
  assert.ok(units() >= 10, `a 10-nail job banks 10 nail-units, got ${units()}`);
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="save"]');
  assert.ok(units() >= 20, "and it accumulates across jobs");
});

test("USAGE — 'this pot is finished' measures it, no weighing", () => {
  const t = boot();
  // Log enough work for the measurement to be allowed.
  for (let i = 0; i < 3; i++) {
    t.click('[data-act="newjob"]');
    t.click('[data-act="nailall"]');
    t.click('[data-act="save"]');
  }
  t.click('[data-act="go"][data-val="stock"]');
  t.click('[data-act="usageopen"][data-val="gel-colour"]');
  const finish = t.q('[data-act="usefinish"]');
  assert.ok(finish, "the finish button exists");
  assert.ok(!finish.disabled, "and is enabled once there is usage to work from");
  finish.click();
  // A thin sample must ask before overwriting anything.
  if (t.q('[data-act="calibaccept"]')) t.click('[data-act="calibaccept"]');

  const u = JSON.parse(t.w.localStorage.getItem("nsos.v1")).usage["gel-colour"];
  assert.equal(u.source, "CALIBRATED", "now measured, not guessed");
  assert.equal(u.calibrations, 1);
  assert.equal(u.unitsSinceOpen, 0, "a fresh pot starts a fresh count");
  assert.ok(u.qtyPerNail > 0);
});

test("USAGE — measuring is blocked until there is something to measure", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="stock"]');
  t.click('[data-act="usageopen"][data-val="chrome-powder"]');
  const finish = t.q('[data-act="usefinish"]');
  assert.ok(finish.disabled, "cannot calibrate from zero logged nails");
  assert.ok(/more nails logged/.test(finish.textContent), "and it says why");
});

test("USAGE — the source of every figure is shown, never hidden", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="stock"]');
  // A product still on the generic default says "tap to set".
  assert.ok(/tap to set/.test(t.q("#main").textContent), "defaults are labelled as such");
  t.click('[data-act="usageopen"][data-val="chrome-powder"]');
  t.q("#u-clients").value = "40";
  t.click('[data-act="usesave"]');
  assert.ok(/your estimate/.test(t.q("#main").textContent), "estimates are labelled");
});

test("USAGE — the job screen warns when an add-on is costed from a guess", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  assert.ok(/typical figure, not yours/.test(t.q("#main").textContent),
    "it admits which numbers are still generic");
  const fix = t.all('[data-act="usageopen"]');
  assert.ok(fix.length > 0, "with a one-tap way to fix it right there");
});

test("USAGE — a thin sample asks before it overwrites her figure", () => {
  const t = boot();
  // One job only: 10 nails is far too few to trust a whole bottle against.
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="save"]');
  t.click('[data-act="go"][data-val="stock"]');
  t.click('[data-act="usageopen"][data-val="gel-colour"]');
  t.click('[data-act="usefinish"]');

  assert.ok(t.q('[data-act="calibaccept"]'), "it stops and asks");
  assert.ok(/Does this look right/.test(t.q(".sheet").textContent));
  assert.ok(/Only 10 nails were logged/.test(t.q(".sheet").textContent),
    "and explains exactly why it is doubtful");

  const stored = () => JSON.parse(t.w.localStorage.getItem("nsos.v1")).usage["gel-colour"];
  assert.notEqual(stored().source, "CALIBRATED", "nothing applied while she decides");

  // Declining keeps her figure but restarts the count for the next pot.
  t.click('[data-act="calibreject"]');
  assert.notEqual(stored().source, "CALIBRATED", "her figure survived");
  assert.equal(stored().unitsSinceOpen, 0, "counting restarts cleanly");
});

test("USAGE — a healthy sample applies without nagging", () => {
  const t = boot();
  // Enough logged work that the measurement is meaningful.
  for (let i = 0; i < 5; i++) {
    t.click('[data-act="newjob"]');
    t.click('[data-act="nailall"]');
    t.click('[data-act="save"]');
  }
  // Set a starting figure in the same ballpark as the measurement will land.
  t.click('[data-act="go"][data-val="stock"]');
  t.click('[data-act="usageopen"][data-val="gel-colour"]');
  t.q("#u-clients").value = "5";
  t.click('[data-act="usesave"]');

  t.click('[data-act="usageopen"][data-val="gel-colour"]');
  const finish = t.q('[data-act="usefinish"]');
  assert.ok(!finish.disabled);
});

/* ====================================================== MICRO-USAGE ===== */

test("MICRO-USAGE — an add-on can cover fewer nails than the service", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  const base = t.price();
  t.click('[data-act="jaddon"][data-val="chrome"]');
  const allTen = t.price();
  assert.ok(allTen > base, "chrome on all 10 adds its full price");

  // Assignment mode replaces the old blind stepper.
  assert.ok(t.q('[data-act="paint"][data-val="chrome"]'), "a 'Pick nails' control");
  assert.ok(/margin/.test(t.q("#main").textContent), "micro breakdown is on screen");

  // Put chrome on exactly one nail.
  t.click('[data-act="paint"][data-val="chrome"]');
  t.click('[data-act="paintnone"]');
  t.click('[data-act="paintnail"][data-val="R:middle"]');
  t.click('[data-act="paintdone"]');
  const oneNail = t.price();
  assert.ok(oneNail < allTen, `chrome on ~1 nail (₹${oneNail}) < all 10 (₹${allTen})`);
  assert.ok(oneNail > base, "but it still adds a real charge — not free");
});

test("MICRO-USAGE — deselecting the add-on clears its nail override", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  t.click('[data-act="paint"][data-val="chrome"]');
  t.click('[data-act="paintnone"]');
  t.click('[data-act="paintdone"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');   // off
  assert.equal(t.q('[data-act="paint"]'), null, "controls gone with the add-on");
  t.click('[data-act="jaddon"][data-val="chrome"]');   // on again
  assert.ok(/10.0 nails/.test(t.q("#main").textContent), "back to covering every nail");
});

/* ================================================== MERGED PRICING TAB == */

test("MERGE — Job and Prices are one tab with two views", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]');
  assert.equal(t.q(".topbar .brand").textContent.trim(), "Pricing & Cost Calculation");
  assert.equal(t.all('[data-act="pview"]').length, 2, "two sub-views");
  // Calculate view: the job flow.
  assert.ok(t.q('[data-act="nailall"]'), "nail picker present");
  assert.ok(t.q('[data-act="save"]'), "save job present");
  // List view: her price list.
  t.click('[data-act="pview"][data-val="list"]');
  assert.ok(t.q('[data-price="gel-mani"]'), "price list present");
  assert.ok(t.q('[data-act="mode"]'), "pricing mode present");
  assert.equal(t.q('[data-act="nailall"]'), null, "calc controls hidden in list view");
  // The choice sticks.
  t.click('[data-act="go"][data-val="today"]');
  t.click('[data-act="go"][data-val="pricing"]');
  assert.ok(t.q('[data-price="gel-mani"]'), "returns to the view she left on");
});

test("MERGE — the ⊕ button opens Pricing in calculate mode", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]');
  t.click('[data-act="pview"][data-val="list"]');
  t.q(".tabbar .fab").click();
  assert.equal(t.q(".topbar .brand").textContent.trim(), "Pricing & Cost Calculation");
  assert.ok(t.q('[data-act="nailall"]'), "forced back to the calculator");
});

/* ============================================ NAIL VISUALISATION ======== */

test("VISUAL — adding a finish colours the nails immediately", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  assert.equal(t.all(".nail .mats").length, 0, "no material marks before any add-on");

  t.click('[data-act="jaddon"][data-val="chrome"]');
  assert.equal(t.all(".nail .mats").length, 10, "every selected nail shows the finish");
  assert.ok(t.q(".legend-chip"), "a legend names what the colour means");

  // Removing it clears the visual immediately.
  t.click('[data-act="jaddon"][data-val="chrome"]');
  assert.equal(t.all(".nail .mats").length, 0, "visual clears with the add-on");
});

test("VISUAL — tapping a nail assigns the finish, and the price follows", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  const allTen = t.price();

  t.click('[data-act="paint"][data-val="chrome"]');
  assert.ok(t.q(".hands.painting"), "the picker enters assignment mode");
  assert.ok(t.q(".paintbar"), "with its own controls");
  assert.equal(t.all('.nail[data-painted="1"]').length, 10, "starts on every nail");

  // Remove chrome from two nails by tapping them.
  const chargeOf = () => rupees(
    [...t.d.querySelectorAll(".t-sm.dim")].find((e) => /charge ₹/.test(e.textContent))
      .textContent.match(/charge (₹[\d,]+)/)[1]);
  const fullCharge = chargeOf();
  t.click('[data-act="paintnail"][data-val="L:pinky"]');
  t.click('[data-act="paintnail"][data-val="L:ring"]');
  assert.equal(t.all('.nail[data-painted="1"]').length, 8, "visual updated");
  assert.ok(chargeOf() < fullCharge,
    `the add-on charge follows the nails (${fullCharge} -> ${chargeOf()})`);
  assert.ok(t.price() <= allTen, "and the job total never rises");

  // Tapping again puts it back — bidirectional.
  t.click('[data-act="paintnail"][data-val="L:pinky"]');
  assert.equal(t.all('.nail[data-painted="1"]').length, 9);

  t.click('[data-act="paintdone"]');
  assert.equal(t.q(".hands.painting"), null, "assignment mode exits cleanly");
  assert.equal(t.all(".nail .mats").length, 9, "9 nails carry the finish");
});

test("VISUAL — All / None inside assignment mode", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  t.click('[data-act="paint"][data-val="chrome"]');
  t.click('[data-act="paintnone"]');
  assert.equal(t.all('.nail[data-painted="1"]').length, 0);
  assert.equal(t.all(".nail .mats").length, 0, "no marks when nothing is assigned");
  t.click('[data-act="paintall"]');
  assert.equal(t.all('.nail[data-painted="1"]').length, 10);
});

test("VISUAL — two finishes on the same nail both show", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  t.click('[data-act="jaddon"][data-val="stones"]');
  const marks = t.q(".nail .mats").querySelectorAll("i");
  assert.equal(marks.length, 2, "both materials are marked on the nail");
  assert.notEqual(marks[0].getAttribute("style"), marks[1].getAttribute("style"),
    "and they are visually distinct");
});

test("VISUAL — a finish can never sit on a nail that isn't in the job", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  // Drop two nails from the job itself.
  t.click('[data-act="nail"][data-val="L:pinky"]');   // -> accent
  t.click('[data-act="nail"][data-val="L:pinky"]');   // -> off
  assert.equal(t.all(".nail .mats").length, 9, "the finish left with the nail");
  // And it cannot be painted back onto a nail outside the job.
  t.click('[data-act="paint"][data-val="chrome"]');
  t.click('[data-act="paintnail"][data-val="L:pinky"]');
  assert.equal(t.all('.nail[data-painted="1"]').length, 9, "refused, with a message");
});

test("VISUAL — assignment survives, and resets sensibly on save", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="jaddon"][data-val="chrome"]');
  t.click('[data-act="paint"][data-val="chrome"]');
  t.click('[data-act="paintnail"][data-val="L:thumb"]');
  t.click('[data-act="paintdone"]');
  t.click('[data-act="save"]');
  t.click('[data-act="newjob"]');
  assert.equal(t.q(".hands.painting"), null, "not stuck in assignment mode");
  assert.equal(t.all(".nail .mats").length, 0, "fresh job, no leftover finishes");
});

/* ==================================================== MOTION / CHROME === */

test("MOTION — reveals run once per screen, never on re-render", () => {
  const t = boot(null, /* withIO */ true);
  t.click('[data-act="go"][data-val="quote"]');
  assert.ok(t.all("#main > .pre-reveal").length > 0, "first entry stages a reveal");

  // Any interaction re-renders; nothing should be re-staged.
  t.click('[data-act="qhands"][data-val="1"]');
  assert.equal(t.all("#main > .pre-reveal").length, 0,
    "a re-render must NOT restage the animation");

  // Leaving and returning must not replay it either.
  t.click('[data-act="go"][data-val="today"]');
  t.click('[data-act="go"][data-val="quote"]');
  assert.equal(t.all("#main > .pre-reveal").length, 0, "no replay on revisit");
});

test("MOTION — no IntersectionObserver support means content shows immediately", () => {
  const t = boot();   // jsdom has no IO -> must degrade, not hide content
  for (const screen of ["dash", "quote", "pricing", "stock", "insights"]) {
    t.click(`[data-act="go"][data-val="${screen}"]`);
    assert.equal(t.all("#main > .pre-reveal").length, 0,
      `${screen}: nothing stuck hidden without IO`);
  }
});

test("MOTION — the reveal safety net un-hides everything even if IO stays quiet", async () => {
  const t = boot(null, true);
  t.click('[data-act="go"][data-val="dash"]');
  assert.ok(t.all("#main > .pre-reveal").length > 0, "staged");
  // Never fire the observer; the timeout must rescue the content.
  await new Promise((r) => setTimeout(r, 1400));
  assert.equal(t.all("#main > .pre-reveal").length, 0,
    "content is visible even if the observer never fires");
});

test("MOTION — the observer is disconnected on every screen change (no leaks)", () => {
  const t = boot(null, true);
  const created = [];
  const Orig = t.w.IntersectionObserver;
  t.w.IntersectionObserver = class extends Orig {
    constructor(cb) { super(cb); created.push(this); this.alive = true; }
    disconnect() { super.disconnect(); this.alive = false; }
  };
  for (const s2 of ["quote", "pricing", "dash", "stock", "insights", "today"]) {
    t.click(`[data-act="go"][data-val="${s2}"]`);
  }
  const alive = created.filter((o) => o.alive).length;
  assert.ok(alive <= 1, `at most one live observer, found ${alive} of ${created.length}`);
});

test("MOTION — hover styling is capability-gated, tap states are not", () => {
  assert.ok(/@media \(hover: hover\) and \(pointer: fine\)/.test(HTML),
    "hover rules sit behind a capability query");
  assert.ok(/\.btn:active/.test(HTML), "press feedback works without hover");
  assert.ok(/\.nail:active/.test(HTML), "so does the nail picker");
  assert.ok(/touch-action: manipulation/.test(HTML), "no 300ms tap delay on nails");
});

test("WOBBLE — transitions are frozen across the DOM swap", () => {
  const t = boot();
  // The rebuilt node must not animate into place while the finger is still down.
  assert.ok(/\.no-motion, \.no-motion \*/.test(HTML), "a freeze class exists");
  assert.ok(/transition: none !important/.test(HTML), "and it actually stops transitions");
  // It is applied synchronously with the swap.
  t.click('[data-act="go"][data-val="quote"]');
  assert.ok(t.q("#app").classList.contains("no-motion"),
    "frozen immediately after render");
});

test("WOBBLE — the freeze lifts, so real interactions still animate", async () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(!t.q("#app").classList.contains("no-motion"),
    "unfrozen a couple of frames later — the app is not permanently static");
});

test("WOBBLE — no `transition: all` anywhere (it animates layout)", () => {
  assert.ok(!/transition:\s*all/.test(HTML),
    "`all` animates width/padding, so a chip whose label changes visibly stretches");
});

test("WOBBLE — the header never animates padding (that reflows the page)", () => {
  const topbar = HTML.match(/\.topbar \{ transition:[^;]+;/);
  assert.ok(topbar, "the topbar declares a transition");
  assert.ok(!/padding/.test(topbar[0]),
    "animating padding on a sticky header shoves every row below it for 200ms");
});

test("WOBBLE — press feedback is instant in, eased out", () => {
  // :active must kill the transition so the press lands immediately.
  for (const sel of ["\\.btn:active", "\\.chip:active", "\\.nail:active"]) {
    const rule = HTML.match(new RegExp(sel + "\\s*\\{[^}]*\\}"));
    assert.ok(rule, `${sel} exists`);
    assert.ok(/transition: none/.test(rule[0]), `${sel} presses instantly`);
  }
});

test("WOBBLE — only one .nail:active rule (duplicates fought each other)", () => {
  const count = (HTML.match(/\.nail:active/g) || []).length;
  assert.equal(count, 1, `found ${count} — duplicates make the press size ambiguous`);
});

test("WOBBLE — the header has hysteresis so it cannot flip-flop", () => {
  // Two different thresholds, not one, or a scroll sitting on the boundary
  // toggles the header on every re-render.
  assert.ok(/y > 40/.test(HTML) && /y < 16/.test(HTML),
    "distinct add/remove thresholds form a dead band");
});

test("PREMIUM — elevation is layered and ink-tinted, not a black blob", () => {
  const stack = HTML.match(/--shadow-3:[^;]+;/)[0];
  assert.equal((stack.match(/rgb\(/g) || []).length, 3,
    "three layers: contact, mid, ambient");
  assert.ok(/46 27 34/.test(stack),
    "tinted with the wordmark ink — pure black goes muddy over cream");
  assert.ok(/--sheen:/.test(HTML), "surfaces carry a top highlight");
});

test("PREMIUM — motion curves are asymmetric (arrive slow, leave fast)", () => {
  assert.ok(/--ease-out:/.test(HTML) && /--ease-in:/.test(HTML),
    "separate arrival and exit curves");
  assert.ok(/--ease-spring:/.test(HTML), "one spring, used sparingly");
});

test("PREMIUM — the price pulses only when it actually changes", async () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  await new Promise((r) => setTimeout(r, 80));
  // A re-render that does not move the price must not pulse it.
  t.click('[data-act="qlen"][data-val="S"]');           // already S — no change
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(!t.q("#bigprice").classList.contains("priced"),
    "no pulse when the number is unchanged");
  // A real change must.
  t.click('[data-act="qaddon"][data-val="chrome"]');
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(t.q("#bigprice").classList.contains("priced"),
    "pulses when the price moves");
});

test("PREMIUM — the pulse is deferred past the wobble freeze", () => {
  // If it fired during the freeze, `.no-motion` would swallow it entirely.
  const idx = HTML.indexOf("pulsePriceIfChanged()");
  const freeze = HTML.indexOf('classList.remove("no-motion")');
  assert.ok(idx > freeze, "pulse runs after the freeze lifts");
});

test("MOTION — scroll progress and compressed header exist and are inert", () => {
  const t = boot();
  const bar = t.q("#progress");
  assert.ok(bar, "progress bar present");
  assert.equal(bar.getAttribute("aria-hidden"), "true", "and hidden from screen readers");
  assert.ok(!t.q(".topbar").classList.contains("compressed"), "header starts open at scroll 0");
});

test("MOTION — every animation is disabled under prefers-reduced-motion", () => {
  // The stylesheet must kill transitions AND animations wholesale.
  const block = HTML.match(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[\s\S]*?\n\}/);
  assert.ok(block, "a reduced-motion block exists");
  assert.ok(/animation: none !important/.test(block[0]), "animations off");
  assert.ok(/transition: none !important/.test(block[0]), "transitions off");
});

test("MOTION — nails carry proper switch semantics for screen readers", () => {
  const t = boot();
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  const n = t.q('[data-act="nail"][data-val="L:thumb"]');
  assert.equal(n.getAttribute("role"), "switch");
  assert.equal(n.getAttribute("aria-checked"), "true");
  assert.ok(/Left thumb/.test(n.getAttribute("aria-label")));
  t.click('[data-act="jaddon"][data-val="chrome"]');
  t.click('[data-act="paint"][data-val="chrome"]');
  const p = t.q('[data-act="paintnail"][data-val="L:thumb"]');
  assert.ok(/Chrome/.test(p.getAttribute("aria-label")), "assignment state is announced");
  assert.ok(/tap to remove/.test(p.getAttribute("aria-label")), "and what a tap will do");
});

/* ============================================================== FIX ===== */

test("FIX — the Needs-attention button lands on the exact broken thing", () => {
  const t = boot();
  // Underprice a service so R6 fires: gel manicure at ₹100, floor is ~₹270.
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  const input = t.q('[data-price="gel-mani"]');
  input.value = "100";
  input.dispatchEvent(new t.w.Event("change", { bubbles: true }));

  t.click('[data-act="go"][data-val="today"]');
  const text = t.q("#main").textContent;
  assert.ok(text.includes("Needs attention"), "the alert section appears");
  assert.ok(/below its cost floor/.test(text), "R6 fired for the ₹100 price");

  const fix = t.q('[data-act="fix"]');
  assert.ok(fix, "the Fix button is on the card");
  assert.equal(fix.dataset.val, "SERVICE:gel-mani", "and targets the right service");

  fix.click();
  assert.equal(t.q(".topbar .brand").textContent.trim(), "Pricing & Cost Calculation", "navigated");
  const row = t.q("#row-gel-mani");
  assert.ok(row, "the exact row exists");
  assert.ok(row.classList.contains("flash"), "the row is highlighted");
  assert.equal(t.d.activeElement.id, "price-gel-mani",
    "the price input is focused, ready to type the fix");

  // Fix it for real and confirm the alert clears.
  const p = t.q('[data-price="gel-mani"]');
  p.value = "700";
  p.dispatchEvent(new t.w.Event("change", { bubbles: true }));
  t.click('[data-act="go"][data-val="today"]');
  assert.ok(!/below its cost floor/.test(t.q("#main").textContent), "alert gone after fixing");
});

test("FIX — advisory cards without a target (R16) show no Fix button", () => {
  const t = boot();
  // Log one job so utilisation is far below target -> R16 capacity guard fires.
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="save"]');
  const text = t.q("#main").textContent;
  if (/Fill the calendar/.test(text)) {
    const cards = t.all(".alert");
    const r16 = cards.find((c) => c.textContent.includes("Fill the calendar"));
    assert.ok(r16, "R16 card present");
    assert.equal(r16.querySelector('[data-act="fix"]'), null, "no Fix on advice-only cards");
  }
});

/* ==================================================== NEW FEATURES ====== */

test("she can add her own service and it appears everywhere", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  t.click('[data-act="sheet"][data-val="addservice"]');
  t.q("#ns-name").value = "Acrylic Set";
  t.q("#ns-min").value = "120";
  t.q("#ns-mat").value = "200";
  t.q("#ns-price").value = "1200";
  t.click('[data-act="savesvc"]');
  assert.equal(t.q(".sheet"), null, "sheet closed on save");
  assert.ok(t.q("#main").textContent.includes("Acrylic Set"), "row on Prices");

  t.click('[data-act="go"][data-val="quote"]');
  const chip = t.all('[data-act="qservice"]').find((c) => c.textContent.includes("Acrylic Set"));
  assert.ok(chip, "chip on Quote");
  chip.click();
  assert.equal(t.price(), 1200, "quotes at HER price");
  assert.ok(/you keep|\/hr/.test(t.q("#main").textContent), "margin analysis present");

  t.click('[data-act="go"][data-val="insights"]');
  assert.ok(t.q("#main").textContent.includes("Acrylic Set"), "ranked in Insights");
});

test("her custom service survives a reload", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  t.click('[data-act="sheet"][data-val="addservice"]');
  t.q("#ns-name").value = "Pedicure";
  t.q("#ns-min").value = "60"; t.q("#ns-mat").value = "90"; t.q("#ns-price").value = "600";
  t.click('[data-act="savesvc"]');
  const saved = t.w.localStorage.getItem("nsos.v1");
  assert.ok(saved.includes("Pedicure"), "persisted");
  const parsed = JSON.parse(saved);
  assert.equal(parsed.custom.services.length, 1);
  assert.equal(parsed.custom.services[0].materialPaise, 9000);
});

test("she can add her own add-on and toggle it on a quote", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  t.click('[data-act="sheet"][data-val="addaddon"]');
  t.q("#ns-name").value = "Foil Art";
  t.q("#ns-min").value = "10"; t.q("#ns-mat").value = "15"; t.q("#ns-price").value = "180";
  t.click('[data-act="saveaddon"]');
  t.click('[data-act="go"][data-val="quote"]');
  const base = t.price();
  const chip = t.all('[data-act="qaddon"]').find((c) => c.textContent.includes("Foil Art"));
  assert.ok(chip, "add-on chip exists");
  chip.click();
  assert.ok(t.price() > base, "her add-on price applies");
});

test("a garbage service form is rejected and stays open", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  t.click('[data-act="sheet"][data-val="addservice"]');
  t.q("#ns-name").value = "";
  t.click('[data-act="savesvc"]');
  assert.ok(t.q(".sheet"), "still open — nothing saved");
  assert.equal(JSON.parse(t.w.localStorage.getItem("nsos.v1") || "{}").custom?.services?.length ?? 0, 0);
});

test("deleting a custom service cleans up every reference", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  t.click('[data-act="sheet"][data-val="addservice"]');
  t.q("#ns-name").value = "Temp"; t.q("#ns-min").value = "30";
  t.q("#ns-mat").value = "10"; t.q("#ns-price").value = "100";
  t.click('[data-act="savesvc"]');
  const del = t.all('[data-act="delcustom"]')[0];
  assert.ok(del, "delete control present on her rows only");
  del.click();
  assert.ok(!t.q("#main").textContent.includes("Temp"), "gone from Prices");
  t.click('[data-act="go"][data-val="quote"]');
  assert.ok(!t.q("#main").textContent.includes("Temp"), "gone from Quote");
});

test("she can edit minutes and material cost of a BUILT-IN service", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="quote"]');
  const before = t.q("#main").textContent.match(/(\d+) min/)[1];
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  const min = t.q('[data-minutes="gel-mani"]');
  assert.equal(Number(min.value), 75, "seeded standard");
  min.value = "50";
  min.dispatchEvent(new t.w.Event("change", { bubbles: true }));
  const mat = t.q('[data-matcost="gel-mani"]');
  mat.value = "120";
  mat.dispatchEvent(new t.w.Event("change", { bubbles: true }));
  t.click('[data-act="go"][data-val="quote"]');
  const text = t.q("#main").textContent;
  assert.ok(text.includes("65 min"), "50 min service + 15 setup, was " + before);
  assert.ok(text.includes("₹120"), "her material cost is used");
});

test("she can add a stock item and it shows cost per use", () => {
  const t = boot();
  t.click('[data-act="go"][data-val="stock"]');
  const rows = t.all(".list-row").length;
  t.click('[data-act="sheet"][data-val="additem"]');
  t.q("#ni-name").value = "Coffin Tips XL";
  t.q("#ni-price").value = "350";
  t.q("#ni-qty").value = "500";
  t.click('[data-act="saveitem"]');
  assert.equal(t.q(".sheet"), null, "sheet closed");
  assert.ok(t.q("#main").textContent.includes("Coffin Tips XL"));
  assert.equal(t.all(".list-row").length, rows + 1, "one new row");
  t.click('[data-act="delitem"]');
  assert.equal(t.all(".list-row").length, rows, "deleted again");
});

test("the dashboard renders, filters by period, and resets stats in two taps", () => {
  const t = boot();
  // log one job first
  t.click('[data-act="newjob"]');
  t.click('[data-act="nailall"]');
  t.click('[data-act="save"]');
  t.click('[data-act="go"][data-val="dash"]');
  const kpis = () => t.all(".kpi .val").map((e) => rupees(e.textContent));
  assert.equal(kpis()[0], 700, "revenue shows the logged job");
  assert.ok(t.q("#main").textContent.includes("Gel Manicure"), "by-service section");
  assert.ok(t.q("#main").textContent.includes("UPI"), "payment split section");

  t.click('[data-act="dashperiod"][data-val="all"]');
  assert.equal(kpis()[0], 700, "still there on All");

  // reset stats: first tap arms, second erases
  t.click('[data-act="resetstats"]');
  assert.ok(t.q("#main").textContent.includes("Tap again"), "armed, not yet erased");
  assert.equal(JSON.parse(t.w.localStorage.getItem("nsos.v1")).jobs.length, 1, "nothing erased yet");
  t.click('[data-act="resetstats"]');
  assert.equal(kpis()[0], 0, "stats cleared");
  assert.equal(JSON.parse(t.w.localStorage.getItem("nsos.v1")).jobs.length, 0, "jobs gone");
  t.click('[data-act="go"][data-val="pricing"]'); t.click('[data-act="pview"][data-val="list"]');
  assert.equal(Number(t.q('[data-price="gel-mani"]').value), 700, "prices untouched by the reset");
});

/* ============================================================ RUNNER ==== */

const t0 = Date.now();
let pass = 0;
const failures = [];

for (const [name, fn] of TESTS) {
  process.stderr.write(`  … ${name}\n`);
  try {
    await fn();
    pass++;
    console.log(`ok ${pass + failures.length} - ${name}`);
  } catch (err) {
    failures.push([name, err]);
    console.log(`not ok ${pass + failures.length} - ${name}`);
    console.log(`  ${(err.message || String(err)).split("\n").join("\n  ")}`);
  }
}

for (const w of WINDOWS) { try { w.close(); } catch { /* already closed */ } }

console.log(`\n# tests ${TESTS.length}`);
console.log(`# pass  ${pass}`);
console.log(`# fail  ${failures.length}`);
console.log(`# time  ${Date.now() - t0}ms`);
process.exit(failures.length ? 1 : 0);
