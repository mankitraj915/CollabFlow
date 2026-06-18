import asyncio
import uuid
import pytest
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from collabflow.asgi import application
from graph.models import Project

User = get_user_model()

@pytest.fixture
def test_user():
    user = User.objects.create_user(username="testuser", password="password")
    return user

@pytest.fixture
def test_project(test_user):
    return Project.objects.create(name="Test Project", owner=test_user)

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_phase3_websocket_system(test_project, test_user):
    # Setup connection
    communicator = WebsocketCommunicator(
        application, 
        f"/ws/graph/{test_project.id}/"
    )
    communicator.scope["user"] = test_user
    
    connected, subprotocol = await communicator.connect()
    assert connected, "WebSocket handshake failed"
    
    # Receive initial snapshot
    snapshot_response = await communicator.receive_json_from()
    assert snapshot_response["type"] == "snapshot"
    assert snapshot_response["payload"]["project_id"] == str(test_project.id)
    print("\n[PHASE 3] Handshake and Snapshot success.")
    
    await communicator.disconnect()

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_phase4_and_5_graph_functionality_and_cpm(test_project, test_user):
    communicator = WebsocketCommunicator(
        application, 
        f"/ws/graph/{test_project.id}/"
    )
    communicator.scope["user"] = test_user
    await communicator.connect()
    await communicator.receive_json_from() # Consume snapshot

    # CREATE NODE A (Effort: 2)
    await communicator.send_json_to({
        "action": "node.create",
        "payload": {"label": "A", "effort_hours": 2, "position_x": 0, "position_y": 0}
    })
    resp = await communicator.receive_json_from()
    assert resp["action"] == "node.created"
    node_a_id = resp["payload"]["node"]["id"]
    print(f"\n[PHASE 4] Node A created: {node_a_id}")

    # CREATE NODE B (Effort: 4)
    await communicator.send_json_to({
        "action": "node.create",
        "payload": {"label": "B", "effort_hours": 4, "position_x": 0, "position_y": 0}
    })
    resp = await communicator.receive_json_from()
    node_b_id = resp["payload"]["node"]["id"]
    print(f"[PHASE 4] Node B created: {node_b_id}")
    
    # CREATE NODE C (Effort: 2)
    await communicator.send_json_to({
        "action": "node.create",
        "payload": {"label": "C", "effort_hours": 2, "position_x": 0, "position_y": 0}
    })
    resp = await communicator.receive_json_from()
    node_c_id = resp["payload"]["node"]["id"]
    
    # CREATE NODE D (Effort: 1)
    await communicator.send_json_to({
        "action": "node.create",
        "payload": {"label": "D", "effort_hours": 1, "position_x": 0, "position_y": 0}
    })
    resp = await communicator.receive_json_from()
    node_d_id = resp["payload"]["node"]["id"]

    # CREATE EDGES
    # A -> B
    await communicator.send_json_to({
        "action": "edge.create",
        "payload": {"source_id": node_a_id, "target_id": node_b_id}
    })
    resp = await communicator.receive_json_from()
    assert resp["action"] == "edge.created"
    
    # A -> C
    await communicator.send_json_to({
        "action": "edge.create",
        "payload": {"source_id": node_a_id, "target_id": node_c_id}
    })
    await communicator.receive_json_from()
    
    # B -> D
    await communicator.send_json_to({
        "action": "edge.create",
        "payload": {"source_id": node_b_id, "target_id": node_d_id}
    })
    await communicator.receive_json_from()
    
    # C -> D
    await communicator.send_json_to({
        "action": "edge.create",
        "payload": {"source_id": node_c_id, "target_id": node_d_id}
    })
    resp = await communicator.receive_json_from()
    print(f"[PHASE 4] Edges created successfully")

    # PHASE 5: VERIFY CPM
    # Path 1: A(2) -> B(4) -> D(1) = 7
    # Path 2: A(2) -> C(2) -> D(1) = 5
    cpm = resp["payload"]["cpm"]
    assert cpm["total_duration"] == 7.0
    print(f"\n[PHASE 5] Total Duration Expected: 7.0, Actual: {cpm['total_duration']}")
    
    sched_a = cpm["schedules"][node_a_id]
    assert sched_a["is_critical"] is True
    assert sched_a["total_float"] == 0.0
    
    sched_b = cpm["schedules"][node_b_id]
    assert sched_b["is_critical"] is True
    
    sched_c = cpm["schedules"][node_c_id]
    assert sched_c["is_critical"] is False
    assert sched_c["total_float"] == 2.0  # (7 - 5 = 2)
    print(f"[PHASE 5] Node C Float Expected: 2.0, Actual: {sched_c['total_float']}")
    
    # TEST CYCLE DETECTION
    await communicator.send_json_to({
        "action": "edge.create",
        "payload": {"source_id": node_d_id, "target_id": node_a_id}
    })
    err_resp = await communicator.receive_json_from()
    assert err_resp["type"] == "error"
    print(f"[PHASE 4] Cycle detection triggered: {err_resp['message']}")

    await communicator.disconnect()

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_phase6_multi_user(test_project, test_user):
    c1 = WebsocketCommunicator(application, f"/ws/graph/{test_project.id}/")
    c1.scope["user"] = test_user
    await c1.connect()
    await c1.receive_json_from()
    
    c2 = WebsocketCommunicator(application, f"/ws/graph/{test_project.id}/")
    c2.scope["user"] = test_user
    await c2.connect()
    await c2.receive_json_from()
    
    print("\n[PHASE 6] Client 1 and Client 2 connected.")
    
    # Client 1 creates a node
    await c1.send_json_to({
        "action": "node.create",
        "payload": {"label": "SyncTest", "effort_hours": 1, "position_x": 0, "position_y": 0}
    })
    
    # Both clients should receive the broadcast
    msg1 = await c1.receive_json_from()
    msg2 = await c2.receive_json_from()
    
    assert msg1["action"] == "node.created"
    assert msg2["action"] == "node.created"
    assert msg1["payload"]["node"]["id"] == msg2["payload"]["node"]["id"]
    
    print(f"[PHASE 6] Broadcast sync verified for node creation: {msg1['payload']['node']['id']}")

    await c1.disconnect()
    await c2.disconnect()
