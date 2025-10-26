import * as vscode from 'vscode';
import * as path from 'path';
import { PackageEditorProvider } from './packageEditor';
import { AnimationEditorProvider } from './animationEditor';

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

    const packageAndRunStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        0 // Lowest priority (appears rightmost on left side)
    );

    packageAndRunStatusBarItem.command = 'xs-vscode.packageAndRun';
    packageAndRunStatusBarItem.text = '$(package) Package & Run';
    packageAndRunStatusBarItem.tooltip = 'Package and run the game from .xs package';
    packageAndRunStatusBarItem.show();

    context.subscriptions.push(packageAndRunStatusBarItem);
}

function registerCommands(context: vscode.ExtensionContext) {

    // Run Engine command
   let runEngine = vscode.commands.registerCommand('xs-vscode.runEngine', () => {
    const config = vscode.workspace.getConfiguration('xs');
    let enginePath = config.get<string>('enginePath', '');
    let workingDir = config.get<string>('workingDirectory', '${workspaceFolder}');

    console.log('Engine path:', enginePath);
    console.log('Working dir:', workingDir);

    // Validate engine path
    if (!enginePath) {
        vscode.window.showErrorMessage('XS Engine path not set. Please configure it in settings (xs.enginePath)');
        return;
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
   	terminal.sendText(`& "${enginePath}" run "${projectFolder}"`);

    console.log('Terminal command sent');
	});
    context.subscriptions.push(runEngine);

    // Package Game command
    let packageGame = vscode.commands.registerCommand('xs-vscode.packageGame', () => {
        const config = vscode.workspace.getConfiguration('xs');
        let enginePath = config.get<string>('enginePath', '');
        let workingDir = config.get<string>('workingDirectory', '${workspaceFolder}');

        // Validate engine path
        if (!enginePath) {
            vscode.window.showErrorMessage('XS Engine path not set. Please configure it in settings (xs.enginePath)');
            return;
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
        terminal.sendText(`& "${enginePath}" package "${projectFolder}" "${outputPath}"`);

        vscode.window.showInformationMessage(`Packaging ${folderName}...`);
    });
    context.subscriptions.push(packageGame);

    // Package and Run command
    let packageAndRun = vscode.commands.registerCommand('xs-vscode.packageAndRun', () => {
        const config = vscode.workspace.getConfiguration('xs');
        let enginePath = config.get<string>('enginePath', '');
        let workingDir = config.get<string>('workingDirectory', '${workspaceFolder}');

        // Validate engine path
        if (!enginePath) {
            vscode.window.showErrorMessage('XS Engine path not set. Please configure it in settings (xs.enginePath)');
            return;
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
        terminal.sendText(`& "${enginePath}" package "${projectFolder}" "${outputPath}" ; if ($?) { & "${enginePath}" run "${outputPath}" }`);

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
    createDebugAdapterDescriptor(
        session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        const config = session.configuration;
        const packageFirst = config.packageFirst || false;

        // Get engine configuration
        const vsConfig = vscode.workspace.getConfiguration('xs');
        let enginePath = vsConfig.get<string>('enginePath', '');
        let workingDir = vsConfig.get<string>('workingDirectory', '${workspaceFolder}');

        if (!enginePath) {
            vscode.window.showErrorMessage('XS Engine path not set. Please configure it in settings (xs.enginePath)');
            return null;
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

export function deactivate() {}