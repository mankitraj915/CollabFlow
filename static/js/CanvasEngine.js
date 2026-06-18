const NODE_WIDTH = 200;
const NODE_HEIGHT = 72;
const NODE_RADIUS = 12;
const GRID_SIZE = 40;
const MOVE_THROTTLE_MS = 50;
const ARROWHEAD_SIZE = 10;
const DPR = window.devicePixelRatio || 1;

const COLORS = {
    nodeFillNormal: "#1e293b",
    nodeFillCritical: "#2a1f0e",
    nodeStrokeNormal: "#334155",
    nodeStrokeCritical: "#b45309",
    nodeStrokeSelected: "#3b82f6",
    nodeTextPrimary: "#edf2f7",
    nodeTextSecondary: "#94a3b8",
    edgeNormal: "#475569",
    edgeCritical: "#f59e0b",
    gridLine: "rgba(30, 41, 59, 0.4)",
    gridLineMajor: "rgba(30, 41, 59, 0.7)",
    canvasBg: "#06080d",
    edgeModeHighlight: "#6366f1",
    criticalGlow: "rgba(245, 158, 11, 0.2)",
    selectedGlow: "rgba(59, 130, 246, 0.2)",
};

export class CanvasEngine {
    constructor(canvasElement, state, wsManager, uiManager) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext("2d");
        this.state = state;
        this.wsManager = wsManager;
        this.uiManager = uiManager;
        
        this.resize();
        window.addEventListener("resize", () => this.resize());
        this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
        this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
        this.canvas.addEventListener("mouseup", (e) => this.onMouseUp(e));
        this.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
        this.canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e));
        document.addEventListener("keydown", (e) => this.onKeyDown(e));
        
        this.renderLoop();
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width * DPR;
        this.canvas.height = rect.height * DPR;
        this.canvas.style.width = rect.width + "px";
        this.canvas.style.height = rect.height + "px";
        this.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    screenToWorld(sx, sy) {
        return {
            x: (sx - this.state.camera.x) / this.state.camera.zoom,
            y: (sy - this.state.camera.y) / this.state.camera.zoom,
        };
    }

    worldToScreen(wx, wy) {
        return {
            x: wx * this.state.camera.zoom + this.state.camera.x,
            y: wy * this.state.camera.zoom + this.state.camera.y,
        };
    }

    renderLoop() {
        this.render();
        requestAnimationFrame(() => this.renderLoop());
    }

    render() {
        const w = this.canvas.width / DPR;
        const h = this.canvas.height / DPR;

        this.ctx.fillStyle = COLORS.canvasBg;
        this.ctx.fillRect(0, 0, w, h);

        this.ctx.save();
        this.ctx.translate(this.state.camera.x, this.state.camera.y);
        this.ctx.scale(this.state.camera.zoom, this.state.camera.zoom);

        this.drawGrid(w, h);
        this.drawEdges();
        this.drawNodes();

        this.ctx.restore();
    }

    drawGrid(viewWidth, viewHeight) {
        const topLeft = this.screenToWorld(0, 0);
        const bottomRight = this.screenToWorld(viewWidth, viewHeight);

        const startX = Math.floor(topLeft.x / GRID_SIZE) * GRID_SIZE;
        const startY = Math.floor(topLeft.y / GRID_SIZE) * GRID_SIZE;
        const endX = Math.ceil(bottomRight.x / GRID_SIZE) * GRID_SIZE;
        const endY = Math.ceil(bottomRight.y / GRID_SIZE) * GRID_SIZE;

        this.ctx.lineWidth = 0.5 / this.state.camera.zoom;

        for (let x = startX; x <= endX; x += GRID_SIZE) {
            this.ctx.strokeStyle = (x % (GRID_SIZE * 5) === 0) ? COLORS.gridLineMajor : COLORS.gridLine;
            this.ctx.beginPath();
            this.ctx.moveTo(x, startY);
            this.ctx.lineTo(x, endY);
            this.ctx.stroke();
        }

        for (let y = startY; y <= endY; y += GRID_SIZE) {
            this.ctx.strokeStyle = (y % (GRID_SIZE * 5) === 0) ? COLORS.gridLineMajor : COLORS.gridLine;
            this.ctx.beginPath();
            this.ctx.moveTo(startX, y);
            this.ctx.lineTo(endX, y);
            this.ctx.stroke();
        }
    }

    drawEdges() {
        const criticalEdgeSet = this.state.buildCriticalEdgeSet();

        this.state.edges.forEach(edge => {
            const source = this.state.nodes.get(edge.source_id);
            const target = this.state.nodes.get(edge.target_id);
            if (!source || !target) return;

            const isCritical = criticalEdgeSet.has(`${edge.source_id}->${edge.target_id}`);

            const sx = source.position_x + NODE_WIDTH / 2;
            const sy = source.position_y + NODE_HEIGHT / 2;
            const tx = target.position_x + NODE_WIDTH / 2;
            const ty = target.position_y + NODE_HEIGHT / 2;

            const sourcePoint = this.getNodeBorderPoint(sx, sy, NODE_WIDTH, NODE_HEIGHT, tx, ty);
            const targetPoint = this.getNodeBorderPoint(tx, ty, NODE_WIDTH, NODE_HEIGHT, sx, sy);

            this.ctx.lineWidth = isCritical ? 2.5 : 1.5;
            this.ctx.strokeStyle = isCritical ? COLORS.edgeCritical : COLORS.edgeNormal;

            if (isCritical) {
                this.ctx.shadowColor = COLORS.criticalGlow;
                this.ctx.shadowBlur = 8;
            }

            this.ctx.beginPath();
            this.ctx.moveTo(sourcePoint.x, sourcePoint.y);
            this.ctx.lineTo(targetPoint.x, targetPoint.y);
            this.ctx.stroke();

            this.ctx.fillStyle = isCritical ? COLORS.edgeCritical : COLORS.edgeNormal;
            this.drawArrowhead(targetPoint.x, targetPoint.y, sourcePoint.x, sourcePoint.y);

            this.ctx.shadowColor = "transparent";
            this.ctx.shadowBlur = 0;
        });
    }

    getNodeBorderPoint(cx, cy, w, h, targetX, targetY) {
        const dx = targetX - cx;
        const dy = targetY - cy;
        const halfW = w / 2;
        const halfH = h / 2;

        if (dx === 0 && dy === 0) return { x: cx, y: cy };

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        let scale;

        if (absDx * halfH > absDy * halfW) {
            scale = halfW / absDx;
        } else {
            scale = halfH / absDy;
        }

        return { x: cx + dx * scale, y: cy + dy * scale };
    }

    drawArrowhead(toX, toY, fromX, fromY) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        this.ctx.beginPath();
        this.ctx.moveTo(toX, toY);
        this.ctx.lineTo(
            toX - ARROWHEAD_SIZE * Math.cos(angle - Math.PI / 7),
            toY - ARROWHEAD_SIZE * Math.sin(angle - Math.PI / 7)
        );
        this.ctx.lineTo(
            toX - ARROWHEAD_SIZE * Math.cos(angle + Math.PI / 7),
            toY - ARROWHEAD_SIZE * Math.sin(angle + Math.PI / 7)
        );
        this.ctx.closePath();
        this.ctx.fill();
    }

    drawNodes() {
        this.state.nodes.forEach(node => {
            const x = node.position_x;
            const y = node.position_y;
            const isSelected = this.state.selectedNodeId === node.id;
            const isCritical = node.is_critical;
            const isEdgeSource = this.state.edgeMode.active && this.state.edgeMode.sourceId === node.id;

            if (isCritical) {
                this.ctx.shadowColor = COLORS.criticalGlow;
                this.ctx.shadowBlur = 16;
            } else if (isSelected) {
                this.ctx.shadowColor = COLORS.selectedGlow;
                this.ctx.shadowBlur = 16;
            }

            this.ctx.fillStyle = isCritical ? COLORS.nodeFillCritical : COLORS.nodeFillNormal;
            this.ctx.beginPath();
            this.roundRect(x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
            this.ctx.fill();

            this.ctx.shadowColor = "transparent";
            this.ctx.shadowBlur = 0;

            this.ctx.lineWidth = isSelected ? 2 : 1;
            if (isEdgeSource) {
                this.ctx.strokeStyle = COLORS.edgeModeHighlight;
                this.ctx.lineWidth = 2.5;
            } else if (isSelected) {
                this.ctx.strokeStyle = COLORS.nodeStrokeSelected;
            } else if (isCritical) {
                this.ctx.strokeStyle = COLORS.nodeStrokeCritical;
            } else {
                this.ctx.strokeStyle = COLORS.nodeStrokeNormal;
            }

            this.ctx.beginPath();
            this.roundRect(x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
            this.ctx.stroke();

            if (isCritical) {
                this.ctx.fillStyle = COLORS.edgeCritical;
                this.ctx.beginPath();
                this.roundRect(x, y, 4, NODE_HEIGHT, { tl: NODE_RADIUS, bl: NODE_RADIUS, tr: 0, br: 0 });
                this.ctx.fill();
            }

            this.ctx.fillStyle = COLORS.nodeTextPrimary;
            this.ctx.font = "600 13px Inter, sans-serif";
            this.ctx.textAlign = "left";
            this.ctx.textBaseline = "middle";

            const maxTextWidth = NODE_WIDTH - 24;
            let displayLabel = node.label;
            while (this.ctx.measureText(displayLabel).width > maxTextWidth && displayLabel.length > 1) {
                displayLabel = displayLabel.slice(0, -1);
            }
            if (displayLabel !== node.label) displayLabel += "…";
            this.ctx.fillText(displayLabel, x + 14, y + 26);

            this.ctx.fillStyle = COLORS.nodeTextSecondary;
            this.ctx.font = "500 11px 'JetBrains Mono', monospace";
            this.ctx.fillText(node.effort_hours + "h", x + 14, y + 48);

            if (isCritical) {
                this.ctx.fillStyle = COLORS.edgeCritical;
                this.ctx.font = "700 9px Inter, sans-serif";
                const criticalBadgeX = x + NODE_WIDTH - 14;
                this.ctx.textAlign = "right";
                this.ctx.fillText("CRITICAL", criticalBadgeX, y + 48);
                this.ctx.textAlign = "left";
            }
        });
    }

    roundRect(x, y, w, h, r) {
        if (typeof r === "number") {
            r = { tl: r, tr: r, br: r, bl: r };
        }
        this.ctx.moveTo(x + r.tl, y);
        this.ctx.lineTo(x + w - r.tr, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
        this.ctx.lineTo(x + w, y + h - r.br);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
        this.ctx.lineTo(x + r.bl, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
        this.ctx.lineTo(x, y + r.tl);
        this.ctx.quadraticCurveTo(x, y, x + r.tl, y);
    }

    hitTestNode(worldX, worldY) {
        let hitId = null;
        this.state.nodes.forEach((node) => {
            if (
                worldX >= node.position_x &&
                worldX <= node.position_x + NODE_WIDTH &&
                worldY >= node.position_y &&
                worldY <= node.position_y + NODE_HEIGHT
            ) {
                hitId = node.id;
            }
        });
        return hitId;
    }

    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = this.screenToWorld(sx, sy);

        if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
            this.state.pan.active = true;
            this.state.pan.startX = e.clientX;
            this.state.pan.startY = e.clientY;
            this.state.pan.camStartX = this.state.camera.x;
            this.state.pan.camStartY = this.state.camera.y;
            this.canvas.style.cursor = "grabbing";
            e.preventDefault();
            return;
        }

        const hitId = this.hitTestNode(world.x, world.y);

        if (this.state.edgeMode.active && hitId) {
            if (!this.state.edgeMode.sourceId) {
                this.state.edgeMode.sourceId = hitId;
                document.getElementById("edgeModeBanner").textContent = "Source selected. Now click the target node.";
            } else {
                this.wsManager.send("edge.create", {
                    source_id: this.state.edgeMode.sourceId,
                    target_id: hitId,
                });
                this.uiManager.exitEdgeMode();
            }
            return;
        }

        if (hitId) {
            this.state.selectedNodeId = hitId;
            const node = this.state.nodes.get(hitId);
            this.state.drag.active = true;
            this.state.drag.nodeId = hitId;
            this.state.drag.offsetX = world.x - node.position_x;
            this.state.drag.offsetY = world.y - node.position_y;
            this.canvas.classList.add("dragging-node");
        } else {
            this.state.selectedNodeId = null;
            this.state.pan.active = true;
            this.state.pan.startX = e.clientX;
            this.state.pan.startY = e.clientY;
            this.state.pan.camStartX = this.state.camera.x;
            this.state.pan.camStartY = this.state.camera.y;
        }

        this.uiManager.updateSidebar();
    }

    onMouseMove(e) {
        if (this.state.pan.active) {
            const dx = e.clientX - this.state.pan.startX;
            const dy = e.clientY - this.state.pan.startY;
            this.state.camera.x = this.state.pan.camStartX + dx;
            this.state.camera.y = this.state.pan.camStartY + dy;
            return;
        }

        if (!this.state.drag.active) return;

        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = this.screenToWorld(sx, sy);

        const node = this.state.nodes.get(this.state.drag.nodeId);
        if (!node) return;

        node.position_x = world.x - this.state.drag.offsetX;
        node.position_y = world.y - this.state.drag.offsetY;

        const now = performance.now();
        if (now - this.state.lastMoveEmit >= MOVE_THROTTLE_MS) {
            this.wsManager.send("node.move", {
                node_id: node.id,
                position_x: Math.round(node.position_x * 10) / 10,
                position_y: Math.round(node.position_y * 10) / 10,
            });
            this.state.lastMoveEmit = now;
        }
    }

    onMouseUp(e) {
        if (this.state.drag.active) {
            const node = this.state.nodes.get(this.state.drag.nodeId);
            if (node) {
                this.wsManager.send("node.move", {
                    node_id: node.id,
                    position_x: Math.round(node.position_x * 10) / 10,
                    position_y: Math.round(node.position_y * 10) / 10,
                });
            }
            this.state.drag.active = false;
            this.state.drag.nodeId = null;
            this.canvas.classList.remove("dragging-node");
        }
        this.state.pan.active = false;
        this.canvas.style.cursor = this.state.edgeMode.active ? "crosshair" : "grab";
    }

    onWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
        const newZoom = Math.max(0.2, Math.min(5, this.state.camera.zoom * zoomFactor));

        const worldBefore = this.screenToWorld(mx, my);
        this.state.camera.zoom = newZoom;
        const screenAfter = this.worldToScreen(worldBefore.x, worldBefore.y);

        this.state.camera.x += mx - screenAfter.x;
        this.state.camera.y += my - screenAfter.y;
    }

    onDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = this.screenToWorld(sx, sy);

        const hitId = this.hitTestNode(world.x, world.y);
        if (hitId) {
            const node = this.state.nodes.get(hitId);
            const newLabel = prompt("Rename task:", node.label);
            if (newLabel && newLabel !== node.label) {
                this.wsManager.send("node.update", { node_id: hitId, label: newLabel });
            }
        }
    }

    onKeyDown(e) {
        if (e.key === "Escape") {
            if (this.state.edgeMode.active) {
                this.uiManager.exitEdgeMode();
            }
            this.uiManager.closeNodeModal();
        }
        if (e.key === "Delete" || e.key === "Backspace") {
            if (document.activeElement.tagName !== "INPUT") {
                this.uiManager.deleteSelected();
            }
        }
    }
}
