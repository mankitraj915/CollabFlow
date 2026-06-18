from django.urls import re_path

from graph.consumers import GraphConsumer

websocket_urlpatterns: list = [
    re_path(
        r"ws/graph/(?P<project_id>[0-9a-f\-]{36})/$",
        GraphConsumer.as_asgi(),
    ),
]
