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
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist')
            ]
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
                case 'browse':
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
                    padding: 8px 12px;
                    background: var(--vscode-editorGroupHeader-tabsBackground);
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
                    background: var(--vscode-editor-background);
                    display: flex;
                    flex-direction: column;
                }

                .animation-list-header {
                    padding: 8px 12px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-foreground);
                }

                .animation-list-buttons {
                    display: flex;
                    gap: 4px;
                }

                .animation-list {
                    flex: 1;
                    overflow-y: auto;
                }

                .animation-item {
                    display: flex;
                    align-items: center;
                    padding: 6px 12px;
                    cursor: pointer;
                    gap: 8px;
                    user-select: none;
                }

                .animation-item:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .animation-item.selected {
                    background: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }

                .animation-color-dot {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }

                .animation-item-name {
                    flex: 1;
                    font-size: 13px;
                }

                /* Resize Handle */
                .resize-handle {
                    width: 1px;
                    cursor: col-resize;
                    background: var(--vscode-panel-border);
                    position: relative;
                    flex-shrink: 0;
                    padding: 0 2px;
                    margin: 0 -2px;
                }

                .resize-handle:hover,
                .resize-handle.resizing {
                    background: var(--vscode-sash-hoverBorder);
                }

                .resize-handle-horizontal {
                    height: 1px;
                    width: 100%;
                    cursor: row-resize;
                    background: var(--vscode-panel-border);
                    padding: 2px 0;
                    margin: -2px 0;
                }

                .resize-handle-horizontal:hover,
                .resize-handle-horizontal.resizing {
                    background: var(--vscode-sash-hoverBorder);
                }

                /* Grid View Panel */
                .grid-view-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    background: var(--vscode-editor-background);
                }

                .grid-view-content {
                    flex: 1;
                    overflow: auto;
                    padding: 16px;
                }

                .grid-placeholder {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }

                /* Bottom Panels Container */
                .bottom-container {
                    display: flex;
                    flex-direction: column;
                }

                /* Bottom Panels */
                .bottom-panels {
                    height: 200px;
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
                    padding: 8px 12px;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-foreground);
                }

                .timeline-content {
                    flex: 1;
                    padding: 8px;
                    overflow-x: auto;
                    display: flex;
                    gap: 4px;
                }

                .timeline-placeholder {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }

                /* Preview Panel */
                .preview-panel {
                    width: 300px;
                    display: flex;
                    flex-direction: column;
                    background: var(--vscode-editor-background);
                }

                .preview-header {
                    padding: 8px 12px;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-foreground);
                }

                .preview-content {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .preview-placeholder {
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
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
            </div>

            <!-- Main Content -->
            <div class="main-content">
                <!-- Animation List -->
                <div class="animation-list-panel" id="animation-list-panel">
                    <div class="animation-list-header">
                        <span>Animations</span>
                        <div class="animation-list-buttons">
                            <vscode-button appearance="icon" aria-label="Add Animation" id="add-animation-btn">
                                <span class="codicon codicon-add"></span>
                            </vscode-button>
                            <vscode-button appearance="icon" aria-label="Remove Animation" id="remove-animation-btn">
                                <span class="codicon codicon-remove"></span>
                            </vscode-button>
                        </div>
                    </div>
                    <div class="animation-list" id="animation-list">
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

                <!-- Resize Handle -->
                <div class="resize-handle" id="resize-handle-left"></div>

                <!-- Grid View -->
                <div class="grid-view-panel">
                    <div class="grid-view-content" id="grid-view">
                        <div class="grid-placeholder">
                            Select a sprite sheet to begin
                        </div>
                    </div>
                </div>
            </div>

            <!-- Horizontal Resize Handle -->
            <div class="resize-handle resize-handle-horizontal" id="resize-handle-bottom"></div>

            <!-- Bottom Panels -->
            <div class="bottom-panels" id="bottom-panels">
                <!-- Timeline -->
                <div class="timeline-panel" id="timeline-panel">
                    <div class="timeline-header">Timeline</div>
                    <div class="timeline-content" id="timeline">
                        <div class="timeline-placeholder">No animation selected</div>
                    </div>
                </div>

                <!-- Resize Handle -->
                <div class="resize-handle" id="resize-handle-preview"></div>

                <!-- Preview -->
                <div class="preview-panel" id="preview-panel">
                    <div class="preview-header">Preview</div>
                    <div class="preview-content" id="preview">
                        <div class="preview-placeholder">No preview available</div>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentData = ${JSON.stringify(data)};
                let selectedAnimation = ${animationEntries.length > 0 ? `"${this.escapeHtml(animationEntries[0][0])}"` : 'null'};

                // Top bar event listeners
                document.getElementById('browse-btn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'browse' });
                });

                document.getElementById('image-path').addEventListener('input', (e) => {
                    currentData.image = e.target.value;
                    updateDocument();
                });

                document.getElementById('columns').addEventListener('input', (e) => {
                    currentData.columns = parseInt(e.target.value) || 1;
                    updateDocument();
                });

                document.getElementById('rows').addEventListener('input', (e) => {
                    currentData.rows = parseInt(e.target.value) || 1;
                    updateDocument();
                });

                document.getElementById('fps').addEventListener('input', (e) => {
                    currentData.fps = parseInt(e.target.value) || 1;
                    updateDocument();
                });

                // Animation list event listeners
                document.getElementById('add-animation-btn').addEventListener('click', () => {
                    const name = prompt('Animation name:');
                    if (!name || name.trim() === '') return;
                    if (currentData.animations[name]) {
                        alert('Animation with this name already exists');
                        return;
                    }
                    currentData.animations[name] = [];
                    updateDocument();
                });

                document.getElementById('remove-animation-btn').addEventListener('click', () => {
                    if (!selectedAnimation) {
                        alert('No animation selected');
                        return;
                    }
                    if (confirm(\`Delete animation "\${selectedAnimation}"?\`)) {
                        delete currentData.animations[selectedAnimation];
                        selectedAnimation = null;
                        updateDocument();
                    }
                });

                // Animation item selection
                document.getElementById('animation-list').addEventListener('click', (e) => {
                    const item = e.target.closest('.animation-item');
                    if (item) {
                        document.querySelectorAll('.animation-item').forEach(el => el.classList.remove('selected'));
                        item.classList.add('selected');
                        selectedAnimation = item.dataset.name;
                    }
                });

                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'imageSelected') {
                        document.getElementById('image-path').value = message.path;
                        currentData.image = message.path;
                        updateDocument();
                    }
                });

                function updateDocument() {
                    vscode.postMessage({
                        type: 'update',
                        data: currentData
                    });
                }

                // Resizing functionality
                function setupResize(handleId, targetId, isHorizontal, getSize, setSize) {
                    const handle = document.getElementById(handleId);
                    const target = document.getElementById(targetId);
                    let isResizing = false;
                    let startPos = 0;
                    let startSize = 0;

                    handle.addEventListener('mousedown', (e) => {
                        isResizing = true;
                        startPos = isHorizontal ? e.clientY : e.clientX;
                        startSize = getSize(target);
                        handle.classList.add('resizing');
                        e.preventDefault();
                    });

                    document.addEventListener('mousemove', (e) => {
                        if (!isResizing) return;
                        const delta = (isHorizontal ? e.clientY : e.clientX) - startPos;
                        const newSize = startSize + delta;
                        setSize(target, Math.max(100, newSize));
                    });

                    document.addEventListener('mouseup', () => {
                        if (isResizing) {
                            isResizing = false;
                            handle.classList.remove('resizing');
                        }
                    });
                }

                // Setup resize handles
                setupResize(
                    'resize-handle-left',
                    'animation-list-panel',
                    false,
                    (el) => el.offsetWidth,
                    (el, size) => el.style.width = size + 'px'
                );

                // Bottom panel resize - invert delta since we're resizing from top
                const handleBottom = document.getElementById('resize-handle-bottom');
                const bottomPanel = document.getElementById('bottom-panels');
                let isResizingBottom = false;
                let startYBottom = 0;
                let startHeightBottom = 0;

                handleBottom.addEventListener('mousedown', (e) => {
                    isResizingBottom = true;
                    startYBottom = e.clientY;
                    startHeightBottom = bottomPanel.offsetHeight;
                    handleBottom.classList.add('resizing');
                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isResizingBottom) return;
                    const delta = startYBottom - e.clientY; // Inverted!
                    const newHeight = startHeightBottom + delta;
                    bottomPanel.style.height = Math.max(100, newHeight) + 'px';
                });

                document.addEventListener('mouseup', () => {
                    if (isResizingBottom) {
                        isResizingBottom = false;
                        handleBottom.classList.remove('resizing');
                    }
                });

                setupResize(
                    'resize-handle-preview',
                    'preview-panel',
                    false,
                    (el) => el.offsetWidth,
                    (el, size) => el.style.width = size + 'px'
                );
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
