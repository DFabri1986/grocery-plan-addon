# Design: Household members & multiple week plans

**Date:** 2026-06-22
**Project:** `grocery_plan` (Home Assistant add-on — Django + React)
**Status:** Approved design, pending implementation plan

## Problem

Today `grocery_plan` is fully singleton: one shared weekly meal plan (a single
`PlanAssignment` table keyed by day × meal_time), one derived grocery list, and
no notion of "people" or "weeks". You can only ever have *this* week, for
*everyone at once*.

We want:

- **Household members** ("people") — e.g. Sara, Kid A, Kid B.
- **Multiple calendar-dated week plans per person.**
- A **shopping-week selector**: pick one calendar week and the grocery list totals
  **every person's plan for that week** into one combined household shop.

## Decisions (from brainstorming)

1. **People = household members; one shared shop.** Each person has their own
   weekly meal plans, but the grocery list/budget combines everyone's plan for the
   selected week into a single household shop.
2. **Weeks are real calendar weeks.** Identified by their Monday (`week_start`).
   One shopping week is selected at the top; the shop totals every person's plan
   for that same week. Other weeks are separate dated plans.
3. **Same 5 meal-time slots for everyone** (Breakfast, Recess, Lunch, Dinner,
   Snacks) with the existing weekend Recess/Lunch greying. No per-person slot
   profile in this version.
4. **New weeks can start blank or copy an existing week** of that person (copy
   duplicates all meal-slot assignments, then edit).

## Architecture

### Approach chosen: explicit `WeekPlan` entity

A `WeekPlan` row represents (person + week-start). Meal assignments hang off it.
Chosen over denormalizing `person`/`week_start` onto each `PlanAssignment` because
empty weeks must be able to exist and be navigated — you "add a week, then fill
it" — and copy/delete cascade cleanly.

### Sync layer: keep full-state load + poll + diff-push

The existing `useSyncedData()` hook (`frontend/src/api.js`) loads full state once,
polls every ~3s, and pushes debounced diffs. We keep this model rather than
refetching per selection. At family scale (a few people × a handful of weeks) the
payload stays small, the client filters by selected person/week locally, and
`api.js`/`sync.js` need only minor changes.

**Trade-off:** `/api/state/` grows with the number of weeks retained. Acceptable
now; could paginate/scope by date range later if a household accumulates many
weeks. Not in scope for this version.

## Data model changes (`app/planner/models.py`)

### New: `Person`
- `name` (CharField)
- `order` (IntegerField, for display ordering)
- CRUD: add / rename / reorder / delete (delete cascades the person's WeekPlans).

### New: `WeekPlan`
- `person` (FK → Person, `on_delete=CASCADE`)
- `week_start` (DateField — the Monday of the week)
- `unique_together = (person, week_start)`

### Changed: `PlanAssignment`
- Replace its standalone identity with `week_plan` (FK → WeekPlan,
  `on_delete=CASCADE`).
- Keep `day`, `meal_time`, `meal` (FK), `order`.
- An assignment now belongs to exactly one person's week.

### Changed: `ShopState`
- Add `week_start` (DateField) so each shopping week tracks its own
  got/actual state.
- `unique_together = (week_start, key)` (key remains `f_<priceItemId>` /
  `n_<nonFoodId>` / `x_<extraId>`).
- Prevents one week's checkmarks/actuals from bleeding into another week.

### Unchanged (household-shared)
`Meal`, `MealIngredient`, `PriceItem`, `Supplier`, `NonFoodEssential`, `Extra`,
`Settings`. Meals + the price book are one shared library. Non-food essentials
and extras stay household-level standing lists, shown for whichever week is being
shopped (confirmed: not per-week).

## Migration

Data migration to preserve existing singleton data:

1. Create one default `Person` named "Household".
2. Compute the current week's Monday (for 2026-06-22 that is 2026-06-22).
3. Create a `WeekPlan(person=Household, week_start=current Monday)`.
4. Repoint all existing `PlanAssignment` rows onto that `WeekPlan`.
5. Set `week_start = current Monday` on all existing `ShopState` rows.

Result: existing plan and shopping state land intact as the Household person's
current week.

## API (`views.py`, `urls.py`, `serializers.py`)

- **`/api/people/`** — CRUD (list, create, rename, reorder, delete).
- **`/api/weeks/`** — list weeks (filterable by person); create **blank**, or
  create by **copy** via `?copy_from=<weekplan_id>` (duplicates all that week's
  `PlanAssignment` rows into the new week); delete.
- **Assignment endpoints** scoped to a `week_plan` (add/move/remove a meal in a
  given person's week).
- **`/api/state/`** extended to include people, their weeks, and assignments
  (so the client can filter locally).
- **`/api/shop/`** aggregates food across **all people** for a given
  `week_start`, plus non-food essentials and extras, with per-week shop state.

Serializers continue to map snake_case ↔ camelCase for the React client, matching
the existing convention.

## Frontend (`frontend/src/GroceryPlanner.jsx` + sync)

- **Global shopping-week selector** in the header (prev / next / date picker),
  expressed as a `week_start` Monday. Drives both tabs.
- **Week Plan tab:**
  - **Person switcher** + an "Add person" / manage-people control.
  - Shows the selected person's grid for the selected week.
  - **"Add week"** → choose blank or copy-from-existing (that person's weeks).
  - Same 5 slots for everyone; weekend Recess/Lunch greying retained.
- **Grocery Plan tab:** totals every person's plan for the selected week into the
  one household shop; got/actual scoped to that week's `ShopState`.
- **Meals / Prices tabs:** unchanged (shared library + price book).
- `api.js`/`sync.js`: include person/week dimensions in the synced state and
  diff-push; client-side filtering by selected person/week.

## Error handling / edge cases

- **No people yet:** prompt to add the first person; Week Plan tab shows an empty
  state.
- **Selected week with no plans for anyone:** grocery list is empty (plus any
  standing non-food/extras).
- **Delete a person:** cascade their WeekPlans + assignments; shop recomputes.
- **Delete a week:** removes that WeekPlan + its assignments only.
- **Copy-week:** meals referenced are shared, so duplicated assignments resolve
  fine; only `PlanAssignment` rows are copied (not a new WeekPlan's shop state).
- **Switching shopping week:** shop view + got/actual reflect that week only.

## Testing

**Model / migration**
- `WeekPlan` uniqueness per (person, week_start); cascade deletes (person → weeks →
  assignments).
- Migration repoints existing `PlanAssignment` and `ShopState` onto the Household
  person's current week.

**API**
- People CRUD.
- Create week blank vs copy (copy duplicates assignments; blank is empty).
- Shop aggregation sums food across all people for a given week.
- Shop state isolated per week (got/actual on one week doesn't affect another).

**Frontend**
- Switching person/week shows the correct grid.
- Shopping-week selector totals all people for that week.
- Checkmarks/actuals don't leak across weeks.

## Out of scope (this version)

- Per-person meal-time profiles (adult vs school-kid slots).
- Per-week non-food essentials / extras.
- State pagination / date-range scoping of `/api/state/`.
- Any per-user authentication (Home Assistant Ingress remains the security
  boundary; "people" are plan owners, not login accounts).
