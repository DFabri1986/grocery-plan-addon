from decimal import Decimal, InvalidOperation

from django.conf import settings as dj_settings
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    DAYS,
    MEAL_TIMES,
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
from rest_framework.decorators import action
from .serializers import (
    ExtraSerializer,
    MealSerializer,
    NonFoodEssentialSerializer,
    PersonSerializer,
    PriceItemSerializer,
    SettingsSerializer,
    ShopStateSerializer,
    SupplierSerializer,
    WeekPlanSerializer,
)
from . import pricing, receipts


def _f(value):
    """Decimal -> float (or None), so the JSON matches the React number shape."""
    return float(value) if value is not None else None


def _to_decimal(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


# --------------------------------------------------------------------------- #
#  Granular CRUD ViewSets (one per entity)
# --------------------------------------------------------------------------- #
class PriceItemViewSet(viewsets.ModelViewSet):
    queryset = PriceItem.objects.all()
    serializer_class = PriceItemSerializer


class MealViewSet(viewsets.ModelViewSet):
    queryset = Meal.objects.prefetch_related("items").all()
    serializer_class = MealSerializer


class NonFoodEssentialViewSet(viewsets.ModelViewSet):
    queryset = NonFoodEssential.objects.all()
    serializer_class = NonFoodEssentialSerializer


class ExtraViewSet(viewsets.ModelViewSet):
    queryset = Extra.objects.all()
    serializer_class = ExtraSerializer


class ShopStateViewSet(viewsets.ModelViewSet):
    queryset = ShopState.objects.all()
    serializer_class = ShopStateSerializer
    lookup_field = "key"


class SupplierViewSet(viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer


class PersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all()
    serializer_class = PersonSerializer


class WeekPlanViewSet(viewsets.ModelViewSet):
    queryset = WeekPlan.objects.select_related("person").all()
    serializer_class = WeekPlanSerializer

    @action(detail=True, methods=["put"])
    @transaction.atomic
    def plan(self, request, pk=None):
        wp = self.get_object()
        grid = request.data or {}
        valid_meal_ids = set(Meal.objects.values_list("id", flat=True))
        PlanAssignment.objects.filter(week_plan=wp).delete()
        rows = []
        for day in DAYS:
            day_plan = grid.get(day, {}) or {}
            for mt in MEAL_TIMES:
                for order, meal_id in enumerate(day_plan.get(mt, []) or []):
                    try:
                        mid = int(meal_id)
                    except (TypeError, ValueError):
                        continue
                    if mid in valid_meal_ids:
                        rows.append(PlanAssignment(
                            week_plan=wp, day=day, meal_time=mt, meal_id=mid, order=order
                        ))
        PlanAssignment.objects.bulk_create(rows)
        return Response(build_state()["plans"][str(wp.id)])


# --------------------------------------------------------------------------- #
#  Singleton settings
# --------------------------------------------------------------------------- #
class SettingsView(APIView):
    def get(self, request):
        return Response(SettingsSerializer(Settings.load()).data)

    def patch(self, request):
        obj = Settings.load()
        ser = SettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


# --------------------------------------------------------------------------- #
#  Full-state assembler  ->  the exact React shape, in one GET
# --------------------------------------------------------------------------- #
def build_state():
    s = Settings.load()

    price_items = list(PriceItem.objects.all())
    price_book = [
        {
            "id": str(p.id),
            "item": p.item,
            "price": _f(p.price),
            "unit": p.unit,
            "category": p.category,
            "isFood": p.is_food,
            "supplierId": str(p.supplier_id) if p.supplier_id else None,
        }
        for p in price_items
    ]

    suppliers = [{"id": str(s.id), "name": s.name} for s in Supplier.objects.all()]

    meals = [
        {
            "id": str(m.id),
            "name": m.name,
            "mealTime": m.meal_time,
            "items": [
                {"itemId": str(ing.item_id), "qty": _f(ing.qty)}
                for ing in m.items.all()
            ],
        }
        for m in Meal.objects.prefetch_related("items").all()
    ]

    non_food = [
        {"id": str(n.id), "itemId": str(n.item_id), "qty": _f(n.qty)}
        for n in NonFoodEssential.objects.all()
    ]

    extras = [
        {
            "id": str(e.id), "item": e.item, "qty": _f(e.qty), "price": _f(e.price),
            "supplierId": str(e.supplier_id) if e.supplier_id else None,
        }
        for e in Extra.objects.all()
    ]

    people = [
        {"id": str(pe.id), "name": pe.name, "order": pe.order}
        for pe in Person.objects.all()
    ]

    weeks = [
        {"id": str(wp.id), "personId": str(wp.person_id), "weekStart": wp.week_start.isoformat()}
        for wp in WeekPlan.objects.all()
    ]

    plans = {}
    for wp in WeekPlan.objects.all():
        grid = {d: {mt: [] for mt in MEAL_TIMES} for d in DAYS}
        plans[str(wp.id)] = grid
    for pa in PlanAssignment.objects.all():
        grid = plans.get(str(pa.week_plan_id))
        if grid and pa.day in grid and pa.meal_time in grid[pa.day]:
            grid[pa.day][pa.meal_time].append(str(pa.meal_id))

    shop = {}
    for stt in ShopState.objects.all():
        wk = stt.week_start.isoformat()
        bucket = shop.setdefault(wk, {"actuals": {}, "got": {}})
        if stt.actual is not None:
            bucket["actuals"][stt.key] = _f(stt.actual)
        if stt.got:
            bucket["got"][stt.key] = True

    return {
        "budget": _f(s.budget),
        "period": s.period,
        "priceBook": price_book,
        "meals": meals,
        "nonFood": non_food,
        "extras": extras,
        "suppliers": suppliers,
        "people": people,
        "weeks": weeks,
        "plans": plans,
        "shop": shop,
    }


class StateView(APIView):
    def get(self, request):
        return Response(build_state())


class ConfigView(APIView):
    """Runtime config (currency symbol, poll interval) from the add-on options."""

    def get(self, request):
        return Response(dj_settings.APP_CONFIG)


# --------------------------------------------------------------------------- #
#  Bulk projections that don't map 1:1 to a single row
# --------------------------------------------------------------------------- #
class ShopView(APIView):
    """Per-calendar-week bulk upsert of the actuals/got maps (keyed f_/n_/x_)."""

    def get(self, request):
        return Response(build_state()["shop"])

    @transaction.atomic
    def put(self, request):
        week_start = request.data.get("weekStart")
        if not week_start:
            return Response({"detail": "weekStart is required"}, status=400)
        actuals = request.data.get("actuals", {}) or {}
        got = request.data.get("got", {}) or {}
        keys = set(actuals) | set(got)
        for key in keys:
            actual_val = _to_decimal(actuals.get(key))
            got_val = bool(got.get(key))
            if actual_val is None and not got_val:
                ShopState.objects.filter(week_start=week_start, key=key).delete()
            else:
                ShopState.objects.update_or_create(
                    week_start=week_start, key=key,
                    defaults={"got": got_val, "actual": actual_val},
                )
        # Drop only this week's keys the client no longer tracks.
        ShopState.objects.filter(week_start=week_start).exclude(key__in=keys).delete()
        return Response(build_state()["shop"].get(str(week_start), {"actuals": {}, "got": {}}))


# --------------------------------------------------------------------------- #
#  Receipt import: parse uploaded Coles/Woolworths PDFs -> review -> commit
# --------------------------------------------------------------------------- #
def _supplier_for_vendor(vendor):
    if vendor in ("Coles", "Woolworths"):
        return Supplier.objects.get_or_create(name=vendor)[0]
    return None


class ImportParseView(APIView):
    """Accept one or more order PDFs, return de-duplicated parsed items for
    review. No database writes."""

    def post(self, request):
        files = request.FILES.getlist("files")
        if not files:
            return Response({"detail": "No files uploaded."}, status=400)

        existing = {p.item.lower(): p for p in PriceItem.objects.all()}
        merged = {}  # name_lower -> item dict (keep most recent by date)
        vendors, parsed_files = set(), 0
        for f in files:
            try:
                result = receipts.parse_receipt(f.read())
            except Exception as exc:  # noqa: BLE001 - surface parse errors per file
                return Response(
                    {"detail": f"Could not parse {f.name}: {exc}"}, status=422
                )
            if result["vendor"] != "Unknown":
                vendors.add(result["vendor"])
            parsed_files += 1
            date = result.get("date") or ""
            for it in result["items"]:
                key = it["name"].lower()
                prev = merged.get(key)
                if prev is None or date >= prev["_date"]:
                    supplier = _supplier_for_vendor(it["vendor"])
                    cur = existing.get(key)
                    merged[key] = {
                        "name": it["name"],
                        "price": it["price"],
                        "unit": it["unit"],
                        "category": it["category"],
                        "isFood": it["isFood"],
                        "supplierId": supplier.id if supplier else None,
                        "supplierName": supplier.name if supplier else None,
                        "vendor": it["vendor"],
                        "action": "update" if cur else "new",
                        "currentPrice": _f(cur.price) if cur else None,
                        "_date": date,
                    }
        items = sorted(merged.values(), key=lambda x: (x["category"], x["name"]))
        for it in items:
            it.pop("_date", None)
        return Response({
            "items": items,
            "summary": {
                "files": parsed_files,
                "items": len(items),
                "vendors": sorted(vendors),
                "new": sum(1 for i in items if i["action"] == "new"),
                "update": sum(1 for i in items if i["action"] == "update"),
            },
        })


class PriceLookupView(APIView):
    """Best-effort current price for an item from BOTH vendors. Always 200;
    a vendor is null when blocked or not matched."""

    def get(self, request):
        name = (request.query_params.get("name") or "").strip()
        if not name:
            return Response({"name": name, "results": {}})
        results = {}
        for vendor, fn in (("Woolworths", pricing.lookup_woolworths),
                           ("Coles", pricing.lookup_coles)):
            try:
                r = fn(name)
            except Exception:
                r = None
            results[vendor] = r if (r and r.get("price")) else None
        return Response({"name": name, "results": results})


class DedupeView(APIView):
    """Merge price-book items that have identical names (case-insensitive,
    whitespace-normalised). References (meal ingredients, non-food essentials)
    are repointed to the kept item before duplicates are deleted."""

    @transaction.atomic
    def post(self, request):
        from collections import defaultdict

        groups = defaultdict(list)
        for p in PriceItem.objects.all():
            groups[" ".join(p.item.lower().split())].append(p)

        removed = merged_groups = 0
        for items in groups.values():
            if len(items) < 2:
                continue
            merged_groups += 1
            # Keep the best entry: prefer one with a supplier, then the newest.
            items.sort(key=lambda p: (p.supplier_id is not None, p.id))
            keep = items[-1]
            tidy = " ".join(keep.item.split())
            if tidy != keep.item:
                keep.item = tidy
                keep.save(update_fields=["item"])
            dup_ids = [d.id for d in items[:-1]]
            MealIngredient.objects.filter(item_id__in=dup_ids).update(item=keep)
            NonFoodEssential.objects.filter(item_id__in=dup_ids).update(item=keep)
            PriceItem.objects.filter(id__in=dup_ids).delete()
            removed += len(dup_ids)
        return Response({"groups": merged_groups, "removed": removed})


class ImportCommitView(APIView):
    """Upsert reviewed items into the price book (match by name, case-insensitive)."""

    @transaction.atomic
    def post(self, request):
        items = request.data.get("items", []) or []
        created = updated = 0
        for it in items:
            name = (it.get("name") or "").strip()
            if not name:
                continue
            supplier = None
            if it.get("supplierId"):
                supplier = Supplier.objects.filter(pk=it["supplierId"]).first()
            defaults = {
                "price": _to_decimal(it.get("price")) or 0,
                "unit": it.get("unit") or "ea",
                "category": it.get("category") or "Pantry & Dry",
                "is_food": bool(it.get("isFood")),
                "supplier": supplier,
            }
            existing = PriceItem.objects.filter(item__iexact=name).first()
            if existing:
                for k, v in defaults.items():
                    setattr(existing, k, v)
                existing.save()
                updated += 1
            else:
                PriceItem.objects.create(item=name, **defaults)
                created += 1
        return Response({"created": created, "updated": updated})
