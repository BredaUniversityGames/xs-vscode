import * as vscode from 'vscode';
import * as path from 'path';

// The "xs" panel in the activity bar: what the project is, what you can do
// with it and which engine runs it

type Section = 'project' | 'actions' | 'engine';

// project.json stores settings as { "type": "string", "value": "game.wren" }
function readString(data: any, key: string): string | undefined {
    const entry = data?.[key];
    const value = typeof entry === 'object' && entry !== null ? entry.value : entry;
    return typeof value === 'string' ? value : undefined;
}

class Item extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly section?: Section,
        options: { description?: string; tooltip?: string; icon?: string; command?: vscode.Command } = {}
    ) {
        super(label, section ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        this.description = options.description;
        this.tooltip = options.tooltip;
        this.command = options.command;
        if (options.icon) {
            this.iconPath = new vscode.ThemeIcon(options.icon);
        }
    }
}

// Where the engine is and how it runs, see getEngineInfo in extension.ts
export interface EngineInfo {
    version?: string;        // undefined when the engine did not answer
    executable?: string;     // full path, undefined when xs is not configured or on PATH
    configured: boolean;     // xs.enginePath is set
    workingDir?: string;     // full path the engine runs in
}

export class XsProjectViewProvider implements vscode.TreeDataProvider<Item> {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;

    // undefined while loading
    private engine: EngineInfo | undefined;

    constructor(private readonly getEngineInfo: () => Promise<EngineInfo>) {
        this.refreshEngine();
    }

    static register(context: vscode.ExtensionContext, getEngineInfo: () => Promise<EngineInfo>) {
        const provider = new XsProjectViewProvider(getEngineInfo);
        const watcher = vscode.workspace.createFileSystemWatcher('**/project.json');
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('xs.projectView', provider),
            watcher,
            watcher.onDidChange(() => provider.refresh()),
            watcher.onDidCreate(() => provider.refresh()),
            watcher.onDidDelete(() => provider.refresh()),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('xs.enginePath') || e.affectsConfiguration('xs.workingDirectory')) {
                    provider.refreshEngine();
                }
            }),
            vscode.commands.registerCommand('xs-vscode.refreshProjectView', () => provider.refreshEngine())
        );
    }

    refresh() {
        this.changed.fire();
    }

    refreshEngine() {
        this.engine = undefined;
        this.refresh();
        this.getEngineInfo().then(
            engine => { this.engine = engine; this.refresh(); },
            () => { this.engine = { configured: false }; this.refresh(); }
        );
    }

    getTreeItem(item: Item): vscode.TreeItem {
        return item;
    }

    async getChildren(item?: Item): Promise<Item[]> {
        if (!item) {
            return [
                new Item('Project', 'project'),
                new Item('Actions', 'actions'),
                new Item('Engine', 'engine'),
            ];
        }
        switch (item.section) {
            case 'project': return this.projectItems();
            case 'actions': return this.actionItems();
            case 'engine': return this.engineItems();
            default: return [];
        }
    }

    private async projectItems(): Promise<Item[]> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return [];
        }
        const projectJson = vscode.Uri.joinPath(folder.uri, 'project.json');
        let main: string | undefined;
        let title: string | undefined;
        try {
            const data = JSON.parse((await vscode.workspace.fs.readFile(projectJson)).toString());
            main = readString(data, 'Main');
            title = readString(data, 'Device.Title');
        } catch {
            // project.json is missing or broken: show what we can
        }

        const items = [
            new Item(folder.name, undefined, {
                icon: 'folder',
                description: title,
                tooltip: folder.uri.fsPath,
            }),
        ];

        if (main) {
            const mainUri = vscode.Uri.file(path.resolve(folder.uri.fsPath, main));
            let exists = true;
            try {
                await vscode.workspace.fs.stat(mainUri);
            } catch {
                exists = false;
            }
            items.push(new Item('main', undefined, {
                description: main,
                icon: exists ? 'file-code' : 'warning',
                tooltip: exists ? mainUri.fsPath : `${mainUri.fsPath} does not exist`,
                command: exists ? { title: 'Open', command: 'vscode.open', arguments: [mainUri] } : undefined,
            }));
        }

        items.push(new Item('project.json', undefined, {
            icon: 'json',
            command: { title: 'Open', command: 'vscode.open', arguments: [projectJson] },
        }));
        return items;
    }

    private actionItems(): Item[] {
        const action = (label: string, icon: string, command: string, tooltip: string) =>
            new Item(label, undefined, { icon, tooltip, command: { title: label, command } });
        return [
            action('Run', 'play', 'xs-vscode.runEngine', 'Run the game from the source folder'),
            action('Debug', 'debug-alt', 'xs-vscode.debugGame', 'Run the game with the Wren debugger attached'),
            action('Package', 'package', 'xs-vscode.packageGame', 'Package the game into an .xs file'),
            action('Package & Run', 'run-all', 'xs-vscode.packageAndRun', 'Package the game, then run the package'),
        ];
    }

    private engineItems(): Item[] {
        const engine = this.engine;
        if (!engine) {
            return [new Item('checking...', undefined, { icon: 'loading~spin' })];
        }
        const settings = (setting: string): vscode.Command =>
            ({ title: 'Open setting', command: 'workbench.action.openSettings', arguments: [setting] });

        const version = engine.version
            ? new Item(`xs ${engine.version}`, undefined, {
                icon: 'game',
                tooltip: `xs engine ${engine.version}`,
                command: { title: 'Show engine info', command: 'xs-vscode.showEngineInfo' },
            })
            : new Item('not found', undefined, {
                icon: 'error',
                description: 'click to set the path',
                tooltip: 'The xs engine did not answer',
                command: { title: 'Show engine info', command: 'xs-vscode.showEngineInfo' },
            });

        const executable = new Item('executable', undefined, {
            icon: 'file-binary',
            description: engine.executable ?? (engine.configured ? 'not found' : 'xs is not on PATH'),
            tooltip: `${engine.executable ?? 'not found'}
${engine.configured ? 'from xs.enginePath' : 'from PATH, set xs.enginePath to choose one'}`,
            command: settings('xs.enginePath'),
        });

        const workingDir = new Item('working dir', undefined, {
            icon: 'folder-opened',
            description: engine.workingDir ?? 'no workspace folder',
            tooltip: `${engine.workingDir ?? 'no workspace folder'}
from xs.workingDirectory`,
            command: settings('xs.workingDirectory'),
        });

        return [version, executable, workingDir];
    }
}
