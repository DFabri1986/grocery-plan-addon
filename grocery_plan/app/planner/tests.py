import datetime
from django.test import TransactionTestCase as TestCase
from django.db import IntegrityError
from django.utils import timezone
from planner.models import Person, WeekPlan, PlanAssignment, ShopState, Meal


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
