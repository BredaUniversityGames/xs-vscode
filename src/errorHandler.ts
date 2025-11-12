import * as vscode from 'vscode';

/**
 * Custom error types for the XS Engine extension
 */
export enum XsErrorType {
    ENGINE_NOT_FOUND = 'ENGINE_NOT_FOUND',
    ENGINE_EXECUTION = 'ENGINE_EXECUTION',
    PROJECT_VALIDATION = 'PROJECT_VALIDATION',
    FILE_OPERATION = 'FILE_OPERATION',
    PARSING = 'PARSING',
    CONFIGURATION = 'CONFIGURATION',
    WEBVIEW = 'WEBVIEW',
    UNKNOWN = 'UNKNOWN'
}

/**
 * Base error class for XS Engine extension errors
 */
export class XsEngineError extends Error {
    constructor(
        public readonly type: XsErrorType,
        message: string,
        public readonly originalError?: unknown,
        public readonly context?: Record<string, any>
    ) {
        super(message);
        this.name = 'XsEngineError';

        // Maintain proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, XsEngineError);
        }
    }

    /**
     * Get a user-friendly error message
     */
    getUserMessage(): string {
        switch (this.type) {
            case XsErrorType.ENGINE_NOT_FOUND:
                return 'XS Engine executable not found. Please configure the engine path in settings.';
            case XsErrorType.ENGINE_EXECUTION:
                return `Failed to execute XS Engine: ${this.message}`;
            case XsErrorType.PROJECT_VALIDATION:
                return `Invalid XS project: ${this.message}`;
            case XsErrorType.FILE_OPERATION:
                return `File operation failed: ${this.message}`;
            case XsErrorType.PARSING:
                return `Failed to parse file: ${this.message}`;
            case XsErrorType.CONFIGURATION:
                return `Configuration error: ${this.message}`;
            case XsErrorType.WEBVIEW:
                return `Webview error: ${this.message}`;
            default:
                return `An error occurred: ${this.message}`;
        }
    }

    /**
     * Get technical details for logging
     */
    getTechnicalDetails(): string {
        const details = [
            `Type: ${this.type}`,
            `Message: ${this.message}`,
            this.context ? `Context: ${JSON.stringify(this.context, null, 2)}` : null,
            this.originalError ? `Original Error: ${String(this.originalError)}` : null,
            this.stack ? `Stack: ${this.stack}` : null
        ].filter(Boolean);

        return details.join('\n');
    }
}

/**
 * Logging utility for consistent error logging
 */
export class ErrorLogger {
    private static outputChannel: vscode.OutputChannel | null = null;

    static initialize(channelName: string = 'XS Engine Tools'): void {
        this.outputChannel = vscode.window.createOutputChannel(channelName);
    }

    static log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        const timestamp = new Date().toISOString();
        const prefix = level.toUpperCase();
        const formattedMessage = `[${timestamp}] ${prefix}: ${message}`;

        console.log(formattedMessage);

        if (this.outputChannel) {
            this.outputChannel.appendLine(formattedMessage);
        }
    }

    static logError(error: Error | XsEngineError | unknown, context?: string): void {
        if (error instanceof XsEngineError) {
            const message = context
                ? `${context}\n${error.getTechnicalDetails()}`
                : error.getTechnicalDetails();
            this.log(message, 'error');
        } else if (error instanceof Error) {
            const message = context
                ? `${context}\nError: ${error.message}\nStack: ${error.stack}`
                : `Error: ${error.message}\nStack: ${error.stack}`;
            this.log(message, 'error');
        } else {
            const message = context
                ? `${context}\nUnknown error: ${String(error)}`
                : `Unknown error: ${String(error)}`;
            this.log(message, 'error');
        }
    }

    static show(): void {
        this.outputChannel?.show();
    }

    static dispose(): void {
        this.outputChannel?.dispose();
        this.outputChannel = null;
    }
}

/**
 * User notification helpers
 */
export class UserNotifier {
    /**
     * Show an error message to the user with optional actions
     */
    static async showError(
        error: Error | XsEngineError | string,
        actions?: { title: string; action: () => void | Promise<void> }[]
    ): Promise<void> {
        const message = typeof error === 'string'
            ? error
            : error instanceof XsEngineError
                ? error.getUserMessage()
                : error.message;

        ErrorLogger.logError(error);

        if (actions && actions.length > 0) {
            const actionTitles = actions.map(a => a.title);
            const selected = await vscode.window.showErrorMessage(message, ...actionTitles);

            if (selected) {
                const action = actions.find(a => a.title === selected);
                if (action) {
                    try {
                        await action.action();
                    } catch (actionError) {
                        ErrorLogger.logError(actionError, 'Error executing user action');
                    }
                }
            }
        } else {
            const showLogsAction = 'Show Logs';
            const selected = await vscode.window.showErrorMessage(message, showLogsAction);
            if (selected === showLogsAction) {
                ErrorLogger.show();
            }
        }
    }

    /**
     * Show a warning message to the user
     */
    static async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        ErrorLogger.log(message, 'warn');
        return await vscode.window.showWarningMessage(message, ...actions);
    }

    /**
     * Show an info message to the user
     */
    static async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        ErrorLogger.log(message, 'info');
        return await vscode.window.showInformationMessage(message, ...actions);
    }
}

/**
 * Retry options for operations
 */
export interface RetryOptions {
    maxAttempts?: number;
    delayMs?: number;
    backoff?: boolean;
    onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Operation wrappers with error handling
 */
export class SafeOperation {
    /**
     * Execute an async operation with error handling
     */
    static async execute<T>(
        operation: () => Promise<T>,
        errorType: XsErrorType,
        errorMessage?: string,
        context?: Record<string, any>
    ): Promise<T | null> {
        try {
            return await operation();
        } catch (error) {
            const xsError = new XsEngineError(
                errorType,
                errorMessage || 'Operation failed',
                error,
                context
            );
            ErrorLogger.logError(xsError);
            return null;
        }
    }

    /**
     * Execute an async operation with error handling and user notification
     */
    static async executeWithNotification<T>(
        operation: () => Promise<T>,
        errorType: XsErrorType,
        errorMessage?: string,
        context?: Record<string, any>
    ): Promise<T | null> {
        try {
            return await operation();
        } catch (error) {
            const xsError = new XsEngineError(
                errorType,
                errorMessage || 'Operation failed',
                error,
                context
            );
            await UserNotifier.showError(xsError);
            return null;
        }
    }

    /**
     * Execute an operation with retry logic
     */
    static async executeWithRetry<T>(
        operation: () => Promise<T>,
        options: RetryOptions = {}
    ): Promise<T> {
        const {
            maxAttempts = 3,
            delayMs = 1000,
            backoff = true,
            onRetry
        } = options;

        let lastError: unknown;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                if (attempt < maxAttempts) {
                    if (onRetry) {
                        onRetry(attempt, error);
                    }

                    const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
                    ErrorLogger.log(
                        `Operation failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`,
                        'warn'
                    );
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    /**
     * Read a file with error handling
     */
    static async readFile(
        uri: vscode.Uri,
        errorMessage?: string
    ): Promise<Uint8Array | null> {
        return this.execute(
            () => vscode.workspace.fs.readFile(uri),
            XsErrorType.FILE_OPERATION,
            errorMessage || `Failed to read file: ${uri.fsPath}`,
            { uri: uri.fsPath }
        );
    }

    /**
     * Write a file with error handling
     */
    static async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        errorMessage?: string
    ): Promise<boolean> {
        const result = await this.execute(
            () => vscode.workspace.fs.writeFile(uri, content),
            XsErrorType.FILE_OPERATION,
            errorMessage || `Failed to write file: ${uri.fsPath}`,
            { uri: uri.fsPath }
        );
        return result !== null;
    }

    /**
     * Create a directory with error handling
     */
    static async createDirectory(
        uri: vscode.Uri,
        errorMessage?: string
    ): Promise<boolean> {
        const result = await this.execute(
            () => vscode.workspace.fs.createDirectory(uri),
            XsErrorType.FILE_OPERATION,
            errorMessage || `Failed to create directory: ${uri.fsPath}`,
            { uri: uri.fsPath }
        );
        return result !== null;
    }

    /**
     * Update configuration with error handling
     */
    static async updateConfig(
        section: string,
        value: any,
        configurationTarget: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
    ): Promise<boolean> {
        const result = await this.execute(
            () => vscode.workspace.getConfiguration().update(section, value, configurationTarget),
            XsErrorType.CONFIGURATION,
            `Failed to update configuration: ${section}`,
            { section, value }
        );
        return result !== null;
    }

    /**
     * Parse JSON with error handling
     */
    static parseJSON<T>(
        content: string,
        errorMessage?: string
    ): T | null {
        try {
            return JSON.parse(content) as T;
        } catch (error) {
            const xsError = new XsEngineError(
                XsErrorType.PARSING,
                errorMessage || 'Failed to parse JSON',
                error
            );
            ErrorLogger.logError(xsError);
            return null;
        }
    }

    /**
     * Execute a child process command with error handling
     */
    static async executeCommand(
        command: string,
        args: string[],
        options?: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string } | null> {
        return new Promise((resolve) => {
            const { spawn } = require('child_process');
            const child = spawn(command, args, {
                cwd: options?.cwd,
                timeout: options?.timeout
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            child.on('error', (error: Error) => {
                const xsError = new XsEngineError(
                    XsErrorType.ENGINE_EXECUTION,
                    `Failed to execute command: ${command}`,
                    error,
                    { command, args, options }
                );
                ErrorLogger.logError(xsError);
                resolve(null);
            });

            child.on('close', (code: number) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    const xsError = new XsEngineError(
                        XsErrorType.ENGINE_EXECUTION,
                        `Command exited with code ${code}`,
                        undefined,
                        { command, args, code, stdout, stderr }
                    );
                    ErrorLogger.logError(xsError);
                    resolve(null);
                }
            });
        });
    }
}

/**
 * Helper to wrap webview message handlers with error handling
 */
export function wrapWebviewMessageHandler<T = any>(
    handler: (message: T) => void | Promise<void>
): (message: T) => Promise<void> {
    return async (message: T) => {
        try {
            await handler(message);
        } catch (error) {
            const xsError = new XsEngineError(
                XsErrorType.WEBVIEW,
                'Error handling webview message',
                error,
                { message }
            );
            ErrorLogger.logError(xsError);
            await UserNotifier.showError(xsError);
        }
    };
}
