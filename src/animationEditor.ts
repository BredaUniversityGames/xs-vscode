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
            enableScripts: true
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

        // Update webview content
        const updateWebview = () => {
            webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, animationData);
        };

        updateWebview();

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'update':
                    this.updateTextDocument(document, message.data);
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

        // Update webview when document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
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

    private getHtmlContent(webview: vscode.Webview, data: AnimationData): string {
        const animationEntries = Object.entries(data.animations);

        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    padding: 20px;
                    margin: 0;
                }
                .section {
                    margin-bottom: 30px;
                    padding-bottom: 20px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .section h2 {
                    margin: 0 0 15px 0;
                    color: var(--vscode-foreground);
                    font-size: 1.2em;
                }
                .form-group {
                    margin-bottom: 15px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .form-group label {
                    min-width: 100px;
                    font-weight: 600;
                }
                .form-group input {
                    flex: 1;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 6px 8px;
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                }
                .form-group input:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }
                button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 14px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                button.secondary {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                button.secondary:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                .animation-list {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                .animation-item {
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 15px;
                    border-radius: 4px;
                }
                .animation-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .animation-header h3 {
                    margin: 0;
                    font-size: 1em;
                    font-family: var(--vscode-editor-font-family);
                }
                .animation-frames {
                    font-family: var(--vscode-editor-font-family);
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.9em;
                }
                .empty-state {
                    text-align: center;
                    padding: 40px;
                    color: var(--vscode-descriptionForeground);
                }
                .button-group {
                    display: flex;
                    gap: 8px;
                }
            </style>
        </head>
        <body>
            <div class="section">
                <h2>Sprite Sheet</h2>
                <div class="form-group">
                    <label>Image Path:</label>
                    <input type="text" id="image" value="${this.escapeHtml(data.image)}" />
                    <button onclick="browseImage()">Browse...</button>
                </div>
                <div class="form-group">
                    <label>Columns:</label>
                    <input type="number" id="columns" value="${data.columns}" min="1" />
                </div>
                <div class="form-group">
                    <label>Rows:</label>
                    <input type="number" id="rows" value="${data.rows}" min="1" />
                </div>
                <div class="form-group">
                    <label>FPS:</label>
                    <input type="number" id="fps" value="${data.fps}" min="1" />
                </div>
                <button onclick="saveSettings()">Update Settings</button>
            </div>

            <div class="section">
                <h2>Animations</h2>
                <div class="animation-list" id="animationList">
                    ${animationEntries.length === 0 ? `
                        <div class="empty-state">
                            No animations defined yet.<br>
                            Click "Add Animation" to create one.
                        </div>
                    ` : animationEntries.map(([name, frames]) => `
                        <div class="animation-item">
                            <div class="animation-header">
                                <h3>${this.escapeHtml(name)}</h3>
                                <div class="button-group">
                                    <button class="secondary" onclick="editAnimation('${this.escapeHtml(name)}')">Edit</button>
                                    <button class="secondary" onclick="deleteAnimation('${this.escapeHtml(name)}')">Delete</button>
                                </div>
                            </div>
                            <div class="animation-frames">Frames: [${frames.join(', ')}]</div>
                        </div>
                    `).join('')}
                </div>
                <button onclick="addAnimation()" style="margin-top: 15px;">Add Animation</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentData = ${JSON.stringify(data)};

                function browseImage() {
                    vscode.postMessage({ type: 'browse' });
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'imageSelected') {
                        document.getElementById('image').value = message.path;
                    }
                });

                function saveSettings() {
                    currentData.image = document.getElementById('image').value;
                    currentData.columns = parseInt(document.getElementById('columns').value);
                    currentData.rows = parseInt(document.getElementById('rows').value);
                    currentData.fps = parseInt(document.getElementById('fps').value);
                    updateDocument();
                }

                async function addAnimation() {
                    const name = prompt('Animation name:');
                    if (!name || name.trim() === '') return;
                    if (currentData.animations[name]) {
                        alert('Animation with this name already exists');
                        return;
                    }
                    const framesStr = prompt('Frame indices (comma-separated):', '0, 1, 2, 3');
                    if (framesStr === null) return;

                    const frames = framesStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                    currentData.animations[name] = frames;
                    updateDocument();
                }

                function editAnimation(name) {
                    const currentFrames = currentData.animations[name].join(', ');
                    const framesStr = prompt('Frame indices (comma-separated):', currentFrames);
                    if (framesStr === null) return;

                    const frames = framesStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                    currentData.animations[name] = frames;
                    updateDocument();
                }

                function deleteAnimation(name) {
                    if (confirm(\`Delete animation "\${name}"?\`)) {
                        delete currentData.animations[name];
                        updateDocument();
                    }
                }

                function updateDocument() {
                    vscode.postMessage({
                        type: 'update',
                        data: currentData
                    });
                }
            </script>
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
