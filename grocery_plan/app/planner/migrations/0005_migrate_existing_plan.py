from django.db import migrations, models


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
    operations = [
        migrations.RunPython(forwards, backwards),
        migrations.AlterField(
            model_name="shopstate",
            name="week_start",
            field=models.DateField(),
        ),
    ]
