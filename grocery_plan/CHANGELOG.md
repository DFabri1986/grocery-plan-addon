# Changelog

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
