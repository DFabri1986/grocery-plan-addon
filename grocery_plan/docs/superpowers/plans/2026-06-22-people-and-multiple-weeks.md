# People & Multiple Week Plans — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `grocery_plan` from a single shared week into household members, each with multiple calendar-dated week plans, where a selected shopping week totals every person's plan into one household grocery list.

**Architecture:** New `Person` and `WeekPlan` Django models; `PlanAssignment` hangs off a `WeekPlan`; `ShopState` gains a `week_start` so each calendar week tracks its own got/actual. The React state grows `people`, `weeks`, `plans` (grid keyed by week id) and `shop` (got/actual keyed by week-start). The full-state load + poll + diff-push sync model is kept; the diff engine is extended for the new entities. New weeks copy by cloning the source grid **client-side** (no server copy endpoint).

**Tech Stack:** Django 5.1.4 + DRF 3.15.2 (SQLite), React 18 + Vite 6 + Tailwind 4, deployed as a Home Assistant add-on (Docker).

## Global Constraints

- Python deps frozen at `app/requirements.txt` versions (Django==5.1.4, djangorestframework==3.15.2, django-unfold==0.43.0, whitenoise==6.8.2, gunicorn==23.0.0). Do not add backend deps.
- Frontend deps: React 18.3.1, lucide-react, Tailwind 4, Vite 6. Add **vitest** as a devDependency for unit-testing the pure `sync.js` module only.
- Serializer field names are **camelCase** to match the React shape (`personId`, `weekStart`, `mealTime`, `itemId`, `supplierId`, `isFood`).
- Decimals are returned as floats in `build_state` (via `_f`), and `COERCE_DECIMAL_TO_STRING = False` is set — keep numbers as numbers in JSON.
- All URLs run behind Home Assistant Ingress; client derives paths from `window.location`. Do not hardcode absolute API paths.
- `week_start` is the **Monday** of a week, represented as an ISO date string `"YYYY-MM-DD"` in JSON and a `DateField` in the DB.
- Same 5 meal-time slots for everyone (`Breakfast, Recess, Lunch, Dinner, Snacks`); weekend Recess/Lunch greying retained. No per-person slot profile.
- Meals, price book, suppliers, non-food essentials and extras stay household-shared (not per-person, not per-week). Only the meal-slot grid (per person+week) and got/actual (per week) carry the new dimensions.

---

## File Structure

**Backend (`app/planner/`)**
- `models.py` — add `Person`, `WeekPlan`; rework `PlanAssignment` (FK → WeekPlan), `ShopState` (+`week_start`).
- `serializers.py` — add `PersonSerializer`, `WeekPlanSerializer`; update `ShopStateSerializer`.
- `views.py` — rewrite `build_state()`; add `PersonViewSet`, `WeekPlanViewSet` (+`plan` detail action); rework `ShopView` (per-week); drop standalone `WeekView`.
- `urls.py` — register `people`, `weeks`; keep `shop`.
- `seed.py` — seed a default `Person` + current `WeekPlan`, assignments under it.
- `admin.py` — register `Person`, `WeekPlan`; update `PlanAssignment`/`ShopState` admins.
- `migrations/0004_people_and_weeks.py` — schema migration (new tables + field changes).
- `migrations/0005_migrate_existing_plan.py` — data migration (existing data → Household + current week).
- `tests.py` — Django `TestCase`s for models, migration invariants, and API.

**Frontend (`frontend/src/`)**
- `sync.js` — extend `pushDiff`/`applyIdMap` for `people`, `weeks`, `plans`, `shop`.
- `sync.test.js` — vitest unit tests for the new sync logic (NEW).
- `api.js` — update `EMPTY` shape.
- `GroceryPlanner.jsx` — selected-week + selected-person state, week navigator, person switcher, add/copy week, person management, cross-person grocery aggregation, per-week shop accessors, per-person/week grid.
- `package.json` — add `vitest` devDependency + `test` script.

**Deploy**
- `config.yaml` — bump `version`.
- `CHANGELOG.md` — add release notes.
- `frontend/dist/` — production build output (built by Docker; built locally only to verify).

---

## State shape (the contract every task shares)

`GET /api/state/` and the React `data` object both use this shape after this change:

```js
{
  budget: 0, period: "Week",
  priceBook: [{ id, item, price, unit, category, isFood, supplierId }],
  meals: [{ id, name, mealTime, items: [{ itemId, qty }] }],
  nonFood: [{ id, itemId, qty }],
  extras: [{ id, item, qty, price, supplierId }],
  suppliers: [{ id, name }],
  people: [{ id, name, order }],
  weeks: [{ id, personId, weekStart }],          // weekStart = "YYYY-MM-DD" (a Monday)
  plans: { [weekId]: { [day]: { [mealTime]: [mealId, ...] } } },
  shop:  { [weekStart]: { actuals: { [key]: number }, got: { [key]: true } } },
}
```

- `key` inside `shop` is still `f_<priceItemId>` / `n_<nonFoodId>` / `x_<extraId>`.
- The old top-level `week`, `actuals`, `got` are **removed**.

---

### Task 1: Person & WeekPlan models + schema migration

**Files:**
- Modify: `app/planner/models.py`
- Create: `app/planner/migrations/0004_people_and_weeks.py` (via makemigrations)
- Create/Modify: `app/planner/tests.py`

**Interfaces:**
- Produces: `Person(name: str, order: int)`; `WeekPlan(person: FK Person, week_start: date)` with `unique_together=(person, week_start)`; `PlanAssignment(week_plan: FK WeekPlan, day, meal_time, meal: FK Meal, order)`; `ShopState(week_start: date, key, got, actual)` with `unique_together=(week_start, key)`.

- [ ] **Step 1: Write the failing test**

Add to `app/planner/tests.py`:

```python
import datetime
from django.test import TestCase
from django.db import IntegrityError
from planner.models import Person, WeekPlan, PlanAssignment, ShopState, Meal


class PeopleWeekModelTests(TestCase):
    def test_weekplan_unique_per_person_and_week(self):
        p = Person.objects.create(name="Sara", order=0)
        wk = datetime.date(2026, 6, 22)
        WeekPlan.objects.create(person=p, week_start=wk)
        with self.assertRaises(IntegrityError):
            WeekPlan.objects.create(person=p, week_start=wk)

    def test_deleting_person_cascades_weeks_and_assignments(self):
        p = Person.objects.create(name="Kid", order=0)
        wp = WeekPlan.objects.create(person=p, week_start=datetime.date(2026, 6, 22))
        meal = Meal.objects.create(name="Toast", meal_time="Breakfast")
        PlanAssignment.objects.create(week_plan=wp, day="Mon", meal_time="Breakfast", meal=meal, order=0)
        p.delete()
        self.assertEqual(WeekPlan.objects.count(), 0)
        self.assertEqual(PlanAssignment.objects.count(), 0)

    def test_shopstate_unique_per_week_and_key(self):
        wk = datetime.date(2026, 6, 22)
        ShopState.objects.create(week_start=wk, key="f_1", got=True)
        with self.assertRaises(IntegrityError):
            ShopState.objects.create(week_start=wk, key="f_1", got=False)
        # same key, different week is allowed
        ShopState.objects.create(week_start=datetime.date(2026, 6, 29), key="f_1", got=True)
        self.assertEqual(ShopState.objects.count(), 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && python manage.py test planner.tests.PeopleWeekModelTests -v2`
Expected: FAIL — `ImportError`/`AttributeError` (no `Person`/`WeekPlan`, `PlanAssignment` has no `week_plan`, `ShopState` has no `week_start`).

- [ ] **Step 3: Edit `models.py`**

Add the two new models after `MealIngredient` (before `PlanAssignment`):

```python
class Person(models.Model):
    """A household member who has their own weekly meal plans."""

    name = models.CharField(max_length=120)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.name


class WeekPlan(models.Model):
    """One person's plan for one calendar week (identified by its Monday)."""

    person = models.ForeignKey(Person, related_name="weeks", on_delete=models.CASCADE)
    week_start = models.DateField()

    class Meta:
        ordering = ["week_start", "id"]
        unique_together = ("person", "week_start")

    def __str__(self):
        return f"{self.person.name} — {self.week_start}"
```

Replace the `PlanAssignment` class body's standalone fields by adding the `week_plan` FK (keep `day`, `meal_time`, `meal`, `order`):

```python
class PlanAssignment(models.Model):
    """One meal placed in one (day, meal_time) slot of a person's week plan."""

    week_plan = models.ForeignKey(
        WeekPlan, related_name="assignments", on_delete=models.CASCADE
    )
    day = models.CharField(max_length=3, choices=DAY_CHOICES)
    meal_time = models.CharField(max_length=20, choices=MEAL_TIME_CHOICES)
    meal = models.ForeignKey(Meal, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["day", "meal_time", "order", "id"]

    def __str__(self):
        return f"{self.day}/{self.meal_time}: {self.meal.name}"
```

Replace `ShopState` (drop `unique=True` on `key`, add `week_start`, add `unique_together`):

```python
class ShopState(models.Model):
    """Per-line shopping state for one calendar week, keyed like the React
    `actuals`/`got` maps: f_<priceItemId>, n_<nonFoodId>, x_<extraId>."""

    week_start = models.DateField()
    key = models.CharField(max_length=80)
    got = models.BooleanField(default=False)
    actual = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )

    class Meta:
        ordering = ["week_start", "key"]
        unique_together = ("week_start", "key")
        verbose_name = "Shop state"

    def clean(self):
        if not self.key:
            raise ValidationError("key is required")

    def __str__(self):
        return f"{self.week_start} {self.key}"
```

- [ ] **Step 4: Make the schema migration**

Run: `cd app && python manage.py makemigrations planner --name people_and_weeks`
Expected: creates `0004_people_and_weeks.py`. It will prompt for a one-off default for the new non-null `PlanAssignment.week_plan` and `ShopState.week_start` if rows could exist — **choose to provide a one-off default**: for `week_plan` use `1`, for `week_start` use `datetime.date(2026,6,22)`. (Existing rows are repointed properly in Task 2; the test DB starts empty so these defaults are never actually applied to real data here.)

If makemigrations cannot proceed cleanly with the FK default, instead split: temporarily make `week_plan` nullable in this migration; Task 2's data migration backfills; a follow-up `alter` is not required because nullable is acceptable for `PlanAssignment` (it always has a WeekPlan in practice). **Prefer the non-null + one-off default path.**

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && python manage.py test planner.tests.PeopleWeekModelTests -v2`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/planner/models.py app/planner/migrations/0004_people_and_weeks.py app/planner/tests.py
git commit -m "feat(model): add Person & WeekPlan, scope PlanAssignment/ShopState to week"
```

---

### Task 2: Data migration — existing plan → Household person + current week

**Files:**
- Create: `app/planner/migrations/0005_migrate_existing_plan.py`
- Modify: `app/planner/tests.py`

**Interfaces:**
- Consumes: models from Task 1.
- Produces: after migrate on a DB that had pre-existing `PlanAssignment`/`ShopState` rows, a `Person("Household")` and a `WeekPlan` for the current Monday own all previously-orphaned assignments, and every `ShopState` has the current Monday as `week_start`.

- [ ] **Step 1: Write the failing test**

Add to `app/planner/tests.py`:

```python
from django.utils import timezone


def _current_monday():
    today = timezone.localdate()
    return today - datetime.timedelta(days=today.weekday())


class MigrationHelperTests(TestCase):
    def test_ensure_default_owner_creates_person_and_week(self):
        from planner.migrations_support import ensure_default_owner
        wp = ensure_default_owner(Person, WeekPlan)
        self.assertEqual(wp.person.name, "Household")
        self.assertEqual(wp.week_start, _current_monday())
        # idempotent
        wp2 = ensure_default_owner(Person, WeekPlan)
        self.assertEqual(wp.id, wp2.id)
        self.assertEqual(Person.objects.count(), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && python manage.py test planner.tests.MigrationHelperTests -v2`
Expected: FAIL — `ModuleNotFoundError: planner.migrations_support`.

- [ ] **Step 3: Create the shared helper**

Create `app/planner/migrations_support.py`:

```python
"""Helpers shared by data migrations and seeding (kept import-safe: takes model
classes as args so it works with both real models and migration-state models)."""
import datetime


def current_monday(today=None):
    if today is None:
        from django.utils import timezone
        today = timezone.localdate()
    return today - datetime.timedelta(days=today.weekday())


def ensure_default_owner(Person, WeekPlan, name="Household", today=None):
    """Return a WeekPlan for `name` on the current Monday, creating the Person
    and WeekPlan if needed. Idempotent."""
    person, _ = Person.objects.get_or_create(
        name=name, defaults={"order": 0}
    )
    wp, _ = WeekPlan.objects.get_or_create(
        person=person, week_start=current_monday(today)
    )
    return wp
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && python manage.py test planner.tests.MigrationHelperTests -v2`
Expected: PASS.

- [ ] **Step 5: Write the data migration**

Create `app/planner/migrations/0005_migrate_existing_plan.py`:

```python
from django.db import migrations


def forwards(apps, schema_editor):
    Person = apps.get_model("planner", "Person")
    WeekPlan = apps.get_model("planner", "WeekPlan")
    PlanAssignment = apps.get_model("planner", "PlanAssignment")
    ShopState = apps.get_model("planner", "ShopState")
    from planner.migrations_support import ensure_default_owner, current_monday

    # Only do work if there is pre-existing data to rehome.
    has_assignments = PlanAssignment.objects.exists()
    has_shop = ShopState.objects.exists()
    if not has_assignments and not has_shop:
        return

    wp = ensure_default_owner(Person, WeekPlan)
    monday = current_monday()
    # Repoint any assignment whose week_plan was defaulted (id=1 placeholder) or
    # is missing onto the Household current week.
    PlanAssignment.objects.exclude(week_plan=wp).update(week_plan=wp)
    ShopState.objects.update(week_start=monday)


def backwards(apps, schema_editor):
    # No-op: we don't recreate the singleton shape.
    pass


class Migration(migrations.Migration):
    dependencies = [("planner", "0004_people_and_weeks")]
    operations = [migrations.RunPython(forwards, backwards)]
```

- [ ] **Step 6: Run the full migrate + tests**

Run: `cd app && python manage.py migrate && python manage.py test planner -v2`
Expected: migrate applies cleanly; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/planner/migrations_support.py app/planner/migrations/0005_migrate_existing_plan.py app/planner/tests.py
git commit -m "feat(migrate): rehome existing plan onto Household current week"
```

---

### Task 3: Serializers for Person, WeekPlan, ShopState

**Files:**
- Modify: `app/planner/serializers.py`
- Modify: `app/planner/tests.py`

**Interfaces:**
- Produces: `PersonSerializer` (`id, name, order`); `WeekPlanSerializer` (`id, personId, weekStart`); `ShopStateSerializer` now also exposes `weekStart`.

- [ ] **Step 1: Write the failing test**

Add to `app/planner/tests.py`:

```python
class SerializerTests(TestCase):
    def test_person_serializer_fields(self):
        from planner.serializers import PersonSerializer
        p = Person.objects.create(name="Sara", order=2)
        self.assertEqual(PersonSerializer(p).data, {"id": p.id, "name": "Sara", "order": 2})

    def test_weekplan_serializer_camelcase(self):
        from planner.serializers import WeekPlanSerializer
        p = Person.objects.create(name="Sara", order=0)
        wp = WeekPlan.objects.create(person=p, week_start=datetime.date(2026, 6, 22))
        data = WeekPlanSerializer(wp).data
        self.assertEqual(data["personId"], p.id)
        self.assertEqual(data["weekStart"], "2026-06-22")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && python manage.py test planner.tests.SerializerTests -v2`
Expected: FAIL — `ImportError` (no `PersonSerializer`/`WeekPlanSerializer`).

- [ ] **Step 3: Edit `serializers.py`**

Add `Person`, `WeekPlan` to the model import block, and append:

```python
class PersonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Person
        fields = ["id", "name", "order"]


class WeekPlanSerializer(serializers.ModelSerializer):
    personId = serializers.PrimaryKeyRelatedField(
        source="person", queryset=Person.objects.all()
    )
    weekStart = serializers.DateField(source="week_start")

    class Meta:
        model = WeekPlan
        fields = ["id", "personId", "weekStart"]
```

Replace `ShopStateSerializer` to add `weekStart`:

```python
class ShopStateSerializer(serializers.ModelSerializer):
    weekStart = serializers.DateField(source="week_start")

    class Meta:
        model = ShopState
        fields = ["weekStart", "key", "got", "actual"]
```

(Update the top-of-file import to include `Person, WeekPlan`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && python manage.py test planner.tests.SerializerTests -v2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/planner/serializers.py app/planner/tests.py
git commit -m "feat(api): add Person/WeekPlan serializers, weekStart on ShopState"
```

---

### Task 4: Rewrite `build_state()` for the new shape

**Files:**
- Modify: `app/planner/views.py`
- Modify: `app/planner/tests.py`

**Interfaces:**
- Consumes: models + serializers from Tasks 1–3.
- Produces: `build_state()` returns the state-shape contract above (with `people`, `weeks`, `plans`, `shop`; no top-level `week`/`actuals`/`got`).

- [ ] **Step 1: Write the failing test**

Add to `app/planner/tests.py`:

```python
from rest_framework.test import APIClient


class StateShapeTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_state_has_people_weeks_plans_shop(self):
        p = Person.objects.create(name="Sara", order=0)
        wp = WeekPlan.objects.create(person=p, week_start=datetime.date(2026, 6, 22))
        meal = Meal.objects.create(name="Toast", meal_time="Breakfast")
        PlanAssignment.objects.create(week_plan=wp, day="Mon", meal_time="Breakfast", meal=meal, order=0)
        ShopState.objects.create(week_start=datetime.date(2026, 6, 22), key="f_9", actual="3.50", got=True)

        st = self.client.get("/api/state/").json()
        self.assertEqual(st["people"], [{"id": p.id, "name": "Sara", "order": 0}])
        self.assertEqual(st["weeks"], [{"id": wp.id, "personId": p.id, "weekStart": "2026-06-22"}])
        self.assertEqual(st["plans"][str(wp.id)]["Mon"]["Breakfast"], [str(meal.id)])
        wk = "2026-06-22"
        self.assertEqual(st["shop"][wk]["actuals"]["f_9"], 3.5)
        self.assertEqual(st["shop"][wk]["got"]["f_9"], True)
        self.assertNotIn("week", st)
        self.assertNotIn("actuals", st)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && python manage.py test planner.tests.StateShapeTests -v2`
Expected: FAIL — `KeyError`/assertion (old shape still returned).

- [ ] **Step 3: Edit `build_state()` in `views.py`**

Replace the `week`, `actuals`, `got` assembly (lines ~132–168) so the function ends like this (keep `price_book`, `suppliers`, `meals`, `non_food`, `extras` exactly as they are):

```python
    people = [
        {"id": pe.id, "name": pe.name, "order": pe.order}
        for pe in Person.objects.all()
    ]

    weeks = [
        {"id": wp.id, "personId": wp.person_id, "weekStart": wp.week_start.isoformat()}
        for wp in WeekPlan.objects.all()
    ]

    plans = {}
    for wp in WeekPlan.objects.all():
        grid = {d: {mt: [] for mt in MEAL_TIMES} for d in DAYS}
        plans[str(wp.id)] = grid
    for pa in PlanAssignment.objects.all():
        grid = plans.get(str(pa.week_plan_id))
        if grid and pa.day in grid and pa.meal_time in grid[pa.day]:
            grid[pa.day][pa.meal_time].append(str(pa.meal_id))

    shop = {}
    for stt in ShopState.objects.all():
        wk = stt.week_start.isoformat()
        bucket = shop.setdefault(wk, {"actuals": {}, "got": {}})
        if stt.actual is not None:
            bucket["actuals"][stt.key] = _f(stt.actual)
        if stt.got:
            bucket["got"][stt.key] = True

    return {
        "budget": _f(s.budget),
        "period": s.period,
        "priceBook": price_book,
        "meals": meals,
        "nonFood": non_food,
        "extras": extras,
        "suppliers": suppliers,
        "people": people,
        "weeks": weeks,
        "plans": plans,
        "shop": shop,
    }
```

Update the import block at the top of `views.py` to add `Person, WeekPlan`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && python manage.py test planner.tests.StateShapeTests -v2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/planner/views.py app/planner/tests.py
git commit -m "feat(api): build_state returns people/weeks/plans/shop shape"
```

---

### Task 5: People & Weeks endpoints; per-week plan & shop

**Files:**
- Modify: `app/planner/views.py`
- Modify: `app/planner/urls.py`
- Modify: `app/planner/tests.py`

**Interfaces:**
- Produces:
  - `GET/POST /api/people/`, `PATCH/DELETE /api/people/<id>/` (fields `name`, `order`).
  - `GET/POST /api/weeks/` (`{personId, weekStart}`), `DELETE /api/weeks/<id>/`.
  - `PUT /api/weeks/<id>/plan/` body `{day:{mealTime:[mealId,...]}}` → replaces that week's assignments; returns the week's grid.
  - `PUT /api/shop/` body `{weekStart, actuals:{key:num}, got:{key:bool}}` → upserts that week's shop state, scoped-deletes only that week's stale keys; returns `{weekStart, actuals, got}`.

- [ ] **Step 1: Write the failing test**

Add to `app/planner/tests.py`:

```python
class PeopleWeeksApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_person_and_week_and_plan(self):
        p = self.client.post("/api/people/", {"name": "Sara", "order": 0}, format="json").json()
        wk = self.client.post("/api/weeks/", {"personId": p["id"], "weekStart": "2026-06-22"}, format="json").json()
        meal = Meal.objects.create(name="Toast", meal_time="Breakfast")
        body = {"Mon": {"Breakfast": [str(meal.id)]}}
        r = self.client.put(f"/api/weeks/{wk['id']}/plan/", body, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PlanAssignment.objects.filter(week_plan_id=wk["id"]).count(), 1)
        self.assertEqual(r.json()["Mon"]["Breakfast"], [str(meal.id)])

    def test_shop_put_is_scoped_to_week(self):
        ShopState.objects.create(week_start=datetime.date(2026, 6, 15), key="f_1", got=True)
        r = self.client.put("/api/shop/", {"weekStart": "2026-06-22", "actuals": {"f_2": 4.0}, "got": {"f_2": True}}, format="json")
        self.assertEqual(r.status_code, 200)
        # last week's row is untouched
        self.assertTrue(ShopState.objects.filter(week_start=datetime.date(2026, 6, 15), key="f_1").exists())
        self.assertTrue(ShopState.objects.filter(week_start=datetime.date(2026, 6, 22), key="f_2").exists())

    def test_delete_week_removes_assignments(self):
        p = Person.objects.create(name="Sara", order=0)
        wp = WeekPlan.objects.create(person=p, week_start=datetime.date(2026, 6, 22))
        meal = Meal.objects.create(name="Toast", meal_time="Breakfast")
        PlanAssignment.objects.create(week_plan=wp, day="Mon", meal_time="Breakfast", meal=meal, order=0)
        r = self.client.delete(f"/api/weeks/{wp.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(PlanAssignment.objects.count(), 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && python manage.py test planner.tests.PeopleWeeksApiTests -v2`
Expected: FAIL — 404s (endpoints not registered).

- [ ] **Step 3: Add viewsets + actions in `views.py`**

Add near the other viewsets:

```python
from rest_framework.decorators import action
from .models import Person, WeekPlan
from .serializers import PersonSerializer, WeekPlanSerializer


class PersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all()
    serializer_class = PersonSerializer


class WeekPlanViewSet(viewsets.ModelViewSet):
    queryset = WeekPlan.objects.select_related("person").all()
    serializer_class = WeekPlanSerializer

    @action(detail=True, methods=["put"])
    @transaction.atomic
    def plan(self, request, pk=None):
        wp = self.get_object()
        grid = request.data or {}
        valid_meal_ids = set(Meal.objects.values_list("id", flat=True))
        PlanAssignment.objects.filter(week_plan=wp).delete()
        rows = []
        for day in DAYS:
            day_plan = grid.get(day, {}) or {}
            for mt in MEAL_TIMES:
                for order, meal_id in enumerate(day_plan.get(mt, []) or []):
                    try:
                        mid = int(meal_id)
                    except (TypeError, ValueError):
                        continue
                    if mid in valid_meal_ids:
                        rows.append(PlanAssignment(
                            week_plan=wp, day=day, meal_time=mt, meal_id=mid, order=order
                        ))
        PlanAssignment.objects.bulk_create(rows)
        return Response(build_state()["plans"][str(wp.id)])
```

Replace `ShopView` so PUT is per-week (GET can return the whole `shop` map):

```python
class ShopView(APIView):
    """Per-calendar-week bulk upsert of the actuals/got maps (keyed f_/n_/x_)."""

    def get(self, request):
        return Response(build_state()["shop"])

    @transaction.atomic
    def put(self, request):
        week_start = request.data.get("weekStart")
        if not week_start:
            return Response({"detail": "weekStart is required"}, status=400)
        actuals = request.data.get("actuals", {}) or {}
        got = request.data.get("got", {}) or {}
        keys = set(actuals) | set(got)
        for key in keys:
            actual_val = _to_decimal(actuals.get(key))
            got_val = bool(got.get(key))
            if actual_val is None and not got_val:
                ShopState.objects.filter(week_start=week_start, key=key).delete()
            else:
                ShopState.objects.update_or_create(
                    week_start=week_start, key=key,
                    defaults={"got": got_val, "actual": actual_val},
                )
        # Drop only this week's keys the client no longer tracks.
        ShopState.objects.filter(week_start=week_start).exclude(key__in=keys).delete()
        return Response(build_state()["shop"].get(str(week_start), {"actuals": {}, "got": {}}))
```

Delete the now-unused `WeekView` class.

- [ ] **Step 4: Register routes in `urls.py`**

Add to the router and remove the `week/` path:

```python
router.register(r"people", views.PersonViewSet, basename="people")
router.register(r"weeks", views.WeekPlanViewSet, basename="weeks")
```

Remove this line:

```python
    path("week/", views.WeekView.as_view(), name="week"),
```

(Keep `shop/`, `state/`, `config/`, `settings/`, `import/*`, `lookup/`, `dedupe/`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && python manage.py test planner.tests.PeopleWeeksApiTests -v2`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/planner/views.py app/planner/urls.py app/planner/tests.py
git commit -m "feat(api): people & weeks endpoints, per-week plan & shop"
```

---

### Task 6: Seed + admin for the new shape

**Files:**
- Modify: `app/planner/seed.py`
- Modify: `app/planner/admin.py`
- Modify: `app/planner/tests.py`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `seed()` creates a default `Person("Household")` and a current-week `WeekPlan`, and all example `PlanAssignment` rows reference it. Admin can manage `Person`, `WeekPlan`.

- [ ] **Step 1: Write the failing test**

Add to `app/planner/tests.py`:

```python
class SeedTests(TestCase):
    def test_seed_creates_person_and_week_with_assignments(self):
        from planner.seed import seed
        seed()
        self.assertEqual(Person.objects.count(), 1)
        self.assertTrue(WeekPlan.objects.filter(person__name="Household").exists())
        wp = WeekPlan.objects.get(person__name="Household")
        self.assertTrue(PlanAssignment.objects.filter(week_plan=wp).exists())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && python manage.py test planner.tests.SeedTests -v2`
Expected: FAIL — seed still creates `PlanAssignment` without `week_plan` (TypeError/IntegrityError).

- [ ] **Step 3: Edit `seed.py`**

At the top of `seed()` (inside its atomic block), before creating PlanAssignments, create the owner and reference it:

```python
    from .migrations_support import ensure_default_owner
    from .models import Person, WeekPlan
    week_plan = ensure_default_owner(Person, WeekPlan)
```

Change every `PlanAssignment.objects.create(...)`/`PlanAssignment(...)` in `seed.py` to pass `week_plan=week_plan` alongside `day`, `meal_time`, `meal`, `order`.

- [ ] **Step 4: Edit `admin.py`**

Add admin registrations (django-unfold `ModelAdmin`):

```python
from .models import Person, WeekPlan


@admin.register(Person)
class PersonAdmin(ModelAdmin):
    list_display = ("name", "order")
    list_editable = ("order",)


@admin.register(WeekPlan)
class WeekPlanAdmin(ModelAdmin):
    list_display = ("person", "week_start")
    list_filter = ("person",)
```

In the existing `PlanAssignmentAdmin`, add `week_plan` to `list_display`/`list_filter` (and to `ShopStateAdmin` add `week_start`). Match the file's existing import of `ModelAdmin`/`admin`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && python manage.py test planner.tests.SeedTests -v2`
Expected: PASS.

- [ ] **Step 6: Run the FULL backend suite**

Run: `cd app && python manage.py test planner -v2`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add app/planner/seed.py app/planner/admin.py app/planner/tests.py
git commit -m "feat: seed Household person + current week; admin for people/weeks"
```

---

### Task 7: Extend the pure sync engine (`sync.js`) + vitest

**Files:**
- Modify: `frontend/src/sync.js`
- Create: `frontend/src/sync.test.js`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: the state-shape contract.
- Produces: `pushDiff` also diffs `people`, `weeks`, `plans`, `shop`; `applyIdMap` remaps `person`/`week` ids. `idMap` gains `person` and `week` kinds.

- [ ] **Step 1: Add vitest to `package.json`**

In `frontend/package.json`, add to `scripts`: `"test": "vitest run"`, and to `devDependencies`: `"vitest": "^2.1.8"`. Then run `cd frontend && npm install`.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/sync.test.js`:

```js
import { describe, it, expect } from "vitest";
import { pushDiff, applyIdMap } from "./sync.js";

const EMPTY = {
  budget: 0, period: "Week", priceBook: [], meals: [], nonFood: [], extras: [],
  suppliers: [], people: [], weeks: [], plans: {}, shop: {},
};

function fakeApi(log, idByPath = {}) {
  return async (path, method = "GET", body) => {
    log.push([method, path, body]);
    if (method === "POST") {
      const id = idByPath[path] ?? Math.floor(Math.random() * 1e6);
      return { id };
    }
    return null;
  };
}

describe("pushDiff people/weeks/plans/shop", () => {
  it("creates a person then a week referencing the real person id", async () => {
    const log = [];
    const api = fakeApi(log, { "people/": 42, "weeks/": 7 });
    const prev = structuredClone(EMPTY);
    const next = structuredClone(EMPTY);
    next.people = [{ id: "tmp_p", name: "Sara", order: 0 }];
    next.weeks = [{ id: "tmp_w", personId: "tmp_p", weekStart: "2026-06-22" }];
    const idMap = await pushDiff(api, prev, next);
    expect(idMap.person["tmp_p"]).toBe("42");
    expect(idMap.week["tmp_w"]).toBe("7");
    const weekPost = log.find(([m, p]) => m === "POST" && p === "weeks/");
    expect(weekPost[2]).toEqual({ personId: "42", weekStart: "2026-06-22" });
  });

  it("PUTs a week's plan to weeks/<id>/plan/ with translated meal ids", async () => {
    const log = [];
    const api = fakeApi(log);
    const prev = structuredClone(EMPTY);
    prev.weeks = [{ id: "5", personId: "1", weekStart: "2026-06-22" }];
    prev.plans = { "5": {} };
    const next = structuredClone(prev);
    next.plans = { "5": { Mon: { Breakfast: ["9"] } } };
    await pushDiff(api, prev, next);
    const put = log.find(([m, p]) => m === "PUT" && p === "weeks/5/plan/");
    expect(put[2]).toEqual({ Mon: { Breakfast: ["9"] } });
  });

  it("PUTs shop per week with weekStart in the body", async () => {
    const log = [];
    const api = fakeApi(log);
    const prev = structuredClone(EMPTY);
    const next = structuredClone(EMPTY);
    next.shop = { "2026-06-22": { actuals: { "f_1": 3 }, got: { "f_1": true } } };
    await pushDiff(api, prev, next);
    const put = log.find(([m, p]) => m === "PUT" && p === "shop/");
    expect(put[2]).toEqual({ weekStart: "2026-06-22", actuals: { "f_1": 3 }, got: { "f_1": true } });
  });

  it("applyIdMap remaps person and week ids", () => {
    const d = structuredClone(EMPTY);
    d.people = [{ id: "tmp_p", name: "Sara", order: 0 }];
    d.weeks = [{ id: "tmp_w", personId: "tmp_p", weekStart: "2026-06-22" }];
    d.plans = { "tmp_w": { Mon: { Breakfast: ["tmp_m"] } } };
    const idMap = { price: {}, meal: { "tmp_m": "9" }, nonfood: {}, extra: {}, person: { "tmp_p": "42" }, week: { "tmp_w": "7" } };
    const out = applyIdMap(d, idMap);
    expect(out.people[0].id).toBe("42");
    expect(out.weeks[0].id).toBe("7");
    expect(out.weeks[0].personId).toBe("42");
    expect(out.plans["7"].Mon.Breakfast).toEqual(["9"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `idMap.person` undefined; no `people/`/`weeks/` calls; `applyIdMap` doesn't touch people/weeks.

- [ ] **Step 4: Edit `sync.js`**

In `pushDiff`, extend the `idMap` and `tr` (line ~33):

```js
  const idMap = { price: {}, meal: {}, nonfood: {}, extra: {}, person: {}, week: {} };
```

After the `extras` block and **before** the `week` block, insert people + weeks + plans, then replace the old single-`week` block and the `actuals/got` block:

```js
  // people
  {
    const p = byId(prev.people), n = byId(next.people);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`people/${id}/`, "DELETE");
    for (const pe of next.people) {
      const payload = { name: pe.name, order: num(pe.order) };
      if (!(pe.id in p)) { const r = await api("people/", "POST", payload); if (r) idMap.person[pe.id] = String(r.id); }
      else if (!deepEqual(p[pe.id], pe)) await api(`people/${pe.id}/`, "PATCH", payload);
    }
  }

  // weeks (personId may be a freshly-created tmp id -> translate)
  {
    const p = byId(prev.weeks), n = byId(next.weeks);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`weeks/${id}/`, "DELETE");
    for (const w of next.weeks) {
      const payload = { personId: tr("person", w.personId), weekStart: w.weekStart };
      if (!(w.id in p)) { const r = await api("weeks/", "POST", payload); if (r) idMap.week[w.id] = String(r.id); }
      // weekStart/personId are immutable in the UI; no PATCH path needed.
    }
  }

  // plans: PUT the grid for any week whose grid changed (translate week + meal ids)
  for (const weekId of Object.keys(next.plans || {})) {
    const before = (prev.plans || {})[weekId];
    const after = next.plans[weekId];
    if (deepEqual(before, after)) continue;
    const grid = {};
    for (const day of Object.keys(after)) {
      grid[day] = {};
      for (const mt of Object.keys(after[day])) {
        grid[day][mt] = (after[day][mt] || []).map((mid) => tr("meal", mid));
      }
    }
    await api(`weeks/${tr("week", weekId)}/plan/`, "PUT", grid);
  }

  // shop: PUT per calendar week whose actuals/got changed
  {
    const weekStarts = new Set([...Object.keys(prev.shop || {}), ...Object.keys(next.shop || {})]);
    const trKey = (k) => {
      const pfx = k.slice(0, 2), id = k.slice(2);
      if (pfx === "f_") return "f_" + tr("price", id);
      if (pfx === "n_") return "n_" + tr("nonfood", id);
      if (pfx === "x_") return "x_" + tr("extra", id);
      return k;
    };
    const mapKeys = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [trKey(k), v]));
    for (const ws of weekStarts) {
      const before = (prev.shop || {})[ws];
      const after = (next.shop || {})[ws] || { actuals: {}, got: {} };
      if (deepEqual(before, after)) continue;
      await api("shop/", "PUT", { weekStart: ws, actuals: mapKeys(after.actuals), got: mapKeys(after.got) });
    }
  }
```

**Delete** the old `if (!deepEqual(prev.week, next.week)) { ... api("week/", "PUT", week) }` block and the old `if (!deepEqual(prev.actuals...)) { ... api("shop/", "PUT", ...) }` block.

In `applyIdMap`, replace the `week`, `actuals`, `got` remaps with people/weeks/plans/shop remaps:

```js
    people: (d.people || []).map((pe) => ({ ...pe, id: tr("person", pe.id) })),
    weeks: (d.weeks || []).map((w) => ({ ...w, id: tr("week", w.id), personId: tr("person", w.personId) })),
    plans: Object.fromEntries(Object.entries(d.plans || {}).map(([wid, grid]) => [
      tr("week", wid),
      Object.fromEntries(Object.entries(grid).map(([day, slots]) => [
        day, Object.fromEntries(Object.entries(slots).map(([mt, ids]) => [mt, ids.map((id) => tr("meal", id))])),
      ])),
    ])),
    shop: Object.fromEntries(Object.entries(d.shop || {}).map(([ws, b]) => [
      ws, { actuals: remapMap(b.actuals || {}), got: remapMap(b.got || {}) },
    ])),
```

Add `person`/`week` to the `tr` in `applyIdMap` (it already reads `idMap[kind]`, so just ensure callers pass those kinds — they do via the idMap object).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/sync.js frontend/src/sync.test.js frontend/package.json frontend/package-lock.json
git commit -m "feat(sync): diff people/weeks/plans/shop; add vitest"
```

---

### Task 8: Update `EMPTY` in `api.js`

**Files:**
- Modify: `frontend/src/api.js`

**Interfaces:**
- Produces: `EMPTY` matches the new state-shape contract (so first-paint and the diff baseline are correct).

- [ ] **Step 1: Edit `api.js`**

Replace the `EMPTY` constant (lines 45–48):

```js
const EMPTY = {
  budget: 0, period: "Week", priceBook: [], meals: [],
  nonFood: [], extras: [], suppliers: [],
  people: [], weeks: [], plans: {}, shop: {},
};
```

- [ ] **Step 2: Verify the build still compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no reference errors from `api.js`). The component still references old keys — that's fixed in Task 9; if the build fails only inside `GroceryPlanner.jsx`, proceed to Task 9. (If you want a green build at this checkpoint, do Task 9 before building.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(sync): update EMPTY state shape for people/weeks"
```

---

### Task 9: Component — week selector, person switcher, add/copy week, cross-person aggregation

**Files:**
- Modify: `frontend/src/GroceryPlanner.jsx`

**Interfaces:**
- Consumes: the new `data` shape + extended sync.
- Produces: a working UI: header week navigator; Week Plan tab with person switcher + add-person + add-week (blank/copy); grocery list totals all people for the selected week; shop got/actual scoped to the selected week.

This task is large; do it as sub-steps, building after each major change.

- [ ] **Step 1: Add date + week helpers near the top constants (after `MEALTIMES`)**

```js
/* ---------- calendar-week helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = (d) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); x.setHours(0, 0, 0, 0); return x; };
const currentMonday = () => isoDate(mondayOf(new Date()));
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoDate(d); };
const fmtWeek = (iso) => { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };
const findWeek = (data, personId, weekStart) =>
  (data.weeks || []).find((w) => String(w.personId) === String(personId) && w.weekStart === weekStart);
const emptyGrid = () => Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(MEALTIMES.map((mt) => [mt, []]))]));
```

- [ ] **Step 2: Add top-level selection state + replace `derived` aggregation**

In `GroceryPlanner()`, after `const [tab, setTab] = useState("week");`:

```js
  const [weekStart, setWeekStart] = useState(currentMonday());
  const [personId, setPersonId] = useState(null);
  // default the person selector to the first person once data arrives
  React.useEffect(() => {
    if (data && personId == null && (data.people || []).length) setPersonId(String(data.people[0].id));
  }, [data, personId]);
```

Replace the `derived` useMemo body's Pass-1 loop so it aggregates across **all people's plans for `weekStart`** instead of `data.week`:

```js
  const derived = useMemo(() => {
    if (!data) return { list: [], byMeal: {}, total: 0 };
    const map = {};
    const byMeal = { Breakfast: 0, Recess: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
    // every week that belongs to the selected calendar week, across all people
    const weekIds = (data.weeks || []).filter((w) => w.weekStart === weekStart).map((w) => String(w.id));
    weekIds.forEach((wid) => {
      const grid = data.plans[wid] || {};
      DAYS.forEach((day) => MEALTIMES.forEach((mt) => {
        (grid[day]?.[mt] || []).forEach((mealId) => {
          const meal = data.meals.find((m) => m.id === mealId);
          if (!meal) return;
          meal.items.forEach((ing) => {
            const pb = data.priceBook.find((p) => p.id === ing.itemId);
            if (!pb || !pb.isFood) return;
            const q = num(ing.qty);
            if (!map[pb.id]) map[pb.id] = { id: pb.id, item: pb.item, category: pb.category, unit: pb.unit, price: num(pb.price), rawQty: 0, timeQty: {}, times: {} };
            map[pb.id].rawQty += q;
            map[pb.id].timeQty[mt] = (map[pb.id].timeQty[mt] || 0) + q;
            map[pb.id].times[mt] = true;
          });
        });
      }));
    });
    const list = Object.values(map).map((x) => {
      const qty = roundQty(x.rawQty, x.unit);
      const cost = qty * x.price;
      if (x.rawQty > 0) MEALTIMES.forEach((mt) => { if (x.timeQty[mt]) byMeal[mt] += cost * (x.timeQty[mt] / x.rawQty); });
      return { id: x.id, item: x.item, category: x.category, unit: x.unit, qty, cost, times: MEALTIMES.filter((t) => x.times[t]) };
    }).sort((a, b) => a.category.localeCompare(b.category) || a.item.localeCompare(b.item));
    return { list, byMeal, total: list.reduce((s, x) => s + x.cost, 0) };
  }, [data, weekStart]);
```

(Add `import React` usage is already present via `import React` at line 1.)

- [ ] **Step 3: Point shop accessors + actualSpent at the selected week**

Replace the actuals/got accessors and `actualSpent`:

```js
  const shopWeek = (data.shop && data.shop[weekStart]) || { actuals: {}, got: {} };
  const setShopWeek = (next) => patch({ shop: { ...(data.shop || {}), [weekStart]: next } });
  const actualSpent = Object.values(shopWeek.actuals).reduce((s, v) => s + num(v), 0);
  const actualBal = num(data.budget) - actualSpent;

  const aGet = (k) => shopWeek.actuals[k] ?? "";
  const aSet = (k, v) => setShopWeek({ actuals: { ...shopWeek.actuals, [k]: v }, got: shopWeek.got });
  const gGet = (k) => !!shopWeek.got[k];
  const gTog = (k) => setShopWeek({ actuals: shopWeek.actuals, got: { ...shopWeek.got, [k]: !shopWeek.got[k] } });
```

Delete the old `const actualSpent = Object.values(data.actuals)...` and the old `aGet/aSet/gGet/gTog` definitions.

- [ ] **Step 4: Add the week navigator to the header**

In the header's right-hand `<div className="flex items-center gap-2">`, before the Budget chip, add:

```jsx
            <div className="flex items-center gap-1 px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.15)" }}>
              <button onClick={() => setWeekStart((w) => addDays(w, -7))} title="Previous week" style={{ color: "#fff" }}>‹</button>
              <input type="date" value={weekStart} onChange={(e) => e.target.value && setWeekStart(mondayOfIso(e.target.value))}
                className="bg-transparent text-white text-xs outline-none" style={{ colorScheme: "dark" }} />
              <button onClick={() => setWeekStart((w) => addDays(w, 7))} title="Next week" style={{ color: "#fff" }}>›</button>
            </div>
```

Add this helper next to the other date helpers (Step 1):

```js
const mondayOfIso = (iso) => isoDate(mondayOf(new Date(iso + "T00:00:00")));
```

- [ ] **Step 5: Pass selection + week mutators into `WeekPlan`, and rewrite `WeekPlan`**

Change the render line:

```jsx
        {tab === "week" && (
          <WeekPlan
            data={data} setData={setData}
            weekStart={weekStart} personId={personId} setPersonId={setPersonId}
          />
        )}
```

Replace the whole `WeekPlan` function:

```jsx
function WeekPlan({ data, setData, weekStart, personId, setPersonId }) {
  const people = data.people || [];
  const mealName = (id) => data.meals.find((m) => m.id === id)?.name || "?";
  const week = personId != null ? findWeek(data, personId, weekStart) : null;
  const grid = week ? (data.plans[String(week.id)] || emptyGrid()) : null;

  const writeGrid = (weekId, nextGrid) =>
    setData({ ...data, plans: { ...data.plans, [String(weekId)]: nextGrid } });

  const add = (day, mt, mealId) => {
    if (!mealId || !week) return;
    const g = structuredClone(grid);
    g[day][mt] = [...(g[day][mt] || []), mealId];
    writeGrid(week.id, g);
  };
  const remove = (day, mt, idx) => {
    const g = structuredClone(grid);
    g[day][mt].splice(idx, 1);
    writeGrid(week.id, g);
  };

  const addPerson = () => {
    const name = window.prompt("New person's name?");
    if (!name) return;
    const id = uid();
    const order = people.length;
    setData({ ...data, people: [...people, { id, name, order }] });
    setPersonId(String(id));
  };
  const renamePerson = () => {
    if (!personId) return;
    const cur = people.find((p) => String(p.id) === String(personId));
    const name = window.prompt("Rename person", cur?.name || "");
    if (!name) return;
    setData({ ...data, people: people.map((p) => (String(p.id) === String(personId) ? { ...p, name } : p)) });
  };
  const deletePerson = () => {
    if (!personId) return;
    if (!window.confirm("Delete this person and all their week plans?")) return;
    const remainingWeeks = (data.weeks || []).filter((w) => String(w.personId) !== String(personId));
    const removedIds = new Set((data.weeks || []).filter((w) => String(w.personId) === String(personId)).map((w) => String(w.id)));
    const plans = Object.fromEntries(Object.entries(data.plans).filter(([wid]) => !removedIds.has(wid)));
    const nextPeople = people.filter((p) => String(p.id) !== String(personId));
    setData({ ...data, people: nextPeople, weeks: remainingWeeks, plans });
    setPersonId(nextPeople.length ? String(nextPeople[0].id) : null);
  };

  const addWeek = (copyFromWeekId) => {
    if (!personId) return;
    const id = uid();
    const newGrid = copyFromWeekId ? structuredClone(data.plans[String(copyFromWeekId)] || emptyGrid()) : emptyGrid();
    setData({
      ...data,
      weeks: [...(data.weeks || []), { id, personId, weekStart }],
      plans: { ...data.plans, [String(id)]: newGrid },
    });
  };
  const personWeeks = (data.weeks || []).filter((w) => String(w.personId) === String(personId));

  return (
    <div>
      <SectionTitle>Week Plan</SectionTitle>
      <p className="text-sm mb-3" style={{ color: C.sub }}>
        Pick a person and a week (top right). Recess &amp; Lunch are the kids' school days (greyed on weekends).
        Each person's plan for the selected week flows onto the shared Grocery Plan.
      </p>

      {/* person switcher */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {people.map((p) => (
          <button key={p.id} onClick={() => setPersonId(String(p.id))}
            className="px-3 py-1.5 rounded-md text-sm font-medium"
            style={{
              background: String(p.id) === String(personId) ? C.dark : "#fff",
              color: String(p.id) === String(personId) ? "#fff" : C.dark,
              border: `1px solid ${C.line}`,
            }}>{p.name}</button>
        ))}
        <Btn tone="ghost" onClick={addPerson}><Plus size={15} />Add person</Btn>
        {personId && <Btn tone="ghost" onClick={renamePerson}>Rename</Btn>}
        {personId && <Btn tone="danger" onClick={deletePerson}><Trash2 size={14} /></Btn>}
      </div>

      {!people.length && (
        <div className="text-sm px-3 py-4 rounded-lg" style={{ border: `1px solid ${C.line}`, color: C.sub }}>
          Add a person to start planning their week.
        </div>
      )}

      {personId && !week && (
        <div className="text-sm px-3 py-4 rounded-lg flex items-center gap-3" style={{ border: `1px solid ${C.line}`, color: C.sub }}>
          <span>No plan for {fmtWeek(weekStart)} yet.</span>
          <Btn tone="solid" onClick={() => addWeek(null)}><Plus size={15} />Blank week</Btn>
          {personWeeks.length > 0 && (
            <select defaultValue="" onChange={(e) => { if (e.target.value) addWeek(e.target.value); }}
              className="text-sm rounded px-2 py-1 outline-none" style={{ border: `1px solid ${C.line}` }}>
              <option value="">Copy from…</option>
              {personWeeks.map((w) => <option key={w.id} value={w.id}>{fmtWeek(w.weekStart)}</option>)}
            </select>
          )}
        </div>
      )}

      {week && grid && (
        <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${C.line}` }}>
          <table className="w-full border-collapse text-sm" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={th(C.mid)} className="text-left w-24">Meal time</th>
                {DAYS.map((d) => <th key={d} style={th(C.mid)}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {MEALTIMES.map((mt) => (
                <tr key={mt}>
                  <td style={{ ...td(), background: C.light, fontWeight: 700, color: C.dark }}>{mt}</td>
                  {DAYS.map((d) => {
                    const weekendRecess = mt === "Recess" && !SCHOOL.has(d);
                    const slot = grid[d]?.[mt] || [];
                    return (
                      <td key={d} style={{ ...td(), background: weekendRecess ? "#EEF1EF" : "#fff", verticalAlign: "top" }}>
                        {weekendRecess ? <span style={{ color: "#AAB3AE" }}>—</span> : (
                          <div className="flex flex-col gap-1">
                            {slot.map((mid, i) => (
                              <span key={i} className="inline-flex items-center justify-between gap-1 px-1.5 py-1 rounded"
                                style={{ background: C.band, border: `1px solid ${C.line}` }}>
                                <span className="truncate">{mealName(mid)}</span>
                                <button onClick={() => remove(d, mt, i)} style={{ color: C.sub }}><X size={13} /></button>
                              </span>
                            ))}
                            <select value="" onChange={(e) => { add(d, mt, e.target.value); e.target.value = ""; }}
                              className="text-xs rounded px-1 py-1 outline-none" style={{ border: `1px dashed ${C.line}`, color: C.sub }}>
                              <option value="">+ add…</option>
                              {[...data.meals].sort((a, b) => (a.mealTime === mt ? -1 : 1) - (b.mealTime === mt ? -1 : 1) || a.name.localeCompare(b.name))
                                .map((m) => <option key={m.id} value={m.id}>{m.name}{m.mealTime !== mt ? ` (${m.mealTime})` : ""}</option>)}
                            </select>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Build to verify the component compiles and references resolve**

Run: `cd frontend && npm run build`
Expected: build succeeds with no `data.week`/`data.actuals`/`data.got` references remaining. If the build reports any such reference, fix it (the only legitimate readers are now `derived`, the shop accessors, and `WeekPlan`).

- [ ] **Step 7: Manual smoke test (dev server)**

Run: `cd frontend && npm run dev` (or rebuild + run the add-on). Verify:
- Add a person → appears as a tab; selecting an empty week offers Blank/Copy.
- Add meals to a person's week → grocery list on the Grocery tab reflects them for that week.
- Add a second person with their own meals → grocery list totals both for the same week.
- Move the week navigator forward → grids and grocery list change; got/actual entered on one week don't appear on another.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/GroceryPlanner.jsx
git commit -m "feat(ui): week selector, person switcher, add/copy week, cross-person shop"
```

---

### Task 10: Deploy — version bump, changelog, build

**Files:**
- Modify: `config.yaml`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: a new add-on version with a changelog entry; the production frontend build verified.

- [ ] **Step 1: Bump the add-on version**

In `config.yaml`, change `version: "1.4.0"` to `version: "1.5.0"`.

- [ ] **Step 2: Add a CHANGELOG entry**

Prepend to `CHANGELOG.md`:

```markdown
## 1.5.0 — 2026-06-22

- **People & multiple week plans.** Add household members, each with their own
  calendar-dated week plans.
- **Shopping-week selector.** Pick a week; the grocery list totals every
  person's plan for that week into one household shop.
- New weeks start blank or copy an existing week.
- Got/actual shopping state is now tracked per week.
```

- [ ] **Step 3: Verify the full build + tests one more time**

Run: `cd app && python manage.py test planner -v2 && cd ../frontend && npm test && npm run build`
Expected: backend tests PASS, sync tests PASS, frontend build succeeds.

- [ ] **Step 4: Commit**

```bash
git add config.yaml CHANGELOG.md
git commit -m "chore(release): v1.5.0 — people & multiple week plans"
```

- [ ] **Step 5: Deploy to Home Assistant**

This add-on is deployed by Home Assistant building the Docker image from this repo (multi-stage build runs `npm run build` and `collectstatic`; `run.sh` runs `migrate` then `seed_if_empty` on start). To deploy:
1. Push the branch / merge to the branch HA pulls from (or copy the add-on folder into the HA `/addons` directory).
2. In Home Assistant → Settings → Add-ons → Grocery Plan → **Rebuild** (picks up v1.5.0), then **Restart**. The startup `migrate` applies `0004`/`0005`, rehoming any existing plan onto the Household person's current week.

(Steps 1–2 are performed by the user in their HA instance; the agent's deliverable ends at the committed, built, version-bumped branch.)

---

## Self-Review

**Spec coverage:**
- People (add/rename/reorder/delete) → Tasks 1, 3, 5, 9. ✓
- Multiple calendar-dated weeks per person → Tasks 1, 4, 5, 9. ✓
- Shopping-week selector totals all people for the week → Task 9 (`derived` aggregation + header navigator). ✓
- New week blank or copy → Task 9 (`addWeek`, copy = client-side grid clone). ✓
- ShopState per week → Tasks 1, 4, 5, 9. ✓
- Same 5 slots + weekend greying → preserved in Task 9 `WeekPlan`. ✓
- Household-shared meals/prices/suppliers/non-food/extras → untouched. ✓
- Migration of existing data → Task 2. ✓
- Sync stays full-state → Tasks 7, 8. ✓
- Out-of-scope items (per-person slot profiles, per-week non-food/extras, state pagination, auth) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type/name consistency:** `weekStart` (camelCase) in JSON/serializers/sync; `week_start` in Django. `personId`/`weekId` translated via `idMap.person`/`idMap.week` consistently in `pushDiff` and `applyIdMap`. `plans` keyed by string week id everywhere. Shop body uses `{weekStart, actuals, got}` in both `sync.js` and `ShopView.put`. ✓

**Risk note:** Task 1 Step 4 (makemigrations default for the new non-null FK) is the one interactive spot — the plan specifies the one-off defaults to provide. The test DB is empty so those defaults never touch real rows; Task 2 handles real existing installs.
