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

    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        0 // Priority (higher = more left)
    );
    
    statusBarItem.command = 'xs-vscode.runEngine';
    statusBarItem.text = '$(play) Run Game (xs)';
    statusBarItem.tooltip = 'Run current folder as an xs game';
    statusBarItem.show();
    
    context.subscriptions.push(statusBarItem);

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

    // Resolve ${workspaceFolder} variable
    if (workingDir.includes('${workspaceFolder}')) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            workingDir = workingDir.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
        } else {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
    }

    console.log('Resolved working dir:', workingDir);
    console.log('Running command:', `"${enginePath}"`);

    // Create and show terminal
    const terminal = vscode.window.createTerminal({
        name: 'XS Engine',
        cwd: workingDir
    });
    
    terminal.show();
   	terminal.sendText(`& "${enginePath}"`);
    
    console.log('Terminal command sent');
	});
    context.subscriptions.push(runEngine);
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