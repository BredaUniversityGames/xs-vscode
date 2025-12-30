import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface AtlasData {
    outputImage: string;
    padding: number;
    useMaxRects?: boolean;
    sources: {
        path: string;
        name: string;
        trim: {
            top: number;
            right: number;
            bottom: number;
            left: number;
        };
    }[];
}

export class AtlasEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new AtlasEditorProvider(context);
        return vscode.window.registerCustomEditorProvider('xs.atlasEditor', provider, {
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
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'imagePacker')
        ];
        if (workspaceFolder) {
            localResourceRoots.push(workspaceFolder.uri);
        }

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots
        };

        // Load the atlas data
        let atlasData: AtlasData;
        try {
            const text = document.getText();
            if (text.trim().length === 0) {
                // Empty file - create default data
                atlasData = {
                    outputImage: 'atlas.png',
                    padding: 2,
                    useMaxRects: true,
                    sources: []
                };
            } else {
                atlasData = JSON.parse(text);
            }
        } catch (e) {
            vscode.window.showErrorMessage('Failed to parse atlas file. Using defaults.');
            atlasData = {
                outputImage: 'atlas.png',
                padding: 2,
                useMaxRects: true,
                sources: []
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
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'imagePacker', 'imagePackerWebview.css')
        );
        const jsUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'imagePacker', 'imagePackerWebview.js')
        );

        // Update webview content
        const updateWebview = () => {
            webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, atlasData, toolkitUri, cssUri, jsUri);
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
                case 'browseImages':
                    await this.handleBrowseImages(webviewPanel);
                    break;
                case 'browseOutput':
                    await this.handleBrowseOutput(webviewPanel);
                    break;
                case 'getImageUri':
                    await this.handleGetImageUri(webviewPanel, message.path);
                    break;
                case 'exportPng':
                    await this.handleExportPng(message.data, message.outputPath);
                    break;
            }
        });

        // Watch for external changes to the document
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString() && !isUpdating) {
                try {
                    atlasData = JSON.parse(e.document.getText());
                    webviewPanel.webview.postMessage({
                        type: 'dataUpdated',
                        data: atlasData
                    });
                } catch (e) {
                    // Ignore parse errors during editing
                }
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private async handleBrowseImages(webviewPanel: vscode.WebviewPanel) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            openLabel: 'Select Images',
            filters: {
                'Images': ['png', 'jpg', 'jpeg', 'bmp', 'gif']
            },
            defaultUri: workspaceFolder?.uri
        };

        const fileUris = await vscode.window.showOpenDialog(options);
        if (fileUris && fileUris.length > 0) {
            const paths = fileUris.map(uri => uri.fsPath);
            webviewPanel.webview.postMessage({
                type: 'imagesSelected',
                paths: paths
            });
        }
    }

    private async handleBrowseOutput(webviewPanel: vscode.WebviewPanel) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const options: vscode.SaveDialogOptions = {
            saveLabel: 'Save Atlas',
            filters: {
                'PNG Images': ['png']
            },
            defaultUri: workspaceFolder ? vscode.Uri.joinPath(workspaceFolder.uri, 'atlas.png') : undefined
        };

        const fileUri = await vscode.window.showSaveDialog(options);
        if (fileUri) {
            webviewPanel.webview.postMessage({
                type: 'outputPathSelected',
                path: fileUri.fsPath
            });
        }
    }

    private async handleGetImageUri(webviewPanel: vscode.WebviewPanel, imagePath: string) {
        try {
            const imageUri = webviewPanel.webview.asWebviewUri(vscode.Uri.file(imagePath));
            webviewPanel.webview.postMessage({
                type: 'imageUri',
                path: imagePath,
                uri: imageUri.toString()
            });
        } catch (error) {
            console.error('Error getting image URI:', error);
        }
    }

    private async handleExportPng(base64Data: string, outputPath: string) {
        try {
            // Remove the data:image/png;base64, prefix
            const base64Image = base64Data.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(base64Image, 'base64');

            // Write the file
            fs.writeFileSync(outputPath, buffer);

            vscode.window.showInformationMessage(`Atlas exported to ${path.basename(outputPath)}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to export atlas: ${errorMessage}`);
        }
    }

    private updateTextDocument(document: vscode.TextDocument, data: AtlasData) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, JSON.stringify(data, null, 2));
        vscode.workspace.applyEdit(edit);
    }

    private getHtmlContent(webview: vscode.Webview, data: AtlasData, toolkitUri: vscode.Uri, cssUri: vscode.Uri, jsUri: vscode.Uri): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src ${webview.cspSource};">
    <title>Atlas Editor</title>
    <script type="module" src="${toolkitUri}"></script>
    <link rel="stylesheet" href="${cssUri}">
</head>
<body>
    <div class="container">
        <div class="top-bar">
            <div class="top-bar-row">
                <div class="input-group">
                    <label for="output-path">Output:</label>
                    <input type="text" id="output-path" value="${data.outputImage || 'atlas.png'}" placeholder="atlas.png">
                    <vscode-button id="browse-output-btn">Browse</vscode-button>
                </div>
                <div class="input-group">
                    <label for="padding-input">Padding:</label>
                    <input type="number" id="padding-input" value="${data.padding !== undefined ? data.padding : 2}" min="0" max="100" style="width: 60px;">
                    <span>px</span>
                </div>
                <div class="input-group">
                    <input type="checkbox" id="use-maxrects-checkbox" ${data.useMaxRects !== false ? 'checked' : ''}>
                    <label for="use-maxrects-checkbox">Use MaxRects algorithm</label>
                </div>
                <vscode-button id="pack-preview-btn" appearance="primary">Pack & Preview</vscode-button>
            </div>
        </div>

        <div class="main-content">
            <div class="left-panel">
                <div class="panel-header">
                    <span id="images-count">Images (0)</span>
                    <div class="panel-buttons">
                        <vscode-button id="add-images-btn">+ Add Images</vscode-button>
                        <vscode-button id="remove-image-btn" disabled>Remove</vscode-button>
                    </div>
                </div>
                <div class="images-list" id="images-list">
                    <div class="empty-state">Click "+ Add Images" to begin</div>
                </div>
            </div>

            <div class="panel-separator"></div>

            <div class="right-panel">
                <div class="panel-header">
                    <span>Preview</span>
                    <div class="zoom-controls">
                        <label for="zoom-select">Zoom:</label>
                        <select id="zoom-select">
                            <option value="0.25">25%</option>
                            <option value="0.5">50%</option>
                            <option value="1" selected>100%</option>
                            <option value="2">200%</option>
                            <option value="4">400%</option>
                        </select>
                    </div>
                </div>
                <div class="preview-container" id="preview-container">
                    <div class="empty-state">No images to preview</div>
                </div>
                <div class="preview-info" id="preview-info"></div>
            </div>
        </div>

        <div class="bottom-bar">
            <vscode-button id="export-btn" appearance="primary" disabled>Export PNG</vscode-button>
        </div>
    </div>

    <script src="${jsUri}"></script>
    <script type="application/json" id="atlas-data">${JSON.stringify(data)}</script>
</body>
</html>`;
    }
}

// Keep the command for creating new atlas files
export function registerImagePackerCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('xs-vscode.packImages', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace folder first');
            return;
        }

        // Prompt for filename
        const filename = await vscode.window.showInputBox({
            prompt: 'Enter atlas filename',
            value: 'atlas.xsatlas',
            validateInput: (value) => {
                if (!value.endsWith('.xsatlas')) {
                    return 'Filename must end with .xsatlas';
                }
                return null;
            }
        });

        if (!filename) {
            return;
        }

        // Create the file with default data
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filename);
        const defaultData: AtlasData = {
            outputImage: filename.replace('.xsatlas', '.png'),
            padding: 2,
            useMaxRects: true,
            sources: []
        };

        await vscode.workspace.fs.writeFile(
            fileUri,
            Buffer.from(JSON.stringify(defaultData, null, 2))
        );

        // Open the file
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    });

    context.subscriptions.push(disposable);
}
