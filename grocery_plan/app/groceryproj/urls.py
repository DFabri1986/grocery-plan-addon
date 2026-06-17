from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("planner.urls")),
    # Everything else ("/", "/assets/...") is served by WhiteNoise from the
    # built React app; unmatched paths fall through to a 404.
]
