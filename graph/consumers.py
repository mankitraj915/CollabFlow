from __future__ import annotations

import json
import time
import uuid
from typing import Any

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.core.cache import cache
from django.db import IntegrityError, transaction

from graph.models import Edge, Node, Project
from graph.services import (
    CyclicDependencyError,
    compute_and_persist_critical_path,
    serialize_cpm_result,
    validate_edge_creation,
)


class GraphConsumer(AsyncWebsocketConsumer):
    project_id: uuid.UUID
    group_name: str

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.last_receive_time = 0.0
        self.message_count = 0

    async def connect(self) -> None:
        raw_project_id: str = self.scope["url_route"]["kwargs"]["project_id"]

        try:
            self.project_id = uuid.UUID(raw_project_id)
        except ValueError:
            await self.close(code=4000)
            return

        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4003)
            return

        has_access: bool = await self._verify_project_access(self.project_id, user)
        if not has_access:
            await self.close(code=4004)
            return

        self.group_name = f"graph_{self.project_id}"

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        snapshot: dict[str, Any] = await self._get_optimized_snapshot(self.project_id)
        await self.send(text_data=json.dumps({
            "type": "snapshot",
            "payload": snapshot,
        }))

    async def disconnect(self, close_code: int) -> None:
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(
                self.group_name, self.channel_name
            )

    async def receive(self, text_data: str = "", bytes_data: bytes = b"") -> None:
        now = time.time()
        if now - self.last_receive_time > 1.0:
            self.last_receive_time = now
            self.message_count = 0
            
        self.message_count += 1
        if self.message_count > 40:
            await self._send_error("Rate limit exceeded")
            return

        try:
            message: dict[str, Any] = json.loads(text_data)
        except json.JSONDecodeError:
            await self._send_error("Invalid JSON payload")
            return

        action: str = message.get("action", "")
        payload: dict[str, Any] = message.get("payload", {})

        handler_map: dict[str, Any] = {
            "node.create": self._handle_node_create,
            "node.update": self._handle_node_update,
            "node.delete": self._handle_node_delete,
            "node.move": self._handle_node_move,
            "edge.create": self._handle_edge_create,
            "edge.delete": self._handle_edge_delete,
        }

        handler = handler_map.get(action)
        if handler is None:
            await self._send_error(f"Unknown action: {action}")
            return

        await handler(payload)

    async def graph_update(self, event: dict[str, Any]) -> None:
        await self.send(text_data=json.dumps({
            "type": "delta",
            "action": event["action"],
            "payload": event["payload"],
        }))

    async def _handle_node_create(self, payload: dict[str, Any]) -> None:
        label: str | None = payload.get("label")
        effort_hours: float = float(payload.get("effort_hours", 0.0))
        position_x: float = float(payload.get("position_x", 0.0))
        position_y: float = float(payload.get("position_y", 0.0))

        if not label:
            await self._send_error("Node label is required")
            return

        try:
            result: dict[str, Any] = await self._create_node_with_cpm(
                self.project_id, label, effort_hours, position_x, position_y
            )
        except IntegrityError:
            await self._send_error(f"Node with label '{label}' already exists")
            return

        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "graph.update",
                "action": "node.created",
                "payload": result,
            },
        )

    async def _handle_node_update(self, payload: dict[str, Any]) -> None:
        node_id_str: str | None = payload.get("node_id")
        if not node_id_str:
            await self._send_error("node_id is required")
            return

        try:
            node_id: uuid.UUID = uuid.UUID(node_id_str)
        except ValueError:
            await self._send_error("Invalid node_id format")
            return

        update_fields: dict[str, Any] = {}
        if "label" in payload:
            update_fields["label"] = payload["label"]
        if "effort_hours" in payload:
            update_fields["effort_hours"] = float(payload["effort_hours"])

        if not update_fields:
            await self._send_error("No valid fields to update")
            return

        result: dict[str, Any] | None = await self._update_node_with_cpm(
            node_id, update_fields
        )

        if result is None:
            await self._send_error("Node not found")
            return

        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "graph.update",
                "action": "node.updated",
                "payload": result,
            },
        )

    async def _handle_node_delete(self, payload: dict[str, Any]) -> None:
        node_id_str: str | None = payload.get("node_id")
        if not node_id_str:
            await self._send_error("node_id is required")
            return

        try:
            node_id: uuid.UUID = uuid.UUID(node_id_str)
        except ValueError:
            await self._send_error("Invalid node_id format")
            return

        result: dict[str, Any] | None = await self._delete_node_with_cpm(node_id)
        if result is None:
            await self._send_error("Node not found")
            return

        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "graph.update",
                "action": "node.deleted",
                "payload": result,
            },
        )

    async def _handle_node_move(self, payload: dict[str, Any]) -> None:
        node_id_str: str | None = payload.get("node_id")
        if not node_id_str:
            return

        try:
            node_id: uuid.UUID = uuid.UUID(node_id_str)
        except ValueError:
            return

        position_x: float | None = payload.get("position_x")
        position_y: float | None = payload.get("position_y")

        if position_x is None or position_y is None:
            return

        move_data: dict[str, Any] = {
            "node_id": str(node_id),
            "position_x": float(position_x),
            "position_y": float(position_y),
        }

        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "graph.update",
                "action": "node.moved",
                "payload": move_data,
            },
        )

        await self._persist_node_position(
            node_id, float(position_x), float(position_y)
        )

    async def _handle_edge_create(self, payload: dict[str, Any]) -> None:
        source_id_str: str | None = payload.get("source_id")
        target_id_str: str | None = payload.get("target_id")

        if not source_id_str or not target_id_str:
            await self._send_error("source_id and target_id are required")
            return

        try:
            source_id: uuid.UUID = uuid.UUID(source_id_str)
            target_id: uuid.UUID = uuid.UUID(target_id_str)
        except ValueError:
            await self._send_error("Invalid UUID format for source_id or target_id")
            return

        try:
            result: dict[str, Any] = await self._atomic_create_edge(
                self.project_id, source_id, target_id
            )
        except CyclicDependencyError as exc:
            await self._send_error(str(exc))
            return
        except ValueError as exc:
            await self._send_error(str(exc))
            return
        except IntegrityError:
            await self._send_error("Edge already exists or references invalid nodes")
            return

        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "graph.update",
                "action": "edge.created",
                "payload": result,
            },
        )

    async def _handle_edge_delete(self, payload: dict[str, Any]) -> None:
        source_id_str: str | None = payload.get("source_id")
        target_id_str: str | None = payload.get("target_id")

        if not source_id_str or not target_id_str:
            await self._send_error("source_id and target_id are required")
            return

        try:
            source_id: uuid.UUID = uuid.UUID(source_id_str)
            target_id: uuid.UUID = uuid.UUID(target_id_str)
        except ValueError:
            await self._send_error("Invalid UUID format")
            return

        result: dict[str, Any] | None = await self._delete_edge_with_cpm(
            source_id, target_id
        )
        if result is None:
            await self._send_error("Edge not found")
            return

        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "graph.update",
                "action": "edge.deleted",
                "payload": result,
            },
        )

    async def _send_error(self, message: str) -> None:
        await self.send(text_data=json.dumps({
            "type": "error",
            "message": message,
        }))

    @database_sync_to_async
    def _verify_project_access(self, project_id: uuid.UUID, user: Any) -> bool:
        if not user.is_authenticated:
            return False
        return Project.objects.filter(id=project_id, owner=user).exists()

    @database_sync_to_async
    def _get_optimized_snapshot(self, project_id: uuid.UUID) -> dict[str, Any]:
        from django.core.cache import cache
        cache_key = f"snapshot_{project_id}"
        cached_data = cache.get(cache_key)
        if cached_data:
            return cached_data

        nodes = list(
            Node.objects.filter(project_id=project_id)
            .select_related("project")
            .values(
                "id", "label", "effort_hours",
                "position_x", "position_y",
                "earliest_start", "earliest_finish",
                "latest_start", "latest_finish",
                "total_slack", "is_critical",
            )
        )

        edges = list(
            Edge.objects.filter(project_id=project_id)
            .select_related("source", "target")
            .values("source_id", "target_id")
        )

        cpm_result = compute_and_persist_critical_path(project_id)
        cpm_data: dict[str, Any] = serialize_cpm_result(cpm_result)

        serialized_nodes: list[dict[str, Any]] = [
            {
                "id": str(n["id"]),
                "label": n["label"],
                "effort_hours": n["effort_hours"],
                "position_x": n["position_x"],
                "position_y": n["position_y"],
                "earliest_start": cpm_result.schedules[n["id"]].earliest_start
                if n["id"] in cpm_result.schedules else n["earliest_start"],
                "earliest_finish": cpm_result.schedules[n["id"]].earliest_finish
                if n["id"] in cpm_result.schedules else n["earliest_finish"],
                "latest_start": cpm_result.schedules[n["id"]].latest_start
                if n["id"] in cpm_result.schedules else n["latest_start"],
                "latest_finish": cpm_result.schedules[n["id"]].latest_finish
                if n["id"] in cpm_result.schedules else n["latest_finish"],
                "total_slack": cpm_result.schedules[n["id"]].total_float
                if n["id"] in cpm_result.schedules else n["total_slack"],
                "is_critical": cpm_result.schedules[n["id"]].is_critical
                if n["id"] in cpm_result.schedules else n["is_critical"],
            }
            for n in nodes
        ]

        serialized_edges: list[dict[str, Any]] = [
            {
                "source_id": str(e["source_id"]),
                "target_id": str(e["target_id"]),
            }
            for e in edges
        ]

        result_data = {
            "project_id": str(project_id),
            "nodes": serialized_nodes,
            "edges": serialized_edges,
            "cpm": cpm_data,
        }
        
        cache.set(cache_key, result_data, timeout=86400)
        return result_data

    @database_sync_to_async
    def _create_node_with_cpm(
        self,
        project_id: uuid.UUID,
        label: str,
        effort_hours: float,
        position_x: float,
        position_y: float,
    ) -> dict[str, Any]:
        node: Node = Node.objects.create(
            project_id=project_id,
            label=label,
            effort_hours=effort_hours,
            position_x=position_x,
            position_y=position_y,
        )

        cpm_result = compute_and_persist_critical_path(project_id)
        cache.delete(f"snapshot_{project_id}")

        return {
            "node": {
                "id": str(node.id),
                "label": node.label,
                "effort_hours": node.effort_hours,
                "position_x": node.position_x,
                "position_y": node.position_y,
            },
            "cpm": serialize_cpm_result(cpm_result),
        }

    @database_sync_to_async
    def _update_node_with_cpm(
        self, node_id: uuid.UUID, fields: dict[str, Any]
    ) -> dict[str, Any] | None:
        try:
            node: Node = Node.objects.select_related("project").get(id=node_id)
        except Node.DoesNotExist:
            return None

        for field_name, value in fields.items():
            setattr(node, field_name, value)
        node.save(update_fields=list(fields.keys()) + ["updated_at"])

        if "effort_hours" in fields:
            cpm_result = compute_and_persist_critical_path(node.project_id)
            cpm_data = serialize_cpm_result(cpm_result)
        else:
            cpm_data = None

        cache.delete(f"snapshot_{node.project_id}")

        return {
            "node": {
                "id": str(node.id),
                "label": node.label,
                "effort_hours": node.effort_hours,
                "position_x": node.position_x,
                "position_y": node.position_y,
            },
            "cpm": cpm_data,
        }

    @database_sync_to_async
    def _delete_node_with_cpm(self, node_id: uuid.UUID) -> dict[str, Any] | None:
        try:
            node: Node = Node.objects.get(id=node_id)
        except Node.DoesNotExist:
            return None

        project_id: uuid.UUID = node.project_id
        node.delete()

        cpm_result = compute_and_persist_critical_path(project_id)
        cache.delete(f"snapshot_{project_id}")

        return {
            "node_id": str(node_id),
            "cpm": serialize_cpm_result(cpm_result),
        }

    @database_sync_to_async
    def _persist_node_position(
        self, node_id: uuid.UUID, position_x: float, position_y: float
    ) -> None:
        Node.objects.filter(id=node_id).update(
            position_x=position_x, position_y=position_y
        )
        node = Node.objects.filter(id=node_id).first()
        if node:
            cache.delete(f"snapshot_{node.project_id}")

    @database_sync_to_async
    def _atomic_create_edge(
        self,
        project_id: uuid.UUID,
        source_id: uuid.UUID,
        target_id: uuid.UUID,
    ) -> dict[str, Any]:
        with transaction.atomic():
            Node.objects.filter(project_id=project_id).select_for_update()
            validate_edge_creation(project_id, source_id, target_id)
            Edge.objects.create(
                project_id=project_id,
                source_id=source_id,
                target_id=target_id,
            )

        cpm_result = compute_and_persist_critical_path(project_id)
        cache.delete(f"snapshot_{project_id}")

        return {
            "source_id": str(source_id),
            "target_id": str(target_id),
            "project_id": str(project_id),
            "cpm": serialize_cpm_result(cpm_result),
        }

    @database_sync_to_async
    def _delete_edge_with_cpm(
        self, source_id: uuid.UUID, target_id: uuid.UUID
    ) -> dict[str, Any] | None:
        edge_qs = Edge.objects.filter(source_id=source_id, target_id=target_id)
        if not edge_qs.exists():
            return None

        project_id: uuid.UUID = edge_qs.first().project_id
        edge_qs.delete()

        cpm_result = compute_and_persist_critical_path(project_id)
        cache.delete(f"snapshot_{project_id}")

        return {
            "source_id": str(source_id),
            "target_id": str(target_id),
            "cpm": serialize_cpm_result(cpm_result),
        }
