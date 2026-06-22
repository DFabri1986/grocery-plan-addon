# Changelog

## 1.5.0 — 2026-06-22

- **People & multiple week plans.** Add household members, each with their own
  calendar-dated week plans.
- **Shopping-week selector.** Pick a week; the grocery list totals every
  person's plan for that week into one household shop.
- New weeks start blank or copy an existing week.
- Got/actual shopping state is now tracked per week.

## 1.4.0 — 2026-06-19

- **Prices always show 2 decimal places** (budget, price book, extras, import
  review) — values format to e.g. `3.30` when not being edited.
- **Deduplicate** button on the Prices tab: merges price-book items with
  identical names, repointing meal-ingredient and non-food references to the
  kept item so nothing breaks.
- **Price refresh polls both Woolworths and Coles** and shows each price as a
  tappable chip — tap one to set that price and supplier. The item's current
  supplier price is auto-applied when found.

## 1.3.0 — 2026-06-18

- **Price book sorting & filtering:** click any column header on the Prices tab
  to sort (toggle asc/desc), and use the filter bar to search by name and
  filter by category, food/non-food, and supplier (incl. "Unassigned"), with a
  live "showing X of Y" count and a Clear button.

## 1.2.0 — 2026-06-18

- **Shop by supplier:** the Grocery Plan now has a "what to buy where"
  breakdown — planned food, non-food and extras grouped by supplier, each with
  a remaining-to-buy subtotal and a one-tap copy of that shop's list.
- **Refresh current price:** a button next to each price on the Prices tab does
  a best-effort live lookup from the item's supplier (Coles or Woolworths) and
  updates the price. Best-effort only — the vendors bot-protect their sites, so
  it can come back "no match"; it works from the add-on's home-network IP.

## 1.1.0 — 2026-06-18

- **Import from receipts:** new *Import receipt* button on the Prices tab.
  Upload one or more Coles or Woolworths order PDFs; they're parsed
  (`pdftotext`), de-duplicated, categorised and priced, then shown in a review
  table where you can edit/exclude rows before importing into the price book.
  Existing items update in place; new ones are created.
- **Suppliers:** a supplier list (seeded with Coles, Woolworths, Who Gives A
  Crap) with a per-item supplier you can pick on the Prices tab and directly on
  the Grocery Plan (food, non-food and extras). Imported items get their
  supplier set automatically from the receipt's vendor.
- Added `poppler-utils` to the image for PDF text extraction.

## 1.0.3 — 2026-06-17

- Show the unit of measurement next to quantities on the Grocery Plan, so
  "Apples / bananas 1.9" reads "1.9 kg" rather than being ambiguous. Units also
  appear on the non-food list and in the copied shopping list.
- Remove the deprecated `build.yaml` and set the base image directly in the
  Dockerfile (a multi-arch `base-python` manifest; the Supervisor's `--platform`
  picks the right arch). Clears the "build.yaml is deprecated" warning and
  follows the current Home Assistant convention.

## 1.0.2 — 2026-06-17

- Grocery list quantities now round **up** to whole shopping units (you can't
  buy 2.7 loaves of bread → 3), and the estimated cost and budget totals use
  the rounded quantity. Loose weight/volume units (kg, g, L, mL) stay
  fractional. The "food spend by meal time" breakdown is split proportionally
  so it still adds up to the food total.

## 1.0.1 — 2026-06-17

- Fix Docker build failure on install: declare `ARG BUILD_FROM` as a global
  build arg (before the first `FROM`) so it is in scope for the runtime stage's
  `FROM` in the multi-stage build. Previously the build failed with
  "base name (${BUILD_FROM}) should not be blank".
- Point `url` at the real repository.

## 1.0.0 — 2026-06-17

Initial release.

- Django + DRF backend with a SQLite database in `/data`.
- Models mirroring the original React data shape: Settings, PriceItem, Meal,
  MealIngredient, PlanAssignment, NonFoodEssential, Extra, ShopState.
- Granular DRF ModelViewSets plus a one-call `GET /api/state/` assembler and
  bulk `week`/`shop` endpoints.
- React (Vite) frontend reusing the original UI and grocery aggregation, with
  the storage layer replaced by the REST API: loads the whole state, polls for
  other users' changes (configurable interval), and pushes optimistic granular
  edits. Last write wins.
- Automatic migrations and first-run seeding of example data on container
  start.
- django-unfold-themed admin, reachable only through the add-on.
- Full Home Assistant Ingress support (relative assets, `X-Ingress-Path` →
  `SCRIPT_NAME`); no public port and no app-level auth.
- User-tunable options: `currency_symbol`, `poll_interval`, `default_period`,
  `log_level`.
- Multi-arch: `aarch64` and `amd64`.
