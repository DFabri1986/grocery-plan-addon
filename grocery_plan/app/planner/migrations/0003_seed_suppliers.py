from django.db import migrations

SUPPLIERS = ["Coles", "Woolworths", "Who Gives A Crap"]


def seed_suppliers(apps, schema_editor):
    Supplier = apps.get_model("planner", "Supplier")
    for name in SUPPLIERS:
        Supplier.objects.get_or_create(name=name)


def unseed(apps, schema_editor):
    Supplier = apps.get_model("planner", "Supplier")
    Supplier.objects.filter(name__in=SUPPLIERS).delete()


class Migration(migrations.Migration):
    dependencies = [("planner", "0002_supplier_extra_supplier_priceitem_supplier")]
    operations = [migrations.RunPython(seed_suppliers, unseed)]
