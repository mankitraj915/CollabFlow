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
    selectionBoxFill: "rgba(59, 130, 246, 0.1)",
    selectionBoxStroke: "rgba(59, 130, 246, 0.5)",
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
        this.drawSelectionBox();

        this.ctx.restore();
        
        this.drawMinimap();
        this.drawCursors();
    }

    drawMinimap() {
        const padding = 16;
        const width = 200;
        const height = 150;
        const rect = this.canvas.getBoundingClientRect();
        const x = rect.width - width - padding;
        const y = rect.height - height - padding;

        this.ctx.fillStyle = "rgba(10, 10, 10, 0.8)";
        this.ctx.fillRect(x, y, width, height);
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x, y, width, height);

        if (this.state.nodes.size === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.state.nodes.forEach(node => {
            if (node.position_x < minX) minX = node.position_x;
            if (node.position_y < minY) minY = node.position_y;
            if (node.position_x > maxX) maxX = node.position_x;
            if (node.position_y > maxY) maxY = node.position_y;
        });
        maxX += NODE_WIDTH;
        maxY += NODE_HEIGHT;

        const viewMin = this.screenToWorld(0, 0);
        const viewMax = this.screenToWorld(rect.width, rect.height);
        
        const mapMinX = Math.min(minX, viewMin.x);
        const mapMinY = Math.min(minY, viewMin.y);
        const mapMaxX = Math.max(maxX, viewMax.x);
        const mapMaxY = Math.max(maxY, viewMax.y);

        const mapW = mapMaxX - mapMinX;
        const mapH = mapMaxY - mapMinY;

        const scaleX = width / Math.max(mapW, 1);
        const scaleY = height / Math.max(mapH, 1);
        const scale = Math.min(scaleX, scaleY) * 0.9;

        const offsetX = x + (width - mapW * scale) / 2 - mapMinX * scale;
        const offsetY = y + (height - mapH * scale) / 2 - mapMinY * scale;

        this.ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        this.state.nodes.forEach(node => {
            const nx = node.position_x * scale + offsetX;
            const ny = node.position_y * scale + offsetY;
            const nw = NODE_WIDTH * scale;
            const nh = NODE_HEIGHT * scale;
            this.ctx.fillRect(nx, ny, nw, nh);
        });

        const vx = viewMin.x * scale + offsetX;
        const vy = viewMin.y * scale + offsetY;
        const vw = (viewMax.x - viewMin.x) * scale;
        const vh = (viewMax.y - viewMin.y) * scale;

        this.ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(vx, vy, vw, vh);
        this.ctx.fillStyle = "rgba(59, 130, 246, 0.1)";
        this.ctx.fillRect(vx, vy, vw, vh);
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
            const isSelected = this.state.selectedNodeIds.has(node.id);
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

    drawSelectionBox() {
        if (!this.state.selectionBox.active) return;
        const sb = this.state.selectionBox;
        const x = Math.min(sb.startX, sb.currentX);
        const y = Math.min(sb.startY, sb.currentY);
        const w = Math.abs(sb.currentX - sb.startX);
        const h = Math.abs(sb.currentY - sb.startY);

        this.ctx.fillStyle = COLORS.selectionBoxFill;
        this.ctx.fillRect(x, y, w, h);
        this.ctx.strokeStyle = COLORS.selectionBoxStroke;
        this.ctx.lineWidth = 1 / this.state.camera.zoom;
        this.ctx.strokeRect(x, y, w, h);
    }

    zoomToFit() {
        if (this.state.nodes.size === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.state.nodes.forEach(node => {
            if (node.position_x < minX) minX = node.position_x;
            if (node.position_y < minY) minY = node.position_y;
            if (node.position_x > maxX) maxX = node.position_x;
            if (node.position_y > maxY) maxY = node.position_y;
        });
        maxX += NODE_WIDTH;
        maxY += NODE_HEIGHT;
        
        const padding = 100;
        const rect = this.canvas.getBoundingClientRect();
        const viewW = rect.width;
        const viewH = rect.height;

        const w = maxX - minX;
        const h = maxY - minY;

        const zoomX = (viewW - padding * 2) / Math.max(w, 1);
        const zoomY = (viewH - padding * 2) / Math.max(h, 1);
        const zoom = Math.max(0.1, Math.min(zoomX, zoomY, 2));

        this.state.camera.zoom = zoom;
        this.state.camera.x = (viewW - w * zoom) / 2 - minX * zoom;
        this.state.camera.y = (viewH - h * zoom) / 2 - minY * zoom;
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
            if (!this.state.selectedNodeIds.has(hitId)) {
                if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                    this.state.selectedNodeIds.clear();
                }
                this.state.selectedNodeIds.add(hitId);
            }
            this.state.drag.active = true;
            this.state.drag.nodeIds = Array.from(this.state.selectedNodeIds);
            const node = this.state.nodes.get(hitId);
            this.state.drag.offsetX = world.x - node.position_x;
            this.state.drag.offsetY = world.y - node.position_y;
            this.canvas.classList.add("dragging-node");
        } else {
            if (e.button === 0 && !e.shiftKey) {
                this.state.selectionBox.active = true;
                this.state.selectionBox.startX = world.x;
                this.state.selectionBox.startY = world.y;
                this.state.selectionBox.currentX = world.x;
                this.state.selectionBox.currentY = world.y;
                if (!e.metaKey && !e.ctrlKey) {
                    this.state.selectedNodeIds.clear();
                }
            } else {
                this.state.pan.active = true;
                this.state.pan.startX = e.clientX;
                this.state.pan.startY = e.clientY;
                this.state.pan.camStartX = this.state.camera.x;
                this.state.pan.camStartY = this.state.camera.y;
            }
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

        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = this.screenToWorld(sx, sy);

        const now = performance.now();
        if (now - (this.lastCursorEmit || 0) >= MOVE_THROTTLE_MS) {
            this.wsManager.sendCursor(Math.round(world.x * 10) / 10, Math.round(world.y * 10) / 10);
            this.lastCursorEmit = now;
        }

        if (this.state.selectionBox.active) {
            this.state.selectionBox.currentX = world.x;
            this.state.selectionBox.currentY = world.y;
            return;
        }

        if (!this.state.drag.active) return;

        const dx = world.x - this.state.drag.offsetX;
        const dy = world.y - this.state.drag.offsetY;

        // Find delta from the anchor node (the one we grabbed)
        const anchorNode = this.state.nodes.get(this.state.drag.nodeIds[0]);
        if (!anchorNode) return;
        const deltaX = dx - anchorNode.position_x;
        const deltaY = dy - anchorNode.position_y;

        this.state.drag.nodeIds.forEach(id => {
            const node = this.state.nodes.get(id);
            if (node) {
                node.position_x += deltaX;
                node.position_y += deltaY;
            }
        });

        const nowMove = performance.now();
        if (nowMove - this.state.lastMoveEmit >= MOVE_THROTTLE_MS) {
            this.state.drag.nodeIds.forEach(id => {
                const node = this.state.nodes.get(id);
                if (node) {
                    this.wsManager.send("node.move", {
                        node_id: node.id,
                        position_x: Math.round(node.position_x * 10) / 10,
                        position_y: Math.round(node.position_y * 10) / 10,
                    });
                }
            });
            this.state.lastMoveEmit = nowMove;
        }
    }

    onMouseUp(e) {
        if (this.state.selectionBox.active) {
            this.state.selectionBox.active = false;
            const sb = this.state.selectionBox;
            const x1 = Math.min(sb.startX, sb.currentX);
            const y1 = Math.min(sb.startY, sb.currentY);
            const x2 = Math.max(sb.startX, sb.currentX);
            const y2 = Math.max(sb.startY, sb.currentY);

            this.state.nodes.forEach(node => {
                const nx1 = node.position_x;
                const ny1 = node.position_y;
                const nx2 = nx1 + NODE_WIDTH;
                const ny2 = ny1 + NODE_HEIGHT;
                if (nx1 < x2 && nx2 > x1 && ny1 < y2 && ny2 > y1) {
                    this.state.selectedNodeIds.add(node.id);
                }
            });
            this.uiManager.updateSidebar();
        }

        if (this.state.drag.active) {
            this.state.drag.nodeIds.forEach(id => {
                const node = this.state.nodes.get(id);
                if (node) {
                    this.wsManager.send("node.move", {
                        node_id: node.id,
                        position_x: Math.round(node.position_x * 10) / 10,
                        position_y: Math.round(node.position_y * 10) / 10,
                    });
                }
            });
            this.state.drag.active = false;
            this.state.drag.nodeIds = [];
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

    drawCursors() {
        if (!this.state.cursors) return;
        const now = performance.now();
        
        this.state.cursors.forEach((cursor, id) => {
            // Remove cursors older than 10 seconds
            if (now - cursor.lastUpdate > 10000) {
                this.state.cursors.delete(id);
                return;
            }

            // Lerp position for smooth movement
            cursor.x += (cursor.targetX - cursor.x) * 0.4;
            cursor.y += (cursor.targetY - cursor.y) * 0.4;

            const screenPos = this.worldToScreen(cursor.x, cursor.y);
            const x = screenPos.x;
            const y = screenPos.y;

            // Generate deterministic color from username
            let hash = 0;
            const username = cursor.username || "Guest";
            for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
            const hue = Math.abs(hash) % 360;
            const color = `hsl(${hue}, 80%, 60%)`;

            this.ctx.fillStyle = color;
            
            // Draw Cursor Pointer
            this.ctx.beginPath();
            this.ctx.moveTo(x, y);
            this.ctx.lineTo(x + 12, y + 12);
            this.ctx.lineTo(x + 5, y + 14);
            this.ctx.lineTo(x, y + 20);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();

            // Draw Name Badge
            this.ctx.font = "600 11px Inter, sans-serif";
            const textWidth = this.ctx.measureText(username).width;
            
            this.ctx.beginPath();
            this.ctx.roundRect(x + 12, y + 16, textWidth + 10, 18, 4);
            this.ctx.fill();
            
            this.ctx.fillStyle = '#fff';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(username, x + 17, y + 25);
        });
    }
}
