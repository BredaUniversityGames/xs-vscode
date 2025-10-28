import * as vscode from 'vscode';
import * as path from 'path';

interface AnimationData {
    image: string;
    columns: number;
    rows: number;
    fps: number;
    animations: { [name: string]: number[] };
}

export class AnimationEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new AnimationEditorProvider(context);
        return vscode.window.registerCustomEditorProvider('xs.animationEditor', provider, {
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

        // Load the animation data
        let animationData: AnimationData;
        try {
            const text = document.getText();
            if (text.trim().length === 0) {
                // Empty file - create default data
                animationData = {
                    image: '',
                    columns: 1,
                    rows: 1,
                    fps: 10,
                    animations: {}
                };
            } else {
                animationData = JSON.parse(text);
            }
        } catch (e) {
            vscode.window.showErrorMessage('Failed to parse animation file. Using defaults.');
            animationData = {
                image: '',
                columns: 1,
                rows: 1,
                fps: 10,
                animations: {}
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
            webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, animationData, toolkitUri);
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
                case 'promptAnimationName':
                    const name = await vscode.window.showInputBox({
                        prompt: 'Enter animation name',
                        placeHolder: 'Animation name',
                        validateInput: (value) => {
                            if (!value || value.trim() === '') {
                                return 'Name cannot be empty';
                            }
                            if (animationData.animations[value]) {
                                return 'Animation with this name already exists';
                            }
                            return null;
                        }
                    });
                    if (name) {
                        animationData.animations[name] = [];
                        webviewPanel.webview.postMessage({
                            type: 'animationNameEntered',
                            name: name
                        });
                    }
                    break;
                case 'confirmDelete':
                    const result = await vscode.window.showWarningMessage(
                        `Delete animation "${message.name}"?`,
                        { modal: true },
                        'Delete'
                    );
                    if (result === 'Delete') {
                        delete animationData.animations[message.name];
                        webviewPanel.webview.postMessage({
                            type: 'deleteConfirmed',
                            name: message.name
                        });
                    }
                    break;
                case 'promptRename':
                    const newName = await vscode.window.showInputBox({
                        prompt: 'Rename animation',
                        value: message.currentName,
                        validateInput: (value) => {
                            if (!value || value.trim() === '') {
                                return 'Name cannot be empty';
                            }
                            if (value !== message.currentName && animationData.animations[value]) {
                                return 'Animation with this name already exists';
                            }
                            return null;
                        }
                    });
                    if (newName && newName !== message.currentName) {
                        animationData.animations[newName] = animationData.animations[message.currentName];
                        delete animationData.animations[message.currentName];
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
                        animationData = JSON.parse(text);
                        updateWebview();
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

    private updateTextDocument(document: vscode.TextDocument, data: AnimationData) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, JSON.stringify(data, null, 2));
        vscode.workspace.applyEdit(edit);
    }

    private getHtmlContent(webview: vscode.Webview, data: AnimationData, toolkitUri: vscode.Uri): string {
        const animationEntries = Object.entries(data.animations);

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
                    width: 350px;
                }

                .top-bar-group input.small {
                    width: 45px;
                    text-align: center;
                }

                /* Main Content Area */
                .main-content {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                }

                /* Animation List Panel */
                .animation-list-panel {
                    width: 250px;
                    flex-shrink: 0;
                    background: var(--vscode-tab-inactiveBackground);
                    display: flex;
                    flex-direction: column;
                }

                .animation-list-header {
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

                .animation-list-buttons {
                    display: flex;
                    gap: 4px;
                }

                .animation-list {
                    flex: 1;
                    overflow-y: auto;
                    outline: none;
                }

                .animation-item {
                    display: flex;
                    align-items: center;
                    padding: 0 8px;
                    height: 22px;
                    cursor: pointer;
                    gap: 8px;
                    user-select: none;
                }

                .animation-item:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .animation-item.selected {
                    background: var(--vscode-list-inactiveSelectionBackground);
                    color: var(--vscode-list-inactiveSelectionForeground);
                }

                .animation-list:focus-within .animation-item.selected {
                    background: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }

                .animation-color-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }

                .animation-item-name {
                    flex: 1;
                    font-size: 13px;
                }

                .animation-item-name input {
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-focusBorder);
                    padding: 2px 4px;
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    outline: none;
                    width: 100%;
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

                /* Grid View Panel */
                .grid-view-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    background: var(--vscode-editor-background);
                }

                .grid-view-header {
                    padding: 0 8px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-foreground);
                }

                .grid-view-header span {
                    flex: 1;
                }

                .grid-view-buttons {
                    display: flex;
                    gap: 4px;
                    margin-left: 8px;
                }

                .grid-view-content {
                    flex: 1;
                    overflow: auto;
                    padding: 16px;
                    position: relative;
                }

                .grid-placeholder {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }

                .grid-canvas-container {
                    position: relative;
                    display: inline-block;
                }

                .grid-canvas-container canvas {
                    position: absolute;
                    top: 0;
                    left: 0;
                }

                .grid-canvas-container #grid-base-canvas {
                    position: absolute;
                    top: 0;
                    left: 0;
                }

                .grid-canvas-container #grid-overlay-canvas {
                    position: absolute;
                    top: 0;
                    left: 0;
                    cursor: crosshair;
                    pointer-events: auto;
                }

                /* Bottom Panels Container */
                .bottom-container {
                    display: flex;
                    flex-direction: column;
                }

                /* Bottom Panels */
                .bottom-panels {
                    height: 200px;
                    flex-shrink: 0;
                    display: flex;
                }

                /* Timeline Panel */
                .timeline-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    background: var(--vscode-editor-background);
                }

                .timeline-header {
                    padding: 0 8px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-foreground);
                }

                .timeline-header span {
                    flex: 1;
                }

                .timeline-buttons {
                    display: flex;
                    gap: 4px;
                    margin-left: 8px;
                }

                .timeline-content {
                    flex: 1;
                    padding: 8px;
                    overflow-x: auto;
                    overflow-y: hidden;
                    display: flex;
                    gap: 4px;
                    align-items: flex-start;
                }

                .timeline-placeholder {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }

                .timeline-frame {
                    position: relative;
                    flex-shrink: 0;
                    cursor: pointer;
                    border: 2px solid transparent;
                    background: var(--vscode-editor-background);
                }

                .timeline-frame:hover {
                    border-color: var(--vscode-list-hoverBackground);
                }

                .timeline-frame.selected {
                    border-color: var(--vscode-focusBorder);
                }

                .timeline-frame canvas {
                    display: block;
                }

                .timeline-frame-index {
                    position: absolute;
                    bottom: 2px;
                    right: 2px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    font-size: 10px;
                    padding: 2px 4px;
                    border-radius: 2px;
                }

                /* Preview Panel */
                .preview-panel {
                    width: 300px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    background: var(--vscode-editor-background);
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

                .preview-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    overflow: auto;
                }

                .preview-placeholder {
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }

                .preview-canvas-container {
                    position: relative;
                    display: inline-block;
                }

                .preview-canvas-container canvas {
                    display: block;
                    image-rendering: pixelated;
                    image-rendering: crisp-edges;
                }

                .preview-controls {
                    margin-top: 12px;
                    display: flex;
                    gap: 4px;
                    align-items: center;
                }

                .preview-frame-info {
                    margin-top: 8px;
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
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
                <div class="top-bar-group">
                    <label>Columns</label>
                    <input type="number" class="small" id="columns" value="${data.columns}" min="1" />
                </div>
                <div class="top-bar-group">
                    <label>Rows</label>
                    <input type="number" class="small" id="rows" value="${data.rows}" min="1" />
                </div>
                <div class="top-bar-group">
                    <label>FPS</label>
                    <input type="number" class="small" id="fps" value="${data.fps}" min="1" />
                </div>
                <div class="top-bar-group" style="margin-left: auto; color: var(--vscode-descriptionForeground);">
                    <span id="cell-size-display">Cell: -</span>
                </div>
            </div>

            <!-- Main Content -->
            <div class="main-content">
                <!-- Animation List -->
                <div class="animation-list-panel" id="animation-list-panel">
                    <div class="animation-list-header">
                        <span>Animations</span>
                        <div class="animation-list-buttons">
                            <vscode-button appearance="icon" aria-label="New Animation" title="New Animation" id="add-animation-btn">
                                <span class="codicon codicon-new-file"></span>
                            </vscode-button>
                            <vscode-button appearance="icon" aria-label="Delete Animation" title="Delete Animation" id="remove-animation-btn" disabled>
                                <span class="codicon codicon-trash"></span>
                            </vscode-button>
                        </div>
                    </div>
                    <div class="animation-list" id="animation-list" tabindex="0">
                        ${animationEntries.length === 0 ?
                            '<div style="padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No animations</div>' :
                            animationEntries.map(([name, frames], index) => {
                                const color = this.getAnimationColor(index, animationEntries.length);
                                return `
                                    <div class="animation-item ${index === 0 ? 'selected' : ''}" data-name="${this.escapeHtml(name)}">
                                        <div class="animation-color-dot" style="background: ${color};"></div>
                                        <div class="animation-item-name">${this.escapeHtml(name)}</div>
                                    </div>
                                `;
                            }).join('')
                        }
                    </div>
                </div>

                <!-- Separator -->
                <div class="panel-separator"></div>

                <!-- Grid View -->
                <div class="grid-view-panel">
                    <div class="grid-view-header">
                        <span>Sprite Sheet</span>
                        <div class="grid-view-controls">
                            <select id="grid-zoom-select">
                                <option value="0.25">25%</option>
                                <option value="0.5">50%</option>
                                <option value="1" selected>100%</option>
                                <option value="2">200%</option>
                                <option value="4">400%</option>
                            </select>
                            <vscode-button appearance="icon" aria-label="Add Selected Frames to Animation" title="Add Selected Frames to Animation" id="add-frames-btn" disabled>
                                <span class="codicon codicon-new-file"></span>
                            </vscode-button>
                        </div>
                    </div>
                    <div class="grid-view-content" id="grid-view">
                        <div class="grid-placeholder">
                            Select a sprite sheet to begin
                        </div>
                    </div>
                </div>
            </div>

            <!-- Separator -->
            <div class="panel-separator-horizontal"></div>

            <!-- Bottom Panels -->
            <div class="bottom-panels" style="height: 200px;">
                <!-- Timeline -->
                <div class="timeline-panel" id="timeline-panel">
                    <div class="timeline-header">
                        <span>Timeline</span>
                        <div class="timeline-buttons">
                            <vscode-button appearance="icon" aria-label="Insert Before" id="insert-before-btn" disabled>
                                <span class="codicon codicon-arrow-left"></span>
                            </vscode-button>
                            <vscode-button appearance="icon" aria-label="Insert After" id="insert-after-btn" disabled>
                                <span class="codicon codicon-arrow-right"></span>
                            </vscode-button>
                            <vscode-button appearance="icon" aria-label="Remove Frame" id="remove-frame-btn" disabled>
                                <span class="codicon codicon-trash"></span>
                            </vscode-button>
                        </div>
                    </div>
                    <div class="timeline-content" id="timeline">
                        <div class="timeline-placeholder">No animation selected</div>
                    </div>
                </div>

                <!-- Separator -->
                <div class="panel-separator"></div>

                <!-- Preview -->
                <div class="preview-panel" id="preview-panel">
                    <div class="preview-header"><span>Preview</span></div>
                    <div class="preview-content" id="preview">
                        <div class="preview-placeholder">No animation selected</div>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentData = ${JSON.stringify(data)};
                let selectedAnimation = ${animationEntries.length > 0 ? `"${this.escapeHtml(animationEntries[0][0])}"` : 'null'};
                let selectedFrames = new Set(); // Currently selected frames in grid
                let spriteImage = null; // Loaded sprite sheet image
                let selectedTimelineIndex = -1; // Selected frame index in timeline
                let isPlaying = false; // Preview playback state
                let currentPreviewFrame = 0; // Current frame in preview
                let loopEnabled = true; // Loop animation
                let lastFrameTime = 0; // For FPS timing
                let animationFrameId = null; // RequestAnimationFrame ID
                let gridZoom = 1; // Grid view zoom level

                // Top bar event listeners
                document.getElementById('browse-btn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'browse' });
                });

                document.getElementById('image-path').addEventListener('input', (e) => {
                    currentData.image = e.target.value;
                    loadSpriteSheet();
                    updateDocument();
                });

                document.getElementById('columns').addEventListener('input', (e) => {
                    currentData.columns = parseInt(e.target.value) || 1;
                    if (spriteImage) {
                        redrawOverlay();
                        updateCellSizeDisplay();
                    }
                    updateDocument();
                });

                document.getElementById('rows').addEventListener('input', (e) => {
                    currentData.rows = parseInt(e.target.value) || 1;
                    if (spriteImage) {
                        redrawOverlay();
                        updateCellSizeDisplay();
                    }
                    updateDocument();
                });

                document.getElementById('fps').addEventListener('input', (e) => {
                    currentData.fps = parseInt(e.target.value) || 1;
                    updateDocument();
                });

                // Grid zoom event listener
                document.getElementById('grid-zoom-select').addEventListener('change', (e) => {
                    gridZoom = parseFloat(e.target.value) || 1;
                    if (spriteImage && spriteImage.complete) {
                        drawGridView();
                    }
                });

                // Update remove button state
                function updateRemoveButtonState() {
                    const removeBtn = document.getElementById('remove-animation-btn');
                    if (selectedAnimation && currentData.animations[selectedAnimation]) {
                        removeBtn.removeAttribute('disabled');
                    } else {
                        removeBtn.setAttribute('disabled', 'true');
                    }
                }

                // Rebuild animation list UI
                function rebuildAnimationList() {
                    const listEl = document.getElementById('animation-list');
                    const animations = Object.entries(currentData.animations);

                    if (animations.length === 0) {
                        listEl.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No animations</div>';
                        selectedAnimation = null;
                    } else {
                        listEl.innerHTML = animations.map(([name, frames], index) => {
                            const hue = (index * 360) / Math.max(animations.length, 1);
                            const color = \`hsl(\${hue}, 70%, 60%)\`;
                            const isSelected = name === selectedAnimation;
                            return \`
                                <div class="animation-item \${isSelected ? 'selected' : ''}" data-name="\${name}">
                                    <div class="animation-color-dot" style="background: \${color};"></div>
                                    <div class="animation-item-name">\${name}</div>
                                </div>
                            \`;
                        }).join('');

                        // If selected animation was deleted, select first one
                        if (selectedAnimation && !currentData.animations[selectedAnimation]) {
                            selectedAnimation = animations[0][0];
                        }
                    }

                    updateRemoveButtonState();
                    updateAddFramesButtonState();

                    // Redraw grid to update animation dots
                    if (spriteImage) {
                        redrawOverlay();
                    }
                }

                // Animation list event listeners
                document.getElementById('add-animation-btn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'promptAnimationName' });
                });

                document.getElementById('remove-animation-btn').addEventListener('click', () => {
                    if (!selectedAnimation) {
                        return;
                    }
                    vscode.postMessage({
                        type: 'confirmDelete',
                        name: selectedAnimation
                    });
                });

                // Initial state
                updateRemoveButtonState();
                updateAddFramesButtonState();

                // Animation item selection
                const animationList = document.getElementById('animation-list');
                animationList.addEventListener('click', (e) => {
                    const item = e.target.closest('.animation-item');
                    if (item && !e.target.matches('input')) {
                        document.querySelectorAll('.animation-item').forEach(el => el.classList.remove('selected'));
                        item.classList.add('selected');
                        selectedAnimation = item.dataset.name;
                        selectedTimelineIndex = -1; // Reset timeline selection
                        currentPreviewFrame = 0; // Reset preview
                        stopAnimation();
                        animationList.focus();
                        updateRemoveButtonState();
                        updateAddFramesButtonState();
                        renderTimeline();
                        renderPreview();
                    }
                });

                // Animation item rename (double-click)
                document.getElementById('animation-list').addEventListener('dblclick', (e) => {
                    const item = e.target.closest('.animation-item');
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
                        case 'animationNameEntered':
                            currentData.animations[message.name] = [];
                            selectedAnimation = message.name;
                            selectedTimelineIndex = -1;
                            currentPreviewFrame = 0;
                            stopAnimation();
                            rebuildAnimationList();
                            renderTimeline();
                            renderPreview();
                            updateDocument();
                            break;
                        case 'deleteConfirmed':
                            delete currentData.animations[message.name];
                            selectedAnimation = null;
                            selectedTimelineIndex = -1;
                            currentPreviewFrame = 0;
                            stopAnimation();
                            rebuildAnimationList();
                            renderTimeline();
                            renderPreview();
                            updateDocument();
                            break;
                        case 'renameConfirmed':
                            currentData.animations[message.newName] = currentData.animations[message.oldName];
                            delete currentData.animations[message.oldName];
                            if (selectedAnimation === message.oldName) {
                                selectedAnimation = message.newName;
                            }
                            rebuildAnimationList();
                            renderTimeline();
                            renderPreview();
                            updateDocument();
                            break;
                        case 'imageUri':
                            // Received webview URI for image, now load it
                            const gridView = document.getElementById('grid-view');
                            spriteImage = new Image();
                            spriteImage.onload = () => {
                                drawGridView();
                                renderTimeline();
                            };
                            spriteImage.onerror = () => {
                                gridView.innerHTML = '<div class="grid-placeholder">Failed to load image</div>';
                                spriteImage = null;
                            };
                            spriteImage.src = message.uri;
                            break;
                    }
                });

                function updateDocument() {
                    vscode.postMessage({
                        type: 'update',
                        data: currentData
                    });
                }

                // Grid View Functions
                function loadSpriteSheet() {
                    const gridView = document.getElementById('grid-view');

                    if (!currentData.image) {
                        gridView.innerHTML = '<div class="grid-placeholder">Select a sprite sheet to begin</div>';
                        spriteImage = null;
                        return;
                    }

                    // Request webview URI from extension
                    vscode.postMessage({
                        type: 'getImageUri',
                        path: currentData.image
                    });
                }

                function drawGridView() {
                    const gridView = document.getElementById('grid-view');

                    if (!spriteImage || !spriteImage.complete) {
                        console.error('Sprite image not loaded');
                        return;
                    }

                    const cols = currentData.columns;
                    const rows = currentData.rows;
                    const imgWidth = spriteImage.width;
                    const imgHeight = spriteImage.height;

                    // Apply zoom to dimensions
                    const zoomedWidth = Math.floor(imgWidth * gridZoom);
                    const zoomedHeight = Math.floor(imgHeight * gridZoom);

                    console.log('Drawing grid view:', { cols, rows, imgWidth, imgHeight, gridZoom, zoomedWidth, zoomedHeight });

                    // Create container
                    gridView.innerHTML = '';
                    const container = document.createElement('div');
                    container.className = 'grid-canvas-container';
                    container.style.width = zoomedWidth + 'px';
                    container.style.height = zoomedHeight + 'px';

                    const baseCanvas = document.createElement('canvas');
                    baseCanvas.id = 'grid-base-canvas';
                    baseCanvas.width = zoomedWidth;
                    baseCanvas.height = zoomedHeight;

                    const overlayCanvas = document.createElement('canvas');
                    overlayCanvas.id = 'grid-overlay-canvas';
                    overlayCanvas.className = 'overlay-canvas';
                    overlayCanvas.width = zoomedWidth;
                    overlayCanvas.height = zoomedHeight;

                    container.appendChild(baseCanvas);
                    container.appendChild(overlayCanvas);
                    gridView.appendChild(container);

                    // Draw checkerboard background on base canvas
                    const baseCtx = baseCanvas.getContext('2d');

                    // Checkerboard pattern
                    const checkSize = 16;
                    const color1 = '#cccccc';
                    const color2 = '#999999';

                    for (let y = 0; y < imgHeight; y += checkSize) {
                        for (let x = 0; x < imgWidth; x += checkSize) {
                            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
                            baseCtx.fillStyle = isEven ? color1 : color2;
                            baseCtx.fillRect(x, y, checkSize, checkSize);
                        }
                    }

                    // Draw sprite sheet on top
                    baseCtx.drawImage(spriteImage, 0, 0);

                    console.log('Base canvas drawn with checkerboard');

                    // Draw grid and decorations on overlay
                    redrawOverlay();

                    console.log('Overlay drawn');

                    // Setup interaction
                    setupGridInteraction(overlayCanvas);

                    // Update cell size display
                    updateCellSizeDisplay();

                    console.log('Interaction setup complete');
                }

                function updateCellSizeDisplay() {
                    const display = document.getElementById('cell-size-display');
                    if (!spriteImage || !spriteImage.complete) {
                        display.textContent = 'Cell: -';
                        return;
                    }

                    const cellWidth = Math.floor(spriteImage.width / currentData.columns);
                    const cellHeight = Math.floor(spriteImage.height / currentData.rows);
                    display.textContent = \`Cell: \${cellWidth}×\${cellHeight}px\`;
                }

                function redrawOverlay() {
                    const overlayCanvas = document.getElementById('grid-overlay-canvas');
                    if (!overlayCanvas) {
                        console.error('Overlay canvas not found');
                        return;
                    }

                    const ctx = overlayCanvas.getContext('2d');
                    const cols = currentData.columns;
                    const rows = currentData.rows;
                    const cellWidth = overlayCanvas.width / cols;
                    const cellHeight = overlayCanvas.height / rows;

                    console.log('Redrawing overlay:', { cols, rows, cellWidth, cellHeight, canvasWidth: overlayCanvas.width, canvasHeight: overlayCanvas.height });

                    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

                    // Draw simple grid lines
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                    ctx.lineWidth = 1;

                    // Draw all vertical lines
                    for (let x = 0; x <= cols; x++) {
                        const xPos = Math.floor(x * cellWidth) + 0.5;
                        ctx.beginPath();
                        ctx.moveTo(xPos, 0);
                        ctx.lineTo(xPos, overlayCanvas.height);
                        ctx.stroke();
                    }

                    // Draw all horizontal lines
                    for (let y = 0; y <= rows; y++) {
                        const yPos = Math.floor(y * cellHeight) + 0.5;
                        ctx.beginPath();
                        ctx.moveTo(0, yPos);
                        ctx.lineTo(overlayCanvas.width, yPos);
                        ctx.stroke();
                    }

                    // Draw animation dots on frames
                    const animations = Object.entries(currentData.animations);
                    for (let row = 0; row < rows; row++) {
                        for (let col = 0; col < cols; col++) {
                            const frameIndex = row * cols + col;
                            const x = col * cellWidth;
                            const y = row * cellHeight;

                            // Find which animations contain this frame
                            const animsWithFrame = [];
                            animations.forEach(([name, frames], index) => {
                                if (frames.includes(frameIndex)) {
                                    const hue = (index * 360) / Math.max(animations.length, 1);
                                    animsWithFrame.push({ name, color: \`hsl(\${hue}, 70%, 60%)\` });
                                }
                            });

                            // Draw dots for each animation
                            animsWithFrame.forEach((anim, dotIndex) => {
                                ctx.fillStyle = anim.color;
                                ctx.beginPath();
                                const dotX = x + 6;
                                const dotY = y + 6 + (dotIndex * 6);
                                ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
                                ctx.fill();
                            });

                            // Highlight selected frames
                            if (selectedFrames.has(frameIndex)) {
                                ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';
                                ctx.fillRect(x, y, cellWidth, cellHeight);
                                ctx.strokeStyle = 'rgba(100, 150, 255, 0.8)';
                                ctx.lineWidth = 2;
                                ctx.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
                            }
                        }
                    }
                }

                function getFrameAtPosition(canvas, clientX, clientY) {
                    const rect = canvas.getBoundingClientRect();
                    const x = clientX - rect.left;
                    const y = clientY - rect.top;

                    const cols = currentData.columns;
                    const rows = currentData.rows;
                    const cellWidth = canvas.width / cols;
                    const cellHeight = canvas.height / rows;

                    const col = Math.floor(x / cellWidth);
                    const row = Math.floor(y / cellHeight);

                    if (col >= 0 && col < cols && row >= 0 && row < rows) {
                        return row * cols + col;
                    }
                    return -1;
                }

                function setupGridInteraction(canvas) {
                    console.log('Setting up grid interaction on canvas:', canvas);
                    let isDragging = false;
                    let dragStartFrame = -1;

                    canvas.addEventListener('mousedown', (e) => {
                        console.log('Mouse down on canvas');
                        const frame = getFrameAtPosition(canvas, e.clientX, e.clientY);
                        console.log('Frame at position:', frame);
                        if (frame !== -1) {
                            isDragging = true;
                            dragStartFrame = frame;

                            // Toggle selection on click
                            if (selectedFrames.has(frame)) {
                                selectedFrames.delete(frame);
                            } else {
                                selectedFrames.add(frame);
                            }
                            console.log('Selected frames:', Array.from(selectedFrames));
                            redrawOverlay();
                            updateAddFramesButtonState();
                        }
                    });

                    canvas.addEventListener('mousemove', (e) => {
                        if (!isDragging) return;

                        const currentFrame = getFrameAtPosition(canvas, e.clientX, e.clientY);
                        if (currentFrame !== -1) {
                            // Select all frames in rectangle from dragStartFrame to currentFrame
                            const cols = currentData.columns;
                            const startRow = Math.floor(dragStartFrame / cols);
                            const startCol = dragStartFrame % cols;
                            const endRow = Math.floor(currentFrame / cols);
                            const endCol = currentFrame % cols;

                            const minRow = Math.min(startRow, endRow);
                            const maxRow = Math.max(startRow, endRow);
                            const minCol = Math.min(startCol, endCol);
                            const maxCol = Math.max(startCol, endCol);

                            selectedFrames.clear();
                            for (let r = minRow; r <= maxRow; r++) {
                                for (let c = minCol; c <= maxCol; c++) {
                                    selectedFrames.add(r * cols + c);
                                }
                            }
                            redrawOverlay();
                            updateAddFramesButtonState();
                        }
                    });

                    canvas.addEventListener('mouseup', () => {
                        isDragging = false;
                    });

                    canvas.addEventListener('mouseleave', () => {
                        isDragging = false;
                    });
                }

                // Update add frames button state
                function updateAddFramesButtonState() {
                    const addBtn = document.getElementById('add-frames-btn');
                    if (selectedAnimation && selectedFrames.size > 0) {
                        addBtn.removeAttribute('disabled');
                    } else {
                        addBtn.setAttribute('disabled', 'true');
                    }
                }

                // Add frames button
                document.getElementById('add-frames-btn').addEventListener('click', () => {
                    if (!selectedAnimation || selectedFrames.size === 0) {
                        return;
                    }

                    // Add selected frames to current animation
                    const framesToAdd = Array.from(selectedFrames).sort((a, b) => a - b);
                    currentData.animations[selectedAnimation].push(...framesToAdd);

                    // Clear selection
                    selectedFrames.clear();
                    redrawOverlay();
                    renderTimeline();
                    renderPreview();
                    updateAddFramesButtonState();
                    updateDocument();
                });

                // Timeline Functions
                function renderTimeline() {
                    const timelineEl = document.getElementById('timeline');

                    if (!selectedAnimation || !currentData.animations[selectedAnimation]) {
                        timelineEl.innerHTML = '<div class="timeline-placeholder">No animation selected</div>';
                        selectedTimelineIndex = -1;
                        updateTimelineButtonState();
                        return;
                    }

                    const frames = currentData.animations[selectedAnimation];

                    if (frames.length === 0) {
                        timelineEl.innerHTML = '<div class="timeline-placeholder">No frames in animation</div>';
                        selectedTimelineIndex = -1;
                        updateTimelineButtonState();
                        return;
                    }

                    if (!spriteImage || !spriteImage.complete) {
                        timelineEl.innerHTML = '<div class="timeline-placeholder">Loading...</div>';
                        return;
                    }

                    // Render frame thumbnails
                    timelineEl.innerHTML = '';

                    const cols = currentData.columns;
                    const rows = currentData.rows;
                    const cellWidth = spriteImage.width / cols;
                    const cellHeight = spriteImage.height / rows;
                    const thumbHeight = 80; // Max thumbnail height
                    const scale = Math.min(1, thumbHeight / cellHeight);
                    const thumbWidth = cellWidth * scale;
                    const scaledThumbHeight = cellHeight * scale;

                    frames.forEach((frameIndex, timelineIndex) => {
                        const frameDiv = document.createElement('div');
                        frameDiv.className = 'timeline-frame';
                        if (timelineIndex === selectedTimelineIndex) {
                            frameDiv.classList.add('selected');
                        }
                        frameDiv.dataset.timelineIndex = timelineIndex;

                        // Create canvas for thumbnail
                        const canvas = document.createElement('canvas');
                        canvas.width = thumbWidth;
                        canvas.height = scaledThumbHeight;

                        const ctx = canvas.getContext('2d');

                        // Draw checkerboard background
                        const checkSize = 8;
                        const color1 = '#cccccc';
                        const color2 = '#999999';
                        for (let y = 0; y < scaledThumbHeight; y += checkSize) {
                            for (let x = 0; x < thumbWidth; x += checkSize) {
                                const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
                                ctx.fillStyle = isEven ? color1 : color2;
                                ctx.fillRect(x, y, checkSize, checkSize);
                            }
                        }

                        // Calculate source position
                        const row = Math.floor(frameIndex / cols);
                        const col = frameIndex % cols;
                        const sx = col * cellWidth;
                        const sy = row * cellHeight;

                        // Draw frame
                        ctx.drawImage(
                            spriteImage,
                            sx, sy, cellWidth, cellHeight,
                            0, 0, thumbWidth, scaledThumbHeight
                        );

                        // Add frame index label
                        const label = document.createElement('div');
                        label.className = 'timeline-frame-index';
                        label.textContent = frameIndex;

                        frameDiv.appendChild(canvas);
                        frameDiv.appendChild(label);
                        timelineEl.appendChild(frameDiv);
                    });

                    updateTimelineButtonState();
                }

                function updateTimelineButtonState() {
                    const insertBeforeBtn = document.getElementById('insert-before-btn');
                    const insertAfterBtn = document.getElementById('insert-after-btn');
                    const removeFrameBtn = document.getElementById('remove-frame-btn');

                    const hasSelection = selectedTimelineIndex >= 0 &&
                                        selectedAnimation &&
                                        currentData.animations[selectedAnimation] &&
                                        selectedTimelineIndex < currentData.animations[selectedAnimation].length;

                    const hasFramesSelected = selectedFrames.size > 0 && selectedAnimation;

                    if (hasSelection && hasFramesSelected) {
                        insertBeforeBtn.removeAttribute('disabled');
                        insertAfterBtn.removeAttribute('disabled');
                    } else {
                        insertBeforeBtn.setAttribute('disabled', 'true');
                        insertAfterBtn.setAttribute('disabled', 'true');
                    }

                    if (hasSelection) {
                        removeFrameBtn.removeAttribute('disabled');
                    } else {
                        removeFrameBtn.setAttribute('disabled', 'true');
                    }
                }

                // Timeline event listeners
                document.getElementById('timeline').addEventListener('click', (e) => {
                    const frameDiv = e.target.closest('.timeline-frame');
                    if (frameDiv) {
                        const timelineIndex = parseInt(frameDiv.dataset.timelineIndex);

                        // Toggle selection
                        if (selectedTimelineIndex === timelineIndex) {
                            selectedTimelineIndex = -1;
                        } else {
                            selectedTimelineIndex = timelineIndex;
                        }

                        renderTimeline();
                    }
                });

                document.getElementById('insert-before-btn').addEventListener('click', () => {
                    if (selectedTimelineIndex < 0 || !selectedAnimation || selectedFrames.size === 0) {
                        return;
                    }

                    const framesToInsert = Array.from(selectedFrames).sort((a, b) => a - b);
                    currentData.animations[selectedAnimation].splice(selectedTimelineIndex, 0, ...framesToInsert);

                    selectedFrames.clear();
                    redrawOverlay();
                    renderTimeline();
                    renderPreview();
                    updateAddFramesButtonState();
                    updateDocument();
                });

                document.getElementById('insert-after-btn').addEventListener('click', () => {
                    if (selectedTimelineIndex < 0 || !selectedAnimation || selectedFrames.size === 0) {
                        return;
                    }

                    const framesToInsert = Array.from(selectedFrames).sort((a, b) => a - b);
                    currentData.animations[selectedAnimation].splice(selectedTimelineIndex + 1, 0, ...framesToInsert);

                    selectedFrames.clear();
                    redrawOverlay();
                    renderTimeline();
                    renderPreview();
                    updateAddFramesButtonState();
                    updateDocument();
                });

                document.getElementById('remove-frame-btn').addEventListener('click', () => {
                    if (selectedTimelineIndex < 0 || !selectedAnimation) {
                        return;
                    }

                    currentData.animations[selectedAnimation].splice(selectedTimelineIndex, 1);
                    selectedTimelineIndex = -1;

                    // Clamp preview frame
                    if (currentPreviewFrame >= currentData.animations[selectedAnimation].length) {
                        currentPreviewFrame = Math.max(0, currentData.animations[selectedAnimation].length - 1);
                    }

                    renderTimeline();
                    redrawOverlay();
                    renderPreview();
                    updateDocument();
                });

                // Preview Functions
                function renderPreview() {
                    const previewEl = document.getElementById('preview');

                    if (!selectedAnimation || !currentData.animations[selectedAnimation]) {
                        previewEl.innerHTML = '<div class="preview-placeholder">No animation selected</div>';
                        stopAnimation();
                        return;
                    }

                    const frames = currentData.animations[selectedAnimation];

                    if (frames.length === 0) {
                        previewEl.innerHTML = '<div class="preview-placeholder">No frames in animation</div>';
                        stopAnimation();
                        return;
                    }

                    if (!spriteImage || !spriteImage.complete) {
                        previewEl.innerHTML = '<div class="preview-placeholder">Loading...</div>';
                        return;
                    }

                    // Calculate frame dimensions
                    const cols = currentData.columns;
                    const rows = currentData.rows;
                    const cellWidth = spriteImage.width / cols;
                    const cellHeight = spriteImage.height / rows;

                    // Integer scaling for crisp pixels
                    const maxPreviewSize = 200;
                    const scale = Math.max(1, Math.floor(maxPreviewSize / Math.max(cellWidth, cellHeight)));
                    const previewWidth = cellWidth * scale;
                    const previewHeight = cellHeight * scale;

                    // Build preview HTML
                    previewEl.innerHTML = \`
                        <div class="preview-canvas-container">
                            <canvas id="preview-canvas"></canvas>
                        </div>
                        <div class="preview-controls">
                            <vscode-button appearance="icon" id="preview-step-back" aria-label="Step Back">
                                <span class="codicon codicon-debug-step-back"></span>
                            </vscode-button>
                            <vscode-button appearance="icon" id="preview-play-pause" aria-label="Play/Pause">
                                <span class="codicon codicon-\${isPlaying ? 'debug-pause' : 'play'}"></span>
                            </vscode-button>
                            <vscode-button appearance="icon" id="preview-step-forward" aria-label="Step Forward">
                                <span class="codicon codicon-debug-step-over"></span>
                            </vscode-button>
                            <vscode-button appearance="icon" id="preview-loop" aria-label="Toggle Loop" \${loopEnabled ? '' : 'appearance="secondary"'}>
                                <span class="codicon codicon-sync"></span>
                            </vscode-button>
                        </div>
                        <div class="preview-frame-info">
                            Frame: <span id="preview-frame-number">\${currentPreviewFrame + 1}</span> / \${frames.length}
                        </div>
                    \`;

                    const canvas = document.getElementById('preview-canvas');
                    canvas.width = previewWidth;
                    canvas.height = previewHeight;

                    // Setup control event listeners
                    setupPreviewControls();

                    // Draw current frame
                    drawPreviewFrame();
                }

                function drawPreviewFrame() {
                    const canvas = document.getElementById('preview-canvas');
                    if (!canvas || !selectedAnimation) return;

                    const frames = currentData.animations[selectedAnimation];
                    if (frames.length === 0) return;

                    // Clamp current frame
                    currentPreviewFrame = Math.max(0, Math.min(currentPreviewFrame, frames.length - 1));

                    const ctx = canvas.getContext('2d');
                    const cols = currentData.columns;
                    const rows = currentData.rows;
                    const cellWidth = spriteImage.width / cols;
                    const cellHeight = spriteImage.height / rows;

                    // Draw checkerboard
                    const checkSize = 16;
                    const color1 = '#cccccc';
                    const color2 = '#999999';
                    for (let y = 0; y < canvas.height; y += checkSize) {
                        for (let x = 0; x < canvas.width; x += checkSize) {
                            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
                            ctx.fillStyle = isEven ? color1 : color2;
                            ctx.fillRect(x, y, checkSize, checkSize);
                        }
                    }

                    // Get current frame from animation
                    const frameIndex = frames[currentPreviewFrame];
                    const row = Math.floor(frameIndex / cols);
                    const col = frameIndex % cols;
                    const sx = col * cellWidth;
                    const sy = row * cellHeight;

                    // Draw frame scaled to canvas size (integer scaling for crisp pixels)
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(
                        spriteImage,
                        sx, sy, cellWidth, cellHeight,
                        0, 0, canvas.width, canvas.height
                    );

                    // Update frame counter
                    const frameInfo = document.getElementById('preview-frame-number');
                    if (frameInfo) {
                        frameInfo.textContent = currentPreviewFrame + 1;
                    }
                }

                function setupPreviewControls() {
                    document.getElementById('preview-play-pause')?.addEventListener('click', () => {
                        if (isPlaying) {
                            stopAnimation();
                        } else {
                            startAnimation();
                        }
                    });

                    document.getElementById('preview-step-back')?.addEventListener('click', () => {
                        stopAnimation();
                        stepFrame(-1);
                    });

                    document.getElementById('preview-step-forward')?.addEventListener('click', () => {
                        stopAnimation();
                        stepFrame(1);
                    });

                    document.getElementById('preview-loop')?.addEventListener('click', () => {
                        loopEnabled = !loopEnabled;
                        renderPreview();
                    });
                }

                function startAnimation() {
                    if (!selectedAnimation || !currentData.animations[selectedAnimation]) return;

                    const frames = currentData.animations[selectedAnimation];
                    if (frames.length === 0) return;

                    isPlaying = true;
                    lastFrameTime = performance.now();
                    renderPreview();
                    animationLoop();
                }

                function stopAnimation() {
                    isPlaying = false;
                    if (animationFrameId) {
                        cancelAnimationFrame(animationFrameId);
                        animationFrameId = null;
                    }
                    renderPreview();
                }

                function stepFrame(direction) {
                    if (!selectedAnimation) return;

                    const frames = currentData.animations[selectedAnimation];
                    if (frames.length === 0) return;

                    currentPreviewFrame += direction;

                    if (currentPreviewFrame < 0) {
                        currentPreviewFrame = loopEnabled ? frames.length - 1 : 0;
                    } else if (currentPreviewFrame >= frames.length) {
                        currentPreviewFrame = loopEnabled ? 0 : frames.length - 1;
                    }

                    drawPreviewFrame();
                }

                function animationLoop() {
                    if (!isPlaying) return;

                    const now = performance.now();
                    const frameDuration = 1000 / currentData.fps;

                    if (now - lastFrameTime >= frameDuration) {
                        lastFrameTime = now;

                        const frames = currentData.animations[selectedAnimation];
                        currentPreviewFrame++;

                        if (currentPreviewFrame >= frames.length) {
                            if (loopEnabled) {
                                currentPreviewFrame = 0;
                            } else {
                                currentPreviewFrame = frames.length - 1;
                                stopAnimation();
                                return;
                            }
                        }

                        drawPreviewFrame();
                    }

                    animationFrameId = requestAnimationFrame(animationLoop);
                }

                // Load sprite sheet on init
                loadSpriteSheet();
                renderTimeline();
                renderPreview();
            </script>
        </body>
        </html>`;
    }

    private getAnimationColor(index: number, total: number): string {
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
