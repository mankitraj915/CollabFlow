export class WebSocketManager {
    constructor(projectId, uiManager, state) {
        this.projectId = projectId;
        this.uiManager = uiManager;
        this.state = state;
        this.ws = null;
        this.actionQueue = [];
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 10000;
        this.baseReconnectDelay = 1000;
        this.connecting = false;
        
        this.connect();
    }

    connect() {
        if (this.connecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
        this.connecting = true;
        this.uiManager.updateConnectionStatus(false, true);

        const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = `${wsScheme}://${window.location.host}/ws/graph/${this.projectId}/`;
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.connecting = false;
            this.reconnectAttempts = 0;
            this.uiManager.updateConnectionStatus(true);
            this.uiManager.showToast("Connected to project", "success");
            this.flushQueue();
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };

        this.ws.onclose = () => {
            this.connecting = false;
            this.uiManager.updateConnectionStatus(false);
            this.scheduleReconnect();
        };

        this.ws.onerror = () => {
            this.connecting = false;
            this.uiManager.updateConnectionStatus(false);
            // close will be called automatically
        };
    }

    scheduleReconnect() {
        const delay = Math.min(this.maxReconnectDelay, this.baseReconnectDelay * Math.pow(1.5, this.reconnectAttempts));
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), delay);
    }

    handleMessage(data) {
        if (data.type === "snapshot") {
            this.state.loadSnapshot(data.payload);
            this.uiManager.updateSidebar();
        } else if (data.type === "delta") {
            this.state.handleDelta(data.action, data.payload);
            this.uiManager.updateSidebar();
        } else if (data.type === "error") {
            this.uiManager.showToast(data.message, "error");
        }
    }

    send(action, payload) {
        const msg = JSON.stringify({ action, payload });
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        } else {
            this.actionQueue.push(msg);
            this.uiManager.showToast("Action queued while offline", "info");
        }
    }

    flushQueue() {
        while (this.actionQueue.length > 0) {
            const msg = this.actionQueue.shift();
            this.ws.send(msg);
        }
    }
}
