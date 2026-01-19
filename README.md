# Whizbang VSCode Extension

[![Build](https://github.com/whizbang-lib/whizbang-vscode/actions/workflows/build.yml/badge.svg)](https://github.com/whizbang-lib/whizbang-vscode/actions/workflows/build.yml)
[![Lint](https://github.com/whizbang-lib/whizbang-vscode/actions/workflows/lint.yml/badge.svg)](https://github.com/whizbang-lib/whizbang-vscode/actions/workflows/lint.yml)
[![Tests](https://github.com/whizbang-lib/whizbang-vscode/actions/workflows/test.yml/badge.svg)](https://github.com/whizbang-lib/whizbang-vscode/actions/workflows/test.yml)
[![Version](https://img.shields.io/github/package-json/v/whizbang-lib/whizbang-vscode)](https://github.com/whizbang-lib/whizbang-vscode)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/SoftwareExtravaganza.whizbang)](https://marketplace.visualstudio.com/items?itemName=SoftwareExtravaganza.whizbang)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Navigate message flows in Whizbang event-driven applications with GitLens-style code annotations.

## Features

### Development-Time Navigation

- **Message Type Annotations** - See which dispatchers and receptors handle each message
- **Code Lens** - Inline annotations showing message flow relationships
- **Hover Tooltips** - Detailed information about message routes and policies
- **Quick Navigation** - Jump between dispatchers, receptors, and perspectives
- **Cross-Service Support** - Navigate across microservice boundaries

## Requirements

- Visual Studio Code 1.85.0 or higher
- .NET SDK 9.0 or higher
- Whizbang library v0.2.0 or higher

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac)
3. Search for "Whizbang"
4. Click "Install"

### From VSIX file

```bash
code --install-extension whizbang-0.1.0.vsix
```

## Development

### Prerequisites

Install pnpm globally:
```bash
npm install -g pnpm
# or
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

### Building

```bash
# Install dependencies
pnpm install

# Compile TypeScript
pnpm run compile

# Watch mode for development
pnpm run watch
```

### Packaging & Installation

```bash
# Package as VSIX file
pnpm run package

# Install in your VSCode (first time)
pnpm run install-local

# Update installed extension (after making changes)
pnpm run reinstall
```

After running `install-local` or `reinstall`, **restart VSCode** to activate the extension.

## Usage

### Viewing Message Flow Annotations

Open any C# file with Whizbang messages (commands or events). You'll see inline annotations:

```csharp
// Whizbang: ↑ 2 dispatchers | ↓ 3 receptors | 📊 4 perspectives
public record OrderCreatedEvent : IEvent {
    public string OrderId { get; init; }
}
```

**Click** on the annotation to:
- Navigate to dispatchers
- Navigate to receptors
- Navigate to perspectives
- Show flow diagram

### Commands

- `Whizbang: Go to Dispatcher` - Jump to message dispatcher
- `Whizbang: Go to Receptor` - Jump to message receptor
- `Whizbang: Go to Perspective` - Jump to perspective (read model)
- `Whizbang: Find Message Usages` - Find all usages of a message
- `Whizbang: Show Flow Diagram` - Visual message flow diagram
- `Whizbang: Refresh Message Registry` - Rebuild message registry

### Configuration

```json
{
  "whizbang.enableCodeLens": true,
  "whizbang.enableHoverInfo": true,
  "whizbang.messageRegistryPath": ".whizbang/message-registry.json",
  "whizbang.autoGenerateRegistry": true
}
```

## How It Works

The extension uses a Roslyn analyzer to scan your codebase and build a **message registry** that maps:

- **Messages** → **Dispatchers** (who sends them)
- **Messages** → **Receptors** (who handles commands)
- **Events** → **Perspectives** (who updates read models)

This registry is generated at build time and stored in `.whizbang/message-registry.json`.

## Troubleshooting

### Extension not showing annotations

1. Ensure you have a `.csproj` file in your workspace
2. Build your project: `dotnet build`
3. Check for `.whizbang/message-registry.json` file
4. Run command: `Whizbang: Refresh Message Registry`

### Message registry not updating

The message registry is regenerated on build. If it's not updating:

1. Clean and rebuild: `dotnet clean && dotnet build`
2. Check MSBuild output for analyzer errors
3. Ensure Whizbang library is referenced

## Contributing

See [PLAN.md](PLAN.md) for the complete implementation plan.

Contributions are welcome! Please see [CONTRIBUTING.md](https://github.com/whizbang-lib/whizbang-vscode/blob/main/CONTRIBUTING.md).

## License

MIT - See [LICENSE](LICENSE)

## Links

- [Whizbang Library](https://github.com/whizbang-lib/whizbang)
- [Documentation](https://whizbang-lib.github.io)
- [Report Issues](https://github.com/whizbang-lib/whizbang-vscode/issues)
