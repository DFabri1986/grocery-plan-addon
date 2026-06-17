"""
Django settings for the Grocery Plan Home Assistant add-on.

Security model: this app runs ONLY behind Home Assistant Ingress. There is no
public port and no app-level auth for the API. Auth is delegated entirely to
Home Assistant + Ingress, per the add-on brief.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# All writable/persistent state lives under /data (the add-on's persistent
# volume) so it survives restarts/updates and is captured by HA backups.
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# The built React app (Vite dist) is copied here in the Dockerfile.
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", BASE_DIR / "frontend_dist"))


def _get_secret_key() -> str:
    """Persist a generated secret key under /data so sessions/admin logins
    stay valid across restarts."""
    key_file = DATA_DIR / "secret_key"
    if key_file.exists():
        return key_file.read_text().strip()
    from django.core.management.utils import get_random_secret_key

    key = get_random_secret_key()
    try:
        key_file.write_text(key)
        key_file.chmod(0o600)
    except OSError:
        pass
    return key


SECRET_KEY = os.environ.get("SECRET_KEY") or _get_secret_key()

DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"

# Requests arrive through the Ingress proxy with a variety of Host headers.
# Since the only way in is the proxy (no public port), accept any host.
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    # django-unfold must come before django.contrib.admin.
    "unfold",
    "unfold.contrib.filters",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "planner",
]

MIDDLEWARE = [
    # Disable CSRF host/referer enforcement: requests come through the HA
    # ingress proxy and must not be blocked by origin checks. Safe because
    # there is no public port and HA handles authentication.
    "groceryproj.ingress.DisableCSRFMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise serves the built React app (at "/") and collected static
    # files (admin + unfold, at STATIC_URL) with no nginx.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Home Assistant serves the add-on inside an <iframe>; allow same-origin framing.
X_FRAME_OPTIONS = "SAMEORIGIN"

ROOT_URLCONF = "groceryproj.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "groceryproj.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": str(DATA_DIR / "db.sqlite3"),
        "OPTIONS": {"timeout": 20},
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.environ.get("TZ", "UTC")
USE_I18N = True
USE_TZ = True

# STATIC_URL is intentionally relative (no leading slash). When the WSGI layer
# sets SCRIPT_NAME from the X-Ingress-Path header, Django prepends that prefix
# to relative STATIC_URL/MEDIA_URL, so admin/unfold assets resolve correctly
# behind the random ingress base path.
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Serve the built React SPA at the site root ("/", "/assets/...").
WHITENOISE_ROOT = str(FRONTEND_DIST)
WHITENOISE_INDEX_FILE = True

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        # Compressed (not manifest) avoids hashed-filename lookup errors with
        # third-party admin themes; the subclass prepends the ingress prefix to
        # generated static URLs so the admin works behind Ingress.
        "BACKEND": "groceryproj.ingress.IngressStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    # No app-level auth: Home Assistant Ingress is the security boundary.
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    # Emit numbers (300, 4.5) rather than strings, matching the original
    # React data shape.
    "COERCE_DECIMAL_TO_STRING": False,
}

# Logging to stdout so it shows in the add-on's Log tab.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
}

# ---- django-unfold admin theming ----
UNFOLD = {
    "SITE_TITLE": "Grocery Plan",
    "SITE_HEADER": "Grocery Plan",
    "SITE_SUBHEADER": "Home Assistant add-on data",
    "SHOW_HISTORY": True,
    "COLORS": {
        "primary": {
            "500": "46 125 91",
            "600": "27 94 67",
            "700": "27 94 67",
        },
    },
}

# Runtime config surfaced to the frontend via /api/config/. Populated from the
# add-on options by run.sh -> environment variables.
APP_CONFIG = {
    "currency": os.environ.get("CURRENCY_SYMBOL", "$"),
    "pollInterval": int(os.environ.get("POLL_INTERVAL", "3")),
    "defaultPeriod": os.environ.get("DEFAULT_PERIOD", "Week"),
}
