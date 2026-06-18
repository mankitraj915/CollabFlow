from django.contrib import admin
from django.urls import include, path

from graph.views import create_project_view, index_view, project_view, signup_view, guest_login_view, dashboard_view, toggle_public_view

urlpatterns: list = [
    path("admin/", admin.site.urls),
    path("accounts/signup/", signup_view, name="signup"),
    path("accounts/guest/", guest_login_view, name="guest_login"),
    path("accounts/", include("django.contrib.auth.urls")),
    path("", index_view, name="index"),
    path("dashboard/", dashboard_view, name="dashboard"),
    path("project/create/", create_project_view, name="create_project"),
    path("project/<uuid:project_id>/", project_view, name="project"),
    path("project/<uuid:project_id>/toggle-public/", toggle_public_view, name="toggle_public"),
]
