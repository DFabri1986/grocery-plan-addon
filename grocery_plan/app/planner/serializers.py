from rest_framework import serializers

from .models import (
    Extra,
    Meal,
    MealIngredient,
    NonFoodEssential,
    PriceItem,
    Settings,
    ShopState,
    Supplier,
)

# Field names are camelCase to match the React data shape, so the frontend can
# PATCH/POST the same objects it holds in state.


class SettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Settings
        fields = ["budget", "period"]


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name"]


class PriceItemSerializer(serializers.ModelSerializer):
    isFood = serializers.BooleanField(source="is_food", required=False)
    supplierId = serializers.PrimaryKeyRelatedField(
        source="supplier", queryset=Supplier.objects.all(),
        required=False, allow_null=True,
    )

    class Meta:
        model = PriceItem
        fields = ["id", "item", "price", "unit", "category", "isFood", "supplierId"]


class MealIngredientSerializer(serializers.ModelSerializer):
    itemId = serializers.PrimaryKeyRelatedField(
        source="item", queryset=PriceItem.objects.all()
    )

    class Meta:
        model = MealIngredient
        fields = ["itemId", "qty"]


class MealSerializer(serializers.ModelSerializer):
    mealTime = serializers.CharField(source="meal_time", required=False)
    items = MealIngredientSerializer(many=True, required=False)

    class Meta:
        model = Meal
        fields = ["id", "name", "mealTime", "items"]

    def _write_items(self, meal, items_data):
        meal.items.all().delete()
        MealIngredient.objects.bulk_create(
            [
                MealIngredient(meal=meal, item=it["item"], qty=it["qty"])
                for it in items_data
            ]
        )

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        meal = Meal.objects.create(**validated_data)
        self._write_items(meal, items_data)
        return meal

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            self._write_items(instance, items_data)
        return instance


class NonFoodEssentialSerializer(serializers.ModelSerializer):
    itemId = serializers.PrimaryKeyRelatedField(
        source="item", queryset=PriceItem.objects.all()
    )

    class Meta:
        model = NonFoodEssential
        fields = ["id", "itemId", "qty"]


class ExtraSerializer(serializers.ModelSerializer):
    supplierId = serializers.PrimaryKeyRelatedField(
        source="supplier", queryset=Supplier.objects.all(),
        required=False, allow_null=True,
    )

    class Meta:
        model = Extra
        fields = ["id", "item", "qty", "price", "supplierId"]


class ShopStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopState
        fields = ["key", "got", "actual"]
