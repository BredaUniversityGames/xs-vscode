import * as vscode from 'vscode';
import * as path from 'path';
import { PackageEditorProvider } from './packageEditor';
import { AnimationEditorProvider } from './animationEditor/animationEditor';
import { SpriteEditorProvider } from './spriteEditor/spriteEditor';

// Platform detection utilities
function isWindows(): boolean {
    return process.platform === 'win32';
}

function isMacOS(): boolean {
    return process.platform === 'darwin';
}

function isLinux(): boolean {
    return process.platform === 'linux';
}

// Get platform-appropriate file dialog filters for executables
function getExecutableFilters(): { [name: string]: string[] } | undefined {
    if (isWindows()) {
        return { 'Executables': ['exe'] };
    }
    if (isMacOS()) {
        return { 'Applications': ['app'] };
    }
    if (isLinux()) {
        return undefined;
    }
    return undefined;
}

// Get the executable name for display in messages
function getExecutableName(): string {
    if (isWindows()) {
        return 'xs.exe';
    }
    if (isMacOS()) {
        return 'xs.app or xs executable';
    }
    if (isLinux()) {
        return 'xs';
    }
    return 'xs';
}

// Resolve the actual executable path from a user-selected path
// On macOS, if user selects an .app bundle, find the executable inside it
async function resolveExecutablePath(selectedPath: string): Promise<string> {
    if (isMacOS() && selectedPath.endsWith('.app')) {
        // Look for executable inside the .app bundle
        // Standard location: AppName.app/Contents/MacOS/<executable>
        const macOSDir = path.join(selectedPath, 'Contents', 'MacOS');
        const appName = path.basename(selectedPath, '.app');

        // Try common executable names
        const possibleNames = [
            appName,           // Same name as app (e.g., xs.app -> xs)
            appName.toLowerCase(),
            'xs',
            'XS'
        ];

        const fs = require('fs').promises;
        for (const name of possibleNames) {
            const execPath = path.join(macOSDir, name);
            try {
                await fs.access(execPath, require('fs').constants.X_OK);
                return execPath;
            } catch {
                // Try next name
            }
        }

        // If we can't find a known executable, try to find any executable in MacOS dir
        try {
            const files = await fs.readdir(macOSDir);
            if (files.length > 0) {
                // Return the first file (usually there's only one main executable)
                return path.join(macOSDir, files[0]);
            }
        } catch {
            // Fall through to return original path
        }
    }

    return selectedPath;
}

// Build a shell command that works on the current platform
// For .app bundles, we call the executable inside directly to keep output in terminal
async function buildRunCommand(enginePath: string, projectFolder: string): Promise<string> {
    if (isWindows()) {
        return `& "${enginePath}" run "${projectFolder}"`;
    }
    // Resolve .app bundle to executable inside
    const execPath = await resolveExecutablePath(enginePath);
    return `"${execPath}" run "${projectFolder}"`;
}

async function buildPackageCommand(enginePath: string, projectFolder: string, outputPath: string): Promise<string> {
    if (isWindows()) {
        return `& "${enginePath}" package "${projectFolder}" "${outputPath}"`;
    }
    // Resolve .app bundle to executable inside
    const execPath = await resolveExecutablePath(enginePath);
    return `"${execPath}" package "${projectFolder}" "${outputPath}"`;
}

async function buildPackageAndRunCommand(enginePath: string, projectFolder: string, outputPath: string): Promise<string> {
    if (isWindows()) {
        // PowerShell: use & operator and $? for exit code check
        return `& "${enginePath}" package "${projectFolder}" "${outputPath}" ; if ($?) { & "${enginePath}" run "${outputPath}" }`;
    }
    // Resolve .app bundle to executable inside
    const execPath = await resolveExecutablePath(enginePath);
    return `"${execPath}" package "${projectFolder}" "${outputPath}" && "${execPath}" run "${outputPath}"`;
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('xs-vscode activating ...');

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
    try {
        const content = await vscode.workspace.fs.readFile(projectJsonUri);
        const projectData = JSON.parse(content.toString());

        // Check for XS-specific fields
        if (!projectData.Main) {
            return false;
        }

        console.log('xs project detected. xs-vscode activated.');
        return true;
    } catch (e) {
        console.log('project.json not found or invalid');
        return false;
    }
}

function registerEditors(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        PackageEditorProvider.register(context)
    );
    context.subscriptions.push(
        AnimationEditorProvider.register(context)
    );
    context.subscriptions.push(
        SpriteEditorProvider.register(context)
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

    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // For .app bundles, we need to call the executable directly to capture stdout
        // (open command doesn't capture output)
        const executablePath = await resolveExecutablePath(enginePath);
        const { stdout } = await execAsync(`"${executablePath}" version`);
        const version = stdout.trim();

        statusBarItem.text = `$(game) xs ${version}`;
        statusBarItem.tooltip = `XS Engine ${version}\nPath: ${enginePath}`;
        statusBarItem.show();
    } catch (error) {
        // If version command fails, just show that xs is configured
        statusBarItem.text = '$(game) xs';
        statusBarItem.tooltip = `XS Engine\nPath: ${enginePath}`;
        statusBarItem.show();
    }
}

function registerCommands(context: vscode.ExtensionContext) {
    // Show Engine Info command
    let showEngineInfo = vscode.commands.registerCommand('xs-vscode.showEngineInfo', async () => {
        const config = vscode.workspace.getConfiguration('xs');
        const enginePath = config.get<string>('enginePath', '');

        if (!enginePath) {
            const selection = await vscode.window.showErrorMessage(
                `XS Engine path not set. Please locate ${getExecutableName()}`,
                'Browse...',
                'Cancel'
            );

            if (selection === 'Browse...') {
                const filters = getExecutableFilters();
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select XS Engine',
                    ...(filters && { filters })
                });

                if (fileUri && fileUri[0]) {
                    const newEnginePath = fileUri[0].fsPath;
                    const engineDir = path.dirname(newEnginePath);
                    await config.update('enginePath', newEnginePath, vscode.ConfigurationTarget.Global);
                    await config.update('workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`XS Engine path set to: ${newEnginePath}`);
                }
            }
        } else {
            try {
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);

                // For .app bundles, resolve to the executable inside
                const executablePath = await resolveExecutablePath(enginePath);
                const { stdout } = await execAsync(`"${executablePath}" version`);
                const version = stdout.trim();

                vscode.window.showInformationMessage(
                    `XS Engine ${version}\nPath: ${enginePath}`,
                    'Open Settings'
                ).then(selection => {
                    if (selection === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'xs.enginePath');
                    }
                });
            } catch (error) {
                vscode.window.showInformationMessage(
                    `XS Engine\nPath: ${enginePath}`,
                    'Open Settings'
                ).then(selection => {
                    if (selection === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'xs.enginePath');
                    }
                });
            }
        }
    });
    context.subscriptions.push(showEngineInfo);

    // Run Engine command
   let runEngine = vscode.commands.registerCommand('xs-vscode.runEngine', async () => {
    const config = vscode.workspace.getConfiguration('xs');
    let enginePath = config.get<string>('enginePath', '');
    let workingDir = config.get<string>('workingDirectory', '${workspaceFolder}');

    console.log('Engine path from settings:', enginePath);
    console.log('Working dir:', workingDir);

    // Validate engine path
    if (!enginePath) {
        const selection = await vscode.window.showErrorMessage(
            `XS Engine path not set. Please locate ${getExecutableName()}`,
            'Browse...',
            'Cancel'
        );

        if (selection === 'Browse...') {
            const filters = getExecutableFilters();
            const fileUri = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Select XS Engine',
                ...(filters && { filters })
            });

            if (fileUri && fileUri[0]) {
                enginePath = fileUri[0].fsPath;
                const engineDir = path.dirname(enginePath);
                await config.update('enginePath', enginePath, vscode.ConfigurationTarget.Global);
                await config.update('workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`XS Engine path set to: ${enginePath}`);
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

    console.log('Resolved working dir:', workingDir);
    console.log('Project folder:', projectFolder);
    console.log('Running command:', `"${enginePath}" run "${projectFolder}"`);

    // Create and show terminal
    const terminal = vscode.window.createTerminal({
        name: 'XS Engine',
        cwd: workingDir
    });

    terminal.show();
   	terminal.sendText(await buildRunCommand(enginePath, projectFolder));

    console.log('Terminal command sent');
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
                `XS Engine path not set. Please locate ${getExecutableName()}`,
                'Browse...',
                'Cancel'
            );

            if (selection === 'Browse...') {
                const filters = getExecutableFilters();
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select XS Engine',
                    ...(filters && { filters })
                });

                if (fileUri && fileUri[0]) {
                    enginePath = fileUri[0].fsPath;
                    const engineDir = path.dirname(enginePath);
                    await config.update('enginePath', enginePath, vscode.ConfigurationTarget.Global);
                    await config.update('workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`XS Engine path set to: ${enginePath}`);
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
        vscode.workspace.fs.createDirectory(packageDirUri).then(() => {
            console.log('.package directory ensured');
        }, (error) => {
            console.log('.package directory already exists or error:', error);
        });

        // Resolve ${workspaceFolder} variable in working directory
        if (workingDir.includes('${workspaceFolder}')) {
            workingDir = workingDir.replace('${workspaceFolder}', projectFolder);
        }

        console.log('Project folder:', projectFolder);
        console.log('Folder name:', folderName);
        console.log('Output path:', outputPath);
        console.log('Running command:', `"${enginePath}" package "${projectFolder}" "${outputPath}"`);

        // Create and show terminal
        const terminal = vscode.window.createTerminal({
            name: 'XS Package',
            cwd: workingDir
        });

        terminal.show();
        terminal.sendText(await buildPackageCommand(enginePath, projectFolder, outputPath));

        vscode.window.showInformationMessage(`Packaging ${folderName}...`);
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
                `XS Engine path not set. Please locate ${getExecutableName()}`,
                'Browse...',
                'Cancel'
            );

            if (selection === 'Browse...') {
                const filters = getExecutableFilters();
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select XS Engine',
                    ...(filters && { filters })
                });

                if (fileUri && fileUri[0]) {
                    enginePath = fileUri[0].fsPath;
                    const engineDir = path.dirname(enginePath);
                    await config.update('enginePath', enginePath, vscode.ConfigurationTarget.Global);
                    await config.update('workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`XS Engine path set to: ${enginePath}`);
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
        vscode.workspace.fs.createDirectory(packageDirUri).then(() => {
            console.log('.package directory ensured');
        }, (error) => {
            console.log('.package directory already exists or error:', error);
        });

        // Resolve ${workspaceFolder} variable in working directory
        if (workingDir.includes('${workspaceFolder}')) {
            workingDir = workingDir.replace('${workspaceFolder}', projectFolder);
        }

        console.log('Project folder:', projectFolder);
        console.log('Folder name:', folderName);
        console.log('Output path:', outputPath);
        console.log('Running commands: package then run');

        // Create and show terminal
        const terminal = vscode.window.createTerminal({
            name: 'XS Package & Run',
            cwd: workingDir
        });

        terminal.show();
        // Chain both commands: package first, then run if successful
        terminal.sendText(await buildPackageAndRunCommand(enginePath, projectFolder, outputPath));

        vscode.window.showInformationMessage(`Packaging and running ${folderName}...`);
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
                `XS Engine path not set. Please locate ${getExecutableName()}`,
                'Browse...',
                'Cancel'
            );

            if (selection === 'Browse...') {
                const filters = getExecutableFilters();
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select XS Engine',
                    ...(filters && { filters })
                });

                if (fileUri && fileUri[0]) {
                    enginePath = fileUri[0].fsPath;
                    const engineDir = path.dirname(enginePath);
                    await vsConfig.update('enginePath', enginePath, vscode.ConfigurationTarget.Global);
                    await vsConfig.update('workingDirectory', engineDir, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`XS Engine path set to: ${enginePath}`);
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
            vscode.workspace.fs.createDirectory(packageDirUri);

            const terminal = vscode.window.createTerminal({
                name: 'XS Package & Run',
                cwd: workingDir
            });

            terminal.show();
            terminal.sendText(await buildPackageAndRunCommand(enginePath, projectFolder, outputPath));
        } else {
            // Just Run
            const terminal = vscode.window.createTerminal({
                name: 'XS Engine',
                cwd: workingDir
            });

            terminal.show();
            terminal.sendText(await buildRunCommand(enginePath, projectFolder));
        }

        // Return null since we're just launching, not debugging
        return null;
    }
}

export function deactivate() {}