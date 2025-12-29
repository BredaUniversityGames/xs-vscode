import * as vscode from 'vscode';
import * as path from 'path';

interface AnimationData {
    image: string;
    columns: number;
    rows: number;
    fps: number;
    imagePadding?: number;
    padding?: number;
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
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist'),
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'animationEditor')
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

        // Get URIs for external webview files
        const cssUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'animationEditor', 'animationEditorWebview.css')
        );
        const jsUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'animationEditor', 'animationEditorWebview.js')
        );

        // Update webview content
        const updateWebview = () => {
            webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, animationData, toolkitUri, cssUri, jsUri);
        };

        updateWebview();

        let isUpdating = false; // Track if we're updating to avoid refresh loop

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'update':
                    isUpdating = true;
                    animationData = message.data;
                    this.updateTextDocument(document, message.data);
                    setTimeout(() => { isUpdating = false; }, 500);
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
                        // Remove [game] or other placeholders and clean the path
                        let cleanPath = message.path.replace(/^\[game\]\//, '').replace(/^\[game\]\\/, '');
                        const fullPath = path.join(workspaceFolder.uri.fsPath, cleanPath);
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
                        // Send update message to webview instead of regenerating HTML
                        webviewPanel.webview.postMessage({
                            type: 'dataChanged',
                            data: animationData
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

    private updateTextDocument(document: vscode.TextDocument, data: AnimationData) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, JSON.stringify(data, null, 2));
        vscode.workspace.applyEdit(edit);
    }

    private getHtmlContent(webview: vscode.Webview, data: AnimationData, toolkitUri: vscode.Uri, cssUri: vscode.Uri, jsUri: vscode.Uri): string {
        const animationEntries = Object.entries(data.animations);

        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script type="module" src="${toolkitUri}"></script>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css">
            <link rel="stylesheet" href="${cssUri}">
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
                <div class="top-bar-group">
                    <label>Image Pad</label>
                    <input type="number" class="small" id="image-padding" value="${data.imagePadding || 0}" min="0" title="Trim edges of entire sprite sheet" />
                </div>
                <div class="top-bar-group">
                    <label>Sprite Pad</label>
                    <input type="number" class="small" id="padding" value="${data.padding || 0}" min="0" title="Trim edges of each sprite" />
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

            <script src="${jsUri}"></script>
            <script>
                // Initialize the webview with data
                initialize(${JSON.stringify(data)}, ${animationEntries.length > 0 ? `"${this.escapeHtml(animationEntries[0][0])}"` : 'null'});
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
