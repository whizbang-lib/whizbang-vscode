# Whizbang VSCode Extension - Architecture

## Overview

The Whizbang VSCode extension provides IDE features for message-driven .NET applications by analyzing a JSON registry generated at build time.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Build Time                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  dotnet build                                                │
│       ↓                                                       │
│  MessageRegistryGenerator (Source Generator)                 │
│       ↓                                                       │
│  MessageRegistry.g.cs (C# with embedded JSON)               │
│       ↓                                                       │
│  Directory.Build.targets (MSBuild)                          │
│       ↓                                                       │
│  .whizbang/message-registry.json                            │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       Runtime (VSCode)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Extension Activation                                        │
│       ↓                                                       │
│  RegistryLoader.initialize()                                │
│       ├─ Find .whizbang/message-registry.json              │
│       ├─ Load and parse JSON                                │
│       └─ Setup FileSystemWatcher                            │
│       ↓                                                       │
│  Register Providers                                          │
│       ├─ CodeLensProvider                                   │
│       ├─ HoverProvider                                      │
│       └─ Commands                                            │
│       ↓                                                       │
│  User Interactions                                           │
│       ├─ Hover → Show tooltip                               │
│       ├─ CodeLens → Navigate                                │
│       └─ Command → Quick pick                               │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. MessageRegistryGenerator (C#)

**Location**: `whizbang/src/Whizbang.Generators/MessageRegistryGenerator.cs`

**Purpose**: Roslyn incremental source generator that discovers message patterns.

**Discovery Process**:

1. **Message Types** (ICommand, IEvent):
   ```csharp
   predicate: node is RecordDeclarationSyntax with BaseList
   transform: Check if implements ICommand or IEvent
   output: { TypeName, IsCommand, IsEvent, FilePath, LineNumber }
   ```

2. **Dispatchers** (SendAsync, PublishAsync):
   ```csharp
   predicate: node is InvocationExpressionSyntax with "SendAsync" or "PublishAsync"
   transform: Extract message type from argument expression
   output: { MessageType, ClassName, MethodName, FilePath, LineNumber }
   ```

3. **Receptors** (IReceptor<TMessage, TResponse>):
   ```csharp
   predicate: node is ClassDeclarationSyntax with BaseList
   transform: Check if implements IReceptor<,>
   output: { MessageType, ClassName, MethodName: "HandleAsync", FilePath, LineNumber }
   ```

4. **Perspectives** (IPerspectiveOf<TEvent>):
   ```csharp
   predicate: node is ClassDeclarationSyntax with BaseList
   transform: Check if implements IPerspectiveOf<>
   output: { ClassName, EventTypes[], FilePath, LineNumber }
   ```

**Output**: Generates `MessageRegistry.g.cs` with JSON embedded as a string constant.

### 2. MSBuild Integration

**Location**: `whizbang/Directory.Build.targets`

**Purpose**: Extract JSON from generated C# file and write to `.whizbang/message-registry.json`.

**Process**:
```xml
<Target Name="ExtractMessageRegistry" AfterTargets="Build">
  1. Check if MessageRegistry.g.cs exists
  2. Use sed to extract JSON from C# verbatim string
  3. Replace escaped quotes ("" → ")
  4. Write to .whizbang/message-registry.json
  5. Log success message
</Target>
```

### 3. Extension Entry Point

**File**: `src/extension.ts`

**Responsibilities**:
- Extension activation/deactivation
- Provider registration
- Command registration
- Lifecycle management

**Activation Sequence**:
```typescript
export async function activate(context: ExtensionContext) {
  1. Initialize RegistryLoader
  2. Register CodeLensProvider for C# files
  3. Register HoverProvider for C# files
  4. Register navigation commands
  5. Add all to context.subscriptions for cleanup
}
```

### 4. Registry Loader

**File**: `src/registryLoader.ts`

**Purpose**: Load, parse, and watch the message registry JSON file.

**Key Methods**:
- `initialize()`: Find and load registry file
- `findRegistryFile()`: Search workspace for `.whizbang/message-registry.json`
- `loadRegistry()`: Parse JSON into MessageRegistry type
- `setupFileWatcher()`: Watch for file changes and reload
- `findMessage(typeName)`: Query by message type name

**File Watching**:
```typescript
this.watcher = vscode.workspace.createFileSystemWatcher(registryPath);
this.watcher.onDidChange(() => this.loadRegistry(registryPath));
```

**Event Emission**:
```typescript
private onRegistryChangedEmitter = new EventEmitter<MessageRegistry>();
public readonly onRegistryChanged = this.onRegistryChangedEmitter.event;
```

### 5. Code Lens Provider

**File**: `src/codeLensProvider.ts`

**Purpose**: Add inline annotations to message types.

**Process**:
```typescript
provideCodeLenses(document, token) {
  1. Get all messages from registry
  2. For each message:
     a. Check if in current file
     b. Create CodeLens at message line
     c. Add dispatcher count with emoji
     d. Add receptor count with emoji
     e. Add perspective count with emoji (events only)
  3. Return array of CodeLens objects
}
```

**CodeLens Creation**:
```typescript
new CodeLens(range, {
  title: `📤 ${dispatchers.length} dispatcher(s)`,
  command: 'whizbang.showDispatchers',
  arguments: [message]
})
```

### 6. Hover Provider

**File**: `src/hoverProvider.ts`

**Purpose**: Show rich markdown tooltips on hover.

**Process**:
```typescript
provideHover(document, position, token) {
  1. Get word at cursor position
  2. Find message by type name
  3. Create markdown with:
     - Header with emoji and type
     - Message kind (Command/Event)
     - Dispatchers list with navigation links
     - Receptors list with navigation links
     - Perspectives list with navigation links
  4. Return Hover with markdown
}
```

**Markdown Format**:
```markdown
### 📬 CreateOrderCommand

**Type:** Command

#### 📤 Dispatched By
- OrderController.CreateOrder() [(go to source)](command:...)

#### 🎯 Handled By
- CreateOrderReceptor.HandleAsync() [(go to source)](command:...)
```

**Navigation Links**:
```typescript
const args = encodeURIComponent(JSON.stringify({
  filePath: location.filePath,
  lineNumber: location.lineNumber
}));
return `[(go to source)](command:whizbang.navigateToLocation?${args})`;
```

### 7. Navigation Commands

**Implemented in**: `src/extension.ts`

**Commands**:
1. `whizbang.navigateToLocation`: Core navigation
2. `whizbang.showDispatchers`: Show dispatcher quick pick
3. `whizbang.showReceptors`: Show receptor quick pick
4. `whizbang.showPerspectives`: Show perspective quick pick
5. `whizbang.goToDispatcher`: Navigate from current position
6. `whizbang.goToReceptor`: Navigate from current position
7. `whizbang.goToPerspective`: Navigate from current position

**Navigation Process**:
```typescript
async function navigateToLocation(filePath, lineNumber) {
  1. Find file in workspace folders
  2. Open document
  3. Show in editor
  4. Move cursor to line
  5. Reveal range in center
}
```

**Quick Pick**:
```typescript
async function showLocations(locations, kind) {
  1. If 0 locations: show info message
  2. If 1 location: navigate directly
  3. If multiple: show quick pick with:
     - Label: Class.Method
     - Description: FilePath:LineNumber
  4. Navigate to selected location
}
```

## Type Definitions

### TypeScript Types

```typescript
export interface CodeLocation {
  class: string;
  method: string;
  filePath: string;
  lineNumber: number;
}

export interface MessageInfo {
  type: string;
  isCommand: boolean;
  isEvent: boolean;
  filePath: string;
  lineNumber: number;
  dispatchers: CodeLocation[];
  receptors: CodeLocation[];
  perspectives: CodeLocation[];
}

export interface MessageRegistry {
  messages: MessageInfo[];
}
```

## Performance Considerations

### Registry Loading
- **Single load** on activation
- **Incremental reload** on file change
- **In-memory cache** for fast queries

### Provider Performance
- **CodeLens**: O(n) where n = messages in registry
- **Hover**: O(1) lookup by type name
- **Navigation**: O(1) file open + seek

### File Watching
- Single watcher per registry file
- Debounced reload on change
- No polling, event-driven

## Dependencies

### Runtime
- **VSCode Engine**: ^1.85.0
- **TypeScript**: Project dependency
- **Node.js**: Runtime for extension

### Build Time
- **TypeScript Compiler**: Transpilation
- **pnpm**: Fast, disk-efficient package management

### No External Libraries
- Pure TypeScript + VSCode API
- No additional packages beyond VSCode API
- Minimal footprint
