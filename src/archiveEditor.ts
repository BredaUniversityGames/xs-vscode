import * as vscode from 'vscode';

interface PackageEntry {
    relativePath: string;
    uncompressedSize: bigint;
    dataOffset: bigint;
    dataLength: bigint;
    isCompressed: boolean;
}

class ArchiveParser {
    static async parse(uri: vscode.Uri): Promise<PackageEntry[]> {
        const data = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(data);
        
        let offset = 0;

        // Helper to read uint64_t (little-endian)
        const readUInt64 = (): bigint => {
            const value = buffer.readBigUInt64LE(offset);
            offset += 8;
            return value;
        };

        // Helper to read string (Cereal format: length + data)
        const readString = (): string => {
            const length = Number(readUInt64());
            const str = buffer.toString('utf8', offset, offset + length);
            offset += length;
            return str;
        };

        // Helper to read bool
        const readBool = (): boolean => {
            const value = buffer[offset] !== 0;
            offset += 1;
            return value;
        };

        // Read entry count
        const entryCount = Number(readUInt64());
        console.log(`Archive contains ${entryCount} entries`);

        const entries: PackageEntry[] = [];

        // Read all entries
        for (let i = 0; i < entryCount; i++) {
            const entry: PackageEntry = {
                relativePath: readString(),
                uncompressedSize: readUInt64(),
                dataOffset: readUInt64(),
                dataLength: readUInt64(),
                isCompressed: readBool()
            };
            
            entries.push(entry);
            console.log(`${i + 1}. ${entry.relativePath} (${entry.uncompressedSize} bytes, compressed: ${entry.isCompressed})`);
        }

        // offset now points to start of data section
        console.log(`Data section starts at offset: ${offset}`);

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

    private getHtmlContent(entries: PackageEntry[], uri: vscode.Uri): string {
        const totalSize = entries.reduce((sum, e) => sum + Number(e.uncompressedSize), 0);
        const totalData = entries.reduce((sum, e) => sum + Number(e.dataLength), 0);

        const rows = entries.map(entry => {
            const sizeKB = (Number(entry.uncompressedSize) / 1024).toFixed(1);
            const dataKB = (Number(entry.dataLength) / 1024).toFixed(1);
            
            return `
                <tr>
                    <td class="path">${this.escapeHtml(entry.relativePath)}</td>
                    <td class="size">${sizeKB} KB</td>
                    <td class="size">${dataKB} KB</td>
                    <td class="compressed">${entry.isCompressed ? '✓' : ''}</td>
                </tr>
            `;
        }).join('');

        const compressionRatio = totalSize > 0 ? ((1 - totalData / totalSize) * 100).toFixed(1) : '0.0';

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
                .path {
                    font-family: var(--vscode-editor-font-family);
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
                        <span class="stat-label">Uncompressed:</span>
                        <span>${(totalSize / 1024).toFixed(1)} KB</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Package Size:</span>
                        <span>${(totalData / 1024).toFixed(1)} KB</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Compression:</span>
                        <span>${compressionRatio}%</span>
                    </div>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Path</th>
                        <th style="text-align: right">Uncompressed</th>
                        <th style="text-align: right">Packed</th>
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