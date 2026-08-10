/* ==========================================================================
   SEED LIBRARY — East Delhi starter kit
   --------------------------------------------------------------------------
   MARKET: freelance / home-based nail artist in East Delhi (Laxmi Nagar,
   Preet Vihar, Mayur Vihar, Shahdara). Clients earning ₹25–35k/month treat a
   nail appointment as an occasional ₹500–1,500 treat, not a routine spend.

   • Product prices  — local supplier / Amazon India street prices.
   • `myPrice`       — HER starting price, the number the app actually uses.
                       Fully editable; this is a sensible opening position for
                       this locality, not a recommendation she must follow.
   • `marketLow/High`— what artists around East Delhi actually charge, so the
                       app can flag "you're under the local floor" honestly.

   Every one of these is editable in the app. They exist so the first screen
   she opens is useful instead of empty.
   ========================================================================== */

import { toPaise, COST_CLASS, BASIS, COATS_MODEL } from "./engine.mjs";

const P = (name, o) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  costClass: COST_CLASS.METERED,
  baseUnit: "ML",
  residuePct: 0.05,
  usesPerItem: 1,
  ...o,
});

export const PRODUCTS = [
  // ---- prep -------------------------------------------------------------
  P("Nail Dehydrator",   { category: "Prep",      brand: "Local",   landedPaise: toPaise(180), baseQty: 15,  pack: "15 ml bottle" }),
  P("Acid-Free Primer",  { category: "Prep",      brand: "Local",   landedPaise: toPaise(200), baseQty: 15,  pack: "15 ml bottle" }),
  P("Rubber Base Coat",  { category: "Gel",       brand: "Mid",     landedPaise: toPaise(280), baseQty: 15,  pack: "15 ml bottle" }),
  P("Gel Colour",        { category: "Gel",       brand: "Mid",     landedPaise: toPaise(180), baseQty: 15,  pack: "15 ml bottle", shade: "#C2185B" }),
  P("No-Wipe Top Coat",  { category: "Gel",       brand: "Mid",     landedPaise: toPaise(300), baseQty: 15,  pack: "15 ml bottle" }),
  P("Gel Cleanser",      { category: "Consumable",brand: "Local",   landedPaise: toPaise(150), baseQty: 100, pack: "100 ml" }),
  P("Acetone",           { category: "Consumable",brand: "Local",   landedPaise: toPaise(120), baseQty: 500, pack: "500 ml" }),

  // ---- extensions -------------------------------------------------------
  P("Builder Gel",       { category: "Builder",   brand: "Mid",     landedPaise: toPaise(550), baseQty: 30, baseUnit: "G",
                           pack: "30 g jar", isBuilder: true, densityGPerMl: 1.05 }),
  P("Soft Gel Tips",     { category: "Extension", brand: "Local",   landedPaise: toPaise(350), baseQty: 500, baseUnit: "PC",
                           pack: "box of 500", costClass: COST_CLASS.DISCRETE, residuePct: 0 }),
  P("Slip Solution",     { category: "Extension", brand: "Local",   landedPaise: toPaise(200), baseQty: 100, pack: "100 ml" }),

  // ---- art & accessories ------------------------------------------------
  P("Chrome Powder",     { category: "Art",       brand: "Mid",     landedPaise: toPaise(250), baseQty: 3, baseUnit: "G", pack: "3 g jar" }),
  P("Rhinestones",       { category: "Accessory", brand: "Local",   landedPaise: toPaise(250), baseQty: 1000, baseUnit: "PC",
                           pack: "1000 pc", costClass: COST_CLASS.DISCRETE, residuePct: 0 }),
  P("Bonding Gel",       { category: "Accessory", brand: "Mid",     landedPaise: toPaise(200), baseQty: 8,  pack: "8 ml" }),
  P("Nail Art Paint",    { category: "Art",       brand: "Local",   landedPaise: toPaise(350), baseQty: 12, pack: "12 ml set" }),

  // ---- disposables ------------------------------------------------------
  P("Lint-Free Wipes",   { category: "Consumable",brand: "Local",   landedPaise: toPaise(120), baseQty: 200, baseUnit: "PC",
                           pack: "200 pc", costClass: COST_CLASS.DISCRETE, residuePct: 0 }),
  P("Nitrile Gloves",    { category: "Consumable",brand: "Local",   landedPaise: toPaise(350), baseQty: 100, baseUnit: "PC",
                           pack: "100 pairs", costClass: COST_CLASS.DISCRETE, residuePct: 0 }),
  P("Nail File 180/240", { category: "Tool",      brand: "Local",   landedPaise: toPaise(15),  baseQty: 1, baseUnit: "PC",
                           pack: "each", costClass: COST_CLASS.DISCRETE, residuePct: 0, wastagePct: 0, usesPerItem: 3 }),
  P("Buffer Block",      { category: "Tool",      brand: "Local",   landedPaise: toPaise(25),  baseQty: 1, baseUnit: "PC",
                           pack: "each", costClass: COST_CLASS.DISCRETE, residuePct: 0, wastagePct: 0, usesPerItem: 5 }),
  P("E-File Bit",        { category: "Tool",      brand: "Mid",     landedPaise: toPaise(450), baseQty: 1, baseUnit: "PC",
                           pack: "each", costClass: COST_CLASS.DISCRETE, residuePct: 0, wastagePct: 0, usesPerItem: 150 }),
];

export const DURABLES = [
  { id: "lamp",  name: "LED/UV Lamp 48W",  costPaise: toPaise(2200), salvagePaise: 0, basis: "SERVICES", lifeUnits: 1500 },
  { id: "brush", name: "Brush Set",        costPaise: toPaise(700),  salvagePaise: 0, basis: "SERVICES", lifeUnits: 300  },
  { id: "efile", name: "E-File Handpiece", costPaise: toPaise(2800), salvagePaise: 0, basis: "SERVICES", lifeUnits: 2000 },
];

const L = (productId, qtyPerBasis, basis, coatsModel, extra = {}) =>
  ({ productId, qtyPerBasis, basis, coatsModel, ...extra });

/** Recipes: bill-of-materials + a time standard + HER starting price. */
export const SERVICES = [
  {
    id: "gel-mani", name: "Gel Manicure", kind: "SERVICE", scope: "FULL_SET",
    minutes: 75, defaultCoats: 2,
    myPrice: 700, marketLow: 500, marketHigh: 1200,
    durables: ["lamp", "brush"],
    lines: [
      L("nail-dehydrator", 0.03, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("acid-free-primer",0.02, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("rubber-base-coat",0.05, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("gel-colour",      0.06, BASIS.PER_NAIL,    COATS_MODEL.LINEAR),
      L("no-wipe-top-coat",0.06, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("gel-cleanser",    2.00, BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("lint-free-wipes", 8,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("nitrile-gloves",  1,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("nail-file-180-240",1,   BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("buffer-block",    1,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("e-file-bit",      1,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
    ],
  },
  {
    id: "soft-gel-set", name: "Soft Gel Extension Set", kind: "SERVICE", scope: "FULL_SET",
    minutes: 150, defaultCoats: 2,
    myPrice: 1500, marketLow: 1200, marketHigh: 2500,
    durables: ["lamp", "brush", "efile"],
    lines: [
      L("nail-dehydrator", 0.03, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("acid-free-primer",0.02, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("soft-gel-tips",   1,    BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("builder-gel",     0.35, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("slip-solution",   0.15, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("gel-colour",      0.06, BASIS.PER_NAIL,    COATS_MODEL.LINEAR),
      L("no-wipe-top-coat",0.06, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("gel-cleanser",    3.00, BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("lint-free-wipes", 12,   BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("nitrile-gloves",  1,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("nail-file-180-240",2,   BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("buffer-block",    1,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("e-file-bit",      2,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
    ],
  },
  {
    id: "refill", name: "Extension Refill", kind: "SERVICE", scope: "FULL_SET",
    minutes: 105, defaultCoats: 2,
    myPrice: 1000, marketLow: 800, marketHigh: 1600,
    durables: ["lamp", "brush", "efile"],
    lines: [
      L("builder-gel",     0.22, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("acid-free-primer",0.02, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("gel-colour",      0.06, BASIS.PER_NAIL,    COATS_MODEL.LINEAR),
      L("no-wipe-top-coat",0.06, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("gel-cleanser",    2.50, BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("lint-free-wipes", 10,   BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("nitrile-gloves",  1,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("e-file-bit",      2,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
    ],
  },
  {
    id: "removal", name: "Soak-Off Removal", kind: "REMOVAL", scope: "FULL_SET",
    minutes: 25, defaultCoats: 1,
    myPrice: 250, marketLow: 150, marketHigh: 400,
    durables: ["efile"],
    lines: [
      L("acetone",         6,    BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("lint-free-wipes", 12,   BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("nitrile-gloves",  1,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("nail-file-180-240",1,   BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("e-file-bit",      1,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
    ],
  },

  // ---- ADD-ONS ----------------------------------------------------------
  {
    id: "chrome", name: "Chrome Finish", kind: "ADDON", scope: "PER_NAIL",
    minutes: 10, defaultCoats: 1, myPrice: 150, marketLow: 100, marketHigh: 300, durables: [],
    lines: [
      L("chrome-powder",   0.02, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("no-wipe-top-coat",0.04, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("lint-free-wipes", 4,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
    ],
  },
  {
    id: "stones", name: "Rhinestones (20)", kind: "ADDON", scope: "PER_NAIL",
    minutes: 12, defaultCoats: 1, myPrice: 150, marketLow: 100, marketHigh: 300, durables: [],
    lines: [
      L("rhinestones",     20,   BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("bonding-gel",     0.15, BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
      L("no-wipe-top-coat",0.02, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
    ],
  },
  {
    id: "french", name: "French Tips", kind: "ADDON", scope: "PER_NAIL",
    minutes: 25, defaultCoats: 1, myPrice: 200, marketLow: 150, marketHigh: 400, durables: [],
    lines: [
      L("gel-colour",      0.04, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("nail-art-paint",  0.02, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("lint-free-wipes", 3,    BASIS.PER_SERVICE, COATS_MODEL.PER_SERVICE),
    ],
  },
  {
    id: "art-3d", name: "3D / Hand-Painted Art", kind: "ADDON", scope: "PER_NAIL",
    minutes: 35, defaultCoats: 1, myPrice: 300, marketLow: 250, marketHigh: 700, durables: [],
    lines: [
      L("nail-art-paint",  0.06, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("builder-gel",     0.08, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("no-wipe-top-coat",0.03, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
    ],
  },
  {
    id: "cat-eye", name: "Cat Eye Effect", kind: "ADDON", scope: "PER_NAIL",
    minutes: 8, defaultCoats: 1, myPrice: 120, marketLow: 100, marketHigh: 250, durables: [],
    lines: [
      L("gel-colour",      0.05, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
      L("no-wipe-top-coat",0.02, BASIS.PER_NAIL,    COATS_MODEL.FIXED_PER_NAIL),
    ],
  },
  {
    id: "ombre", name: "Ombré / Gradient", kind: "ADDON", scope: "PER_NAIL",
    minutes: 20, defaultCoats: 3, myPrice: 200, marketLow: 150, marketHigh: 350, durables: [],
    lines: [
      L("gel-colour",      0.05, BASIS.PER_NAIL, COATS_MODEL.FIRST_FULL_REST_PARTIAL, { partialAlpha: 0.6 }),
      L("no-wipe-top-coat",0.02, BASIS.PER_NAIL, COATS_MODEL.FIXED_PER_NAIL),
    ],
  },
];

/** Her opening price list, in paise, keyed by service id. Fully editable. */
export const DEFAULT_PRICES = Object.fromEntries(
  SERVICES.map((s) => [s.id, toPaise(s.myPrice)]),
);

/** Join a service's recipe lines to real product records. */
export function hydrate(service, products = PRODUCTS, durables = DURABLES) {
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  return {
    lines: service.lines
      .map((l) => ({ ...l, product: byId[l.productId] }))
      .filter((l) => l.product),
    durables: durables.filter((d) => (service.durables || []).includes(d.id)),
  };
}
