from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r"prices", views.PriceItemViewSet, basename="prices")
router.register(r"meals", views.MealViewSet, basename="meals")
router.register(r"nonfood", views.NonFoodEssentialViewSet, basename="nonfood")
router.register(r"extras", views.ExtraViewSet, basename="extras")
router.register(r"shopstate", views.ShopStateViewSet, basename="shopstate")
router.register(r"suppliers", views.SupplierViewSet, basename="suppliers")

urlpatterns = [
    path("state/", views.StateView.as_view(), name="state"),
    path("config/", views.ConfigView.as_view(), name="config"),
    path("settings/", views.SettingsView.as_view(), name="settings"),
    path("week/", views.WeekView.as_view(), name="week"),
    path("shop/", views.ShopView.as_view(), name="shop"),
    path("import/parse/", views.ImportParseView.as_view(), name="import-parse"),
    path("import/commit/", views.ImportCommitView.as_view(), name="import-commit"),
    path("", include(router.urls)),
]
