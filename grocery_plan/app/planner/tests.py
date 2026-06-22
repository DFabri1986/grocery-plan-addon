import datetime
from django.test import TransactionTestCase as TestCase
from django.db import IntegrityError
from django.utils import timezone
from planner.models import Person, WeekPlan, PlanAssignment, ShopState, Meal
from rest_framework.test import APIClient


def _current_monday():
    today = timezone.localdate()
    return today - datetime.timedelta(days=today.weekday())


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
        self.assertEqual(st["people"], [{"id": str(p.id), "name": "Sara", "order": 0}])
        self.assertEqual(st["weeks"], [{"id": str(wp.id), "personId": str(p.id), "weekStart": "2026-06-22"}])
        self.assertEqual(st["plans"][str(wp.id)]["Mon"]["Breakfast"], [str(meal.id)])
        wk = "2026-06-22"
        self.assertEqual(st["shop"][wk]["actuals"]["f_9"], 3.5)
        self.assertEqual(st["shop"][wk]["got"]["f_9"], True)
        self.assertNotIn("week", st)
        self.assertNotIn("actuals", st)


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


class SeedTests(TestCase):
    def test_seed_creates_person_and_week_with_assignments(self):
        from planner.seed import seed
        seed()
        self.assertEqual(Person.objects.count(), 1)
        self.assertTrue(WeekPlan.objects.filter(person__name="Household").exists())
        wp = WeekPlan.objects.get(person__name="Household")
        self.assertTrue(PlanAssignment.objects.filter(week_plan=wp).exists())
