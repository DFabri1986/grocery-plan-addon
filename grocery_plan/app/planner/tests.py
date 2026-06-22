import datetime
from django.test import TransactionTestCase as TestCase
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
