import uuid

from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from graph.models import Project


@login_required
def index_view(request: HttpRequest) -> HttpResponse:
    projects = Project.objects.filter(owner=request.user)
    return render(request, "dashboard.html", {"projects": projects})


@login_required
@require_POST
def create_project_view(request: HttpRequest) -> HttpResponse:
    name = request.POST.get("name", "New Project")
    project = Project.objects.create(name=name, owner=request.user)
    return redirect("project", project_id=project.id)


@login_required
def project_view(request: HttpRequest, project_id: uuid.UUID) -> HttpResponse:
    project = get_object_or_404(Project, id=project_id, owner=request.user)
    return render(request, "index.html", {"project": project, "project_id": str(project_id)})
