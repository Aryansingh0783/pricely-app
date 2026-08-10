/* Golden-file + invariant tests for the pricing engine.
   Run:  node --test test/                                                   */

import test from "node:test";
import assert from "node:assert/strict";
import {
  toPaise, allocate, yieldFactor, effectiveUnitCostMicro, effectiveUses,
  calibrateYield, landedCosts, weightedAverageCostMicro, nailUnits, fullHands,
  lineQuantity, costJob, chairHours, proposePrices, jobOutcome, sensitivity,
  marginToMarkup, markupToMargin, roundPrice, overheadRatePaisePerHour, scaledServiceMinutes,
  targetHourlyRatePaise, recommend, formatINR, BASIS, COATS_MODEL,
  DEFAULT_ASSUMPTIONS, sizeFactor, composePrice, priceHealth, PRICING_MODE, microUsage, usagePerNailFromLife, clientsPerContainer, calibrateUsage, USAGE_SOURCE,
} from "../src/engine.mjs";
import { PRODUCTS, DURABLES, SERVICES, DEFAULT_PRICES, hydrate } from "../src/seed.mjs";

const A = DEFAULT_ASSUMPTIONS;
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ~${b} (±${tol})`);

/* ------------------------------------------------------------ money ----- */

test("allocate always sums exactly to the total", () => {
  assert.deepEqual(allocate(100, [1, 1, 1]).reduce((a, b) => a + b), 100);
  assert.deepEqual(allocate(1, [1, 1, 1]).reduce((a, b) => a + b), 1);
  assert.deepEqual(allocate(0, [5, 3]).reduce((a, b) => a + b), 0);
  for (let t = 0; t < 500; t++) {
    const total = Math.floor(Math.random() * 100000);
    const w = Array.from({ length: 1 + Math.floor(Math.random() * 8) },
                         () => 1 + Math.floor(Math.random() * 5000));
    assert.equal(allocate(total, w).reduce((a, b) => a + b, 0), total);
  }
});

test("landed cost distributes shipping and keeps the total intact", () => {
  const out = landedCosts(
    [{ lineValuePaise: 30000 }, { lineValuePaise: 20000 }, { lineValuePaise: 10000 }],
    { shippingPaise: 6000, discountPaise: 1000 },
  );
  assert.equal(out.reduce((s, l) => s + l.allocatedPaise, 0), 5000);
  assert.equal(out.reduce((s, l) => s + l.landedPaise, 0), 65000);
  assert.ok(out[0].allocatedPaise > out[2].allocatedPaise, "bigger line absorbs more");
});

test("margin and markup round-trip", () => {
  near(marginToMarkup(0.6), 1.5, 1e-9, "60% margin = 150% markup");
  for (const m of [0.1, 0.25, 0.4, 0.6, 0.75]) {
    near(markupToMargin(marginToMarkup(m)), m, 1e-9, "round trip");
  }
});

/* ------------------------------------------------------------ yield ----- */

test("yield factor and effective unit cost", () => {
  near(yieldFactor({ residuePct: 0.05, wastagePct: 0.10 }), 0.855, 1e-9, "y");
  // ₹300 / 15 ml = ₹20/ml nominal -> ₹23.392/ml effective
  const micro = effectiveUnitCostMicro({
    landedPaise: toPaise(300), baseQty: 15, residuePct: 0.05, wastagePct: 0.10,
  });
  near(micro / 1e6 / 100, 23.3918, 1e-3, "effective ₹/ml");
});

test("effective uses is always below theoretical", () => {
  const u = effectiveUses({ baseQty: 15, qtyPerUse: 0.6, residuePct: 0.05, wastagePct: 0.10 });
  near(u.theoretical, 23.75, 1e-9, "theoretical");
  near(u.effective, 21.375, 1e-9, "effective");
  assert.ok(u.effective < u.theoretical);
});

test("calibration blends toward measured reality", () => {
  const first = calibrateYield({ theoreticalUses: 47, actualUses: 31 });
  near(first.measured, 0.6596, 1e-3, "measured");
  near(first.applied, 0.6596, 1e-3, "no history -> take measurement");
  const second = calibrateYield({ theoreticalUses: 47, actualUses: 40, previousYield: 0.66 });
  assert.ok(second.applied > 0.66 && second.applied < second.measured, "EWMA sits between");
});

test("weighted average cost across lots", () => {
  const wac = weightedAverageCostMicro([
    { qtyOnHand: 10, unitCostMicro: 100 },
    { qtyOnHand: 30, unitCostMicro: 200 },
    { qtyOnHand: 0,  unitCostMicro: 999 },
  ]);
  near(wac, 175, 1e-9, "WAC ignores depleted lots");
});

/* -------------------------------------------------------- nail units ---- */

test("nail weights normalise so a hand is exactly 5.00", () => {
  near(nailUnits(fullHands(1)), 5.0, 1e-12, "one hand");
  near(nailUnits(fullHands(2)), 10.0, 1e-12, "both hands");
});

test("a thumb costs more than a pinky", () => {
  assert.ok(nailUnits([{ finger: "thumb" }]) > nailUnits([{ finger: "pinky" }]));
  near(nailUnits([{ finger: "thumb" }]), 1.30, 1e-12, "single thumb repair");
});

test("length multiplier applies to extension work", () => {
  near(nailUnits([{ finger: "middle", length: "XL" }, { finger: "ring", length: "XL" }]),
       3.50, 1e-12, "2 accent nails at XL");
  near(nailUnits(fullHands(2, "M")), 12.0, 1e-12, "both hands medium");
});

/* ------------------------------------------------------- consumption ---- */

test("coats models behave differently", () => {
  const ctx = { nailUnits: 10, hands: 2, coats: 3 };
  const base = { qtyPerBasis: 0.05, basis: BASIS.PER_NAIL };
  near(lineQuantity({ ...base, coatsModel: COATS_MODEL.LINEAR }, ctx), 1.5, 1e-12, "linear x3");
  near(lineQuantity({ ...base, coatsModel: COATS_MODEL.FIXED_PER_NAIL }, ctx), 0.5, 1e-12, "fixed ignores coats");
  near(lineQuantity({ ...base, coatsModel: COATS_MODEL.FIRST_FULL_REST_PARTIAL, partialAlpha: 0.6 }, ctx),
       0.05 * 10 * 2.2, 1e-12, "1 + 0.6(n-1)");
  near(lineQuantity({ qtyPerBasis: 2, basis: BASIS.PER_SERVICE, coatsModel: COATS_MODEL.PER_SERVICE }, ctx),
       2, 1e-12, "per-service ignores everything");
});

/* ----------------------------------------- GOLDEN: worked example -- */

const gelMani = SERVICES.find((s) => s.id === "gel-mani");
const gm = hydrate(gelMani, PRODUCTS, DURABLES);
const gmCtx = { nailUnits: 10, hands: 2, coats: 2, hours: 1.5 };
const gmCost = costJob({ lines: gm.lines, durables: gm.durables, ctx: gmCtx, assumptions: A });

test("GOLDEN — gel manicure direct cost, East Delhi product prices", () => {
  near(gmCost.materialsPaise, 7486, 3, "materials ≈ ₹74.86");
  near(gmCost.durablesPaise, 380, 2, "durables ≈ ₹3.80");
  near(gmCost.directPaise, 7866, 4, "C_direct ≈ ₹78.66");
});

test("GOLDEN — every line is the landed price corrected for yield", () => {
  const byName = Object.fromEntries(gmCost.items.map((i) => [i.name, i.costPaise]));
  const eff = (rupees, qty, ml) => Math.round(((toPaise(rupees) / qty) / 0.855) * ml);
  near(byName["Nail Dehydrator"],  eff(180, 15, 0.30), 2, "dehydrator");
  near(byName["Acid-Free Primer"], eff(200, 15, 0.20), 2, "primer");
  near(byName["Rubber Base Coat"], eff(280, 15, 0.50), 2, "base coat");
  near(byName["Gel Colour"],       eff(180, 15, 1.20), 2, "gel colour x2 coats");
  near(byName["No-Wipe Top Coat"], eff(300, 15, 0.60), 2, "top coat");
  near(byName["Nail File 180/240"], 500, 2, "₹15 file over 3 clients");
  near(byName["Buffer Block"],      500, 2, "₹25 buffer over 5");
  near(byName["E-File Bit"],        300, 2, "₹450 bit over 150");
});

test("GOLDEN — overhead, floor and the price models at East Delhi rates", () => {
  const q = proposePrices({ directPaise: gmCost.directPaise, hours: 1.5, assumptions: A });
  near(q.overheadRatePaisePerHour, 10417, 2, "₹104.17/hr overhead");
  near(q.targetHourlyRatePaise, 52083, 2, "₹520.83/hr target rate");
  near(q.overheadPaise, 15625, 2, "₹156.25 overhead");
  near(q.absorbedPaise, 23491, 5, "₹234.91 absorbed");
  near(q.models.rateBased.pricePaise, 85991, 10, "rate-based -> ₹859.91");
  assert.equal(q.recommendedPaise, 85000, "rounds to ₹850");
  assert.ok(q.models.rateBased.recommended, "rate-based is the recommendation");
});

test("GOLDEN — the outcome numbers at HER price, not ours", () => {
  const her = DEFAULT_PRICES["gel-mani"];            // ₹700
  const o = jobOutcome({ pricePaise: her, directPaise: gmCost.directPaise, hours: 1.5 });
  near(o.contributionPaise, 62134, 10, "she keeps ₹621.34");
  near(o.contributionPerHourPaise, 41423, 20, "₹414.23 per chair-hour");
  near(o.materialSharePct, 11.24, 0.2, "materials are ~11% of price at local rates");
});

test("GOLDEN — the recommendation lands inside the East Delhi market band", () => {
  for (const sv of SERVICES) {
    const h = hydrate(sv, PRODUCTS, DURABLES);
    const isAddon = sv.kind === "ADDON";
    const mins = scaledServiceMinutes(sv.minutes, 10, A.serviceFixedTimePct);
    const hours = chairHours({ serviceMinutes: mins, setupMinutes: isAddon ? 0 : A.setupMinutes });
    const c = costJob({ lines: h.lines, durables: h.durables,
                        ctx: { nailUnits: 10, hands: 2, coats: sv.defaultCoats, hours }, assumptions: A });
    const q = proposePrices({ directPaise: c.directPaise, hours, assumptions: A,
      market: { lowPaise: toPaise(sv.marketLow), highPaise: toPaise(sv.marketHigh) } });
    assert.ok(q.recommendedPaise >= toPaise(sv.marketLow) * 0.9 &&
              q.recommendedPaise <= toPaise(sv.marketHigh),
      `${sv.name}: recommended ${formatINR(q.recommendedPaise)} outside band ` +
      `${formatINR(toPaise(sv.marketLow))}-${formatINR(toPaise(sv.marketHigh))}`);
  }
});

test("GOLDEN — the target hourly rate is regional, not aspirational", () => {
  const R = targetHourlyRatePaise(A);
  near(R, 52083, 2, "(₹20,000 + ₹5,000) / 48 h = ₹520.83/hr");
  assert.ok(R < toPaise(700), "must not drift back to metro-salon rates");
  assert.ok(R > toPaise(300), "but must still cover a living");
  near(overheadRatePaisePerHour(A), 10417, 2, "overhead ₹104.17/hr");
});

test("GOLDEN — her default prices are all viable at East Delhi rates", () => {
  for (const sv of SERVICES) {
    const h = hydrate(sv, PRODUCTS, DURABLES);
    const isAddon = sv.kind === "ADDON";
    const mins = scaledServiceMinutes(sv.minutes, 10, A.serviceFixedTimePct);
    const hours = chairHours({ serviceMinutes: mins, setupMinutes: isAddon ? 0 : A.setupMinutes });
    const c = costJob({ lines: h.lines, durables: h.durables,
                        ctx: { nailUnits: 10, hands: 2, coats: sv.defaultCoats, hours }, assumptions: A });
    const her = DEFAULT_PRICES[sv.id];
    const o = jobOutcome({ pricePaise: her, directPaise: c.directPaise, hours });
    assert.ok(o.contributionPerHourPaise > toPaise(250),
      `${sv.name} earns only ${formatINR(o.contributionPerHourPaise)}/hr at ${formatINR(her)}`);
    assert.ok(her >= toPaise(sv.marketLow) && her <= toPaise(sv.marketHigh),
      `${sv.name} default ${formatINR(her)} is outside the local band`);
  }
});

/* ------------------------------------------------------- HER PRICING ---- */

test("FLAT mode: her price is used verbatim for a full set", () => {
  const r = composePrice({ mode: PRICING_MODE.FLAT, basePricePaise: toPaise(700),
                           addonPricesPaise: [], factor: 1, roundToPaise: toPaise(50) });
  assert.equal(r.pricePaise, toPaise(700), "no invented number");
});

test("FLAT mode: add-ons add their own price, and partial jobs scale down", () => {
  const both = composePrice({ mode: PRICING_MODE.FLAT, basePricePaise: toPaise(700),
                              addonPricesPaise: [toPaise(150)], factor: 1, roundToPaise: toPaise(50) });
  assert.equal(both.pricePaise, toPaise(850), "700 + 150 chrome");
  const one = composePrice({ mode: PRICING_MODE.FLAT, basePricePaise: toPaise(700),
                             addonPricesPaise: [toPaise(150)],
                             factor: sizeFactor(5, A.serviceFixedTimePct), roundToPaise: toPaise(50) });
  assert.ok(one.pricePaise < both.pricePaise, "one hand costs less");
  assert.ok(one.pricePaise > both.pricePaise * 0.5, "but more than half — prep does not halve");
  assert.equal(one.pricePaise, toPaise(500), "850 x 0.60 = 510 -> ₹500");
});

test("HOURLY mode: rate x time, add-ons still priced individually", () => {
  const r = composePrice({ mode: PRICING_MODE.HOURLY, hourlyRatePaise: toPaise(450),
                           baseHours: 1.5, addonPricesPaise: [toPaise(150)],
                           factor: 1, roundToPaise: toPaise(50) });
  assert.equal(r.basePaise, toPaise(675), "₹450 x 1.5 h");
  assert.equal(r.pricePaise, toPaise(850), "675 + 150 = 825 -> ₹850");
});

test("HOURLY mode does not double-count the size factor", () => {
  // baseHours is already scaled by job size; applying factor again would compound.
  const full = composePrice({ mode: PRICING_MODE.HOURLY, hourlyRatePaise: toPaise(450),
                              baseHours: 1.5, factor: 1, roundToPaise: 0 });
  const half = composePrice({ mode: PRICING_MODE.HOURLY, hourlyRatePaise: toPaise(450),
                              baseHours: 0.9, factor: sizeFactor(5, 0.2), roundToPaise: 0 });
  assert.equal(half.basePaise, toPaise(405), "0.9 h x ₹450, not scaled twice");
  assert.ok(half.basePaise / full.basePaise > 0.5, "sane ratio");
});

test("a one-off override wins over everything and is reported as such", () => {
  const r = composePrice({ mode: PRICING_MODE.FLAT, basePricePaise: toPaise(700),
                           factor: 1, roundToPaise: toPaise(50), overridePaise: toPaise(650) });
  assert.equal(r.pricePaise, toPaise(650));
  assert.equal(r.isOverridden, true);
  assert.equal(r.rawPaise, toPaise(700), "the list price is still reported");
});

test("priceHealth is blunt about a price that does not cover cost", () => {
  const h = priceHealth({ pricePaise: toPaise(200), recommendedPaise: toPaise(850),
                          floorPaise: toPaise(300), absorbedPaise: toPaise(260),
                          directPaise: toPaise(81), hours: 1.5,
                          market: { lowPaise: toPaise(500), highPaise: toPaise(1200) } });
  assert.ok(h.flags.includes("BELOW_FLOOR"));
  assert.ok(h.flags.includes("BELOW_MARKET"));
  assert.equal(h.ok, false);
  assert.equal(h.gapToRecommendedPaise, toPaise(650));
});

test("priceHealth stays quiet when her price is fine", () => {
  const h = priceHealth({ pricePaise: toPaise(700), recommendedPaise: toPaise(850),
                          floorPaise: toPaise(300), absorbedPaise: toPaise(260),
                          directPaise: toPaise(81), hours: 1.5,
                          market: { lowPaise: toPaise(500), highPaise: toPaise(1200) } });
  assert.deepEqual(h.flags, [], "a viable price raises nothing");
  assert.equal(h.ok, true);
  near(h.contributionPerHourPaise, 41267, 100, "₹412.67/hr at ₹700");
});

test("THE CORE INSIGHT — time beats materials by an order of magnitude", () => {
  const R = targetHourlyRatePaise(A);
  const cheaperProduct = gmCost.directPaise * 0.20;   // 20% off ALL materials
  const tenMinutesSaved = R / 6;
  // At East Delhi rates the gap narrows from ~9x to ~5.5x, but time still wins.
  assert.ok(tenMinutesSaved > cheaperProduct * 4,
    `saving 10 min (${formatINR(tenMinutesSaved)}) must beat 20% cheaper materials (${formatINR(cheaperProduct)})`);
  assert.ok(tenMinutesSaved < cheaperProduct * 12,
    "and the claim must stay honest — this is not the metro-rate 9x anymore");
});

test("naive material-markup pricing is still catastrophically low", () => {
  const naive = gmCost.directPaise / 0.4;             // "60% margin on materials"
  const her = DEFAULT_PRICES["gel-mani"];
  assert.ok(her > naive * 3, "her real price is 3x+ what markup-on-materials would say");
  near(naive, 19665, 10, "naive model says ₹196.65");
});

/* -------------------------------------------- GOLDEN: add-on ------ */

test("GOLDEN — add-ons out-earn the base service per hour", () => {
  const s = SERVICES.find((x) => x.id === "stones");
  const h = hydrate(s, PRODUCTS, DURABLES);
  const hours = 12 / 60;
  const c = costJob({ lines: h.lines, durables: h.durables,
                      ctx: { nailUnits: 10, hands: 2, coats: 1, hours }, assumptions: A });
  const o = jobOutcome({ pricePaise: DEFAULT_PRICES["stones"], directPaise: c.directPaise, hours });
  assert.ok(c.directPaise < toPaise(30), "stones cost under ₹30");
  assert.ok(o.contributionPerHourPaise > targetHourlyRatePaise(A),
    "beats the target hourly rate — add-ons are the best-paid work she does");
});

/* ----------------------------------------- GOLDEN: extensions ----- */

test("GOLDEN — a full set earns a similar rate but takes twice as long", () => {
  const s = SERVICES.find((x) => x.id === "soft-gel-set");
  const h = hydrate(s, PRODUCTS, DURABLES);
  const hours = chairHours({ serviceMinutes: 150, setupMinutes: 20 });
  const c = costJob({ lines: h.lines, durables: h.durables,
                      ctx: { nailUnits: 12, hands: 2, coats: 2, hours }, assumptions: A });
  const q = proposePrices({ directPaise: c.directPaise, hours, assumptions: A,
                            market: { lowPaise: toPaise(1200), highPaise: toPaise(2500) } });
  assert.ok(q.recommendedPaise >= toPaise(1200) && q.recommendedPaise <= toPaise(2500),
    `expected ₹1,200–2,500, got ${formatINR(q.recommendedPaise)}`);
  assert.ok(!q.flags.includes("BELOW_FLOOR"));
  const o = jobOutcome({ pricePaise: q.recommendedPaise, directPaise: c.directPaise, hours });
  near(o.contributionPerHourPaise, 52083, 15000, "lands near the target hourly rate");
});

test("builder gel uses the higher builder wastage default", () => {
  const set = hydrate(SERVICES.find((x) => x.id === "soft-gel-set"), PRODUCTS, DURABLES);
  const c = costJob({ lines: set.lines, durables: set.durables,
                      ctx: { nailUnits: 10, hands: 2, coats: 2, hours: 2.83 }, assumptions: A });
  const builder = c.items.find((i) => i.name === "Builder Gel");
  near(builder.wastagePct, 0.15, 1e-12, "15% not 10%");
  assert.ok(builder.unitCostMicro > builder.nominalUnitMicro, "effective > nominal, always");
});

/* ------------------------------------------- time scales with job size -- */

test("REGRESSION — one hand must not take as long as two", () => {
  // Shipped bug: recipe duration was flat, so a one-hand job priced identically
  // to a full set. With rate-based pricing, flat time means flat price.
  const std = 75;
  const full = scaledServiceMinutes(std, 10, A.serviceFixedTimePct);
  const half = scaledServiceMinutes(std, 5, A.serviceFixedTimePct);
  near(full, 75, 1e-9, "a full set is the calibrated standard");
  near(half, 45, 1e-9, "one hand = 15 fixed + 30 variable");
  assert.ok(half < full, "one hand is quicker");
  assert.ok(half > full * 0.5, "but not half — prep and cleanup do not halve");
});

test("longer nails take longer, not just more product", () => {
  const short = scaledServiceMinutes(150, nailUnits(fullHands(2, "S")), A.serviceFixedTimePct);
  const long  = scaledServiceMinutes(150, nailUnits(fullHands(2, "XL")), A.serviceFixedTimePct);
  near(short, 150, 1e-9, "S is the reference length");
  assert.ok(long > short * 1.5, `XL should take much longer: ${short} -> ${long}`);
});

test("the fixed-time share behaves at both extremes", () => {
  near(scaledServiceMinutes(100, 5, 0), 50, 1e-9, "0% fixed -> fully proportional");
  near(scaledServiceMinutes(100, 5, 1), 100, 1e-9, "100% fixed -> never scales");
  near(scaledServiceMinutes(100, 0, 0.2), 20, 1e-9, "no nails -> only the fixed part");
  for (const p of [-1, 2]) {
    const v = scaledServiceMinutes(100, 5, p);
    assert.ok(v >= 50 && v <= 100, `out-of-range fixedPct ${p} is clamped, got ${v}`);
  }
});

test("REGRESSION — a one-hand job prices strictly below a two-hand job", () => {
  const h = hydrate(gelMani, PRODUCTS, DURABLES);
  const price = (hands) => {
    const u = nailUnits(fullHands(hands, "S"), A);
    const mins = scaledServiceMinutes(gelMani.minutes, u, A.serviceFixedTimePct);
    const hours = chairHours({ serviceMinutes: mins, setupMinutes: A.setupMinutes });
    const c = costJob({ lines: h.lines, durables: h.durables,
                        ctx: { nailUnits: u, hands, coats: 2, hours }, assumptions: A });
    return { ...proposePrices({ directPaise: c.directPaise, hours, assumptions: A }), hours,
             directPaise: c.directPaise };
  };
  const one = price(1), two = price(2);
  assert.ok(one.recommendedPaise < two.recommendedPaise,
    `one hand ${formatINR(one.recommendedPaise)} must be < two hands ${formatINR(two.recommendedPaise)}`);
  assert.ok(one.directPaise < two.directPaise, "and uses less product");
  assert.ok(one.hours < two.hours, "and less chair time");
  assert.equal(two.recommendedPaise, 85000, "the full set recommends ₹850 at local rates");
  assert.equal(one.recommendedPaise, 55000, "one hand recommends ₹550");
  assert.ok(one.recommendedPaise > two.recommendedPaise * 0.5,
    "but more than half — fixed prep does not disappear");
});

/* ------------------------------------------------- MICRO-USAGE ---------- */

test("MICRO — chrome on ONE nail from a ₹250 / 3 g dibbi", () => {
  const m = microUsage({
    landedPaise: toPaise(250), baseQty: 3, qtyPerNail: 0.02, nailUnitsUsed: 1,
    fullSetChargePaise: toPaise(150), fixedPct: A.serviceFixedTimePct,
    roundToPaise: toPaise(1),
  });
  near(m.qtyUsed, 0.02, 1e-12, "0.02 g used");
  near(m.costPaise, 195, 2, "₹1.95 of chrome");
  near(m.chargePaise, toPaise(42), 100, "~₹42 charge, not ₹15");
  assert.ok(m.profitPaise > toPaise(38), "profit is the whole point");
  assert.ok(m.marginPct > 90, "tiny usage = very high margin");
  assert.equal(m.nailsPerContainer, 142, "the dibbi does ~142 nails");
  assert.equal(m.isLoss, false);
});

test("MICRO — cost scales linearly with nails, charge does NOT", () => {
  const at = (n) => microUsage({
    landedPaise: toPaise(250), baseQty: 3, qtyPerNail: 0.02, nailUnitsUsed: n,
    fullSetChargePaise: toPaise(150), fixedPct: 0.20, roundToPaise: toPaise(1),
  });
  const one = at(1), ten = at(10);
  near(ten.costPaise / one.costPaise, 10, 0.05, "material is exactly 10x");
  assert.ok(ten.chargePaise / one.chargePaise < 4,
    "charge is far from 10x — setup and cure don't shrink");
  assert.ok(one.marginPct > ten.marginPct, "smaller jobs carry richer margins");
});

test("MICRO — gel polish on 2 fingers, 2 coats", () => {
  const m = microUsage({
    landedPaise: toPaise(180), baseQty: 15, qtyPerNail: 0.06, nailUnitsUsed: 2, coats: 2,
    fullSetChargePaise: toPaise(700), fixedPct: 0.20, roundToPaise: toPaise(10),
  });
  near(m.qtyUsed, 0.24, 1e-12, "0.06 x 2 nails x 2 coats");
  assert.ok(m.costPaise > 0 && m.costPaise < toPaise(5), "pennies of polish");
  assert.ok(m.marginPct > 95, "essentially all margin");
});

test("MICRO — a charge below material cost is flagged as a loss", () => {
  const m = microUsage({
    landedPaise: toPaise(250), baseQty: 3, qtyPerNail: 0.02, nailUnitsUsed: 10, coats: 2,
    fullSetChargePaise: toPaise(15), fixedPct: 0.20,
  });
  assert.ok(m.isLoss, `₹15 charge vs ${formatINR(m.costPaise)} of chrome is a loss`);
  assert.ok(m.profitPaise < 0 && m.marginPct < 0, "reported honestly, not clamped");
});

test("MICRO — zero nails is safe, not a divide-by-zero", () => {
  const m = microUsage({
    landedPaise: toPaise(250), baseQty: 3, qtyPerNail: 0.02, nailUnitsUsed: 0,
    fullSetChargePaise: toPaise(150), fixedPct: 0.20,
  });
  assert.equal(m.qtyUsed, 0);
  assert.equal(m.costPaise, 0);
  assert.ok(Number.isFinite(m.marginPct), "margin stays finite");
});

test("MICRO — effective cost always exceeds the sticker cost", () => {
  const m = microUsage({
    landedPaise: toPaise(250), baseQty: 3, qtyPerNail: 0.02, nailUnitsUsed: 1,
    fullSetChargePaise: toPaise(150),
  });
  assert.ok(m.unitCostMicro > m.nominalUnitMicro, "residue + wastage priced in");
  near(m.nominalUnitMicro / 1e6 / 100, 83.33, 0.01, "sticker ₹83.33/g");
  near(m.unitCostMicro / 1e6 / 100, 97.47, 0.01, "real ₹97.47/g");
});

/* ================================================ USAGE DISCOVERY ======== */

test("USAGE — 'one pot does ~40 clients' converts to a per-nail quantity", () => {
  // A 3 g chrome pot she says lasts about 40 clients.
  const q = usagePerNailFromLife({ baseQty: 3, clientsPerContainer: 40, residuePct: 0.05 });
  near(q, 0.007125, 1e-6, "3 g x 0.95 / (40 x 10 nails)");
  // And it reads back the way she said it.
  near(clientsPerContainer({ baseQty: 3, qtyPerNail: q, residuePct: 0.05 }), 40, 1e-6, "round trip");
});

test("USAGE — the two directions are exact inverses for any input", () => {
  for (let t = 0; t < 200; t++) {
    const baseQty = 1 + Math.random() * 100;
    const n = 1 + Math.random() * 200;
    const q = usagePerNailFromLife({ baseQty, clientsPerContainer: n });
    near(clientsPerContainer({ baseQty, qtyPerNail: q }), n, 1e-6, "inverse");
  }
});

test("USAGE — a finished pot is measured, not guessed", () => {
  // She logged 420 nail-units against a 3 g pot before it ran out.
  const r = calibrateUsage({ baseQty: 3, nailUnitsConsumed: 420, residuePct: 0.05 });
  assert.equal(r.ok, true);
  near(r.measured, 0.006786, 1e-6, "2.85 g usable / 420 nails");
  near(r.applied, r.measured, 1e-12, "no history yet -> take the measurement");
  assert.equal(r.confidence, "HIGH", "420 nails is a solid sample");
});

test("USAGE — a second pot blends with the first, it doesn't lurch", () => {
  const first = calibrateUsage({ baseQty: 3, nailUnitsConsumed: 420 });
  const second = calibrateUsage({ baseQty: 3, nailUnitsConsumed: 300,
                                  previousQtyPerNail: first.applied });
  assert.ok(second.applied > first.applied, "moved toward the new, higher measurement");
  assert.ok(second.applied < second.measured, "but did not jump all the way");
  assert.ok(second.driftPct > 0, "drift reported honestly");
});

test("USAGE — a wild measurement is flagged rather than silently trusted", () => {
  const r = calibrateUsage({ baseQty: 3, nailUnitsConsumed: 5, previousQtyPerNail: 0.007 });
  assert.equal(r.suspicious, true, "5 nails emptying a pot is not believable");
  assert.equal(r.confidence, "LOW");
});

test("USAGE — calibrating with nothing logged fails safely", () => {
  const r = calibrateUsage({ baseQty: 3, nailUnitsConsumed: 0, previousQtyPerNail: 0.02 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NO_USAGE_LOGGED");
  assert.equal(r.applied, 0.02, "the old figure survives untouched");
});

test("USAGE — measured usage feeds straight into micro-usage costing", () => {
  const r = calibrateUsage({ baseQty: 3, nailUnitsConsumed: 420 });
  const m = microUsage({
    landedPaise: toPaise(250), baseQty: 3, qtyPerNail: r.applied, nailUnitsUsed: 1,
    fullSetChargePaise: toPaise(150), fixedPct: 0.20,
  });
  assert.ok(m.costPaise > 0, "a real cost falls out of a real measurement");
  near(m.nailsPerContainer, 420, 1, "and the pot's reach matches what was logged");
});

test("USAGE — the three sources are distinct and ordered", () => {
  assert.deepEqual(Object.keys(USAGE_SOURCE), ["DEFAULT", "ESTIMATED", "CALIBRATED"]);
});

/* ------------------------------------------------------- invariants ----- */

test("INVARIANT — cost is never negative and effective ≥ nominal for all services", () => {
  for (const s of SERVICES) {
    const h = hydrate(s, PRODUCTS, DURABLES);
    const hours = chairHours({ serviceMinutes: s.minutes, setupMinutes: A.setupMinutes });
    const c = costJob({ lines: h.lines, durables: h.durables,
                        ctx: { nailUnits: 10, hands: 2, coats: s.defaultCoats, hours }, assumptions: A });
    assert.ok(c.directPaise >= 0, `${s.name} cost >= 0`);
    for (const i of c.items) {
      assert.ok(i.costPaise >= 0, `${s.name}/${i.name} >= 0`);
      assert.ok(i.unitCostMicro >= i.nominalUnitMicro - 1e-6, `${s.name}/${i.name} effective >= nominal`);
      assert.ok(Number.isInteger(i.costPaise), `${s.name}/${i.name} is integer paise`);
    }
  }
});

test("INVARIANT — the recommended price never lands below the floor", () => {
  for (const s of SERVICES) {
    const h = hydrate(s, PRODUCTS, DURABLES);
    const hours = chairHours({ serviceMinutes: s.minutes, setupMinutes: A.setupMinutes });
    const c = costJob({ lines: h.lines, durables: h.durables,
                        ctx: { nailUnits: 10, hands: 2, coats: s.defaultCoats, hours }, assumptions: A });
    const q = proposePrices({ directPaise: c.directPaise, hours, assumptions: A });
    assert.ok(q.recommendedPaise >= q.floorPaise, `${s.name}: ${q.recommendedPaise} >= ${q.floorPaise}`);
    assert.equal(q.recommendedPaise % A.roundToPaise, 0, `${s.name} rounds to ₹50`);
  }
});

test("INVARIANT — rounding never drops below the floor, for any input", () => {
  for (let t = 0; t < 2000; t++) {
    const price = Math.floor(Math.random() * 500000);
    const floor = Math.floor(Math.random() * 500000);
    assert.ok(roundPrice(price, 5000, floor) >= floor);
  }
});

test("INVARIANT — a job priced at cost yields exactly zero contribution", () => {
  const o = jobOutcome({ pricePaise: gmCost.directPaise, directPaise: gmCost.directPaise, hours: 1.5 });
  assert.equal(o.contributionPaise, 0);
});

test("overhead rate explodes as utilisation falls — the trap in", () => {
  const half = { ...A, billableHoursMonthly: A.billableHoursMonthly / 2 };
  assert.equal(overheadRatePaisePerHour(half), overheadRatePaisePerHour(A) * 2);
});

/* ------------------------------------------------------ sensitivity ----- */

test("GOLDEN — sensitivity matrix", () => {
  const m = sensitivity({ directPaise: 7866, hoursList: [1.25, 1.5, 1.75],
                          ratesPaise: [30000, 40000, 52083, 65000, 80000] });
  near(m[0].cells[0].pricePaise, 45366, 2, "1.25h @ ₹300");
  near(m[1].cells[2].pricePaise, 85991, 2, "1.50h @ ₹520.83");
  near(m[2].cells[4].pricePaise, 147866, 2, "1.75h @ ₹800");
  for (const row of m) {
    for (let i = 1; i < row.cells.length; i++) {
      assert.ok(row.cells[i].pricePaise > row.cells[i - 1].pricePaise, "monotonic in rate");
    }
  }
});

/* --------------------------------------------------- recommendations ---- */

test("R16 capacity guard suppresses price increases when the calendar is empty", () => {
  const services = [{ name: "Removal", samples: 8, hours: 0.67, contributionPerHourPaise: 12000,
                      pricePaise: 25000, floorPaise: 18000, absorbedPaise: 15000, directPaise: 3800 },
                    { name: "Gel Mani", samples: 20, hours: 1.5, contributionPerHourPaise: 41423,
                      pricePaise: 70000, floorPaise: 27015, absorbedPaise: 23491, directPaise: 7866 }];
  const busy = recommend({ services, utilisation: 0.9 });
  const quiet = recommend({ services, utilisation: 0.3 });
  assert.ok(busy.some((r) => r.id === "R5"), "underpricing flagged when busy");
  assert.ok(!quiet.some((r) => r.id === "R5"), "suppressed when the calendar is empty");
  assert.ok(quiet.some((r) => r.id === "R16"), "and explains why");
});

test("R6 below-floor is URGENT and always surfaces regardless of capacity", () => {
  const r = recommend({
    services: [{ name: "Removal", samples: 2, hours: 0.67, contributionPerHourPaise: 5000,
                 pricePaise: 15000, floorPaise: 25000, absorbedPaise: 21739, directPaise: 9000 }],
    utilisation: 0.2,
  });
  const hit = r.find((x) => x.id === "R6");
  assert.ok(hit, "flagged");
  assert.equal(hit.severity, "URGENT");
  assert.equal(hit.suggestedPricePaise, 25000);
  assert.equal(hit.entityType, "SERVICE", "carries where to navigate");
  assert.equal(hit.entityId, "Removal", "falls back to name when no id given");
});

test("rules below the sample threshold stay silent", () => {
  const r = recommend({
    services: [{ name: "New thing", samples: 2, hours: 1, contributionPerHourPaise: 100,
                 pricePaise: 100000, floorPaise: 1000, absorbedPaise: 900, directPaise: 500 }],
    utilisation: 1,
  });
  assert.ok(!r.some((x) => x.id === "R5"), "no advice from 2 data points");
});

test("dead stock and expiry rules", () => {
  const r = recommend({
    services: [],
    products: [
      { name: "Neon Green Gel", daysSinceUse: 140, valuePaise: toPaise(300) },
      { name: "Builder Gel", daysToExpiry: 20, daysToDeplete: 95, valuePaise: toPaise(900) },
    ],
    utilisation: 1,
  });
  assert.ok(r.some((x) => x.id === "R3"), "dead stock");
  assert.ok(r.some((x) => x.id === "R4"), "expiry risk");
});

/* ----------------------------------------------------------- format ----- */

test("Indian digit grouping", () => {
  assert.equal(formatINR(toPaise(123456)), "₹1,23,456");
  assert.equal(formatINR(toPaise(2050)), "₹2,050");
  assert.equal(formatINR(12111, { decimals: true }), "₹121.11");
});
