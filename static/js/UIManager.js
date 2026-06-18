export class UIManager {
    constructor(state, wsManager) {
        this.state = state;
        this.wsManager = wsManager;
    }

    setEngine(engine) {
        this.engine = engine;
    }

    setWsManager(wsManager) {
        this.wsManager = wsManager;
    }

    updateConnectionStatus(connected, connecting = false) {
        const badge = document.getElementById("connectionBadge");
        const text = document.getElementById("connectionText");
        if (connecting) {
            badge.className = "connection-badge disconnected";
            text.textContent = "Connecting";
        } else if (connected) {
            badge.className = "connection-badge connected";
            text.textContent = "Live";
        } else {
            badge.className = "connection-badge disconnected";
            text.textContent = "Offline";
        }
    }

    showToast(message, type) {
        const container = document.getElementById("toastContainer");
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    updateSidebar() {
        const totalDuration = this.state.cpm.total_duration || 0;
        document.getElementById("statDuration").textContent =
            totalDuration > 0 ? totalDuration.toFixed(1) + "h" : "0h";
        document.getElementById("statTasks").textContent = this.state.nodes.size.toString();

        const wbsList = document.getElementById("wbsList");
        const emptyState = document.getElementById("emptyState");

        if (this.state.nodes.size === 0) {
            wbsList.innerHTML = "";
            wbsList.appendChild(emptyState);
            emptyState.style.display = "flex";
            return;
        }

        emptyState.style.display = "none";

        const topoOrder = this.state.cpm.topological_order || [];
        const orderedIds = topoOrder.length > 0 ? topoOrder : Array.from(this.state.nodes.keys());

        let html = "";
        orderedIds.forEach(nodeId => {
            const node = this.state.nodes.get(nodeId);
            if (!node) return;

            const isCritical = node.is_critical;
            const isSelected = this.state.selectedNodeIds.has(nodeId);
            let cardClass = "wbs-card";
            if (isCritical) cardClass += " critical";
            if (isSelected) cardClass += " selected";

            let barLeftPct = 0;
            let barWidthPct = 0;
            if (totalDuration > 0) {
                barLeftPct = (node.earliest_start / totalDuration) * 100;
                barWidthPct = Math.max(2, (node.effort_hours / totalDuration) * 100);
            } else if (node.effort_hours > 0) {
                barWidthPct = 100;
            }

            html += `<div class="${cardClass}" data-node-id="${nodeId}">
                <div class="wbs-card-header">
                    <span class="wbs-card-label">${this.escapeHtml(node.label)}</span>
                    <span class="wbs-card-effort">${node.effort_hours}h</span>
                </div>
                <div class="wbs-bar-container">
                    <div class="wbs-bar-fill wbs-bar-es" style="left:${barLeftPct}%;width:${barWidthPct}%"></div>
                </div>
                <div class="wbs-metrics">
                    <span class="wbs-metric">ES <span class="wbs-metric-value">${node.earliest_start.toFixed(1)}</span></span>
                    <span class="wbs-metric">EF <span class="wbs-metric-value">${node.earliest_finish.toFixed(1)}</span></span>
                    <span class="wbs-metric">LS <span class="wbs-metric-value">${node.latest_start.toFixed(1)}</span></span>
                    <span class="wbs-metric">LF <span class="wbs-metric-value">${node.latest_finish.toFixed(1)}</span></span>
                    <span class="wbs-metric">Slack <span class="wbs-metric-value">${node.total_slack.toFixed(1)}</span></span>
                </div>
            </div>`;
        });

        wbsList.innerHTML = html;

        // Attach event listeners
        wbsList.querySelectorAll(".wbs-card").forEach(card => {
            card.addEventListener("click", (e) => {
                this.selectNodeFromSidebar(card.getAttribute("data-node-id"), e.shiftKey || e.metaKey || e.ctrlKey);
            });
        });
    }

    selectNodeFromSidebar(nodeId, multiSelect = false) {
        if (!multiSelect) {
            this.state.selectedNodeIds.clear();
        }
        this.state.selectedNodeIds.add(nodeId);
        
        const node = this.state.nodes.get(nodeId);
        if (node && this.engine) {
            const screenPos = this.engine.worldToScreen(
                node.position_x + 100, // half NODE_WIDTH
                node.position_y + 36   // half NODE_HEIGHT
            );
            const canvasRect = this.engine.canvas.parentElement.getBoundingClientRect();
            const centerX = canvasRect.width / 2;
            const centerY = canvasRect.height / 2;
            this.state.camera.x += centerX - screenPos.x;
            this.state.camera.y += centerY - screenPos.y;
        }
        this.updateSidebar();
    }

    openNodeModal() {
        document.getElementById("nodeModal").classList.add("visible");
        document.getElementById("inputNodeLabel").value = "";
        document.getElementById("inputNodeEffort").value = "1";
        setTimeout(() => {
            document.getElementById("inputNodeLabel").focus();
        }, 100);
    }

    closeNodeModal() {
        document.getElementById("nodeModal").classList.remove("visible");
    }

    submitCreateNode() {
        const label = document.getElementById("inputNodeLabel").value.trim();
        const effort = parseFloat(document.getElementById("inputNodeEffort").value) || 0;

        if (!label) {
            this.showToast("Task label is required", "error");
            return;
        }

        const nodeCount = this.state.nodes.size;
        const col = nodeCount % 4;
        const row = Math.floor(nodeCount / 4);
        const posX = 60 + col * 260;
        const posY = 60 + row * 130;

        this.wsManager.send("node.create", {
            label: label,
            effort_hours: effort,
            position_x: posX,
            position_y: posY,
        });

        this.closeNodeModal();
    }

    toggleEdgeMode() {
        if (this.state.edgeMode.active) {
            this.exitEdgeMode();
        } else {
            this.state.edgeMode.active = true;
            this.state.edgeMode.sourceId = null;
            document.getElementById("btnEdgeMode").classList.add("active");
            document.getElementById("edgeModeBanner").classList.add("visible");
            document.getElementById("edgeModeBanner").textContent =
                "Click a source node, then a target node to create a dependency. Press Esc to cancel.";
            if (this.engine) {
                this.engine.canvas.classList.add("edge-mode");
            }
        }
    }

    exitEdgeMode() {
        this.state.edgeMode.active = false;
        this.state.edgeMode.sourceId = null;
        document.getElementById("btnEdgeMode").classList.remove("active");
        document.getElementById("edgeModeBanner").classList.remove("visible");
        if (this.engine) {
            this.engine.canvas.classList.remove("edge-mode");
        }
    }

    deleteSelected() {
        if (this.state.selectedNodeIds.size === 0) {
            this.showToast("Select a node to delete", "info");
            return;
        }
        this.state.selectedNodeIds.forEach(nodeId => {
            this.wsManager.send("node.delete", { node_id: nodeId });
        });
        this.state.selectedNodeIds.clear();
        this.updateSidebar();
    }
}
