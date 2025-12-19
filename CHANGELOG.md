# Changelog

All notable changes to the Whizbang VSCode extension will be documented in this file.

## [0.1.0] - Initial Release

### Added
- **Code Lens Annotations**: Inline annotations showing message flow relationships
  - Dispatcher count with 📤 emoji
  - Receptor count with 🎯 emoji
  - Perspective count with 👁️ emoji (events only)
  - Clickable navigation to source locations

- **Hover Tooltips**: Rich markdown tooltips on message types
  - Message classification (Command/Event)
  - List of all dispatchers with navigation links
  - List of all receptors with navigation links
  - List of all perspectives with navigation links

- **Navigation Commands**:
  - `Whizbang: Go to Dispatcher` - Jump to message dispatcher
  - `Whizbang: Go to Receptor` - Jump to handler
  - `Whizbang: Go to Perspective` - Jump to event observers

- **Message Registry Integration**:
  - Automatic discovery of `.whizbang/message-registry.json`
  - File watching with automatic reload on changes
  - Multi-project workspace support

- **Developer Experience**:
  - pnpm package manager for fast, disk-efficient builds
  - TypeScript with strict type checking
  - Comprehensive documentation (ARCHITECTURE.md, TESTING.md)

### Technical Details
- VSCode Engine: ^1.85.0
- TypeScript: ^5.3.0
- Package Manager: pnpm (replaces npm)
- Zero external dependencies beyond VSCode API
