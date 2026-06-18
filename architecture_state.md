# CollabFlow: Architecture State & Onboarding Guide

## 1. The Mental Model

CollabFlow is a real-time, multiplayer dependency graph and Work Breakdown Structure (WBS) generator. At its core, it is a **reactive, centralized state engine**. 

The system operates on a hub-and-spoke model where the Django backend acts as the authoritative hub, and connected clients (browsers) are thin, rendering spokes.
*   **The Graph as Truth**: The fundamental data structure is a Directed Acyclic Graph (DAG). Nodes represent tasks with effort estimates, and edges represent dependencies.
*   **Real-time Synchronization**: The system uses WebSockets to broadcast state mutations (deltas) to all connected clients in a specific project room. When a user drags a node or creates an edge, the intent is sent to the server, validated, persisted, and then the confirmed state change is broadcasted.
*   **Algorithmic Authority**: The backend enforces structural integrity. It prevents circular dependencies (cycles) using Kahn's Algorithm *before* allowing an edge to be persisted. It also recalculates the Critical Path Method (CPM) metrics (Earliest Start, Latest Finish, Slack, etc.) on every structural mutation and persists these time vectors to optimize read operations.

### Primary Data Flow (Mutation)
1. **Client Action**: User interacts with the Canvas UI (e.g., links two nodes).
2. **WebSocket Emit**: JSON payload dispatched over WS (`edge.create`).
3. **Consumer Routing**: `GraphConsumer` decodes and routes the action.
4. **Validation & Algorithm**: `services.py` simulates the edge insertion. If a cycle is detected, an error is returned.
5. **Atomic Persistence**: If valid, the edge is committed, and CPM is recalculated and bulk-updated on all affected nodes via a database transaction.
6. **Broadcast**: A success payload (including the new edge and updated CPM state) is broadcast via Redis to the Channel Group.
7. **Client Render**: Client receives the broadcast, mutates its local state, and the `requestAnimationFrame` loop redraws the Canvas.

## 2. Tech Stack & Explicit Dependencies

*   **Backend Framework**: Python 3.11, Django 5.x.
*   **Real-time Layer**: Django Channels 4.x, Daphne (ASGI server).
*   **Message Broker**: Redis 7 (via `channels-redis`) for routing WebSocket group messages.
*   **Database**: PostgreSQL 16 (via `psycopg2-binary`). Uses UUIDv4 primary keys for distributed-safe ID generation.
*   **Frontend**: Vanilla HTML5, CSS Grid, and Canvas API. Zero frontend framework dependencies. 
*   **Infrastructure**: Docker & Docker Compose (multi-stage builds, deterministic health-check startup sequencing).

## 3. Implicit Logic & Assumptions

*   **Optimistic Canvas Movement**: Node dragging updates local coordinates instantly for a zero-lag feel, while throttling WS `node.move` emissions to 20Hz. The backend accepts these coordinates without validation, trusting the client's positional data.
*   **No Authentication (Yet)**: The `AuthMiddlewareStack` is in place, but connections currently resolve based entirely on knowing the project UUID. Anyone with the URL can view and mutate the graph.
*   **Global CPM Recalculation**: The entire Critical Path is recalculated and persisted across all nodes on *every* structural change (node add/del, edge add/del). This is fine for small/medium graphs but is an implicit assumption that $O(V+E)$ operations are cheap enough to run synchronously on the WS thread.
*   **Auto-Project Creation**: Visiting the root URL (`/`) automatically creates a default project if none exist, or redirects to the first available project. This is a development convenience.

## 4. Structural Overview

```text
CollabFlow/
├── Dockerfile                  # Multi-stage production build (Daphne)
├── docker-compose.yml          # Local dev environment (Postgres, Redis, Web)
├── manage.py                   # Django CLI
├── requirements.txt            # Pinned Python dependencies
├── collabflow/                 # Global Django Configuration
│   ├── asgi.py                 # ProtocolTypeRouter (HTTP vs WS)
│   ├── settings.py             # ENV-driven config (DB, Redis, Channels)
│   └── urls.py                 # Core routing (Admin, Frontend views)
├── graph/                      # Core Application Domain
│   ├── admin.py                # Django Admin interface
│   ├── consumers.py            # AsyncWebsocketConsumer (The WS Controller)
│   ├── models.py               # Project, Node (Time Vectors), Edge
│   ├── routing.py              # WS URL patterns
│   ├── services.py             # Kahn's Algo, CPM Math, Business Logic
│   └── views.py                # HTTP Views (serving the Canvas)
└── templates/
    └── index.html              # The entire UI Engine (Grid, Canvas, WS Logic)
```

**Entry Points**:
*   **HTTP**: `collabflow/urls.py` -> `graph.views.project_view` -> `index.html`
*   **WebSocket**: `collabflow/asgi.py` -> `graph/routing.py` -> `graph.consumers.GraphConsumer`

## 5. Fragile vs. Robust Systems

### Robust (Production-Ready concepts)
*   **Schema Design**: Models use UUIDs and enforce DB-level constraints (e.g., `CHECK(source != target)` to prevent self-loops, `UNIQUE(source, target)`).
*   **Algorithmic Core**: The `services.py` layer is pure, decoupled, and handles cycle detection and CPM mathematically.
*   **Deployment Architecture**: The Docker Compose setup utilizes health checks to ensure DB/Redis are accepting connections before the ASGI server boots, preventing race conditions.
*   **Atomic Operations**: Edge creation utilizes `transaction.atomic()` and `select_for_update()` to prevent race conditions that could bypass cycle detection during concurrent edge creation.

### Fragile (MVP/Scaffolding)
*   **Conflict Resolution**: If two users drag the same node, it's a "last write wins" race condition. There are no CRDTs or operational transforms in place.
*   **Canvas Event Handling**: The `index.html` file is monolithic (~600 lines). The hit-testing, panning, zooming, and drag-and-drop state machines are custom-built and tightly coupled to the render loop. It works well, but scaling it to handle complex selections/groups will require refactoring into modular JS classes.
*   **Error Recovery**: If the WS connection drops, it attempts a naive reconnect. However, it does not queue offline actions or request missed deltas upon reconnection; it relies on receiving a fresh full snapshot.

## 6. Immediate Development Horizon

1.  **Resolve Local Environment Conflict**: 
    *   *Issue*: `Bind for 0.0.0.0:5432 failed: port is already allocated`. The local machine is already running a Postgres instance on 5432, conflicting with the Docker Compose Postgres container.
    *   *Action*: Update `docker-compose.yml` to expose Postgres on a different host port (e.g., `"5433:5432"`) or stop the local host service.
2.  **Authentication & Authorization**: Implement proper user sessions or JWT tokens so that project access can be scoped to specific users/teams.
3.  **Frontend Modularization**: Extract the Javascript from `index.html` into a dedicated `static/js/app.js` and split the logic into Canvas Engine, WebSocket Manager, and UI State Manager.
4.  **Optimized Recalculation**: Profile the CPM recalculation. As graphs grow to 1000+ nodes, recalculating the entire graph synchronously inside the consumer will cause WS frame blocking. This should eventually be pushed to a Celery task or optimized to only recalculate affected sub-graphs.
