export class CommandPalette {
    constructor(options = {}) {
        this.options = Object.assign({
            onAction: (actionId) => console.log('Action:', actionId),
            actions: [
                { id: 'home', title: 'Go to Dashboard', icon: '🏠' },
            ]
        }, options);

        this.isVisible = false;
        this.selectedIndex = 0;
        this.filteredActions = [...this.options.actions];

        this.initDOM();
        this.bindEvents();
    }

    initDOM() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'cmd-palette-overlay';
        this.overlay.innerHTML = `
            <div class="cmd-palette">
                <div class="cmd-palette-header">
                    <input type="text" class="cmd-palette-input" placeholder="Type a command or search..." autocomplete="off" spellcheck="false">
                </div>
                <div class="cmd-palette-list"></div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        this.input = this.overlay.querySelector('.cmd-palette-input');
        this.list = this.overlay.querySelector('.cmd-palette-list');

        const style = document.createElement('style');
        style.textContent = `
            .cmd-palette-overlay {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
                z-index: 10000; display: none;
                align-items: flex-start; justify-content: center;
                padding-top: 12vh; opacity: 0; transition: opacity 0.15s ease;
            }
            .cmd-palette-overlay.visible { display: flex; opacity: 1; }
            .cmd-palette {
                width: 100%; max-width: 600px;
                background: var(--bg-secondary, #111);
                border: 1px solid var(--border-default, #333);
                border-radius: var(--radius-xl, 12px);
                box-shadow: 0 20px 40px rgba(0,0,0,0.5);
                overflow: hidden;
                transform: scale(0.98); transition: transform 0.15s ease;
            }
            .cmd-palette-overlay.visible .cmd-palette { transform: scale(1); }
            .cmd-palette-header {
                padding: 16px; border-bottom: 1px solid var(--border-subtle, #222);
            }
            .cmd-palette-input {
                width: 100%; background: transparent; border: none;
                color: var(--text-primary, #fff); font-size: 18px;
                outline: none; font-family: var(--font-sans);
            }
            .cmd-palette-input::placeholder { color: var(--text-muted, #555); }
            .cmd-palette-list { max-height: 340px; overflow-y: auto; padding: 8px 0; }
            .cmd-item {
                display: flex; align-items: center; gap: 12px;
                padding: 12px 20px; cursor: pointer;
                color: var(--text-secondary, #aaa);
                transition: all 0.1s;
            }
            .cmd-item.selected, .cmd-item:hover {
                background: var(--bg-elevated, #222);
                color: var(--text-primary, #fff);
                border-left: 3px solid var(--accent-blue, #0070f3);
            }
            .cmd-icon { font-size: 16px; width: 24px; text-align: center; }
            .cmd-title { font-size: 14px; font-weight: 500; }
        `;
        document.head.appendChild(style);
    }

    bindEvents() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.toggle();
            }
            if (e.key === 'Escape' && this.isVisible) {
                this.close();
            }
        });

        this.input.addEventListener('input', () => this.filterActions());
        this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });
    }

    setActions(actions) {
        this.options.actions = actions;
        this.filterActions();
    }

    toggle() {
        this.isVisible ? this.close() : this.open();
    }

    open() {
        this.isVisible = true;
        this.overlay.classList.add('visible');
        this.input.value = '';
        this.filterActions();
        setTimeout(() => this.input.focus(), 50);
    }

    close() {
        this.isVisible = false;
        this.overlay.classList.remove('visible');
        this.input.blur();
    }

    filterActions() {
        const query = this.input.value.toLowerCase();
        this.filteredActions = this.options.actions.filter(a => a.title.toLowerCase().includes(query));
        this.selectedIndex = 0;
        this.renderList();
    }

    renderList() {
        this.list.innerHTML = '';
        if (this.filteredActions.length === 0) {
            this.list.innerHTML = '<div class="cmd-item" style="justify-content:center; color: var(--text-muted);">No commands found</div>';
            return;
        }

        this.filteredActions.forEach((action, index) => {
            const item = document.createElement('div');
            item.className = `cmd-item ${index === this.selectedIndex ? 'selected' : ''}`;
            item.innerHTML = `
                <span class="cmd-icon">${action.icon || '⌘'}</span>
                <span class="cmd-title">${action.title}</span>
            `;
            item.addEventListener('click', () => this.executeAction(action.id));
            item.addEventListener('mouseenter', () => {
                this.selectedIndex = index;
                this.updateSelection();
            });
            this.list.appendChild(item);
        });
    }

    updateSelection() {
        const items = this.list.querySelectorAll('.cmd-item');
        items.forEach((item, index) => {
            if (index === this.selectedIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    handleKeydown(e) {
        if (!this.isVisible) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = (this.selectedIndex + 1) % this.filteredActions.length;
            this.updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = (this.selectedIndex - 1 + this.filteredActions.length) % this.filteredActions.length;
            this.updateSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.filteredActions[this.selectedIndex]) {
                this.executeAction(this.filteredActions[this.selectedIndex].id);
            }
        }
    }

    executeAction(id) {
        this.close();
        this.options.onAction(id);
    }
}
