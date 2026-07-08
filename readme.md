# xs game engine tools

Visual Studio Code extension providing comprehensive tooling for the xs game engine, including package viewing and animation editing.

## Features

### Custom Editors

- **xs package viewer** - Visual editor for `.xs` package files
- **xs animation editor** - Interactive editor for `.xsanim` animation files with timeline and grid view

### Commands

- `xs: run engine` - Launch the xs game engine with your project
- `xs: package game` - Package your game into an `.xs` file
- `xs: package and run` - Package and immediately run your game
- `xs: show engine info` - Display information about the configured engine

### Language Support

- Syntax highlighting and file icons for `.xs` and `.xsanim` files
- Automatic activation when a `project.json` is detected in the workspace

## Requirements

- xs game engine executable

## Extension Settings

This extension contributes the following settings:

- `xs.enginePath` - Path to the xs engine executable:
  - Windows: `C:\path\to\xs.exe`
  - macOS: `/path/to/xs.app` (select the .app bundle, the extension will find the executable inside)
  - Linux: `/path/to/xs`
- `xs.workingDirectory` - Working directory when running the engine (default: `${workspaceFolder}`)

Note: when `xs.enginePath` points to an engine build that does not have a `resources/` folder next to the executable (e.g. a development build), the engine looks for `resources/` in the working directory instead — set `xs.workingDirectory` to the folder that contains it (e.g. the engine repository root).

## Getting Started

1. Install the extension
2. Open a workspace containing an xs game project (with `project.json`)
3. Configure the engine path in settings:
   - Open VS Code settings (Ctrl+, on Windows/Linux, Cmd+, on macOS)
   - Search for "xs.enginePath"
   - Set the path to your xs engine executable
4. Start using the xs commands and editors!

## Debug Configurations

The extension provides two debug configuration templates:

**run game** - Launch the game from the source folder:
```json
{
  "type": "xs",
  "request": "launch",
  "name": "run game",
  "projectFolder": "${workspaceFolder}",
  "packageFirst": false
}
```

**package & run** - Package and launch from `.xs` file:
```json
{
  "type": "xs",
  "request": "launch",
  "name": "package & run",
  "projectFolder": "${workspaceFolder}",
  "packageFirst": true
}
```

## Release Notes

### 0.0.1

Initial release of xs game engine tools featuring:
- Package viewer for `.xs` files
- Animation editor for `.xsanim` files
- Engine integration commands

## Repository

[https://github.com/BredaUniversityGames/xs-vscode](https://github.com/BredaUniversityGames/xs-vscode)

## License

MIT
