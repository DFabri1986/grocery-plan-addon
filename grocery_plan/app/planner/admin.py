from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline

from .models import (
    Extra,
    Meal,
    MealIngredient,
    NonFoodEssential,
    Person,
    PlanAssignment,
    PriceItem,
    Settings,
    ShopState,
    Supplier,
    WeekPlan,
)


@admin.register(Supplier)
class SupplierAdmin(ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)


@admin.register(Person)
class PersonAdmin(ModelAdmin):
    list_display = ("name", "order")
    list_editable = ("order",)


@admin.register(WeekPlan)
class WeekPlanAdmin(ModelAdmin):
    list_display = ("person", "week_start")
    list_filter = ("person",)


@admin.register(Settings)
class SettingsAdmin(ModelAdmin):
    list_display = ("budget", "period")

    def has_add_permission(self, request):
        # Singleton row.
        return not Settings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PriceItem)
class PriceItemAdmin(ModelAdmin):
    list_display = ("item", "price", "unit", "category", "is_food", "supplier")
    list_filter = ("is_food", "category", "supplier")
    search_fields = ("item",)
    list_editable = ("price", "is_food", "supplier")


class MealIngredientInline(TabularInline):
    model = MealIngredient
    extra = 1
    autocomplete_fields = ("item",)


@admin.register(Meal)
class MealAdmin(ModelAdmin):
    list_display = ("name", "meal_time")
    list_filter = ("meal_time",)
    search_fields = ("name",)
    inlines = [MealIngredientInline]


@admin.register(PlanAssignment)
class PlanAssignmentAdmin(ModelAdmin):
    list_display = ("week_plan", "day", "meal_time", "meal", "order")
    list_filter = ("week_plan", "day", "meal_time")
    autocomplete_fields = ("meal",)


@admin.register(NonFoodEssential)
class NonFoodEssentialAdmin(ModelAdmin):
    list_display = ("item", "qty")
    autocomplete_fields = ("item",)


@admin.register(Extra)
class ExtraAdmin(ModelAdmin):
    list_display = ("item", "qty", "price", "supplier")


@admin.register(ShopState)
class ShopStateAdmin(ModelAdmin):
    list_display = ("week_start", "key", "got", "actual")
    search_fields = ("key",)
