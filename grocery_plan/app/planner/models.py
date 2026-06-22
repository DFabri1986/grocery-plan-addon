from django.core.exceptions import ValidationError
from django.db import models

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MEAL_TIMES = ["Breakfast", "Recess", "Lunch", "Dinner", "Snacks"]

DAY_CHOICES = [(d, d) for d in DAYS]
MEAL_TIME_CHOICES = [(m, m) for m in MEAL_TIMES]


class Settings(models.Model):
    """Singleton row holding the budget + period."""

    budget = models.DecimalField(max_digits=10, decimal_places=2, default=300)
    period = models.CharField(max_length=40, default="Week")

    class Meta:
        verbose_name = "Settings"
        verbose_name_plural = "Settings"

    def save(self, *args, **kwargs):
        self.pk = 1  # enforce singleton
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return f"Budget {self.budget} / {self.period}"


class Supplier(models.Model):
    """A place items are bought from (Coles, Woolworths, Who Gives A Crap…)."""

    name = models.CharField(max_length=120, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class PriceItem(models.Model):
    item = models.CharField(max_length=200)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    unit = models.CharField(max_length=40, default="ea")
    category = models.CharField(max_length=80, default="Pantry & Dry")
    is_food = models.BooleanField(default=True)
    supplier = models.ForeignKey(
        Supplier, null=True, blank=True, on_delete=models.SET_NULL, related_name="items"
    )

    class Meta:
        ordering = ["item"]
        verbose_name = "Price item"

    def __str__(self):
        return self.item


class Meal(models.Model):
    name = models.CharField(max_length=200)
    meal_time = models.CharField(
        max_length=20, choices=MEAL_TIME_CHOICES, default="Dinner"
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class MealIngredient(models.Model):
    meal = models.ForeignKey(Meal, related_name="items", on_delete=models.CASCADE)
    item = models.ForeignKey(PriceItem, on_delete=models.CASCADE)
    qty = models.DecimalField(max_digits=10, decimal_places=3, default=1)

    def __str__(self):
        return f"{self.meal.name}: {self.item.item} x{self.qty}"


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


class PlanAssignment(models.Model):
    """One meal placed in one (day, meal_time) slot of a person's week plan."""

    week_plan = models.ForeignKey(
        WeekPlan, related_name="assignments", null=True, on_delete=models.CASCADE
    )
    day = models.CharField(max_length=3, choices=DAY_CHOICES)
    meal_time = models.CharField(max_length=20, choices=MEAL_TIME_CHOICES)
    meal = models.ForeignKey(Meal, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["day", "meal_time", "order", "id"]

    def __str__(self):
        return f"{self.day}/{self.meal_time}: {self.meal.name}"


class NonFoodEssential(models.Model):
    item = models.ForeignKey(PriceItem, on_delete=models.CASCADE)
    qty = models.DecimalField(max_digits=10, decimal_places=3, default=1)

    class Meta:
        verbose_name = "Non-food essential"

    def __str__(self):
        return f"{self.item.item} x{self.qty}"


class Extra(models.Model):
    item = models.CharField(max_length=200, blank=True, default="")
    qty = models.DecimalField(max_digits=10, decimal_places=3, default=1)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    supplier = models.ForeignKey(
        Supplier, null=True, blank=True, on_delete=models.SET_NULL, related_name="extras"
    )

    def __str__(self):
        return self.item or "(extra)"


class ShopState(models.Model):
    """Per-line shopping state for one calendar week, keyed like the React
    `actuals`/`got` maps: f_<priceItemId>, n_<nonFoodId>, x_<extraId>."""

    week_start = models.DateField(null=True)
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
