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
    NonFoodEssential,
    PlanAssignment,
    PriceItem,
    Settings,
    ShopState,
    Supplier,
)
from .serializers import (
    ExtraSerializer,
    MealSerializer,
    NonFoodEssentialSerializer,
    PriceItemSerializer,
    SettingsSerializer,
    ShopStateSerializer,
    SupplierSerializer,
)
from . import receipts


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

    week = {d: {mt: [] for mt in MEAL_TIMES} for d in DAYS}
    for pa in PlanAssignment.objects.all():
        if pa.day in week and pa.meal_time in week[pa.day]:
            week[pa.day][pa.meal_time].append(str(pa.meal_id))

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

    actuals, got = {}, {}
    for st in ShopState.objects.all():
        if st.actual is not None:
            actuals[st.key] = _f(st.actual)
        if st.got:
            got[st.key] = True

    return {
        "budget": _f(s.budget),
        "period": s.period,
        "priceBook": price_book,
        "meals": meals,
        "week": week,
        "nonFood": non_food,
        "extras": extras,
        "actuals": actuals,
        "got": got,
        "suppliers": suppliers,
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
class WeekView(APIView):
    """The week plan is a denormalised projection of PlanAssignment. Replacing
    the whole set on every change keeps the client simple and is idempotent
    (last-write-wins)."""

    def get(self, request):
        return Response(build_state()["week"])

    @transaction.atomic
    def put(self, request):
        week = request.data or {}
        valid_meal_ids = set(Meal.objects.values_list("id", flat=True))
        PlanAssignment.objects.all().delete()
        rows = []
        for day in DAYS:
            day_plan = week.get(day, {}) or {}
            for mt in MEAL_TIMES:
                for order, meal_id in enumerate(day_plan.get(mt, []) or []):
                    try:
                        mid = int(meal_id)
                    except (TypeError, ValueError):
                        continue
                    if mid in valid_meal_ids:
                        rows.append(
                            PlanAssignment(
                                day=day, meal_time=mt, meal_id=mid, order=order
                            )
                        )
        PlanAssignment.objects.bulk_create(rows)
        return Response(build_state()["week"])


class ShopView(APIView):
    """Bulk upsert of the actuals/got maps (keyed f_/n_/x_)."""

    def get(self, request):
        st = build_state()
        return Response({"actuals": st["actuals"], "got": st["got"]})

    @transaction.atomic
    def put(self, request):
        actuals = request.data.get("actuals", {}) or {}
        got = request.data.get("got", {}) or {}
        keys = set(actuals) | set(got)
        for key in keys:
            actual_val = _to_decimal(actuals.get(key))
            got_val = bool(got.get(key))
            if actual_val is None and not got_val:
                ShopState.objects.filter(key=key).delete()
            else:
                ShopState.objects.update_or_create(
                    key=key, defaults={"got": got_val, "actual": actual_val}
                )
        # Drop any keys the client no longer tracks.
        ShopState.objects.exclude(key__in=keys).delete()
        st = build_state()
        return Response({"actuals": st["actuals"], "got": st["got"]})


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
