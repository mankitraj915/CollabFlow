from django.contrib import admin

from graph.models import Edge, Node, Project


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["name", "id", "created_at", "updated_at"]
    search_fields = ["name"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(Node)
class NodeAdmin(admin.ModelAdmin):
    list_display = [
        "label", "project", "effort_hours", "is_critical",
        "earliest_start", "earliest_finish", "total_slack",
    ]
    list_filter = ["is_critical", "project"]
    search_fields = ["label"]


@admin.register(Edge)
class EdgeAdmin(admin.ModelAdmin):
    list_display = ["source", "target", "project", "created_at"]
    list_filter = ["project"]
