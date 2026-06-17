"""
Home Assistant Ingress integration helpers.

Ingress proxies requests to the add-on, strips its random base path
(/api/hassio_ingress/<token>) from PATH_INFO, and passes the stripped prefix in
the ``X-Ingress-Path`` header. To make Django generate correct absolute URLs
(admin links, {% static %} tags, redirects) under that prefix we set the WSGI
``SCRIPT_NAME`` from the header. With a *relative* STATIC_URL, Django then
prepends the prefix automatically.

The React SPA itself does not rely on SCRIPT_NAME: its assets use relative Vite
paths and its API calls are derived from window.location, so it works behind the
ingress base path regardless.
"""


from django.urls import get_script_prefix
from whitenoise.storage import CompressedStaticFilesStorage


class IngressStaticFilesStorage(CompressedStaticFilesStorage):
    """Static storage whose URLs include the per-request ingress prefix.

    ``{% static %}`` (used by the admin/unfold templates and the DRF browsable
    API) normally emits root-relative ``/static/...`` URLs, which escape the
    ingress base path in the browser and 404. We prepend the WSGI script prefix
    (set from X-Ingress-Path) so they resolve as
    ``/api/hassio_ingress/<token>/static/...``. Outside ingress the prefix is
    just ``/``.
    """

    def url(self, name, force=False):
        return get_script_prefix() + "static/" + name.lstrip("/")


class IngressScriptNameMiddleware:
    """WSGI middleware that maps X-Ingress-Path -> SCRIPT_NAME."""

    def __init__(self, application):
        self.application = application

    def __call__(self, environ, start_response):
        ingress_path = environ.get("HTTP_X_INGRESS_PATH")
        if ingress_path:
            environ["SCRIPT_NAME"] = ingress_path.rstrip("/")
        return self.application(environ, start_response)


class DisableCSRFMiddleware:
    """Disable Django's CSRF host/referer enforcement.

    Requests reach the app only through the Home Assistant ingress proxy, which
    authenticates the user. The brief requires that we never add CSRF/host
    checks that would break ingress requests, so we mark every request as
    exempt. There is no public port, so this is not a meaningful exposure.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        setattr(request, "_dont_enforce_csrf_checks", True)
        return self.get_response(request)
