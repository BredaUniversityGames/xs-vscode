import * as vscode from 'vscode';
import * as path from 'path';

interface SpriteData {
    image: string;
    sprites: { [name: string]: { x: number; y: number; width: number; height: number } };
}

export class SpriteEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new SpriteEditorProvider(context);
        return vscode.window.registerCustomEditorProvider('xs.spriteEditor', provider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        });
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const localResourceRoots = [
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist')
        ];
        if (workspaceFolder) {
            localResourceRoots.push(workspaceFolder.uri);
        }

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots
        };

        // Load the sprite data
        let spriteData: SpriteData;
        try {
            const text = document.getText();
            if (text.trim().length === 0) {
                // Empty file - create default data
                spriteData = {
                    image: '',
                    sprites: {}
                };
            } else {
                spriteData = JSON.parse(text);
            }
        } catch (e) {
            vscode.window.showErrorMessage('Failed to parse sprite file. Using defaults.');
            spriteData = {
                image: '',
                sprites: {}
            };
        }

        // Get toolkit URI
        const toolkitUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                'node_modules',
                '@vscode',
                'webview-ui-toolkit',
                'dist',
                'toolkit.js'
            )
        );

        // Update webview content
        const updateWebview = () => {
            webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, spriteData, toolkitUri);
        };

        updateWebview();

        let isUpdating = false; // Track if we're updating to avoid refresh loop

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'update':
                    isUpdating = true;
                    this.updateTextDocument(document, message.data);
                    setTimeout(() => { isUpdating = false; }, 100);
                    break;
                case 'browse': {
                    // Find all image files in the workspace
                    const imageFiles = await vscode.workspace.findFiles(
                        '**/*.{png,jpg,jpeg,bmp,gif}',
                        '**/node_modules/**'
                    );

                    if (imageFiles.length === 0) {
                        vscode.window.showWarningMessage('No image files found in workspace');
                        break;
                    }

                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (!workspaceFolder) {
                        break;
                    }

                    // Create quick pick items with relative paths
                    const items = imageFiles.map(uri => {
                        const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                        return {
                            label: path.basename(uri.fsPath),
                            description: path.dirname(relativePath),
                            path: relativePath.replace(/\\/g, '/')
                        };
                    }).sort((a, b) => a.path.localeCompare(b.path));

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select a sprite sheet from your workspace',
                        matchOnDescription: true
                    });

                    if (selected) {
                        webviewPanel.webview.postMessage({
                            type: 'imageSelected',
                            path: selected.path
                        });
                    }
                    break;
                }
                case 'promptSpriteName':
                    const name = await vscode.window.showInputBox({
                        prompt: 'Enter sprite name',
                        placeHolder: 'Sprite name',
                        validateInput: (value) => {
                            if (!value || value.trim() === '') {
                                return 'Name cannot be empty';
                            }
                            if (spriteData.sprites[value]) {
                                return 'Sprite with this name already exists';
                            }
                            return null;
                        }
                    });
                    if (name) {
                        webviewPanel.webview.postMessage({
                            type: 'spriteNameEntered',
                            name: name
                        });
                    }
                    break;
                case 'confirmDelete':
                    const result = await vscode.window.showWarningMessage(
                        `Delete sprite "${message.name}"?`,
                        { modal: true },
                        'Delete'
                    );
                    if (result === 'Delete') {
                        delete spriteData.sprites[message.name];
                        webviewPanel.webview.postMessage({
                            type: 'deleteConfirmed',
                            name: message.name
                        });
                    }
                    break;
                case 'promptRename':
                    const newName = await vscode.window.showInputBox({
                        prompt: 'Rename sprite',
                        value: message.currentName,
                        validateInput: (value) => {
                            if (!value || value.trim() === '') {
                                return 'Name cannot be empty';
                            }
                            if (value !== message.currentName && spriteData.sprites[value]) {
                                return 'Sprite with this name already exists';
                            }
                            return null;
                        }
                    });
                    if (newName && newName !== message.currentName) {
                        spriteData.sprites[newName] = spriteData.sprites[message.currentName];
                        delete spriteData.sprites[message.currentName];
                        webviewPanel.webview.postMessage({
                            type: 'renameConfirmed',
                            oldName: message.currentName,
                            newName: newName
                        });
                    }
                    break;
                case 'getImageUri': {
                    // Convert relative path to webview URI
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (workspaceFolder && message.path) {
                        const fullPath = path.join(workspaceFolder.uri.fsPath, message.path);
                        const imageUri = webviewPanel.webview.asWebviewUri(vscode.Uri.file(fullPath));
                        webviewPanel.webview.postMessage({
                            type: 'imageUri',
                            uri: imageUri.toString()
                        });
                    }
                    break;
                }
            }
        });

        // Update webview when document changes (but not if we initiated the change)
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString() && !isUpdating) {
                try {
                    const text = e.document.getText();
                    if (text.trim().length > 0) {
                        spriteData = JSON.parse(text);
                        // Send message to update data instead of regenerating HTML
                        webviewPanel.webview.postMessage({
                            type: 'dataUpdated',
                            data: spriteData
                        });
                    }
                } catch (e) {
                    // Ignore parse errors during editing
                }
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private updateTextDocument(document: vscode.TextDocument, data: SpriteData) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, JSON.stringify(data, null, 2));
        vscode.workspace.applyEdit(edit);
    }

    private getHtmlContent(webview: vscode.Webview, data: SpriteData, toolkitUri: vscode.Uri): string {
        const spriteEntries = Object.entries(data.sprites);

        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script type="module" src="${toolkitUri}"></script>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css">
            <style>
                body {
                    padding: 0;
                    margin: 0;
                    height: 100vh;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    border-left: 1px solid var(--vscode-panel-border);
                }

                /* Top Bar */
                .top-bar {
                    display: flex;
                    gap: 12px;
                    padding: 0 12px;
                    height: 35px;
                    background: var(--vscode-tab-inactiveBackground);
                    align-items: center;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }

                .top-bar-group {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .top-bar-group label {
                    font-size: 12px;
                    white-space: nowrap;
                }

                .top-bar-group input {
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
                    padding: 4px 8px;
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    outline: none;
                    border-radius: 2px;
                }

                .top-bar-group input:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    outline-offset: -1px;
                }

                .top-bar-group input.image-path {
                    width: 450px;
                }

                /* Main Content Area */
                .main-content {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                }

                /* Sprite List Panel */
                .sprite-list-panel {
                    width: 250px;
                    flex-shrink: 0;
                    background: var(--vscode-tab-inactiveBackground);
                    display: flex;
                    flex-direction: column;
                }

                .sprite-list-header {
                    padding: 0 8px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-foreground);
                    background: var(--vscode-tab-inactiveBackground);
                }

                .sprite-list-buttons {
                    display: flex;
                    gap: 4px;
                }

                .sprite-list {
                    flex: 1;
                    overflow-y: auto;
                    outline: none;
                }

                .sprite-item {
                    display: flex;
                    align-items: center;
                    padding: 0 8px;
                    height: 22px;
                    cursor: pointer;
                    gap: 8px;
                    user-select: none;
                }

                .sprite-item:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .sprite-item.selected {
                    background: var(--vscode-list-inactiveSelectionBackground);
                    color: var(--vscode-list-inactiveSelectionForeground);
                }

                .sprite-list:focus-within .sprite-item.selected {
                    background: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }

                .sprite-color-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }

                .sprite-item-name {
                    flex: 1;
                    font-size: 13px;
                }

                /* Panel Separators */
                .panel-separator {
                    width: 1px;
                    background: var(--vscode-panel-border);
                    flex-shrink: 0;
                }

                .panel-separator-horizontal {
                    height: 1px;
                    width: 100%;
                    background: var(--vscode-panel-border);
                    flex-shrink: 0;
                }

                /* Canvas View Panel */
                .canvas-view-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    background: var(--vscode-editor-background);
                }

                .canvas-view-header {
                    padding: 0 8px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-foreground);
                }

                .canvas-view-header span {
                    flex: 1;
                }

                .canvas-view-controls {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .canvas-view-controls select {
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
                    padding: 2px 4px;
                    font-family: var(--vscode-font-family);
                    font-size: 12px;
                    outline: none;
                    border-radius: 2px;
                }

                .canvas-view-content {
                    flex: 1;
                    overflow: auto;
                    padding: 16px;
                    position: relative;
                }

                .canvas-placeholder {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }

                .canvas-container {
                    position: relative;
                    display: inline-block;
                }

                .canvas-container canvas {
                    position: absolute;
                    top: 0;
                    left: 0;
                }

                #canvas-base {
                    position: absolute;
                    top: 0;
                    left: 0;
                    image-rendering: pixelated;
                    image-rendering: crisp-edges;
                    image-rendering: -moz-crisp-edges;
                }

                #canvas-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    cursor: crosshair;
                    pointer-events: auto;
                }

                /* Bottom Panel */
                .bottom-panel {
                    height: 200px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    background: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-panel-border);
                }

                .preview-header {
                    padding: 0 8px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-foreground);
                }

                .preview-header span {
                    flex: 1;
                }

                .preview-controls {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .preview-controls select {
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
                    padding: 2px 4px;
                    font-family: var(--vscode-font-family);
                    font-size: 12px;
                    outline: none;
                    border-radius: 2px;
                }

                .preview-content {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    padding: 16px;
                    overflow: auto;
                    gap: 16px;
                }

                .preview-placeholder {
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }

                .preview-canvas-container {
                    display: inline-block;
                }

                .preview-canvas-container canvas {
                    display: block;
                    image-rendering: pixelated;
                    image-rendering: crisp-edges;
                    border: 1px solid var(--vscode-panel-border);
                }

                .preview-info {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }

                .preview-info-row {
                    display: flex;
                    gap: 4px;
                }

                .preview-info-label {
                    font-weight: 600;
                    min-width: 50px;
                }
            </style>
        </head>
        <body>
            <!-- Top Bar -->
            <div class="top-bar">
                <div class="top-bar-group">
                    <label>Image</label>
                    <input type="text" class="image-path" id="image-path" value="${this.escapeHtml(data.image)}" placeholder="Select sprite sheet..." />
                    <vscode-button appearance="icon" aria-label="Browse" id="browse-btn">
                        <span class="codicon codicon-folder-opened"></span>
                    </vscode-button>
                </div>
            </div>

            <!-- Main Content -->
            <div class="main-content">
                <!-- Sprite List -->
                <div class="sprite-list-panel">
                    <div class="sprite-list-header">
                        <span>Sprites</span>
                        <div class="sprite-list-buttons">
                            <vscode-button appearance="icon" aria-label="Delete Sprite" title="Delete Sprite" id="remove-sprite-btn" disabled>
                                <span class="codicon codicon-trash"></span>
                            </vscode-button>
                        </div>
                    </div>
                    <div class="sprite-list" id="sprite-list" tabindex="0">
                        ${spriteEntries.length === 0 ?
                            '<div style="padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No sprites</div>' :
                            spriteEntries.map(([name, rect], index) => {
                                const color = this.getSpriteColor(index, spriteEntries.length);
                                return `
                                    <div class="sprite-item ${index === 0 ? 'selected' : ''}" data-name="${this.escapeHtml(name)}">
                                        <div class="sprite-color-dot" style="background: ${color};"></div>
                                        <div class="sprite-item-name">${this.escapeHtml(name)}</div>
                                    </div>
                                `;
                            }).join('')
                        }
                    </div>
                </div>

                <!-- Separator -->
                <div class="panel-separator"></div>

                <!-- Canvas View -->
                <div class="canvas-view-panel">
                    <div class="canvas-view-header">
                        <span>Sprite Sheet</span>
                        <div class="canvas-view-controls">
                            <select id="canvas-zoom-select">
                                <option value="0.25">25%</option>
                                <option value="0.5">50%</option>
                                <option value="1" selected>100%</option>
                                <option value="2">200%</option>
                                <option value="4">400%</option>
                            </select>
                        </div>
                    </div>
                    <div class="canvas-view-content" id="canvas-view">
                        <div class="canvas-placeholder">
                            Select a sprite sheet to begin
                        </div>
                    </div>
                </div>
            </div>

            <!-- Bottom Panel -->
            <div class="bottom-panel">
                <div class="preview-header">
                    <span>Preview</span>
                    <div class="preview-controls">
                        <select id="preview-zoom-select">
                            <option value="1">1x</option>
                            <option value="2" selected>2x</option>
                            <option value="3">3x</option>
                            <option value="4">4x</option>
                            <option value="6">6x</option>
                            <option value="8">8x</option>
                        </select>
                    </div>
                </div>
                <div class="preview-content" id="preview">
                    <div class="preview-placeholder">No sprite selected</div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentData = ${JSON.stringify(data)};
                let selectedSprite = ${spriteEntries.length > 0 ? `"${this.escapeHtml(spriteEntries[0][0])}"` : 'null'};
                let spriteImage = null; // Loaded sprite sheet image
                let canvasZoom = 1; // Canvas view zoom level
                let previewZoom = 2; // Preview zoom level (default 2x)
                let isDrawing = false; // Is user drawing a selection
                let selectionStart = null; // Start point of selection { x, y }
                let currentSelection = null; // Current selection rect { x, y, width, height }

                // Top bar event listeners
                document.getElementById('browse-btn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'browse' });
                });

                document.getElementById('image-path').addEventListener('input', (e) => {
                    currentData.image = e.target.value;
                    loadSpriteSheet();
                    updateDocument();
                });

                // Canvas zoom event listener
                document.getElementById('canvas-zoom-select').addEventListener('change', (e) => {
                    canvasZoom = parseFloat(e.target.value) || 1;
                    if (spriteImage && spriteImage.complete) {
                        drawCanvasView();
                    }
                });

                // Preview zoom event listener
                document.getElementById('preview-zoom-select').addEventListener('change', (e) => {
                    previewZoom = parseInt(e.target.value) || 2;
                    renderPreview();
                });

                // Update remove button state
                function updateRemoveButtonState() {
                    const removeBtn = document.getElementById('remove-sprite-btn');
                    if (selectedSprite && currentData.sprites[selectedSprite]) {
                        removeBtn.removeAttribute('disabled');
                    } else {
                        removeBtn.setAttribute('disabled', 'true');
                    }
                }

                // Rebuild sprite list UI
                function rebuildSpriteList() {
                    const listEl = document.getElementById('sprite-list');
                    const sprites = Object.entries(currentData.sprites);

                    if (sprites.length === 0) {
                        listEl.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No sprites</div>';
                        selectedSprite = null;
                    } else {
                        listEl.innerHTML = sprites.map(([name, rect], index) => {
                            const hue = (index * 360) / Math.max(sprites.length, 1);
                            const color = \`hsl(\${hue}, 70%, 60%)\`;
                            const isSelected = name === selectedSprite;
                            return \`
                                <div class="sprite-item \${isSelected ? 'selected' : ''}" data-name="\${name}">
                                    <div class="sprite-color-dot" style="background: \${color};"></div>
                                    <div class="sprite-item-name">\${name}</div>
                                </div>
                            \`;
                        }).join('');

                        // If selected sprite was deleted, select first one
                        if (selectedSprite && !currentData.sprites[selectedSprite]) {
                            selectedSprite = sprites[0][0];
                        }
                    }

                    updateRemoveButtonState();

                    // Redraw canvas to update sprite rectangles
                    if (spriteImage) {
                        redrawOverlay();
                    }
                }

                // Sprite list event listeners
                document.getElementById('remove-sprite-btn').addEventListener('click', () => {
                    if (!selectedSprite) {
                        return;
                    }
                    vscode.postMessage({
                        type: 'confirmDelete',
                        name: selectedSprite
                    });
                });

                // Initial state
                updateRemoveButtonState();

                // Sprite item selection
                const spriteList = document.getElementById('sprite-list');
                spriteList.addEventListener('click', (e) => {
                    const item = e.target.closest('.sprite-item');
                    if (item) {
                        document.querySelectorAll('.sprite-item').forEach(el => el.classList.remove('selected'));
                        item.classList.add('selected');
                        selectedSprite = item.dataset.name;
                        spriteList.focus();
                        updateRemoveButtonState();
                        renderPreview();
                        redrawOverlay();
                    }
                });

                // Sprite item rename (double-click)
                spriteList.addEventListener('dblclick', (e) => {
                    const item = e.target.closest('.sprite-item');
                    if (!item) return;

                    const currentName = item.dataset.name;
                    vscode.postMessage({
                        type: 'promptRename',
                        currentName: currentName
                    });
                });

                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'imageSelected':
                            document.getElementById('image-path').value = message.path;
                            currentData.image = message.path;
                            loadSpriteSheet();
                            updateDocument();
                            break;
                        case 'spriteNameEntered':
                            if (currentSelection) {
                                currentData.sprites[message.name] = { ...currentSelection };
                                selectedSprite = message.name;
                                currentSelection = null;
                                rebuildSpriteList();
                                renderPreview();
                                redrawOverlay();
                                updateDocument();
                            }
                            break;
                        case 'deleteConfirmed':
                            delete currentData.sprites[message.name];
                            selectedSprite = null;
                            rebuildSpriteList();
                            renderPreview();
                            redrawOverlay();
                            updateDocument();
                            break;
                        case 'renameConfirmed':
                            currentData.sprites[message.newName] = currentData.sprites[message.oldName];
                            delete currentData.sprites[message.oldName];
                            if (selectedSprite === message.oldName) {
                                selectedSprite = message.newName;
                            }
                            rebuildSpriteList();
                            renderPreview();
                            updateDocument();
                            break;
                        case 'imageUri':
                            // Received webview URI for image, now load it
                            const canvasView = document.getElementById('canvas-view');
                            spriteImage = new Image();
                            spriteImage.onload = () => {
                                drawCanvasView();
                                renderPreview();
                            };
                            spriteImage.onerror = () => {
                                canvasView.innerHTML = '<div class="canvas-placeholder">Failed to load image</div>';
                                spriteImage = null;
                            };
                            spriteImage.src = message.uri;
                            break;
                        case 'dataUpdated':
                            // External update to the document - update our data without resetting view state
                            currentData = message.data;

                            // Update image path input if changed
                            const imagePathInput = document.getElementById('image-path');
                            if (imagePathInput.value !== currentData.image) {
                                imagePathInput.value = currentData.image;
                                loadSpriteSheet();
                            }

                            // Check if selected sprite still exists
                            if (selectedSprite && !currentData.sprites[selectedSprite]) {
                                selectedSprite = null;
                            }

                            // Rebuild UI elements but preserve zoom and other state
                            rebuildSpriteList();
                            renderPreview();
                            if (spriteImage && spriteImage.complete) {
                                redrawOverlay();
                            }
                            break;
                    }
                });

                function updateDocument() {
                    vscode.postMessage({
                        type: 'update',
                        data: currentData
                    });
                }

                // Canvas View Functions
                function loadSpriteSheet() {
                    const canvasView = document.getElementById('canvas-view');

                    if (!currentData.image) {
                        canvasView.innerHTML = '<div class="canvas-placeholder">Select a sprite sheet to begin</div>';
                        spriteImage = null;
                        return;
                    }

                    // Request webview URI from extension
                    vscode.postMessage({
                        type: 'getImageUri',
                        path: currentData.image
                    });
                }

                function drawCanvasView() {
                    const canvasView = document.getElementById('canvas-view');

                    if (!spriteImage || !spriteImage.complete) {
                        console.error('Sprite image not loaded');
                        return;
                    }

                    const imgWidth = spriteImage.width;
                    const imgHeight = spriteImage.height;

                    // Apply zoom to dimensions
                    const zoomedWidth = Math.floor(imgWidth * canvasZoom);
                    const zoomedHeight = Math.floor(imgHeight * canvasZoom);

                    // Create container
                    canvasView.innerHTML = '';
                    const container = document.createElement('div');
                    container.className = 'canvas-container';
                    container.style.width = zoomedWidth + 'px';
                    container.style.height = zoomedHeight + 'px';

                    const baseCanvas = document.createElement('canvas');
                    baseCanvas.id = 'canvas-base';
                    baseCanvas.width = zoomedWidth;
                    baseCanvas.height = zoomedHeight;

                    const overlayCanvas = document.createElement('canvas');
                    overlayCanvas.id = 'canvas-overlay';
                    overlayCanvas.width = zoomedWidth;
                    overlayCanvas.height = zoomedHeight;

                    container.appendChild(baseCanvas);
                    container.appendChild(overlayCanvas);
                    canvasView.appendChild(container);

                    // Draw checkerboard background on base canvas
                    const baseCtx = baseCanvas.getContext('2d');

                    // Checkerboard pattern
                    const checkSize = 16;
                    const color1 = '#cccccc';
                    const color2 = '#999999';

                    for (let y = 0; y < zoomedHeight; y += checkSize) {
                        for (let x = 0; x < zoomedWidth; x += checkSize) {
                            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
                            baseCtx.fillStyle = isEven ? color1 : color2;
                            baseCtx.fillRect(x, y, checkSize, checkSize);
                        }
                    }

                    // Draw sprite sheet on top with pixel-perfect rendering
                    baseCtx.imageSmoothingEnabled = false;
                    baseCtx.drawImage(spriteImage, 0, 0, zoomedWidth, zoomedHeight);

                    // Draw sprite rectangles on overlay
                    redrawOverlay();

                    // Setup interaction
                    setupCanvasInteraction(overlayCanvas);
                }

                function redrawOverlay() {
                    const overlayCanvas = document.getElementById('canvas-overlay');
                    if (!overlayCanvas) {
                        return;
                    }

                    const ctx = overlayCanvas.getContext('2d');
                    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

                    // Draw existing sprite rectangles
                    const sprites = Object.entries(currentData.sprites);
                    sprites.forEach(([name, rect], index) => {
                        const hue = (index * 360) / Math.max(sprites.length, 1);
                        const color = \`hsl(\${hue}, 70%, 60%)\`;

                        // Scale rect to zoom
                        const x = rect.x * canvasZoom;
                        const y = rect.y * canvasZoom;
                        const width = rect.width * canvasZoom;
                        const height = rect.height * canvasZoom;

                        // Draw semi-transparent fill
                        ctx.fillStyle = name === selectedSprite ? 'rgba(100, 150, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
                        ctx.fillRect(x, y, width, height);

                        // Draw rectangle outline
                        ctx.strokeStyle = color;
                        ctx.lineWidth = name === selectedSprite ? 3 : 2;
                        ctx.strokeRect(x, y, width, height);

                        // Draw label
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                        ctx.fillRect(x, y - 16, ctx.measureText(name).width + 8, 16);
                        ctx.fillStyle = color;
                        ctx.font = '12px var(--vscode-font-family)';
                        ctx.fillText(name, x + 4, y - 4);

                        // Draw handles for selected sprite
                        if (name === selectedSprite) {
                            const handleSize = 6;
                            ctx.fillStyle = color;
                            ctx.strokeStyle = '#000000';
                            ctx.lineWidth = 1;

                            // Corner handles
                            const corners = [
                                { cx: x, cy: y },                           // top-left
                                { cx: x + width, cy: y },                   // top-right
                                { cx: x + width, cy: y + height },          // bottom-right
                                { cx: x, cy: y + height }                   // bottom-left
                            ];

                            // Edge handles
                            const edges = [
                                { cx: x + width / 2, cy: y },               // top
                                { cx: x + width, cy: y + height / 2 },      // right
                                { cx: x + width / 2, cy: y + height },      // bottom
                                { cx: x, cy: y + height / 2 }               // left
                            ];

                            [...corners, ...edges].forEach(handle => {
                                ctx.fillRect(handle.cx - handleSize / 2, handle.cy - handleSize / 2, handleSize, handleSize);
                                ctx.strokeRect(handle.cx - handleSize / 2, handle.cy - handleSize / 2, handleSize, handleSize);
                            });
                        }
                    });

                    // Draw current selection
                    if (currentSelection) {
                        const x = currentSelection.x * canvasZoom;
                        const y = currentSelection.y * canvasZoom;
                        const width = currentSelection.width * canvasZoom;
                        const height = currentSelection.height * canvasZoom;

                        ctx.strokeStyle = 'rgba(100, 150, 255, 0.8)';
                        ctx.lineWidth = 2;
                        ctx.setLineDash([5, 5]);
                        ctx.strokeRect(x, y, width, height);
                        ctx.setLineDash([]);

                        ctx.fillStyle = 'rgba(100, 150, 255, 0.2)';
                        ctx.fillRect(x, y, width, height);
                    }
                }

                // Check if a point is inside a sprite rectangle
                function findSpriteAtPoint(x, y) {
                    const sprites = Object.entries(currentData.sprites);
                    for (let i = sprites.length - 1; i >= 0; i--) {
                        const [name, rect] = sprites[i];
                        if (x >= rect.x && x < rect.x + rect.width &&
                            y >= rect.y && y < rect.y + rect.height) {
                            return name;
                        }
                    }
                    return null;
                }

                // Find which handle (if any) is at the given point
                function findHandleAtPoint(x, y, sprite) {
                    if (!sprite) return null;

                    const handleSize = 6 / canvasZoom; // Account for zoom
                    const tolerance = handleSize;

                    const rect = currentData.sprites[sprite];
                    if (!rect) return null;

                    // Check corners first (higher priority)
                    const corners = [
                        { name: 'nw', px: rect.x, py: rect.y },
                        { name: 'ne', px: rect.x + rect.width, py: rect.y },
                        { name: 'se', px: rect.x + rect.width, py: rect.y + rect.height },
                        { name: 'sw', px: rect.x, py: rect.y + rect.height }
                    ];

                    for (const corner of corners) {
                        if (Math.abs(x - corner.px) <= tolerance && Math.abs(y - corner.py) <= tolerance) {
                            return corner.name;
                        }
                    }

                    // Check edges
                    const edges = [
                        { name: 'n', condition: Math.abs(y - rect.y) <= tolerance && x >= rect.x && x <= rect.x + rect.width },
                        { name: 'e', condition: Math.abs(x - (rect.x + rect.width)) <= tolerance && y >= rect.y && y <= rect.y + rect.height },
                        { name: 's', condition: Math.abs(y - (rect.y + rect.height)) <= tolerance && x >= rect.x && x <= rect.x + rect.width },
                        { name: 'w', condition: Math.abs(x - rect.x) <= tolerance && y >= rect.y && y <= rect.y + rect.height }
                    ];

                    for (const edge of edges) {
                        if (edge.condition) {
                            return edge.name;
                        }
                    }

                    return null;
                }

                // Update cursor based on handle type
                function getCursorForHandle(handle) {
                    const cursors = {
                        'nw': 'nw-resize',
                        'ne': 'ne-resize',
                        'se': 'se-resize',
                        'sw': 'sw-resize',
                        'n': 'n-resize',
                        'e': 'e-resize',
                        's': 's-resize',
                        'w': 'w-resize',
                        'move': 'move'
                    };
                    return cursors[handle] || 'crosshair';
                }

                function setupCanvasInteraction(canvas) {
                    let dragMode = null; // null, 'create', 'handle', or 'move'
                    let dragHandle = null; // Which handle is being dragged
                    let editingSprite = null; // Name of sprite being edited
                    let dragStart = null; // Original mouse position
                    let originalRect = null; // Original sprite rect before drag

                    canvas.addEventListener('mousemove', (e) => {
                        if (isDrawing) {
                            // Currently dragging
                            const rect = canvas.getBoundingClientRect();
                            const x = Math.floor((e.clientX - rect.left) / canvasZoom);
                            const y = Math.floor((e.clientY - rect.top) / canvasZoom);

                            if (dragMode === 'create') {
                                // Creating new sprite
                                currentSelection = {
                                    x: Math.min(dragStart.x, x),
                                    y: Math.min(dragStart.y, y),
                                    width: Math.abs(x - dragStart.x),
                                    height: Math.abs(y - dragStart.y)
                                };
                            } else if (dragMode === 'handle' && originalRect) {
                                // Dragging a handle
                                const dx = x - dragStart.x;
                                const dy = y - dragStart.y;
                                const newRect = { ...originalRect };

                                // Apply delta based on handle type
                                if (dragHandle.includes('n')) {
                                    newRect.y = originalRect.y + dy;
                                    newRect.height = originalRect.height - dy;
                                }
                                if (dragHandle.includes('s')) {
                                    newRect.height = originalRect.height + dy;
                                }
                                if (dragHandle.includes('w')) {
                                    newRect.x = originalRect.x + dx;
                                    newRect.width = originalRect.width - dx;
                                }
                                if (dragHandle.includes('e')) {
                                    newRect.width = originalRect.width + dx;
                                }

                                // Ensure minimum size
                                if (newRect.width < 1) {
                                    newRect.x = originalRect.x + originalRect.width - 1;
                                    newRect.width = 1;
                                }
                                if (newRect.height < 1) {
                                    newRect.y = originalRect.y + originalRect.height - 1;
                                    newRect.height = 1;
                                }

                                currentSelection = newRect;
                            } else if (dragMode === 'move' && originalRect) {
                                // Moving sprite
                                const dx = x - dragStart.x;
                                const dy = y - dragStart.y;
                                currentSelection = {
                                    x: originalRect.x + dx,
                                    y: originalRect.y + dy,
                                    width: originalRect.width,
                                    height: originalRect.height
                                };
                            }

                            redrawOverlay();
                        } else {
                            // Update cursor based on what's under the mouse
                            const rect = canvas.getBoundingClientRect();
                            const x = Math.floor((e.clientX - rect.left) / canvasZoom);
                            const y = Math.floor((e.clientY - rect.top) / canvasZoom);

                            if (selectedSprite) {
                                const handle = findHandleAtPoint(x, y, selectedSprite);
                                if (handle) {
                                    canvas.style.cursor = getCursorForHandle(handle);
                                    return;
                                }

                                const sprite = findSpriteAtPoint(x, y);
                                if (sprite === selectedSprite) {
                                    canvas.style.cursor = 'move';
                                    return;
                                }
                            }

                            canvas.style.cursor = 'crosshair';
                        }
                    });

                    canvas.addEventListener('mousedown', (e) => {
                        const rect = canvas.getBoundingClientRect();
                        const x = Math.floor((e.clientX - rect.left) / canvasZoom);
                        const y = Math.floor((e.clientY - rect.top) / canvasZoom);

                        dragStart = { x, y };

                        // Check if clicking on a handle of the selected sprite
                        if (selectedSprite) {
                            const handle = findHandleAtPoint(x, y, selectedSprite);
                            if (handle) {
                                // Start dragging handle
                                dragMode = 'handle';
                                dragHandle = handle;
                                editingSprite = selectedSprite;
                                originalRect = { ...currentData.sprites[selectedSprite] };
                                currentSelection = { ...originalRect };
                                isDrawing = true;
                                return;
                            }

                            // Check if clicking inside selected sprite (move mode)
                            const clickedSprite = findSpriteAtPoint(x, y);
                            if (clickedSprite === selectedSprite) {
                                dragMode = 'move';
                                editingSprite = selectedSprite;
                                originalRect = { ...currentData.sprites[selectedSprite] };
                                currentSelection = { ...originalRect };
                                isDrawing = true;
                                return;
                            }
                        }

                        // Check if clicking on another sprite (select it)
                        const clickedSprite = findSpriteAtPoint(x, y);
                        if (clickedSprite) {
                            selectedSprite = clickedSprite;
                            rebuildSpriteList();
                            renderPreview();
                            redrawOverlay();
                            return;
                        }

                        // Otherwise, start creating new sprite
                        dragMode = 'create';
                        editingSprite = null;
                        isDrawing = true;
                        currentSelection = { x, y, width: 0, height: 0 };
                        redrawOverlay();
                    });

                    canvas.addEventListener('mouseup', (e) => {
                        if (!isDrawing) return;
                        isDrawing = false;

                        if (currentSelection && currentSelection.width > 0 && currentSelection.height > 0) {
                            if (dragMode === 'handle' || dragMode === 'move') {
                                // Update existing sprite
                                currentData.sprites[editingSprite] = { ...currentSelection };
                                currentSelection = null;
                                redrawOverlay();
                                renderPreview();
                                updateDocument();
                            } else if (dragMode === 'create') {
                                // Prompt for new sprite name
                                vscode.postMessage({ type: 'promptSpriteName' });
                            }
                        } else {
                            currentSelection = null;
                            redrawOverlay();
                        }

                        dragMode = null;
                        dragHandle = null;
                        editingSprite = null;
                        originalRect = null;
                        dragStart = null;
                    });

                    canvas.addEventListener('mouseleave', () => {
                        if (isDrawing) {
                            isDrawing = false;
                            currentSelection = null;
                            dragMode = null;
                            dragHandle = null;
                            editingSprite = null;
                            originalRect = null;
                            dragStart = null;
                            redrawOverlay();
                        }
                        canvas.style.cursor = 'crosshair';
                    });
                }

                // Preview Functions
                function renderPreview() {
                    const previewEl = document.getElementById('preview');

                    if (!selectedSprite || !currentData.sprites[selectedSprite]) {
                        previewEl.innerHTML = '<div class="preview-placeholder">No sprite selected</div>';
                        return;
                    }

                    if (!spriteImage || !spriteImage.complete) {
                        previewEl.innerHTML = '<div class="preview-placeholder">Loading...</div>';
                        return;
                    }

                    const sprite = currentData.sprites[selectedSprite];

                    // Use preview zoom for scaling
                    const previewWidth = sprite.width * previewZoom;
                    const previewHeight = sprite.height * previewZoom;

                    // Build preview HTML
                    previewEl.innerHTML = \`
                        <div class="preview-canvas-container">
                            <canvas id="preview-canvas"></canvas>
                        </div>
                        <div class="preview-info">
                            <div class="preview-info-row">
                                <span class="preview-info-label">Name:</span>
                                <span>\${selectedSprite}</span>
                            </div>
                            <div class="preview-info-row">
                                <span class="preview-info-label">Position:</span>
                                <span>x: \${sprite.x}, y: \${sprite.y}</span>
                            </div>
                            <div class="preview-info-row">
                                <span class="preview-info-label">Size:</span>
                                <span>\${sprite.width} × \${sprite.height}px</span>
                            </div>
                            <div class="preview-info-row">
                                <span class="preview-info-label">Zoom:</span>
                                <span>\${previewZoom}x</span>
                            </div>
                        </div>
                    \`;

                    const canvas = document.getElementById('preview-canvas');
                    canvas.width = previewWidth;
                    canvas.height = previewHeight;

                    // Draw sprite
                    const ctx = canvas.getContext('2d');

                    // Draw checkerboard
                    const checkSize = 8;
                    const color1 = '#cccccc';
                    const color2 = '#999999';
                    for (let y = 0; y < previewHeight; y += checkSize) {
                        for (let x = 0; x < previewWidth; x += checkSize) {
                            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
                            ctx.fillStyle = isEven ? color1 : color2;
                            ctx.fillRect(x, y, checkSize, checkSize);
                        }
                    }

                    // Draw sprite
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(
                        spriteImage,
                        sprite.x, sprite.y, sprite.width, sprite.height,
                        0, 0, previewWidth, previewHeight
                    );

                    // Draw center reticle
                    const centerX = previewWidth / 2;
                    const centerY = previewHeight / 2;
                    const reticleSize = 10;

                    ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
                    ctx.lineWidth = 1;

                    // Horizontal line
                    ctx.beginPath();
                    ctx.moveTo(centerX - reticleSize, centerY);
                    ctx.lineTo(centerX + reticleSize, centerY);
                    ctx.stroke();

                    // Vertical line
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY - reticleSize);
                    ctx.lineTo(centerX, centerY + reticleSize);
                    ctx.stroke();

                    // Center dot
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                    ctx.fillRect(centerX - 1, centerY - 1, 2, 2);
                }

                // Load sprite sheet on init
                loadSpriteSheet();
                renderPreview();
            </script>
        </body>
        </html>`;
    }

    private getSpriteColor(index: number, total: number): string {
        const hue = (index * 360) / Math.max(total, 1);
        return `hsl(${hue}, 70%, 60%)`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
