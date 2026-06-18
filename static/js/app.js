import { GraphState } from './GraphState.js';
import { UIManager } from './UIManager.js';
import { WebSocketManager } from './WebSocketManager.js';
import { CanvasEngine } from './CanvasEngine.js';

document.addEventListener("DOMContentLoaded", () => {
    // PROJECT_ID is provided globally by the Django template
    if (typeof PROJECT_ID === "undefined") {
        console.error("PROJECT_ID is not defined.");
        return;
    }

    const state = new GraphState();
    const uiManager = new UIManager(state, null);
    const wsManager = new WebSocketManager(PROJECT_ID, uiManager, state);
    
    uiManager.setWsManager(wsManager);
    
    const canvasElement = document.getElementById("graphCanvas");
    const engine = new CanvasEngine(canvasElement, state, wsManager, uiManager);
    
    uiManager.setEngine(engine);

    import('./CommandPalette.js').then(({ CommandPalette }) => {
        new CommandPalette({
            actions: [
                { id: 'create_node', title: 'Create Node', icon: '✨' },
                { id: 'connect_nodes', title: 'Connect Nodes', icon: '🔗' },
                { id: 'zoom_fit', title: 'Zoom to Fit', icon: '🔍' },
                { id: 'share', title: 'Share Project', icon: '🌐' },
                { id: 'dashboard', title: 'Go to Dashboard', icon: '🏠' }
            ],
            onAction: (actionId) => {
                if (actionId === 'create_node') window.openNodeModal();
                if (actionId === 'connect_nodes') window.toggleEdgeMode();
                if (actionId === 'zoom_fit') engine.zoomToFit();
                if (actionId === 'share') document.getElementById('shareModal').classList.add('visible');
                if (actionId === 'dashboard') window.location.href = '/dashboard/';
            }
        });
    });

    // Bind UI actions to global scope for HTML onclick attributes
    window.openNodeModal = () => uiManager.openNodeModal();
    window.closeNodeModal = () => uiManager.closeNodeModal();
    window.submitCreateNode = () => uiManager.submitCreateNode();
    window.toggleEdgeMode = () => uiManager.toggleEdgeMode();
    window.deleteSelected = () => uiManager.deleteSelected();
});
