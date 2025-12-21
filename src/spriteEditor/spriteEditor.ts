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
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist'),
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'spriteEditor')
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

        // Get URIs for external webview files
        const cssUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'spriteEditor', 'spriteEditorWebview.css')
        );
        const jsUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'spriteEditor', 'spriteEditorWebview.js')
        );

        // Update webview content
        const updateWebview = () => {
            webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, spriteData, toolkitUri, cssUri, jsUri);
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
                case 'showError':
                    vscode.window.showErrorMessage(message.message);
                    break;
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

    private getHtmlContent(webview: vscode.Webview, data: SpriteData, toolkitUri: vscode.Uri, cssUri: vscode.Uri, jsUri: vscode.Uri): string {
        const spriteEntries = Object.entries(data.sprites);

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
            </div>

            <!-- Main Content -->
            <div class="main-content">
                <!-- Sprite List -->
                <div class="sprite-list-panel">
                    <div class="sprite-list-header">
                        <span>Sprites</span>
                        <div class="sprite-list-buttons">
                            <vscode-button appearance="icon" aria-label="Auto Fit Sprite" title="Auto Fit Sprite to Content" id="auto-fit-sprite-btn" disabled>
                                <span class="codicon codicon-screen-full"></span>
                            </vscode-button>
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

            <!-- Resize Handle -->
            <div class="resize-handle" id="resize-handle"></div>

            <!-- Bottom Panel -->
            <div class="bottom-panel" id="bottom-panel">
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

            <script src="${jsUri}"></script>
            <script>
                // Initialize the webview with data
                initialize(${JSON.stringify(data)}, ${spriteEntries.length > 0 ? `"${this.escapeHtml(spriteEntries[0][0])}"` : 'null'});
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
