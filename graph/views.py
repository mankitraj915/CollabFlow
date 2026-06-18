import uuid
import random
import string

from django.contrib.auth import login
from django.contrib.auth.models import User
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from graph.models import Project


def index_view(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        return redirect("dashboard")
    return render(request, "landing.html")


@login_required
def dashboard_view(request: HttpRequest) -> HttpResponse:
    projects = Project.objects.filter(owner=request.user)
    return render(request, "dashboard.html", {"projects": projects})


def signup_view(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        return redirect("dashboard")
    if request.method == "POST":
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect("dashboard")
    else:
        form = UserCreationForm()
    return render(request, "registration/signup.html", {"form": form})


@require_POST
def guest_login_view(request: HttpRequest) -> HttpResponse:
    guest_suffix = "".join(random.choices(string.digits, k=6))
    username = f"guest_{guest_suffix}"
    password = "".join(random.choices(string.ascii_letters + string.digits, k=12))
    user = User.objects.create_user(username=username, password=password)
    login(request, user)
    return redirect("dashboard")


@login_required
@require_POST
def create_project_view(request: HttpRequest) -> HttpResponse:
    name = request.POST.get("name", "New Project")
    project = Project.objects.create(name=name, owner=request.user)
    return redirect("project", project_id=project.id)


def project_view(request: HttpRequest, project_id: uuid.UUID) -> HttpResponse:
    project = get_object_or_404(Project, id=project_id)
    # Allow anonymous access if project is public
    if not project.is_public and project.owner != request.user:
        if not request.user.is_authenticated:
            return redirect("login")
        return HttpResponse("Unauthorized", status=403)
    
    return render(request, "index.html", {
        "project": project, 
        "project_id": str(project_id),
        "is_owner": request.user == project.owner
    })

@login_required
@require_POST
def toggle_public_view(request: HttpRequest, project_id: uuid.UUID) -> HttpResponse:
    project = get_object_or_404(Project, id=project_id, owner=request.user)
    is_public = request.POST.get("is_public") == "true"
    project.is_public = is_public
    project.save(update_fields=["is_public"])
    return JsonResponse({"status": "ok", "is_public": is_public})
