from django.contrib import admin
from django.urls import include, path

from graph.views import create_project_view, index_view, project_view

urlpatterns: list = [
    path("admin/", admin.site.urls),
    path("accounts/", include("django.contrib.auth.urls")),
    path("", index_view, name="index"),
    path("project/create/", create_project_view, name="create_project"),
    path("project/<uuid:project_id>/", project_view, name="project"),
]
