import os

from django.core.wsgi import get_wsgi_application

from groceryproj.ingress import IngressScriptNameMiddleware

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "groceryproj.settings")

application = IngressScriptNameMiddleware(get_wsgi_application())
