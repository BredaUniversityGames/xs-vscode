import * as vscode from 'vscode';
import * as path from 'path';
import { PackageEditorProvider } from './packageEditor';
import { AnimationEditorProvider } from './animationEditor';
import { ErrorLogger, SafeOperation, UserNotifier, XsEngineError, XsErrorType } from './errorHandler';

export async function activate(context: vscode.ExtensionContext) {
    // Initialize error logging
    ErrorLogger.initialize('XS Engine Tools');
    ErrorLogger.log('xs-vscode activating ...');

    // Validate this is an XS project
    if (!await validateXsProject()) {
        return;
    }

    // Register all providers and UI elements
    registerEditors(context);
    registerLaunchProvider(context);
    createStatusBarItems(context);
    registerCommands(context);
}

async function validateXsProject(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return false;
    }

    const projectJsonUri = vscode.Uri.joinPath(workspaceFolder.uri, 'project.json');

    // Read the project.json file with error handling
    const content = await SafeOperation.readFile(projectJsonUri, 'Failed to read project.json');
    if (!content) {
        ErrorLogger.log('project.json not found or invalid', 'info');
        return false;
    }

    // Parse the JSON content
    const projectData = SafeOperation.parseJSON<{ Main?: string }>(
        content.toString(),
        'Failed to parse project.json'
    );

    if (!projectData) {
        return false;
    }

    // Check for XS-specific fields
    if (!projectData.Main) {
        ErrorLogger.log('project.json missing required field "Main"', 'info');
        return false;
    }

    ErrorLogger.log('xs project detected. xs-vscode activated.', 'info');
    return true;
}

function registerEditors(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        PackageEditorProvider.register(context)
    );
    context.subscriptions.push(
        AnimationEditorProvider.register(context)
    );
}

function registerLaunchProvider(context: vscode.ExtensionContext) {
    // Register launch configuration provider (debugging support to be added later)
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('xs', new XsLaunchConfigurationProvider())
    );

    // Register launch handler
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('xs', new XsLaunchHandler())
    );
}

function createStatusBarItems(context: vscode.ExtensionContext) {
    // Create status bar items (on the left with low priority to not hide git info)
    const runStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        1 // Low priority (appears after git info)
    );

    runStatusBarItem.command = 'xs-vscode.runEngine';
    runStatusBarItem.text = '$(debug-alt) Run';
    runStatusBarItem.tooltip = 'Run current folder as an xs game';
    runStatusBarItem.show();

    context.subscriptions.push(runStatusBarItem);

    // Create version status bar item (on the right side, like Python extension)
    const versionStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100 // High priority (appears leftmost on right side)
    );

    versionStatusBarItem.command = 'xs-vscode.showEngineInfo';
    versionStatusBarItem.tooltip = 'XS Engine Version';

    // Update the version display
    updateEngineVersion(versionStatusBarItem);

    context.subscriptions.push(versionStatusBarItem);

    // Watch for configuration changes to update version
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('xs.enginePath')) {
                updateEngineVersion(versionStatusBarItem);
            }
        })
    );
}

async function updateEngineVersion(statusBarItem: vscode.StatusBarItem) {
    const config = vscode.workspace.getConfiguration('xs');
    const enginePath = config.get<string>('enginePath', '');

    if (!enginePath) {
        statusBarItem.text = '$(circle-slash) xs: not configured';
        statusBarItem.tooltip = 'XS Engine not configured. Click to set path.';
        statusBarItem.show();
        return;
    }

    // Try to get version from xs version command
    const result = await SafeOperation.executeCommand(enginePath, ['version'], { timeout: 5000 });

    if (result) {
        const version = result.stdout.trim();
        statusBarItem.text = `$(game) xs ${version}`;
        statusBarItem.tooltip = `XS Engine ${version}\nPath: ${enginePath}`;
    } else {
        // If version command fails, just show that xs is configured
        statusBarItem.text = '$(game) xs';
        statusBarItem.tooltip = `XS Engine\nPath: ${enginePath}`;
    }

    statusBarItem.show();
}

function registerCommands(context: vscode.ExtensionContext) {

    // Show Engine Info command
    let showEngineInfo = vscode.commands.registerCommand('xs-vscode.showEngineInfo', async () => {
        const config = vscode.workspace.getConfiguration('xs');
        const enginePath = config.get<string>('enginePath', '');

        if (!enginePath) {
            const selection = await vscode.window.showErrorMessage(
                'XS Engine path not set. Please locate xs.exe',
                'Browse...',
                'Cancel'
            );

            if (selection === 'Browse...') {
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select XS Engine',
                    filters: {
                        'Executables': ['exe']
                    }
                });

                if (fileUri && fileUri[0]) {
                    const newEnginePath = fileUri[0].fsPath;
                    const engineDir = path.dirname(newEnginePath);
                    await SafeOperation.updateConfig('xs.enginePath', newEnginePath, vscode.ConfigurationTarget.Global);
                    await SafeOperation.updateConfig('xs.workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                    await UserNotifier.showInfo(`XS Engine path set to: ${newEnginePath}`);
                }
            }
        } else {
            // Try to get version information
            const result = await SafeOperation.executeCommand(enginePath, ['version'], { timeout: 5000 });

            const message = result
                ? `XS Engine ${result.stdout.trim()}\nPath: ${enginePath}`
                : `XS Engine\nPath: ${enginePath}`;

            const selection = await UserNotifier.showInfo(message, 'Open Settings');
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'xs.enginePath');
            }
        }
    });
    context.subscriptions.push(showEngineInfo);

    // Run Engine command
   let runEngine = vscode.commands.registerCommand('xs-vscode.runEngine', async () => {
    const config = vscode.workspace.getConfiguration('xs');
    let enginePath = config.get<string>('enginePath', '');
    let workingDir = config.get<string>('workingDirectory', '${workspaceFolder}');

    ErrorLogger.log(`Engine path: ${enginePath}`, 'info');
    ErrorLogger.log(`Working dir: ${workingDir}`, 'info');

    // Validate engine path
    if (!enginePath) {
        const selection = await vscode.window.showErrorMessage(
            'XS Engine path not set. Please locate xs.exe',
            'Browse...',
            'Cancel'
        );

        if (selection === 'Browse...') {
            const fileUri = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Select XS Engine',
                filters: {
                    'Executables': ['exe']
                }
            });

            if (fileUri && fileUri[0]) {
                enginePath = fileUri[0].fsPath;
                const engineDir = path.dirname(enginePath);
                await SafeOperation.updateConfig('xs.enginePath', enginePath, vscode.ConfigurationTarget.Global);
                await SafeOperation.updateConfig('xs.workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                await UserNotifier.showInfo(`XS Engine path set to: ${enginePath}`);
            } else {
                return;
            }
        } else {
            return;
        }
    }

    // Get current workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    const projectFolder = workspaceFolder.uri.fsPath;

    // Resolve ${workspaceFolder} variable in working directory
    if (workingDir.includes('${workspaceFolder}')) {
        workingDir = workingDir.replace('${workspaceFolder}', projectFolder);
    }

    ErrorLogger.log(`Resolved working dir: ${workingDir}`, 'info');
    ErrorLogger.log(`Project folder: ${projectFolder}`, 'info');
    ErrorLogger.log(`Running command: "${enginePath}" run "${projectFolder}"`, 'info');

    // Create and show terminal
    const terminal = vscode.window.createTerminal({
        name: 'XS Engine',
        cwd: workingDir
    });

    terminal.show();
   	terminal.sendText(`& "${enginePath}" run "${projectFolder}"`);

    ErrorLogger.log('Terminal command sent', 'info');
	});
    context.subscriptions.push(runEngine);

    // Package Game command
    let packageGame = vscode.commands.registerCommand('xs-vscode.packageGame', async () => {
        const config = vscode.workspace.getConfiguration('xs');
        let enginePath = config.get<string>('enginePath', '');
        let workingDir = config.get<string>('workingDirectory', '${workspaceFolder}');

        // Validate engine path
        if (!enginePath) {
            const selection = await vscode.window.showErrorMessage(
                'XS Engine path not set. Please locate xs.exe',
                'Browse...',
                'Cancel'
            );

            if (selection === 'Browse...') {
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select XS Engine',
                    filters: {
                        'Executables': ['exe']
                    }
                });

                if (fileUri && fileUri[0]) {
                    enginePath = fileUri[0].fsPath;
                    const engineDir = path.dirname(enginePath);
                    await SafeOperation.updateConfig('xs.enginePath', enginePath, vscode.ConfigurationTarget.Global);
                    await SafeOperation.updateConfig('xs.workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                    await UserNotifier.showInfo(`XS Engine path set to: ${enginePath}`);
                } else {
                    return;
                }
            } else {
                return;
            }
        }

        // Get current workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        const projectFolder = workspaceFolder.uri.fsPath;
        const folderName = path.basename(projectFolder);
        const packageDir = path.join(projectFolder, '.package');
        const outputPath = path.join(packageDir, `${folderName}.xs`);

        // Create .package directory if it doesn't exist
        const packageDirUri = vscode.Uri.file(packageDir);
        await SafeOperation.createDirectory(packageDirUri, 'Failed to create .package directory');

        // Resolve ${workspaceFolder} variable in working directory
        if (workingDir.includes('${workspaceFolder}')) {
            workingDir = workingDir.replace('${workspaceFolder}', projectFolder);
        }

        ErrorLogger.log(`Project folder: ${projectFolder}`, 'info');
        ErrorLogger.log(`Folder name: ${folderName}`, 'info');
        ErrorLogger.log(`Output path: ${outputPath}`, 'info');
        ErrorLogger.log(`Running command: "${enginePath}" package "${projectFolder}" "${outputPath}"`, 'info');

        // Create and show terminal
        const terminal = vscode.window.createTerminal({
            name: 'XS Package',
            cwd: workingDir
        });

        terminal.show();
        terminal.sendText(`& "${enginePath}" package "${projectFolder}" "${outputPath}"`);

        await UserNotifier.showInfo(`Packaging ${folderName}...`);
    });
    context.subscriptions.push(packageGame);

    // Package and Run command
    let packageAndRun = vscode.commands.registerCommand('xs-vscode.packageAndRun', async () => {
        const config = vscode.workspace.getConfiguration('xs');
        let enginePath = config.get<string>('enginePath', '');
        let workingDir = config.get<string>('workingDirectory', '${workspaceFolder}');

        // Validate engine path
        if (!enginePath) {
            const selection = await vscode.window.showErrorMessage(
                'XS Engine path not set. Please locate xs.exe',
                'Browse...',
                'Cancel'
            );

            if (selection === 'Browse...') {
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select XS Engine',
                    filters: {
                        'Executables': ['exe']
                    }
                });

                if (fileUri && fileUri[0]) {
                    enginePath = fileUri[0].fsPath;
                    const engineDir = path.dirname(enginePath);
                    await SafeOperation.updateConfig('xs.enginePath', enginePath, vscode.ConfigurationTarget.Global);
                    await SafeOperation.updateConfig('xs.workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                    await UserNotifier.showInfo(`XS Engine path set to: ${enginePath}`);
                } else {
                    return;
                }
            } else {
                return;
            }
        }

        // Get current workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        const projectFolder = workspaceFolder.uri.fsPath;
        const folderName = path.basename(projectFolder);
        const packageDir = path.join(projectFolder, '.package');
        const outputPath = path.join(packageDir, `${folderName}.xs`);

        // Create .package directory if it doesn't exist
        const packageDirUri = vscode.Uri.file(packageDir);
        await SafeOperation.createDirectory(packageDirUri, 'Failed to create .package directory');

        // Resolve ${workspaceFolder} variable in working directory
        if (workingDir.includes('${workspaceFolder}')) {
            workingDir = workingDir.replace('${workspaceFolder}', projectFolder);
        }

        ErrorLogger.log(`Project folder: ${projectFolder}`, 'info');
        ErrorLogger.log(`Folder name: ${folderName}`, 'info');
        ErrorLogger.log(`Output path: ${outputPath}`, 'info');
        ErrorLogger.log('Running commands: package then run', 'info');

        // Create and show terminal
        const terminal = vscode.window.createTerminal({
            name: 'XS Package & Run',
            cwd: workingDir
        });

        terminal.show();
        // Chain both commands: package first, then run if successful
        terminal.sendText(`& "${enginePath}" package "${projectFolder}" "${outputPath}" ; if ($?) { & "${enginePath}" run "${outputPath}" }`);

        await UserNotifier.showInfo(`Packaging and running ${folderName}...`);
    });
    context.subscriptions.push(packageAndRun);
}


function getLanguageId(filePath: string): string {
    const ext = path.extname(filePath);
    const langMap: { [key: string]: string } = {
        '.json': 'json',
        '.txt': 'plaintext',
        '.wren': 'javascript', // Close enough
        '.frag': 'glsl',
        '.vert': 'glsl'
    };
    return langMap[ext] || 'plaintext';
}

// Launch Configuration Provider
// Provides launch configurations for the Run and Debug panel (F5 support)
// Note: This is launch-only. Actual debugging support (breakpoints, etc.) will be added later.
class XsLaunchConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // If no configuration is provided, create a default one
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                config.type = 'xs';
                config.name = 'xs: Run Game';
                config.request = 'launch';
                config.projectFolder = '${workspaceFolder}';
                config.packageFirst = false;
            }
        }

        if (!config.projectFolder) {
            config.projectFolder = '${workspaceFolder}';
        }

        return config;
    }
}

// Launch Handler
// Handles launching the game when F5 is pressed or Run button is clicked
class XsLaunchHandler implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(
        session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): Promise<vscode.DebugAdapterDescriptor | null> {
        const config = session.configuration;
        const packageFirst = config.packageFirst || false;

        // Get engine configuration
        const vsConfig = vscode.workspace.getConfiguration('xs');
        let enginePath = vsConfig.get<string>('enginePath', '');
        let workingDir = vsConfig.get<string>('workingDirectory', '${workspaceFolder}');

        if (!enginePath) {
            const selection = await vscode.window.showErrorMessage(
                'XS Engine path not set. Please locate xs.exe',
                'Browse...',
                'Cancel'
            );

            if (selection === 'Browse...') {
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select XS Engine',
                    filters: {
                        'Executables': ['exe']
                    }
                });

                if (fileUri && fileUri[0]) {
                    enginePath = fileUri[0].fsPath;
                    const engineDir = path.dirname(enginePath);
                    await SafeOperation.updateConfig('xs.enginePath', enginePath, vscode.ConfigurationTarget.Global);
                    await SafeOperation.updateConfig('xs.workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                    await UserNotifier.showInfo(`XS Engine path set to: ${enginePath}`);
                } else {
                    return null;
                }
            } else {
                return null;
            }
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return null;
        }

        const projectFolder = config.projectFolder.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);

        // Resolve working directory
        if (workingDir.includes('${workspaceFolder}')) {
            workingDir = workingDir.replace('${workspaceFolder}', projectFolder);
        }

        if (packageFirst) {
            // Package & Run
            const folderName = path.basename(projectFolder);
            const packageDir = path.join(projectFolder, '.package');
            const outputPath = path.join(packageDir, `${folderName}.xs`);

            // Create .package directory
            const packageDirUri = vscode.Uri.file(packageDir);
            await SafeOperation.createDirectory(packageDirUri, 'Failed to create .package directory');

            const terminal = vscode.window.createTerminal({
                name: 'XS Package & Run',
                cwd: workingDir
            });

            terminal.show();
            terminal.sendText(`& "${enginePath}" package "${projectFolder}" "${outputPath}" ; if ($?) { & "${enginePath}" run "${outputPath}" }`);
        } else {
            // Just Run
            const terminal = vscode.window.createTerminal({
                name: 'XS Engine',
                cwd: workingDir
            });

            terminal.show();
            terminal.sendText(`& "${enginePath}" run "${projectFolder}"`);
        }

        // Return null since we're just launching, not debugging
        return null;
    }
}

export function deactivate() {
    ErrorLogger.dispose();
}