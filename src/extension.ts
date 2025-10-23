import * as vscode from 'vscode';
import * as path from 'path';
import { ArchiveEditorProvider } from './archiveEditor';

export async function activate(context: vscode.ExtensionContext) {
    console.log('xs-vscode activating ...');

     // Optional: Verify this is actually an XS project
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        const projectJsonUri = vscode.Uri.joinPath(workspaceFolder.uri, 'project.json');
        try {
            const content = await vscode.workspace.fs.readFile(projectJsonUri);
            const projectData = JSON.parse(content.toString());
            
            // Check for XS-specific fields if needed
            if (!projectData.Main) {
                return;
            }
            
            console.log('xs project detected. xs-vscode activated.');
        } catch (e) {
            console.log('project.json not found or invalid');
        }
    }

     // Register archive viewer
    context.subscriptions.push(
        ArchiveEditorProvider.register(context)
    );

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
    packageAndRunStatusBarItem.tooltip = 'Package and run the game from .xs archive';
    packageAndRunStatusBarItem.show();

    context.subscriptions.push(packageAndRunStatusBarItem);

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

export function deactivate() {}