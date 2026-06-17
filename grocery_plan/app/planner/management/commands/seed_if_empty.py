from django.core.management.base import BaseCommand

from planner.models import PriceItem
from planner.seed import seed


class Command(BaseCommand):
    help = "Seed the database with example data only if it is empty."

    def handle(self, *args, **options):
        if PriceItem.objects.exists():
            self.stdout.write("Database already populated; skipping seed.")
            return
        seed()
        self.stdout.write(self.style.SUCCESS("Seeded database with example data."))
