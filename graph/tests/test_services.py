import uuid
import pytest
from django.contrib.auth import get_user_model
from graph.models import Node, Edge, Project
from graph.services import (
    compute_critical_path,
    validate_edge_creation,
    CyclicDependencyError,
)

User = get_user_model()

@pytest.fixture
def user(db):
    return User.objects.create_user(username="testuser", password="password")

@pytest.fixture
def project(db, user):
    return Project.objects.create(name="Test Project", owner=user)

@pytest.mark.django_db
def test_compute_critical_path_linear(project):
    # A -> B -> C
    node_a = Node.objects.create(project=project, label="A", effort_hours=2.0, position_x=0, position_y=0)
    node_b = Node.objects.create(project=project, label="B", effort_hours=3.0, position_x=0, position_y=0)
    node_c = Node.objects.create(project=project, label="C", effort_hours=1.0, position_x=0, position_y=0)

    Edge.objects.create(project=project, source=node_a, target=node_b)
    Edge.objects.create(project=project, source=node_b, target=node_c)

    result = compute_critical_path(project.id)
    
    assert result.total_duration == 6.0
    assert len(result.critical_path) == 3
    assert result.topological_order == [node_a.id, node_b.id, node_c.id]
    
    # Check floats
    assert result.schedules[node_a.id].total_float == 0.0
    assert result.schedules[node_b.id].total_float == 0.0
    assert result.schedules[node_c.id].total_float == 0.0

@pytest.mark.django_db
def test_compute_critical_path_parallel(project):
    # A -> B -> D (2 + 4 + 1 = 7)
    # A -> C -> D (2 + 2 + 1 = 5)
    node_a = Node.objects.create(project=project, label="A", effort_hours=2.0, position_x=0, position_y=0)
    node_b = Node.objects.create(project=project, label="B", effort_hours=4.0, position_x=0, position_y=0)
    node_c = Node.objects.create(project=project, label="C", effort_hours=2.0, position_x=0, position_y=0)
    node_d = Node.objects.create(project=project, label="D", effort_hours=1.0, position_x=0, position_y=0)

    Edge.objects.create(project=project, source=node_a, target=node_b)
    Edge.objects.create(project=project, source=node_a, target=node_c)
    Edge.objects.create(project=project, source=node_b, target=node_d)
    Edge.objects.create(project=project, source=node_c, target=node_d)

    result = compute_critical_path(project.id)

    assert result.total_duration == 7.0
    assert set(result.critical_path) == {node_a.id, node_b.id, node_d.id}
    
    # C should have float
    assert result.schedules[node_c.id].total_float == 2.0
    assert not result.schedules[node_c.id].is_critical

@pytest.mark.django_db
def test_validate_edge_creation_prevents_cycles(project):
    node_a = Node.objects.create(project=project, label="A", effort_hours=1.0, position_x=0, position_y=0)
    node_b = Node.objects.create(project=project, label="B", effort_hours=1.0, position_x=0, position_y=0)

    Edge.objects.create(project=project, source=node_a, target=node_b)

    # Creating B -> A should fail
    with pytest.raises(CyclicDependencyError):
        validate_edge_creation(project.id, node_b.id, node_a.id)

@pytest.mark.django_db
def test_validate_edge_creation_prevents_self_loop(project):
    node_a = Node.objects.create(project=project, label="A", effort_hours=1.0, position_x=0, position_y=0)

    with pytest.raises(CyclicDependencyError):
        validate_edge_creation(project.id, node_a.id, node_a.id)
