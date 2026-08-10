/* ==========================================================================
   PRICELY — PRICING & COSTING ENGINE
   --------------------------------------------------------------------------
   PURE. No DOM. No storage. No network. No Date.now(). No randomness.
   Every function is (input) => output so it can be tested exhaustively and
   reused unchanged on a server later.

   Covers: landed cost and allocation, the three cost classes, effective unit
   cost and yield, nail-units, consumption models, the time model, overhead,
   the four price proposers, realised profitability, and sensitivity.

   MONEY IS INTEGER PAISE. There is no float money in this file.
   Quantities are plain numbers in BASE UNITS (ml | g | pc) and are only ever
   multiplied by micro-paise rates, then rounded once at the boundary.
   ========================================================================== */

/* ---------------------------------------------------------------- money -- */

/** Rupees (float, user-facing) -> paise (integer, internal). */
export const toPaise = (rupees) => Math.round(rupees * 100);

/** Paise -> rupees as a Number, for display only. */
export const toRupees = (paise) => paise / 100;

/** Half-up rounding that behaves correctly for negatives too. */
export const roundPaise = (n) => (n < 0 ? -Math.round(-n) : Math.round(n));

/**
 * Format paise as Indian-grouped currency.
 * @param {number} paise
 * @param {{decimals?: boolean, sign?: boolean}} [opt]
 */
export function formatINR(paise, opt = {}) {
  const { decimals = false, sign = false } = opt;
  const v = paise / 100;
  const s = v.toLocaleString("en-IN", {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
  return (sign && paise > 0 ? "+" : "") + "₹" + s;
}

/**
 * Split `total` across `weights` so the parts are integers that sum EXACTLY
 * to `total` (largest-remainder method). Used for shipping/discount allocation.
 * @param {number} total   integer paise
 * @param {number[]} weights
 * @returns {number[]} integer paise, guaranteed Σ === total
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  const out = floors.slice();
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    out[order[k].i] += 1;
  }
  return out;
}

/* ---------------------------------------------------------------- units -- */

export const BASE_UNITS = /** @type {const} */ (["ML", "G", "PC"]);

/**
 * Convert a purchase into base units.
 * @param {{packs:number, unitsPerPack:number, qtyPerUnit:number}} p
 *        e.g. 2 packs x 3 bottles x 15 ml  ->  90 ml
 */
export const toBaseQty = ({ packs = 1, unitsPerPack = 1, qtyPerUnit }) =>
  packs * unitsPerPack * qtyPerUnit;

/**
 * Density bridge — required when a product is BOUGHT by mass but CONSUMED
 * by volume (builder gel, acrylic powder). Returns ml.
 */
export const gramsToMl = (grams, densityGPerMl) => grams / densityGPerMl;

/* ------------------------------------------------------- cost classes --- */

export const COST_CLASS = /** @type {const} */ ({
  METERED: "METERED",
  DISCRETE: "DISCRETE",
  DURABLE: "DURABLE_AMORTISED",
});

/* --------------------------------------------------- effective unit cost - */

/**
 * System defaults. Every one of these is user-overridable.
 *
 * MARKET CALIBRATION: East Delhi, freelance / home-based artist, clients on
 * ₹25–35k monthly salaries. That demographic treats a nail appointment as an
 * occasional ₹500–1,500 treat, not a routine spend. Every money default below
 * is set for that market — NOT for a salon in a metro mall, and not for the
 * aspirational ₹1,300/hr figures a naive rate calculation produces.
 */
export const DEFAULT_ASSUMPTIONS = {
  residuePct: 0.05,          // unreachable residue in bottle/jar
  wastageGel: 0.10,          // over-dispense, brush wipe, drips
  wastageBuilder: 0.15,      // beads dispensed generously, filed off
  wastageDiscrete: 0.10,     // dropped stones, mis-sized tips
  setupMinutes: 15,          // sanitise + tray prep + station wipe-down
  serviceFixedTimePct: 0.20, // share of a service's time that does NOT scale
                             // with nail count (consult, soak, prep, cleanup)

  // --- these three drive the RECOMMENDED price only. Her own prices win. ---
  targetTakeHomePaise: toPaise(20000),  // realistic starting take-home, East Delhi
  overheadPoolPaise:   toPaise(5000),   // home-based: power, data, ads, packaging
  billableHoursMonthly: 48,             // ~11 clients/week at ~1 h each

  // --- her actual pricing ---
  pricingMode: "FLAT",                  // FLAT (per client) | HOURLY (rate + add-ons)
  myHourlyRatePaise: toPaise(450),      // what she charges per hour in HOURLY mode

  roundToPaise: toPaise(50),
  floorMultiplier: 1.15,     // price must clear absorbed cost by 15%
  nailWeights: { thumb: 1.30, index: 0.95, middle: 1.05, ring: 0.95, pinky: 0.75 },
  lengthMultiplier: { XS: 0.80, S: 1.00, M: 1.20, L: 1.45, XL: 1.75 },
};

export const PRICING_MODE = /** @type {const} */ ({ FLAT: "FLAT", HOURLY: "HOURLY" });

/**
 * Yield factor: y = (1 − residue) · (1 − wastage) · potLifeUtilisation
 * @returns {number} 0 < y <= 1
 */
export function yieldFactor({ residuePct, wastagePct, potLifeUtilisation = 1 }) {
  const y = (1 - residuePct) * (1 - wastagePct) * potLifeUtilisation;
  return Math.max(y, 1e-6);
}

/**
 * EFFECTIVE UNIT COST — the single most important correction to naive costing.
 * Returns MICRO-PAISE per base unit (paise x 1e6) so downstream multiplication
 * by tiny quantities (0.06 ml) never loses precision.
 *
 * @param {{landedPaise:number, baseQty:number, residuePct:number,
 *          wastagePct:number, potLifeUtilisation?:number}} p
 */
export function effectiveUnitCostMicro(p) {
  const nominal = (p.landedPaise * 1e6) / p.baseQty;   // micro-paise / base unit
  return nominal / yieldFactor(p);
}

/** Nominal (uncorrected) unit cost, for the "before/after" comparison UI. */
export const nominalUnitCostMicro = (landedPaise, baseQty) =>
  (landedPaise * 1e6) / baseQty;

/**
 * How many services a container really yields.
 * @param {{baseQty:number, qtyPerUse:number, residuePct:number, wastagePct:number}} p
 */
export function effectiveUses({ baseQty, qtyPerUse, residuePct, wastagePct }) {
  const theoretical = (baseQty * (1 - residuePct)) / qtyPerUse;
  return { theoretical, effective: theoretical * (1 - wastagePct) };
}

/**
 * Yield calibration — back-solve real yield when a lot is marked empty.
 * Blends with the previous value once there is history (EWMA, alpha 0.5).
 */
export function calibrateYield({ theoreticalUses, actualUses, previousYield = null, alpha = 0.5 }) {
  const measured = actualUses / theoreticalUses;
  const applied = previousYield == null ? measured : alpha * measured + (1 - alpha) * previousYield;
  return { measured, applied: Math.min(Math.max(applied, 0.05), 1) };
}

/* -------------------------------------------------------- landed cost ---- */

/**
 * Allocate order-level shipping/fees/discount across purchase lines.
 * @param {{lineValuePaise:number}[]} lines
 * @param {{shippingPaise?:number, feesPaise?:number, discountPaise?:number}} order
 * @returns {{lineValuePaise:number, allocatedPaise:number, landedPaise:number}[]}
 */
export function landedCosts(lines, order = {}) {
  const overhead =
    (order.shippingPaise || 0) + (order.feesPaise || 0) - (order.discountPaise || 0);
  const parts = allocate(overhead, lines.map((l) => l.lineValuePaise));
  return lines.map((l, i) => ({
    lineValuePaise: l.lineValuePaise,
    allocatedPaise: parts[i],
    landedPaise: l.lineValuePaise + parts[i],
  }));
}

/** Weighted-average cost across open lotseturns micro-paise/base unit. */
export function weightedAverageCostMicro(lots) {
  let qty = 0, value = 0;
  for (const l of lots) {
    if (l.qtyOnHand <= 0) continue;
    qty += l.qtyOnHand;
    value += l.qtyOnHand * l.unitCostMicro;
  }
  return qty > 0 ? value / qty : 0;
}

/* ------------------------------------------------------------ nail units - */

export const FINGERS = /** @type {const} */ (["thumb", "index", "middle", "ring", "pinky"]);

/**
 * Job size in nail-units
 * Weights are normalised so ONE HAND === 5.00 and BOTH HANDS === 10.00,
 * which preserves the "10 nails" intuition while distributing partial jobs
 * correctly (a thumb costs more than a pinky).
 *
 * @param {{finger:string, length?:string}[]} selection
 * @param {typeof DEFAULT_ASSUMPTIONS} [a]
 */
export function nailUnits(selection, a = DEFAULT_ASSUMPTIONS) {
  return selection.reduce((sum, n) => {
    const w = a.nailWeights[n.finger] ?? 1;
    const m = a.lengthMultiplier[n.length || "S"] ?? 1;
    return sum + w * m;
  }, 0);
}

/** Convenience: full selection for N hands at a given length. */
export function fullHands(hands = 2, length = "S") {
  const out = [];
  for (let h = 0; h < hands; h++) for (const f of FINGERS) out.push({ finger: f, length });
  return out;
}

/* ---------------------------------------------------------- consumption -- */

export const BASIS = /** @type {const} */ ({
  PER_NAIL: "PER_NAIL", PER_HAND: "PER_HAND",
  PER_SERVICE: "PER_SERVICE", PER_PIECE: "PER_PIECE",
});

export const COATS_MODEL = /** @type {const} */ ({
  LINEAR: "LINEAR",                                   // colour gel, polish
  FIXED_PER_NAIL: "FIXED_PER_NAIL",                   // base/top/primer/chrome
  FIRST_FULL_REST_PARTIAL: "FIRST_FULL_REST_PARTIAL", // sheer builds, ombre
  PER_SERVICE: "PER_SERVICE",                         // cleanser, acetone
});

/**
 * Quantity consumed by one recipe line
 * @param {{basis:string, qtyPerBasis:number, coatsModel:string,
 *          partialAlpha?:number, pieces?:number}} line
 * @param {{nailUnits:number, hands:number, coats:number}} ctx
 */
export function lineQuantity(line, ctx) {
  const { qtyPerBasis, basis, coatsModel, partialAlpha = 0.6, pieces = 0 } = line;
  let multiplier;
  switch (basis) {
    case BASIS.PER_NAIL:    multiplier = ctx.nailUnits; break;
    case BASIS.PER_HAND:    multiplier = ctx.hands;     break;
    case BASIS.PER_PIECE:   multiplier = pieces;        break;
    case BASIS.PER_SERVICE:
    default:                multiplier = 1;             break;
  }
  let coatFactor;
  switch (coatsModel) {
    case COATS_MODEL.LINEAR:
      coatFactor = ctx.coats; break;
    case COATS_MODEL.FIRST_FULL_REST_PARTIAL:
      coatFactor = 1 + partialAlpha * Math.max(0, ctx.coats - 1); break;
    case COATS_MODEL.FIXED_PER_NAIL:
    case COATS_MODEL.PER_SERVICE:
    default:
      coatFactor = 1; break;
  }
  return qtyPerBasis * multiplier * coatFactor;
}

/* ----------------------------------------------------------- durables ---- */

/** Amortised capital cost attributed to one service */
export function durableCostPaise(asset, serviceHours = 0) {
  const base = asset.costPaise - (asset.salvagePaise || 0);
  if (asset.basis === "HOURS") return roundPaise((base / asset.lifeUnits) * serviceHours);
  return roundPaise(base / asset.lifeUnits);
}

/* ------------------------------------------------------------- costing --- */

/**
 * Full material + durable cost for a job
 * @param {object} p
 * @param {Array} p.lines      recipe lines joined to their product
 * @param {Array} p.durables
 * @param {object} p.ctx       { nailUnits, hands, coats, hours }
 * @param {typeof DEFAULT_ASSUMPTIONS} p.assumptions
 */
export function costJob({ lines, durables = [], ctx, assumptions = DEFAULT_ASSUMPTIONS }) {
  const items = [];
  let materialsPaise = 0;

  for (const line of lines) {
    const p = line.product;
    const wastage =
      line.wastagePctOverride ??
      p.wastagePct ??
      (p.costClass === COST_CLASS.DISCRETE
        ? assumptions.wastageDiscrete
        : p.isBuilder
        ? assumptions.wastageBuilder
        : assumptions.wastageGel);

    const unitMicro = effectiveUnitCostMicro({
      landedPaise: p.landedPaise,
      baseQty: p.baseQty,
      residuePct: p.residuePct ?? assumptions.residuePct,
      wastagePct: wastage,
      potLifeUtilisation: p.potLifeUtilisation ?? 1,
    });

    let qty = lineQuantity(line, ctx);
    // Multi-use discrete items (a file used for 3 clients) amortise per service.
    if (p.costClass === COST_CLASS.DISCRETE && p.usesPerItem > 1) qty = qty / p.usesPerItem;

    const costPaise = roundPaise((qty * unitMicro) / 1e6);
    materialsPaise += costPaise;
    items.push({
      productId: p.id, name: p.name, qty,
      unit: p.baseUnit, unitCostMicro: unitMicro,
      nominalUnitMicro: nominalUnitCostMicro(p.landedPaise, p.baseQty),
      wastagePct: wastage, costPaise,
    });
  }

  let durablesPaise = 0;
  const durableItems = durables.map((d) => {
    const c = durableCostPaise(d, ctx.hours || 0);
    durablesPaise += c;
    return { name: d.name, costPaise: c };
  });

  return {
    items, durableItems,
    materialsPaise,
    durablesPaise,
    directPaise: materialsPaise + durablesPaise,
  };
}

/* ------------------------------------------------------------ overhead --- */

/** Overhead rate in paise per hour */
export const overheadRatePaisePerHour = (a = DEFAULT_ASSUMPTIONS) =>
  a.overheadPoolPaise / Math.max(a.billableHoursMonthly, 0.01);

/** Target hourly rate for the rate-based model. */
export const targetHourlyRatePaise = (a = DEFAULT_ASSUMPTIONS) =>
  (a.targetTakeHomePaise + a.overheadPoolPaise) / Math.max(a.billableHoursMonthly, 0.01);

/* -------------------------------------------------------------- pricing -- */

/** Round UP to the nearest step, never below the floor. */
export function roundPrice(pricePaise, stepPaise, floorPaise = 0) {
  if (!stepPaise) return Math.max(roundPaise(pricePaise), floorPaise);
  const r = Math.round(pricePaise / stepPaise) * stepPaise;
  return r < floorPaise ? Math.ceil(floorPaise / stepPaise) * stepPaise : r;
}

/** margin -> markup and back. The #1 small-business arithmetic mistake. */
export const marginToMarkup = (margin) => margin / (1 - margin);
export const markupToMargin = (markup) => markup / (1 + markup);

/**
 * The four price proposers
 * @param {object} p
 * @param {number} p.directPaise
 * @param {number} p.hours
 * @param {typeof DEFAULT_ASSUMPTIONS} p.assumptions
 * @param {number} [p.targetMargin]
 * @param {number} [p.markup]
 * @param {{lowPaise?:number, highPaise?:number}} [p.market]
 */
export function proposePrices({
  directPaise, hours, assumptions = DEFAULT_ASSUMPTIONS,
  targetMargin = 0.6, markup = 1.5, market = {},
}) {
  const O = overheadRatePaisePerHour(assumptions);
  const R = targetHourlyRatePaise(assumptions);
  const overheadPaise = roundPaise(O * hours);
  const absorbedPaise = directPaise + overheadPaise;
  const floorPaise = roundPaise(absorbedPaise * assumptions.floorMultiplier);

  const costPlus  = roundPaise(absorbedPaise * (1 + markup));
  const marginTgt = roundPaise(absorbedPaise / (1 - targetMargin));
  const rateBased = roundPaise(directPaise + R * hours);

  let recommended = rateBased;
  const flags = [];
  if (market.lowPaise != null && recommended < market.lowPaise) flags.push("BELOW_MARKET");
  if (market.highPaise != null && recommended > market.highPaise) flags.push("ABOVE_MARKET");
  if (recommended < floorPaise) { flags.push("BELOW_FLOOR"); recommended = floorPaise; }

  const rounded = roundPrice(recommended, assumptions.roundToPaise, floorPaise);

  return {
    overheadRatePaisePerHour: O,
    targetHourlyRatePaise: R,
    overheadPaise, absorbedPaise, floorPaise,
    models: {
      costPlus:    { pricePaise: costPlus,  label: "Cost-plus",  note: `${Math.round(markup * 100)}% markup on cost` },
      marginTarget:{ pricePaise: marginTgt, label: "Margin target", note: `${Math.round(targetMargin * 100)}% margin = ${Math.round(marginToMarkup(targetMargin) * 100)}% markup` },
      rateBased:   { pricePaise: rateBased, label: "Rate-based", note: `${formatINR(roundPaise(R))}/hr x ${hours.toFixed(2)} h`, recommended: true },
    },
    market,
    flags,
    recommendedPaise: rounded,
  };
}

/**
 * HER PRICE — the primary path.
 *
 * The app's job is to explain the margin on the price SHE chooses, not to
 * impose one. `proposePrices` above is the optional second opinion.
 *
 * Two modes, both real ways freelance artists price:
 * FLAT   — a price per service ("gel mani ₹700"). Most common.
 * HOURLY — her hourly rate × chair time, plus each add-on at its own price.
 *
 * Partial jobs scale by the SAME size factor as time, so one hand is ~60% of a
 * full set rather than either full price or an arbitrary half. She can always
 * override the result for a given quote.
 *
 * @param {object} p
 * @param {string} p.mode                    FLAT | HOURLY
 * @param {number} p.basePricePaise          her price for the base service (FLAT)
 * @param {number} p.hourlyRatePaise         her rate (HOURLY)
 * @param {number} p.baseHours               chair hours for the base service
 * @param {number[]} p.addonPricesPaise      her price for each chosen add-on
 * @param {number} p.factor                  sizeFactor() for this job
 * @param {number} [p.roundToPaise]
 * @param {number|null} [p.overridePaise]    a one-off price typed for this quote
 */
export function composePrice({
  mode, basePricePaise = 0, hourlyRatePaise = 0, baseHours = 0,
  addonPricesPaise = [], factor = 1, addonFactor = null,
  roundToPaise = 0, overridePaise = null,
}) {
  const basis = mode === PRICING_MODE.HOURLY
    ? hourlyRatePaise * baseHours          // already time-scaled; don't scale twice
    : basePricePaise * factor;
  // addonFactor lets each add-on carry its OWN micro-usage scaling (chrome on
  // 2 nails while the manicure covers 10). Pass 1 when already scaled.
  const af = addonFactor == null ? factor : addonFactor;
  const addons = addonPricesPaise.reduce((s, a) => s + a * af, 0);
  const raw = basis + addons;
  const rounded = roundToPaise ? Math.round(raw / roundToPaise) * roundToPaise : roundPaise(raw);
  return {
    basePaise: roundPaise(basis),
    addonsPaise: roundPaise(addons),
    rawPaise: roundPaise(raw),
    pricePaise: overridePaise != null ? overridePaise : Math.max(rounded, 0),
    isOverridden: overridePaise != null,
  };
}

/**
 * Compare her price against the engine's recommendation and against cost.
 * This is the analysis screen's payload — deliberately blunt about the gap.
 */
export function priceHealth({ pricePaise, recommendedPaise, floorPaise, absorbedPaise,
                              directPaise, hours, market = {} }) {
  const contribution = pricePaise - directPaise;
  const perHour = hours > 0 ? roundPaise(contribution / hours) : 0;
  const flags = [];
  if (pricePaise < floorPaise) flags.push("BELOW_FLOOR");
  else if (pricePaise < absorbedPaise) flags.push("BELOW_COST");
  if (market.lowPaise != null && pricePaise < market.lowPaise) flags.push("BELOW_MARKET");
  if (market.highPaise != null && pricePaise > market.highPaise) flags.push("ABOVE_MARKET");
  return {
    contributionPaise: contribution,
    contributionPerHourPaise: perHour,
    materialSharePct: pricePaise > 0 ? (directPaise / pricePaise) * 100 : 0,
    gapToRecommendedPaise: recommendedPaise - pricePaise,
    gapPct: pricePaise > 0 ? ((recommendedPaise - pricePaise) / pricePaise) * 100 : 0,
    flags,
    ok: flags.length === 0,
  };
}

/* ===================================================== USAGE DISCOVERY ===
   THE HARD PROBLEM: she cannot weigh 0.02 g of chrome between clients, and
   any app that asks her to will be abandoned in a week. So we never ask for
   grams. We ask questions she can actually answer, and we measure the rest.

   Three sources, in ascending order of trust:

     DEFAULT     a documented industry starting point. Honest but generic.
     ESTIMATED   she answered "roughly how many clients does one pot do?" —
                 a question every artist can answer from memory.
     CALIBRATED  a pot actually ran out. The app knew how many nails it had
                 been used on, so the real figure is arithmetic, not a guess.

   Every cost in the app is tagged with which of these it came from, so she
   always knows how much to trust the number.
   ======================================================================== */

export const USAGE_SOURCE = /** @type {const} */ ({
  DEFAULT: "DEFAULT", ESTIMATED: "ESTIMATED", CALIBRATED: "CALIBRATED",
});

/**
 * "One pot does about N clients" -> quantity per nail.
 * The question she can answer, turned into the number the engine needs.
 *
 * @param {object} p
 * @param {number} p.baseQty          container size (ml | g | pc)
 * @param {number} p.clientsPerContainer  her lived experience
 * @param {number} [p.nailUnitsPerClient] typically 10 (a full set)
 * @param {number} [p.coats]
 * @param {number} [p.residuePct]     what can never be scraped out
 */
export function usagePerNailFromLife({
  baseQty, clientsPerContainer, nailUnitsPerClient = 10, coats = 1, residuePct = 0.05,
}) {
  const usable = baseQty * (1 - residuePct);
  const nails = Math.max(clientsPerContainer * nailUnitsPerClient * coats, 1e-9);
  return usable / nails;
}

/** The same relationship read the other way, for showing "≈ N clients per pot". */
export function clientsPerContainer({
  baseQty, qtyPerNail, nailUnitsPerClient = 10, coats = 1, residuePct = 0.05,
}) {
  const perClient = qtyPerNail * nailUnitsPerClient * coats;
  return perClient > 0 ? (baseQty * (1 - residuePct)) / perClient : 0;
}

/**
 * CALIBRATION — a container ran out. This is the moment the app stops guessing.
 *
 * She taps "this is finished"; the app already knows how many nail-units of
 * work it was used on since she opened it, so the true consumption falls out
 * with no measuring at all.
 *
 * @param {object} p
 * @param {number} p.baseQty            what was in it
 * @param {number} p.nailUnitsConsumed  what the app logged against it
 * @param {number} [p.previousQtyPerNail] for blending across refills
 * @param {number} [p.alpha]            EWMA weight on the new measurement
 * @param {number} [p.residuePct]
 */
export function calibrateUsage({
  baseQty, nailUnitsConsumed, previousQtyPerNail = null,
  referenceQtyPerNail = null, alpha = 0.6, residuePct = 0.05,
}) {
  if (!(nailUnitsConsumed > 0)) {
    return { ok: false, reason: "NO_USAGE_LOGGED", measured: null, applied: previousQtyPerNail };
  }
  const measured = (baseQty * (1 - residuePct)) / nailUnitsConsumed;

  // Blend only against a previous MEASUREMENT — an estimate shouldn't drag a
  // real observation around.
  const applied = previousQtyPerNail == null
    ? measured
    : alpha * measured + (1 - alpha) * previousQtyPerNail;

  // But sanity-check against whatever figure she was using, measured or not.
  // Otherwise "I finished the pot" after 10 logged nails silently claims each
  // nail eats 0.28 g of chrome, and every price built on it is nonsense.
  const ref = referenceQtyPerNail ?? previousQtyPerNail;
  const driftPct = ref ? ((measured - ref) / ref) * 100 : 0;
  const confidence = nailUnitsConsumed >= 100 ? "HIGH"
                   : nailUnitsConsumed >= 30 ? "MED" : "LOW";
  return {
    ok: true,
    measured,
    applied,
    driftPct,
    confidence,
    /** Too few nails logged for the result to mean anything. */
    thinSample: nailUnitsConsumed < 30,
    /** Wildly different from what she was using — worth a second look. */
    suspicious: ref != null && Math.abs(driftPct) > 200,
  };
}

/**
 * MICRO-USAGE — partial application of a material to a subset of nails.
 *
 * This is a FIRST-CLASS pricing path, not an edge case. "Chrome on one accent
 * nail" is an everyday sale, and the naive answer (divide the ₹250 dibbi by
 * some guessed number of sets) is wrong by an order of magnitude.
 *
 * The chain is: dibbi price -> effective cost per gram (residue + wastage) ->
 * grams actually rubbed on N nails -> rupees. A ₹250 / 3 g chrome pot is
 * ₹97.47/g effective, 0.02 g per nail, so ONE nail costs ₹1.95 of chrome.
 *
 * Charge does NOT scale linearly with nails: doing one accent nail still costs
 * her the setup, the wipe, the cure and the client's attention. It scales by
 * the same fixed/variable split as time (sizeFactor), so 1 nail of a ₹150
 * add-on charges ~₹42, not ₹15.
 *
 * @param {object} p
 * @param {number} p.landedPaise      what she paid for the container
 * @param {number} p.baseQty          how much was in it (ml | g | pc)
 * @param {number} p.qtyPerNail       how much one nail consumes
 * @param {number} p.nailUnitsUsed    weighted nail-units this applies to
 * @param {number} [p.coats]          layers, for products applied in coats
 * @param {number} [p.fullSetChargePaise] her price for the full 10-nail version
 * @param {number} [p.residuePct] @param {number} [p.wastagePct]
 * @param {number} [p.fixedPct]       share of the charge that doesn't scale
 * @param {number} [p.roundToPaise]
 */
export function microUsage({
  landedPaise, baseQty, qtyPerNail, nailUnitsUsed, coats = 1,
  fullSetChargePaise = 0, residuePct = 0.05, wastagePct = 0.10,
  fixedPct = 0.20, roundToPaise = 0, referenceUnits = 10,
}) {
  const unitMicro = effectiveUnitCostMicro({ landedPaise, baseQty, residuePct, wastagePct });
  const qtyUsed = qtyPerNail * nailUnitsUsed * coats;
  const costPaise = roundPaise((qtyUsed * unitMicro) / 1e6);

  const factor = sizeFactor(nailUnitsUsed, fixedPct, referenceUnits);
  const raw = fullSetChargePaise * factor;
  const chargePaise = roundToPaise
    ? Math.round(raw / roundToPaise) * roundToPaise
    : roundPaise(raw);

  const profitPaise = chargePaise - costPaise;
  return {
    qtyUsed,
    unitCostMicro: unitMicro,
    nominalUnitMicro: nominalUnitCostMicro(landedPaise, baseQty),
    costPaise,
    chargePaise,
    profitPaise,
    marginPct: chargePaise > 0 ? (profitPaise / chargePaise) * 100 : 0,
    /** How many nails the whole container covers — the "how far does a dibbi go" answer. */
    nailsPerContainer: qtyPerNail > 0
      ? Math.floor((baseQty * (1 - residuePct)) / (qtyPerNail * coats)) : 0,
    isLoss: profitPaise < 0,
  };
}

/** Realised profitability of an actual job */
export function jobOutcome({ pricePaise, discountPaise = 0, feePct = 0, directPaise, hours }) {
  const feePaise = roundPaise((pricePaise - discountPaise) * feePct);
  const netRevenuePaise = pricePaise - discountPaise - feePaise;
  const contributionPaise = netRevenuePaise - directPaise;
  return {
    feePaise, netRevenuePaise, contributionPaise,
    contributionPerHourPaise: hours > 0 ? roundPaise(contributionPaise / hours) : 0,
    materialSharePct: netRevenuePaise > 0 ? (directPaise / netRevenuePaise) * 100 : 0,
  };
}

/** Sensitivity matrix — price across time x rate scenarios. */
export function sensitivity({ directPaise, hoursList, ratesPaise }) {
  return hoursList.map((h) => ({
    hours: h,
    cells: ratesPaise.map((r) => ({ ratePaise: r, pricePaise: roundPaise(directPaise + r * h) })),
  }));
}

/* ---------------------------------------------------------------- time --- */

/**
 * Scale a recipe's time standard to the actual size of the job
 *
 * A recipe's `minutes` is calibrated for a full set (10 nail-units). But a
 * one-hand job is not a full-length job, and 10 XL nails take longer than 10
 * short ones. Since the recommended price is rate-based, time IS the price —
 * so a flat duration would charge one hand the same as two. It doesn't.
 *
 * Part of a service genuinely doesn't scale: consultation, soaking, hand prep,
 * cleanup. That share is `fixedPct`. The rest scales linearly with nail-units,
 * which already carry the per-finger weights and the length multiplier.
 *
 *   minutes(N) = standard × (fixedPct + (1 − fixedPct) × N / 10)
 *
 * Sanity: N=10 → ×1.00 (unchanged) · N=5 → ×0.60 · N=12 (both hands, M) → ×1.16
 */
export function sizeFactor(nailUnitsValue, fixedPct = 0.20, referenceUnits = 10) {
  const p = Math.min(Math.max(fixedPct, 0), 1);
  return p + (1 - p) * (nailUnitsValue / referenceUnits);
}

export function scaledServiceMinutes(standardMinutes, nailUnitsValue, fixedPct = 0.20, referenceUnits = 10) {
  return standardMinutes * sizeFactor(nailUnitsValue, fixedPct, referenceUnits);
}

/** Total chair time in hours */
export function chairHours({ serviceMinutes, addonMinutes = 0, setupMinutes, bufferMinutes = 0 }) {
  return (serviceMinutes + addonMinutes + setupMinutes + bufferMinutes) / 60;
}

/* ------------------------------------------------------ recommendations -- */

/**
 * Rules-based, explainable recommendations
 * Every rule returns evidence + a rupee impact + a confidence from sample size.
 * Rules are suppressed below MIN_SAMPLE, and ALL price-increase rules are
 * gated by the capacity guard (R16) — because if the calendar is empty the
 * problem is demand, not price.
 */
export const MIN_SAMPLE = 5;

export function recommend({ services = [], products = [], utilisation = 1, assumptions = DEFAULT_ASSUMPTIONS }) {
  const out = [];
  const capacityConstrained = utilisation < 0.5;

  if (capacityConstrained) {
    out.push({
      id: "R16", severity: "WARN", title: "Fill the calendar before raising prices",
      explanation: `You are at ${Math.round(utilisation * 100)}% of your target billable hours. Price increases are suppressed — the constraint right now is demand, not pricing.`,
      confidence: "HIGH", impactPaise: 0,
    });
  }

  const priced = services.filter((s) => s.samples >= MIN_SAMPLE && s.hours > 0);
  const cph = priced.map((s) => s.contributionPerHourPaise).sort((a, b) => a - b);
  const median = cph.length ? cph[Math.floor(cph.length / 2)] : 0;

  for (const s of services) {
    if (s.pricePaise < s.floorPaise) {
      out.push({
        id: "R6", severity: "URGENT", entity: s.name,
        entityType: "SERVICE", entityId: s.id ?? s.name,
        title: `${s.name} is priced below its cost floor`,
        explanation: `Charging ${formatINR(s.pricePaise)} against an absorbed cost of ${formatINR(s.absorbedPaise)}. Floor is ${formatINR(s.floorPaise)}.`,
        suggestedPricePaise: s.floorPaise,
        impactPaise: (s.floorPaise - s.pricePaise) * (s.samples || 1),
        confidence: "HIGH", sample: s.samples,
      });
    } else if (!capacityConstrained && median && s.samples >= MIN_SAMPLE &&
               s.contributionPerHourPaise < median * 0.7) {
      const target = roundPaise(s.directPaise + median * s.hours);
      out.push({
        id: "R5", severity: "WARN", entity: s.name,
        entityType: "SERVICE", entityId: s.id ?? s.name,
        title: `${s.name} earns you far less per hour than the rest`,
        explanation: `${formatINR(s.contributionPerHourPaise)}/hr vs a median of ${formatINR(median)}/hr across ${priced.length} services.`,
        suggestedPricePaise: roundPrice(target, assumptions.roundToPaise, s.floorPaise),
        impactPaise: (target - s.pricePaise) * (s.samples || 1),
        confidence: s.samples >= 10 ? "HIGH" : "MED", sample: s.samples,
      });
    }
  }

  for (const p of products) {
    if (p.daysSinceUse != null && p.daysSinceUse >= 90 && p.valuePaise >= toPaise(300)) {
      out.push({
        id: "R3", severity: "INFO", entity: p.name,
        entityType: "PRODUCT", entityId: p.id ?? p.name,
        title: `${p.name} has not been used in ${p.daysSinceUse} days`,
        explanation: `${formatINR(p.valuePaise)} of stock sitting idle. Bundle it into a promo or stop repurchasing.`,
        impactPaise: p.valuePaise, confidence: "MED",
      });
    }
    if (p.daysToExpiry != null && p.daysToDeplete != null && p.daysToExpiry < p.daysToDeplete) {
      out.push({
        id: "R4", severity: "WARN", entity: p.name,
        entityType: "PRODUCT", entityId: p.id ?? p.name,
        title: `${p.name} will expire before you finish it`,
        explanation: `${p.daysToExpiry} days to expiry, but at your current rate it takes ${Math.round(p.daysToDeplete)} days to use up.`,
        impactPaise: p.valuePaise, confidence: "MED",
      });
    }
  }

  const rank = { URGENT: 0, WARN: 1, INFO: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.impactPaise - a.impactPaise);
}

export const ENGINE_VERSION = "1.0.0";
