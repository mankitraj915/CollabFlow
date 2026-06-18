from __future__ import annotations

import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from graph.models import Edge, Node


class CyclicDependencyError(Exception):
    pass


@dataclass(frozen=True)
class NodeSchedule:
    node_id: uuid.UUID
    label: str
    effort_hours: float
    earliest_start: float
    earliest_finish: float
    latest_start: float
    latest_finish: float
    total_float: float
    is_critical: bool


@dataclass
class CPMResult:
    total_duration: float
    schedules: dict[uuid.UUID, NodeSchedule]
    critical_path: list[uuid.UUID]
    topological_order: list[uuid.UUID]


@dataclass
class AdjacencyData:
    adjacency: dict[uuid.UUID, list[uuid.UUID]] = field(default_factory=dict)
    reverse_adjacency: dict[uuid.UUID, list[uuid.UUID]] = field(default_factory=dict)
    in_degree: dict[uuid.UUID, int] = field(default_factory=dict)
    node_map: dict[uuid.UUID, dict[str, Any]] = field(default_factory=dict)


def build_adjacency_list(project_id: uuid.UUID) -> AdjacencyData:
    nodes = Node.objects.filter(project_id=project_id).values(
        "id", "label", "effort_hours"
    )

    data = AdjacencyData()

    for node in nodes:
        node_id: uuid.UUID = node["id"]
        data.adjacency[node_id] = []
        data.reverse_adjacency[node_id] = []
        data.in_degree[node_id] = 0
        data.node_map[node_id] = {
            "label": node["label"],
            "effort_hours": node["effort_hours"],
        }

    edges = Edge.objects.filter(project_id=project_id).values("source_id", "target_id")

    for edge in edges:
        source_id: uuid.UUID = edge["source_id"]
        target_id: uuid.UUID = edge["target_id"]
        data.adjacency[source_id].append(target_id)
        data.reverse_adjacency[target_id].append(source_id)
        data.in_degree[target_id] += 1

    return data


def topological_sort(project_id: uuid.UUID) -> list[uuid.UUID]:
    data: AdjacencyData = build_adjacency_list(project_id)
    return _kahns_algorithm(data)


def _kahns_algorithm(data: AdjacencyData) -> list[uuid.UUID]:
    in_degree: dict[uuid.UUID, int] = {k: v for k, v in data.in_degree.items()}
    queue: deque[uuid.UUID] = deque()

    for node_id, degree in in_degree.items():
        if degree == 0:
            queue.append(node_id)

    sorted_order: list[uuid.UUID] = []

    while queue:
        current: uuid.UUID = queue.popleft()
        sorted_order.append(current)

        for neighbor in data.adjacency.get(current, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(sorted_order) != len(data.in_degree):
        processed_labels: set[str] = {
            data.node_map[nid]["label"] for nid in sorted_order
        }
        unresolved_labels: list[str] = [
            info["label"]
            for nid, info in data.node_map.items()
            if info["label"] not in processed_labels
        ]
        raise CyclicDependencyError(
            f"Cycle detected among nodes: {unresolved_labels}"
        )

    return sorted_order


def compute_critical_path(project_id: uuid.UUID) -> CPMResult:
    data: AdjacencyData = build_adjacency_list(project_id)

    if not data.node_map:
        return CPMResult(
            total_duration=0.0,
            schedules={},
            critical_path=[],
            topological_order=[],
        )

    topo_order: list[uuid.UUID] = _kahns_algorithm(data)

    earliest_start: dict[uuid.UUID, float] = {}
    earliest_finish: dict[uuid.UUID, float] = {}

    for node_id in topo_order:
        effort: float = data.node_map[node_id]["effort_hours"]
        predecessors: list[uuid.UUID] = data.reverse_adjacency.get(node_id, [])

        if not predecessors:
            earliest_start[node_id] = 0.0
        else:
            earliest_start[node_id] = max(
                earliest_finish[pred] for pred in predecessors
            )

        earliest_finish[node_id] = earliest_start[node_id] + effort

    total_duration: float = max(earliest_finish.values()) if earliest_finish else 0.0

    latest_finish: dict[uuid.UUID, float] = {}
    latest_start: dict[uuid.UUID, float] = {}

    for node_id in reversed(topo_order):
        effort: float = data.node_map[node_id]["effort_hours"]
        successors: list[uuid.UUID] = data.adjacency.get(node_id, [])

        if not successors:
            latest_finish[node_id] = total_duration
        else:
            latest_finish[node_id] = min(
                latest_start[succ] for succ in successors
            )

        latest_start[node_id] = latest_finish[node_id] - effort

    schedules: dict[uuid.UUID, NodeSchedule] = {}
    critical_path: list[uuid.UUID] = []

    for node_id in topo_order:
        total_float: float = latest_start[node_id] - earliest_start[node_id]
        is_critical: bool = abs(total_float) < 1e-9

        schedules[node_id] = NodeSchedule(
            node_id=node_id,
            label=data.node_map[node_id]["label"],
            effort_hours=data.node_map[node_id]["effort_hours"],
            earliest_start=earliest_start[node_id],
            earliest_finish=earliest_finish[node_id],
            latest_start=latest_start[node_id],
            latest_finish=latest_finish[node_id],
            total_float=total_float,
            is_critical=is_critical,
        )

        if is_critical:
            critical_path.append(node_id)

    return CPMResult(
        total_duration=total_duration,
        schedules=schedules,
        critical_path=critical_path,
        topological_order=topo_order,
    )


def compute_and_persist_critical_path(project_id: uuid.UUID) -> CPMResult:
    result: CPMResult = compute_critical_path(project_id)

    nodes_to_update: list[Node] = []
    for node_id, schedule in result.schedules.items():
        nodes_to_update.append(
            Node(
                id=node_id,
                earliest_start=schedule.earliest_start,
                earliest_finish=schedule.earliest_finish,
                latest_start=schedule.latest_start,
                latest_finish=schedule.latest_finish,
                total_slack=schedule.total_float,
                is_critical=schedule.is_critical,
            )
        )

    if nodes_to_update:
        Node.objects.bulk_update(
            nodes_to_update,
            [
                "earliest_start",
                "earliest_finish",
                "latest_start",
                "latest_finish",
                "total_slack",
                "is_critical",
            ],
        )

    return result


def validate_edge_creation(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> bool:
    data: AdjacencyData = build_adjacency_list(project_id)

    if source_id not in data.adjacency or target_id not in data.adjacency:
        raise ValueError("Source or target node does not belong to this project")

    if source_id == target_id:
        raise CyclicDependencyError("Self-loop detected: source equals target")

    data.adjacency[source_id].append(target_id)
    data.reverse_adjacency[target_id].append(source_id)
    data.in_degree[target_id] += 1

    try:
        _kahns_algorithm(data)
    except CyclicDependencyError:
        raise CyclicDependencyError(
            f"Adding edge would create a cycle in the dependency graph"
        )

    return True


def serialize_cpm_result(result: CPMResult) -> dict[str, Any]:
    return {
        "total_duration": result.total_duration,
        "critical_path": [str(nid) for nid in result.critical_path],
        "topological_order": [str(nid) for nid in result.topological_order],
        "schedules": {
            str(nid): {
                "label": sched.label,
                "effort_hours": sched.effort_hours,
                "earliest_start": sched.earliest_start,
                "earliest_finish": sched.earliest_finish,
                "latest_start": sched.latest_start,
                "latest_finish": sched.latest_finish,
                "total_float": sched.total_float,
                "is_critical": sched.is_critical,
            }
            for nid, sched in result.schedules.items()
        },
    }
