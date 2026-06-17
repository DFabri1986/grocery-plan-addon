"""Seed the database with the same example data as the React seed() function,
so the app opens populated on first run."""
import os
from decimal import Decimal

from django.db import transaction

from .models import (
    DAYS,
    Extra,
    Meal,
    MealIngredient,
    NonFoodEssential,
    PlanAssignment,
    PriceItem,
    Settings,
)

SCHOOL = {"Mon", "Tue", "Wed", "Thu", "Fri"}

# (item, price, unit, category, is_food)
PRICE_BOOK = [
    ("Weet-Bix / cereal", "4.50", "box", "Pantry & Dry", True),
    ("Milk 2L", "3.30", "ea", "Dairy & Eggs", True),
    ("Eggs (dozen)", "5.50", "dozen", "Dairy & Eggs", True),
    ("Butter", "5.50", "250g", "Dairy & Eggs", True),
    ("Muesli bars", "4.00", "pack", "Snacks & Treats", True),
    ("Apples / bananas", "4.00", "kg", "Fresh Produce", True),
    ("Yoghurt pouches", "5.00", "pack", "Dairy & Eggs", True),
    ("Sandwich loaf", "2.80", "loaf", "Bakery", True),
    ("Ham / sandwich filling", "5.50", "pack", "Meat & Seafood", True),
    ("Block cheese", "7.00", "500g", "Dairy & Eggs", True),
    ("Wraps", "3.50", "pack", "Bakery", True),
    ("Chicken breast", "11.00", "kg", "Meat & Seafood", True),
    ("Beef mince", "13.00", "kg", "Meat & Seafood", True),
    ("Pasta 500g", "1.50", "ea", "Pantry & Dry", True),
    ("Tinned tomatoes", "1.10", "tin", "Pantry & Dry", True),
    ("Rice 1kg", "3.00", "ea", "Pantry & Dry", True),
    ("Brown onion", "0.50", "ea", "Fresh Produce", True),
    ("Mixed veg (frozen)", "4.50", "kg", "Frozen", True),
    ("Crackers", "3.00", "pack", "Snacks & Treats", True),
    ("Toilet paper", "8.00", "pack", "Household", False),
    ("Nappies", "18.00", "pack", "Baby & Kids", False),
    ("Baby wipes", "4.00", "pack", "Baby & Kids", False),
    ("Dishwashing liquid", "3.50", "bottle", "Household", False),
    ("Laundry liquid", "8.00", "bottle", "Household", False),
    ("Bin liners", "4.00", "pack", "Household", False),
    ("Toothpaste", "4.00", "tube", "Health & Personal", False),
    ("Dry pet food", "15.00", "bag", "Pet", False),
    ("Ice cream", "6.00", "tub", "Snacks & Treats", True),
]

# (name, meal_time, [(item_name, qty), ...])
MEALS = [
    ("Weet-Bix & milk", "Breakfast",
     [("Weet-Bix / cereal", "0.25"), ("Milk 2L", "0.3")]),
    ("Eggs on toast", "Breakfast",
     [("Eggs (dozen)", "0.5"), ("Sandwich loaf", "0.4"), ("Butter", "0.2")]),
    ("Muesli bar & fruit", "Recess",
     [("Muesli bars", "0.4"), ("Apples / bananas", "0.3"), ("Yoghurt pouches", "0.4")]),
    ("Ham & cheese sandwich", "Lunch",
     [("Sandwich loaf", "0.5"), ("Ham / sandwich filling", "0.5"), ("Block cheese", "0.25")]),
    ("Cheese wrap", "Lunch",
     [("Wraps", "0.5"), ("Block cheese", "0.25"), ("Apples / bananas", "0.2")]),
    ("Spag bol", "Dinner",
     [("Beef mince", "1"), ("Pasta 500g", "1"), ("Tinned tomatoes", "2"), ("Brown onion", "1")]),
    ("Chicken & veg", "Dinner",
     [("Chicken breast", "1"), ("Mixed veg (frozen)", "0.5"), ("Rice 1kg", "0.5")]),
    ("Crackers & cheese", "Snacks",
     [("Crackers", "0.5"), ("Block cheese", "0.2")]),
]

NON_FOOD = [
    "Toilet paper", "Nappies", "Baby wipes",
    "Dishwashing liquid", "Laundry liquid", "Bin liners",
]


@transaction.atomic
def seed():
    Settings.objects.update_or_create(
        pk=1,
        defaults={
            "budget": Decimal("300"),
            "period": os.environ.get("DEFAULT_PERIOD", "Week"),
        },
    )

    pb = {}
    for item, price, unit, category, is_food in PRICE_BOOK:
        pb[item] = PriceItem.objects.create(
            item=item, price=Decimal(price), unit=unit,
            category=category, is_food=is_food,
        )

    meals = {}
    for name, meal_time, items in MEALS:
        meal = Meal.objects.create(name=name, meal_time=meal_time)
        MealIngredient.objects.bulk_create(
            [MealIngredient(meal=meal, item=pb[i], qty=Decimal(q)) for i, q in items]
        )
        meals[name] = meal

    def breakfast(i):
        return "Eggs on toast" if i % 2 else "Weet-Bix & milk"

    def lunch(i):
        return "Cheese wrap" if i % 2 else "Ham & cheese sandwich"

    def dinner(i):
        return "Chicken & veg" if i % 2 else "Spag bol"

    rows = []
    for i, day in enumerate(DAYS):
        slots = {
            "Breakfast": [breakfast(i)],
            "Recess": ["Muesli bar & fruit"] if day in SCHOOL else [],
            "Lunch": [lunch(i)] if day in SCHOOL else [],
            "Dinner": [dinner(i)],
            "Snacks": ["Crackers & cheese"] if i < 3 else [],
        }
        for mt, meal_names in slots.items():
            for order, mname in enumerate(meal_names):
                rows.append(
                    PlanAssignment(
                        day=day, meal_time=mt, meal=meals[mname], order=order
                    )
                )
    PlanAssignment.objects.bulk_create(rows)

    NonFoodEssential.objects.bulk_create(
        [NonFoodEssential(item=pb[n], qty=Decimal("1")) for n in NON_FOOD]
    )

    Extra.objects.create(item="Treat night ice cream", qty=Decimal("1"), price=Decimal("6"))
