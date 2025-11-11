# XS Game Engine Tools

Visual Studio Code extension providing comprehensive tooling for the XS game engine, including package viewing, animation editing, and debugging support.

## Features

### Custom Editors

- **XS Package Viewer** - Visual editor for `.xs` package files
- **XS Animation Editor** - Interactive editor for `.xsanim` animation files with timeline and grid view

### Commands

- `xs: run engine` - Launch the XS game engine with your project
- `xs: package game` - Package your game into an `.xs` file
- `xs: package and run` - Package and immediately run your game
- `xs: show engine info` - Display information about the configured engine

### Debugging Support

Integrated debugger for XS Game Engine with support for:
- Launch configurations for running games directly or from packaged `.xs` files
- Automatic packaging before launch (optional)
- Wren language support

### Language Support

- Syntax highlighting and file icons for `.xs` and `.xsanim` files
- Automatic activation when a `project.json` is detected in the workspace

## Requirements

- XS Game Engine executable

## Extension Settings

This extension contributes the following settings:

- `xs.enginePath` - Path to the `xs` executable (e.g., `C:\path\to\xs.exe`)
- `xs.workingDirectory` - Working directory when running the engine (default: `${workspaceFolder}`)

## Getting Started

1. Install the extension
2. Open a workspace containing an XS game project (with `project.json`)
3. Configure the engine path in settings:
   - Open VS Code settings (Ctrl+,)
   - Search for "xs.enginePath"
   - Set the path to your `xs.exe` executable
4. Start using the XS commands and editors!

## Debug Configurations

The extension provides two debug configuration templates:

**Run Game** - Launch the game from the source folder:
```json
{
  "type": "xs",
  "request": "launch",
  "name": "Run Game",
  "projectFolder": "${workspaceFolder}",
  "packageFirst": false
}
```

**Package & Run** - Package and launch from `.xs` file:
```json
{
  "type": "xs",
  "request": "launch",
  "name": "Package & Run",
  "projectFolder": "${workspaceFolder}",
  "packageFirst": true
}
```

## Release Notes

### 0.0.1

Initial release of XS Game Engine Tools featuring:
- Package viewer for `.xs` files
- Animation editor for `.xsanim` files
- Engine integration commands
- Debug adapter for XS Game Engine

## Repository

[https://github.com/BredaUniversityGames/xs-vscode](https://github.com/BredaUniversityGames/xs-vscode)

## License

MIT
