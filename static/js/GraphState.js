export class GraphState {
    constructor() {
        this.nodes = new Map();
        this.edges = [];
        this.cpm = { total_duration: 0, critical_path: [], schedules: {}, topological_order: [] };
        this.selectedNodeId = null;
        this.camera = { x: 80, y: 80, zoom: 1 };
        this.drag = { active: false, nodeId: null, offsetX: 0, offsetY: 0 };
        this.pan = { active: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0 };
        this.edgeMode = { active: false, sourceId: null };
        this.lastMoveEmit = 0;
    }

    loadSnapshot(payload) {
        this.nodes.clear();
        this.edges = [];

        payload.nodes.forEach(n => {
            this.nodes.set(n.id, {
                id: n.id,
                label: n.label,
                effort_hours: n.effort_hours,
                position_x: n.position_x,
                position_y: n.position_y,
                earliest_start: n.earliest_start || 0,
                earliest_finish: n.earliest_finish || 0,
                latest_start: n.latest_start || 0,
                latest_finish: n.latest_finish || 0,
                total_slack: n.total_slack || 0,
                is_critical: n.is_critical || false,
            });
        });

        payload.edges.forEach(e => {
            this.edges.push({ source_id: e.source_id, target_id: e.target_id });
        });

        if (payload.cpm) {
            this.cpm = payload.cpm;
            this.applyCPMToNodes(payload.cpm);
        }
    }

    applyCPMToNodes(cpm) {
        const criticalSet = new Set(cpm.critical_path || []);
        this.nodes.forEach((node, id) => {
            const schedule = cpm.schedules ? cpm.schedules[id] : null;
            if (schedule) {
                node.earliest_start = schedule.earliest_start;
                node.earliest_finish = schedule.earliest_finish;
                node.latest_start = schedule.latest_start;
                node.latest_finish = schedule.latest_finish;
                node.total_slack = schedule.total_float;
                node.is_critical = schedule.is_critical;
            } else {
                node.is_critical = criticalSet.has(id);
            }
        });
    }

    handleDelta(action, payload) {
        if (action === "node.created") {
            const n = payload.node;
            this.nodes.set(n.id, {
                id: n.id,
                label: n.label,
                effort_hours: n.effort_hours,
                position_x: n.position_x,
                position_y: n.position_y,
                earliest_start: 0,
                earliest_finish: 0,
                latest_start: 0,
                latest_finish: 0,
                total_slack: 0,
                is_critical: false,
            });
            if (payload.cpm) {
                this.cpm = payload.cpm;
                this.applyCPMToNodes(payload.cpm);
            }
        } else if (action === "node.updated") {
            const n = payload.node;
            const existing = this.nodes.get(n.id);
            if (existing) {
                existing.label = n.label;
                existing.effort_hours = n.effort_hours;
            }
            if (payload.cpm) {
                this.cpm = payload.cpm;
                this.applyCPMToNodes(payload.cpm);
            }
        } else if (action === "node.deleted") {
            this.nodes.delete(payload.node_id);
            this.edges = this.edges.filter(e => e.source_id !== payload.node_id && e.target_id !== payload.node_id);
            if (this.selectedNodeId === payload.node_id) {
                this.selectedNodeId = null;
            }
            if (payload.cpm) {
                this.cpm = payload.cpm;
                this.applyCPMToNodes(payload.cpm);
            }
        } else if (action === "node.moved") {
            const node = this.nodes.get(payload.node_id);
            if (node) {
                node.position_x = payload.position_x;
                node.position_y = payload.position_y;
            }
        } else if (action === "edge.created") {
            this.edges.push({
                source_id: payload.source_id,
                target_id: payload.target_id,
            });
            if (payload.cpm) {
                this.cpm = payload.cpm;
                this.applyCPMToNodes(payload.cpm);
            }
        } else if (action === "edge.deleted") {
            this.edges = this.edges.filter(e => !(e.source_id === payload.source_id && e.target_id === payload.target_id));
            if (payload.cpm) {
                this.cpm = payload.cpm;
                this.applyCPMToNodes(payload.cpm);
            }
        }
    }

    buildCriticalEdgeSet() {
        const criticalPath = this.cpm.critical_path || [];
        const edgeSet = new Set();
        for (let i = 0; i < criticalPath.length - 1; i++) {
            const edgeKey = criticalPath[i] + "->" + criticalPath[i + 1];
            const hasEdge = this.edges.some(e => e.source_id === criticalPath[i] && e.target_id === criticalPath[i + 1]);
            if (hasEdge) {
                edgeSet.add(edgeKey);
            }
        }
        return edgeSet;
    }
}
