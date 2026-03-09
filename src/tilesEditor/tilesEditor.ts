import * as vscode from 'vscode';
import * as path from 'path';

interface TilesData {
    image: string;
    columns: number;
    rows: number;
    imagePadding?: number;
    padding?: number;
}

export class TilesEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new TilesEditorProvider(context);
        return vscode.window.registerCustomEditorProvider('xs.tilesEditor', provider, {
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
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'tilesEditor')
        ];
        if (workspaceFolder) {
            localResourceRoots.push(workspaceFolder.uri);
        }

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots
        };

        // Load the tiles data
        let tilesData: TilesData;
        try {
            const text = document.getText();
            if (text.trim().length === 0) {
                // Empty file - create default data
                tilesData = {
                    image: '',
                    columns: 1,
                    rows: 1
                };
            } else {
                tilesData = JSON.parse(text);
            }
        } catch (e) {
            vscode.window.showErrorMessage('Failed to parse tiles file. Using defaults.');
            tilesData = {
                image: '',
                columns: 1,
                rows: 1
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
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'tilesEditor', 'tilesEditorWebview.css')
        );
        const jsUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'tilesEditor', 'tilesEditorWebview.js')
        );

        // Update webview content
        const updateWebview = () => {
            webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, tilesData, toolkitUri, cssUri, jsUri);
        };

        updateWebview();

        let isUpdating = false; // Track if we're updating to avoid refresh loop

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'update':
                    isUpdating = true;
                    tilesData = message.data;
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
                        placeHolder: 'Select a tileset image from your workspace',
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
                        tilesData = JSON.parse(text);
                        // Send update message to webview instead of regenerating HTML
                        webviewPanel.webview.postMessage({
                            type: 'dataChanged',
                            data: tilesData
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

    private updateTextDocument(document: vscode.TextDocument, data: TilesData) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, JSON.stringify(data, null, 2));
        vscode.workspace.applyEdit(edit);
    }

    private getHtmlContent(webview: vscode.Webview, data: TilesData, toolkitUri: vscode.Uri, cssUri: vscode.Uri, jsUri: vscode.Uri): string {
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
                    <input type="text" class="image-path" id="image-path" value="${this.escapeHtml(data.image)}" placeholder="Select tileset image..." />
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
                    <label>Image Pad</label>
                    <input type="number" class="small" id="image-padding" value="${data.imagePadding || 0}" min="0" title="Trim edges of entire tileset" />
                </div>
                <div class="top-bar-group">
                    <label>Tile Pad</label>
                    <input type="number" class="small" id="padding" value="${data.padding || 0}" min="0" title="Trim edges of each tile" />
                </div>
                <div class="top-bar-group" style="margin-left: auto; color: var(--vscode-descriptionForeground);">
                    <span id="cell-size-display">Tile: -</span>
                </div>
            </div>

            <!-- Grid View -->
            <div class="grid-view-wrapper">
                <div class="grid-view-header">
                    <span>Tileset</span>
                    <div class="grid-view-controls">
                        <select id="grid-zoom-select">
                            <option value="0.25">25%</option>
                            <option value="0.5">50%</option>
                            <option value="1" selected>100%</option>
                            <option value="2">200%</option>
                            <option value="4">400%</option>
                        </select>
                    </div>
                </div>
                <div class="grid-view-content" id="grid-view-content">
                    <div id="grid-view" class="grid-view">
                        <div class="grid-placeholder">No image selected</div>
                    </div>
                </div>
            </div>

            <!-- Tooltip for tile index -->
            <div id="tile-tooltip" class="tile-tooltip"></div>

            <script>
                const initialData = ${JSON.stringify(data)};
            </script>
            <script src="${jsUri}"></script>
        </body>
        </html>`;
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
