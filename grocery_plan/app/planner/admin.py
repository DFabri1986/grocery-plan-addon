from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline

from .models import (
    Extra,
    Meal,
    MealIngredient,
    NonFoodEssential,
    PlanAssignment,
    PriceItem,
    Settings,
    ShopState,
)


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
    list_display = ("item", "price", "unit", "category", "is_food")
    list_filter = ("is_food", "category")
    search_fields = ("item",)
    list_editable = ("price", "is_food")


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
    list_display = ("day", "meal_time", "meal", "order")
    list_filter = ("day", "meal_time")
    autocomplete_fields = ("meal",)


@admin.register(NonFoodEssential)
class NonFoodEssentialAdmin(ModelAdmin):
    list_display = ("item", "qty")
    autocomplete_fields = ("item",)


@admin.register(Extra)
class ExtraAdmin(ModelAdmin):
    list_display = ("item", "qty", "price")


@admin.register(ShopState)
class ShopStateAdmin(ModelAdmin):
    list_display = ("key", "got", "actual")
    search_fields = ("key",)
