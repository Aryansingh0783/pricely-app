<div align="center">

# Pricely

**Nail studio inventory, pricing and profit tracking for a freelance nail artist.**

A single-file progressive web app. No backend, no accounts, no analytics, no
database, and no build tooling beyond Node. Data lives on the device; the app
works offline and installs to an iPhone Home Screen.

[![Tests](https://github.com/Aryansingh0783/pricely-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Aryansingh0783/pricely-app/actions/workflows/ci.yml)
[![Deploy](https://github.com/Aryansingh0783/pricely-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/Aryansingh0783/pricely-app/actions/workflows/deploy.yml)
![Tests: 144](https://img.shields.io/badge/tests-144%20passing-C9184A)
![No backend](https://img.shields.io/badge/backend-none-2B1A1F)
![License](https://img.shields.io/badge/license-MIT-2B1A1F)

</div>

---

## Why

Freelance nail artists price by feel. Material cost is easy to guess at and
almost always wrong — a gel manicure uses about ₹79 of product but takes 90
minutes of chair time, so the price is set by the hours, not the bottle.

Pricely does three things:

1. **You set your prices.** The app never overwrites them. It explains the
   margin on the number you chose, and shows a recommended price only if you
   ask for one.
2. **It costs partial work properly.** Chrome on one accent nail is a real sale
   with a real cost. Tap the nails it goes on and the price follows.
3. **It learns what you actually use.** You never enter grams. Either say roughly
   how many clients a pot lasts, or keep logging jobs and let the app work it
   out when the pot runs out.

Prices are calibrated for East Delhi — a home-based artist whose clients earn
₹25–35k a month. All of it is editable.

---

## Screens

Bottom tab bar on mobile, sidebar on desktop at 1024 px and up.

- **Today** — this week's revenue, ₹/chair-hour, contribution and material %.
  Rule-based alerts, each with a **Fix** button that jumps straight to the row
  that needs changing. Recent jobs.
- **Quote** — answer an enquiry fast. Service chips, ten-nail picker, length
  XS–XL, coats stepper, add-on chips showing their own price delta, live price,
  a *Where it goes* breakdown, and copy-to-WhatsApp.
- **Pricing & Cost Calculation** — two views. *Calculate & log* is the job flow:
  nail picker, per-add-on nail assignment, live micro-usage cost/charge/margin,
  timer, payment method, save. *My price list* is every service and add-on with
  price, minutes and material cost, all editable, with per-client vs per-hour
  mode and opt-in recommended prices.
- **Dashboard** — week/month/all filter, KPI cards, ₹/hr trend, revenue by
  service, payment split, backup export, reset stats.
- **Stock** — 19 products showing effective vs sticker cost per unit, the usage
  discovery flow, custom item entry, equipment amortisation.
- **Insights** — every service and add-on ranked by contribution per chair-hour.
- **Assumptions** — income target, billable hours, overhead pool, residue,
  wastage, setup time, fixed-time share.

---

## The pricing model

Three ideas carry the whole thing.

### A. Her prices are the input, not the output

She sets every price. The app explains the margin on *her* number rather than
replacing it. A recommended price exists, but it sits behind a toggle and never
applies itself — only an explicit **Use ₹X** tap changes anything.

### B. Time is the price, materials are not

A gel manicure uses about ₹79 of product and 90 minutes of chair time. Marking
up material cost would suggest ₹200; the real market price is ₹700–850. So the
recommendation is rate-based:

```
price              = direct materials + (chair hours × target hourly rate)
target hourly rate = (monthly take-home + overhead) ÷ billable hours
```

Cost-plus and margin-target figures are shown for comparison only. The headline
metric is **₹ contribution per chair-hour**, not margin percentage — margin
reads 80–95% on everything in this trade and therefore ranks nothing.

### C. Partial work is a first-class case

Chrome on one accent nail is a real sale. Material cost scales linearly with
nails; the charge does not, because setup, cure and attention don't shrink.

```
size factor = fixedPct + (1 − fixedPct) × nailUnits / 10        (fixedPct = 0.20)
```

One nail of a ₹150 add-on therefore charges about ₹42, not ₹15.

**Nail-units** weight each finger by nail-plate area, normalised so one hand is
exactly 5.00:

| Thumb | Index | Middle | Ring | Pinky |
|---|---|---|---|---|
| 1.30 | 0.95 | 1.05 | 0.95 | 0.75 |

Length multiplies on top: XS 0.80 · S 1.00 · M 1.20 · L 1.45 · XL 1.75. Longer
nails take more product *and* more time.

**Effective unit cost** corrects the naive "price ÷ volume":

```
effective = (landed ÷ quantity) ÷ [(1 − residue) × (1 − wastage)]
```

Defaults: 5% unreachable residue, 10% wastage on gel and polish, 15% on builder.

---

## Usage discovery

She never weighs anything. The app works out consumption from three sources, and
tags every figure on screen so she always knows how much to trust it:

1. **DEFAULT** — a documented starting figure. Honest, but generic.
2. **ESTIMATED** — she answers *"how many clients does one pot last?"*, which
   every artist knows from memory. The app does the division.
3. **CALIBRATED** — every job banks nail-units against each product. When a pot
   runs out she taps *this is finished* and real consumption falls out
   arithmetically, with nothing measured.

A thin sample (under 30 nails logged) or a wild result (over 200% drift)
**stops and asks** rather than overwriting a sane figure.

> Worked example: a ₹250 / 3 g chrome pot is ₹97.47/g effective. At 0.02 g per
> nail that is ₹1.95 of chrome per nail, and the pot covers roughly 142 nails.

---

## Seeded data

**Starting price list**

| Service | Price | | Add-on | Price |
|---|---:|---|---|---:|
| Gel Manicure | ₹700 | | Chrome Finish | ₹150 |
| Soft Gel Extension Set | ₹1,500 | | Rhinestones (20) | ₹150 |
| Extension Refill | ₹1,000 | | French Tips | ₹200 |
| Soak-Off Removal | ₹250 | | 3D / Hand-Painted Art | ₹300 |
| | | | Cat Eye Effect | ₹120 |
| | | | Ombré / Gradient | ₹200 |

**Default assumptions**

| | |
|---|---|
| Monthly take-home target | ₹20,000 |
| Billable hours per month | 48 (about 11 clients a week) |
| Overhead pool | ₹5,000 (home-based) |
| Implied target rate | **₹521/hr** |
| Hourly rate (hourly mode) | ₹450/hr |
| Setup + cleanup | 15 min per client |
| Fixed share of service time | 20% |
| Price rounding | ₹50 |
| Price floor | absorbed cost × 1.15 |

Plus 19 products at local supplier prices and three pieces of equipment
amortised over their expected service life.

**What the numbers turned up:** add-ons are the best-paid work she does — cat
eye at ₹875/hr, chrome at ₹761/hr — and removal is the worst at ₹318/hr.
Removal is also the one she most often gives away free.

---

## Running it

The built app is a single HTML file with no dependencies.

```bash
node build.mjs        # writes dist/index.html
```

Open `dist/index.html` in a browser. That's it — it works from `file://`.

### Tests

144 tests, all passing.

```bash
npm test              # 59 engine tests, no dependencies
npm install           # jsdom, for the UI suite only
npm run test:ui       # 85 UI tests against the built file
npm run test:all      # build, then both suites
```

- **59 engine tests** — golden fixtures for every worked example above; property
  tests (500 random money allocations always sum exactly, 2,000 random
  price/floor pairs never breach the floor); and invariants (cost never
  negative, effective cost always at least sticker cost, one hand always exactly
  5.00 nail-units).
- **85 UI tests** — every control on every screen clicked and asserted, plus a
  regression test pinning each shipped bug: the theme-flip, the tap wobble, the
  lost nail selection, the undismissable install banner, the flat one-hand price.

---

## Layout

```
src/tokens.css         design tokens — colour, type, spacing, elevation
src/app.css            component styles
src/engine.mjs         pricing and costing. Pure: no DOM, no storage, no network
src/seed.mjs           starter product and service library
src/app.js             UI shell
src/app.template.html  page shell, manifest links, iOS install hint
build.mjs              inlines everything into one self-contained file
test/                  engine and UI suites
public/                manifest and service worker, copied verbatim
netlify-deploy/        host config for a drag-and-drop Netlify deploy
```

The engine is deliberately isolated. It takes numbers and returns numbers, so it
can be tested exhaustively and reused on a server later without change. The UI
does no arithmetic — search `app.js` for a multiplication on a rupee value and
you won't find one.

Money is stored as integer paise throughout. There is no floating-point money
anywhere in the codebase.

**Engine API.** 47 exports, reachable in the browser as `NS.*`. The ones worth
knowing: `costJob`, `proposePrices`, `composePrice`, `priceHealth`, `microUsage`,
`nailUnits`, `sizeFactor`, `calibrateUsage`, `usagePerNailFromLife`, `jobOutcome`,
`recommend`, `formatINR`.

---

## Notes for anyone touching the code

**Full re-render on every tap.** `#app.innerHTML` is replaced on each
interaction. The consequences are already handled:

- Scroll position, focus and caret are saved and restored around the swap.
- Transitions freeze for two frames (`.no-motion`) so the element under a
  pressed finger doesn't animate as it is rebuilt — that was a visible wobble.
- Entrance animations run once per screen via `IntersectionObserver`, never on
  re-render, with a 1.2 s safety net so content can never stay hidden.
- The running timer patches a single text node instead of re-rendering.

**One delegated click handler.** Every control declares `data-act="<action>"`
with an optional `data-val`, scoped inside `#app`. Nothing outside `#app` may use
`data-act` — an earlier version delegated over `[data-theme]`, which `<html>`
carries for theming, so every stray tap flipped the theme.

**No `transition: all` anywhere.** It animates layout properties. The sticky
header animates its shadow only; animating its padding reflowed the page.

**Accessibility.** `prefers-reduced-motion` disables all motion while keeping
content visible. Nails are `role="switch"` with state in their labels. Touch
targets are 44 px or larger. Hover styling sits behind
`@media (hover: hover) and (pointer: fine)` so touch devices never inherit a
stuck hover.

---

## Brand

Sampled directly from the logo artwork.

| Token | Hex | Use |
|---|---|---|
| Pink | `#C9184A` | Accent — buttons, active states, the mark |
| Plum | `#2B1A1F` | App-icon tile, inverse cards, primary buttons |
| Cream | `#FBF7F3` | Page ground |
| Blush | `#F7C6D1` | Mark on the dark tile |
| Ink | `#2E1B22` | Body text, and the tint in every shadow |

Wordmark in **Playfair Display Bold**, tagline *NAIL STUDIO INVENTORY* in
letterspaced pink caps, body in **Inter**. The icon mark is a serif ₹ glyph in
blush on the plum tile, used for the favicon, the iOS touch icon and both PWA
icons.

Shadows are three-layer stacks tinted with the ink rather than pure black —
black over cream desaturates to a muddy grey. Surfaces carry a 1px top sheen.

---

## Deploying

The app is static, so any host works.

**GitHub Pages** — `.github/workflows/deploy.yml` runs both test suites, builds,
and publishes `dist/` on every push to `main`. Enable it once under
Settings → Pages → Source → GitHub Actions.

**Netlify / Cloudflare Pages** — run `node build.mjs`, then drag `dist/` onto
app.netlify.com/drop, or upload it under Cloudflare Pages. The `netlify-deploy/`
folder carries the cache headers and site config; see
[`netlify-deploy/DEPLOY.md`](netlify-deploy/DEPLOY.md).

HTTPS is required for the service worker and for Add to Home Screen; all three
hosts provide it automatically.

### Installing on iPhone

Open the URL in Safari, tap Share, then Add to Home Screen. It runs full-screen
and works offline.

---

## Data

Everything is stored in the browser's `localStorage`, per device, under three
keys — `nsos.v1` (the main record), `nsos.theme`, and `nsos.coach`.

**Nothing leaves the device.** The deployed app makes exactly two third-party
requests, both to Google Fonts. No API calls, no telemetry, no tracking, no
error reporting, no CDN scripts.

Clearing website data erases everything. Use **Dashboard → Export backup**
regularly — it is the only safety net.

---

## Known limitations

- **The service worker precaches the shell, not the fonts.** On a genuinely
  offline launch, Playfair Display falls back to Georgia and the wordmark shifts
  slightly. The app stays fully functional; only the typeface changes. Fixing it
  means self-hosting the two fonts (~60 KB) or dropping to system fonts.
- **Data lives on one device with no sync.** The export button is the only
  safety net, and this is the biggest open risk in the design.

---

## Deliberately not built

Purchases and lot tracking, the inventory movement ledger, client records,
expenses, the owner-capital ledger, cloud sync, bookings, invoices, and most of
the recommendation rule set.

The architecture anticipates all of them: job records are append-only, and every
saved job carries a frozen snapshot of the cost basis it was priced with — so
editing an assumption never rewrites history.

---

## Licence

MIT. See [LICENSE](LICENSE).
