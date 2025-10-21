import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('xs-vscode is now active');

    // Run Engine command
    let runEngine = vscode.commands.registerCommand('xs-vscode.runEngine', () => {
        const config = vscode.workspace.getConfiguration('xs');
        let enginePath = config.get<string>('enginePath', '');
        let workingDir = config.get<string>('workingDirectory', '${workspaceFolder}');

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

        // Create and show terminal
        const terminal = vscode.window.createTerminal({
            name: 'XS Engine',
            cwd: workingDir
        });
        
        terminal.show();
        terminal.sendText(`"${enginePath}"`);
    });

    context.subscriptions.push(runEngine);
}

export function deactivate() {}