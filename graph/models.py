import uuid

from django.conf import settings
from django.db import models


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="projects",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "graph_project"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name


class Node(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="nodes",
        db_index=True,
    )
    label = models.CharField(max_length=255)
    effort_hours = models.FloatField(default=0.0)
    position_x = models.FloatField(default=0.0)
    position_y = models.FloatField(default=0.0)
    earliest_start = models.FloatField(default=0.0)
    earliest_finish = models.FloatField(default=0.0)
    latest_start = models.FloatField(default=0.0)
    latest_finish = models.FloatField(default=0.0)
    total_slack = models.FloatField(default=0.0)
    is_critical = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "graph_node"
        constraints = [
            models.UniqueConstraint(
                fields=["project", "label"],
                name="uq_node_project_label",
            ),
        ]
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.label} ({self.project.name})"


class Edge(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="edges",
        db_index=True,
    )
    source = models.ForeignKey(
        Node,
        on_delete=models.CASCADE,
        related_name="outgoing_edges",
    )
    target = models.ForeignKey(
        Node,
        on_delete=models.CASCADE,
        related_name="incoming_edges",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "graph_edge"
        constraints = [
            models.UniqueConstraint(
                fields=["source", "target"],
                name="uq_edge_source_target",
            ),
            models.CheckConstraint(
                condition=~models.Q(source=models.F("target")),
                name="ck_edge_no_self_loop",
            ),
        ]
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.source.label} → {self.target.label}"
