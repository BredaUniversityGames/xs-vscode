# Change Log

All notable changes to the "xs-vscode" extension will be documented in this file.

## [0.3.2] - 2026-07-07

### Fixed
- `xs.workingDirectory` is now applied reliably: run/package terminals are recreated when the configured working directory changes, instead of reusing a cached terminal with a stale working directory

### Changed
- Consistent lowercase "xs" naming across the extension (title, editors, terminals, messages)

## [0.1.2] - 2025-12-08

### Added
- Linux support for the xs game engine

## [0.1.1] - 2025-12-03

### Added
- macOS support for the xs game engine

## [0.1.0] - 2025-11-11

### Added
- MIT license file (license.txt)

## [0.0.1] - 2025-11-11

### Added
- Initial release
- xs package viewer for .xs files
- xs animation editor for .xsanim files with timeline and grid view
- Commands: run engine, package game, package and run, show engine info
- Language support for .xs and .xsanim files
- Configuration settings for engine path and working directory
