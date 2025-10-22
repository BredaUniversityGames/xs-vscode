import * as vscode from 'vscode';

interface ContentHeader {
    filePath: string;
    fileOffset: bigint;
    fileSize: bigint;
    fileSizeCompressed: bigint;
}

class ArchiveParser {
    private static readonly MAX_PATH = 260;

    static async parse(uri: vscode.Uri): Promise<ContentHeader[]> {
        const data = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(data);

        let offset = 0;

        // Read entry count
        const entryCount = buffer.readBigUInt64LE(offset);
        offset += 8;

        const entries: ContentHeader[] = [];

        for (let i = 0; i < Number(entryCount); i++) {
            // Read file path (260 bytes)
            const pathBuffer = buffer.slice(offset, offset + this.MAX_PATH);
            const nullIndex = pathBuffer.indexOf(0);
            const filePath = pathBuffer.toString('utf8', 0, nullIndex > 0 ? nullIndex : this.MAX_PATH);
            offset += this.MAX_PATH;

            // Skip 4 bytes of padding (struct alignment)
            offset += 4;

            // Read uint64 values
            const fileOffset = buffer.readBigUInt64LE(offset);
            offset += 8;
            const fileSize = buffer.readBigUInt64LE(offset);
            offset += 8;
            const fileSizeCompressed = buffer.readBigUInt64LE(offset);
            offset += 8;

            entries.push({
                filePath,
                fileOffset,
                fileSize,
                fileSizeCompressed
            });

            // Skip file data
            const dataSize = fileSizeCompressed > 0n ? fileSizeCompressed : fileSize;
            offset += Number(dataSize);
        }

        return entries;
    }
}

export class ArchiveEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ArchiveEditorProvider(context);
        return vscode.window.registerCustomEditorProvider('xs.archiveViewer', provider);
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true
        };

        try {
            const entries = await ArchiveParser.parse(document.uri);
            webviewPanel.webview.html = this.getHtmlContent(entries, document.uri);
        } catch (error) {
            webviewPanel.webview.html = this.getErrorHtml(error);
        }
    }

    private getHtmlContent(entries: ContentHeader[], uri: vscode.Uri): string {
        const totalSize = entries.reduce((sum, e) => sum + Number(e.fileSize), 0);
        const totalCompressed = entries.reduce((sum, e) => sum + Number(e.fileSizeCompressed > 0n ? e.fileSizeCompressed : e.fileSize), 0);

        const rows = entries.map(entry => {
            const fileName = entry.filePath.split(/[/\\]/).pop() || entry.filePath;
            const directory = entry.filePath.substring(0, entry.filePath.lastIndexOf('/'));
            const sizeKB = (Number(entry.fileSize) / 1024).toFixed(1);
            const isCompressed = entry.fileSizeCompressed > 0n;
            
            return `
                <tr>
                    <td class="file-name">${this.escapeHtml(fileName)}</td>
                    <td class="directory">${this.escapeHtml(directory)}</td>
                    <td class="size">${sizeKB} KB</td>
                    <td class="compressed">${isCompressed ? '✓' : ''}</td>
                </tr>
            `;
        }).join('');

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
                .header {
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .header h2 {
                    margin: 0 0 10px 0;
                    color: var(--vscode-foreground);
                }
                .stats {
                    display: flex;
                    gap: 30px;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }
                .stat-item {
                    display: flex;
                    gap: 8px;
                }
                .stat-label {
                    font-weight: 600;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.9em;
                }
                th {
                    text-align: left;
                    padding: 8px;
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    font-weight: 600;
                    position: sticky;
                    top: 0;
                }
                td {
                    padding: 6px 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                tr:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                .file-name {
                    font-weight: 500;
                }
                .directory {
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.9em;
                }
                .size {
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                }
                .compressed {
                    text-align: center;
                    color: var(--vscode-charts-green);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>Archive Contents</h2>
                <div class="stats">
                    <div class="stat-item">
                        <span class="stat-label">Files:</span>
                        <span>${entries.length}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Total Size:</span>
                        <span>${(totalSize / 1024).toFixed(1)} KB</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Compressed:</span>
                        <span>${(totalCompressed / 1024).toFixed(1)} KB</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Compression:</span>
                        <span>${((1 - totalCompressed / totalSize) * 100).toFixed(1)}%</span>
                    </div>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>File Name</th>
                        <th>Directory</th>
                        <th style="text-align: right">Size</th>
                        <th style="text-align: center">Compressed</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </body>
        </html>`;
    }

    private getErrorHtml(error: any): string {
        return `<!DOCTYPE html>
        <html>
        <body style="padding: 20px; font-family: var(--vscode-font-family);">
            <h2 style="color: var(--vscode-errorForeground);">Failed to load archive</h2>
            <p>${this.escapeHtml(String(error))}</p>
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