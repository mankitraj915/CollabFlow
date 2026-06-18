# CollabFlow — Implementation Walkthrough

## Overview

Delivered the complete backend engine for a real-time multiplayer dependency graph and WBS generator across **4 sequential code blocks** and **12 files**.

## Project Structure

```
CollabFlow/
├── manage.py
├── requirements.txt
├── collabflow/
│   ├── __init__.py
│   ├── settings.py          ← PostgreSQL + Redis + ASGI config
│   ├── asgi.py              ← Block 1: ProtocolTypeRouter
│   └── urls.py
└── graph/
    ├── __init__.py
    ├── apps.py
    ├── models.py             ← Block 2: Project, Node, Edge
    ├── services.py           ← Block 3: Kahn's + CPM
    ├── consumers.py          ← Block 4: AsyncWebsocketConsumer
    ├── routing.py            ← Block 1: WebSocket URL patterns
    └── migrations/
        └── 0001_initial.py   ← Auto-generated
```

---

## Block 1 — ASGI Setup

### [asgi.py](file:///c:/Users/manki/OneDrive/Desktop/CollabFlow/collabflow/asgi.py)
- `ProtocolTypeRouter` splits HTTP and WebSocket traffic
- WebSocket connections pass through `AuthMiddlewareStack` → `URLRouter`
- Django is explicitly `setup()` before importing app-level routing to avoid `AppRegistryNotReady`

### [routing.py](file:///c:/Users/manki/OneDrive/Desktop/CollabFlow/graph/routing.py)
- Single WebSocket endpoint: `ws/graph/<project_id>/`
- UUID regex pattern: `[0-9a-f\-]{36}`

---

## Block 2 — Database Schema

### [models.py](file:///c:/Users/manki/OneDrive/Desktop/CollabFlow/graph/models.py)

| Model | Purpose | Key Constraints |
|-------|---------|----------------|
| **Project** | Container for a graph workspace | UUID PK |
| **Node** | Task/feature with effort + canvas position | `UNIQUE(project, label)` |
| **Edge** | Directional dependency between nodes | `UNIQUE(source, target)` + `CHECK(source ≠ target)` |

- All primary keys are `UUIDField` for distributed-safe ID generation
- Self-loop prevention at the database level via CHECK constraint
- Cascade deletes ensure referential integrity

---

## Block 3 — Graph Algorithm Service

### [services.py](file:///c:/Users/manki/OneDrive/Desktop/CollabFlow/graph/services.py)

**Adjacency List Builder**: Queries `Node` and `Edge` tables, builds in-memory `AdjacencyData` dataclass with forward/reverse adjacency lists and in-degree map.

**Kahn's Algorithm** (`_kahns_algorithm`):
- Initializes queue with zero in-degree nodes
- Processes BFS, decrementing neighbor in-degrees
- If `len(sorted) ≠ len(nodes)` → raises `CyclicDependencyError` with unresolved node labels

**Critical Path Method** (`compute_critical_path`):
- **Forward pass**: ES = max(EF of predecessors), EF = ES + effort
- **Backward pass**: LF = min(LS of successors), LS = LF - effort
- **Float**: total_float = LS - ES; critical if |float| < 1e-9
- Returns `CPMResult` dataclass with per-node schedules, critical path, and total duration

**Edge Validation** (`validate_edge_creation`):
- Simulates edge insertion in memory
- Runs Kahn's on the augmented graph
- Raises `CyclicDependencyError` if cycle detected — no DB write occurs

---

## Block 4 — Real-Time Synchronization

### [consumers.py](file:///c:/Users/manki/OneDrive/Desktop/CollabFlow/graph/consumers.py)

`GraphConsumer(AsyncWebsocketConsumer)`:

| Lifecycle | Behavior |
|-----------|----------|
| `connect` | Validates UUID, checks project exists, joins Redis group `graph_{id}`, sends full snapshot (nodes + edges + CPM) |
| `disconnect` | Leaves Redis group |
| `receive` | Dispatches by `action` field to typed handlers |

**Action handlers** (6 total):
- `node.create` / `node.update` / `node.delete` / `node.move`
- `edge.create` (with cycle validation) / `edge.delete`

**Flow**: Validate payload → persist via `@database_sync_to_async` → broadcast delta to Redis group → all connected clients receive via `graph_update`

**Error handling**: Invalid JSON, missing fields, unknown actions, non-existent nodes, and cycle violations all return structured `{"type": "error", "message": "..."}` payloads.

---

## Verification Results

| Check | Result |
|-------|--------|
| `python manage.py check` | ✅ System check identified no issues (0 silenced) |
| `python manage.py makemigrations` | ✅ 3 models + 3 constraints generated |

---

## Next Steps to Run

1. **Create PostgreSQL database**: `CREATE DATABASE collabflow;`
2. **Apply migrations**: `python manage.py migrate`
3. **Start Redis**: `redis-server`
4. **Run ASGI server**: `python manage.py runserver` (Daphne auto-detected via `ASGI_APPLICATION`)
5. **Connect WebSocket**: `ws://localhost:8000/ws/graph/<project-uuid>/`
