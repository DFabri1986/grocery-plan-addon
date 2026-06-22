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
