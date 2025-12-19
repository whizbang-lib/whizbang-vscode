# Whizbang VSCode Extension - Testing Guide

## Overview

This guide explains how to test the Whizbang VSCode extension with the master message registry generated from the ECommerce sample project.

---

## Prerequisites

1. **Build the ECommerce sample** to generate the master registry:
   ```bash
   cd /Users/philcarbone/src/whizbang/samples/ECommerce
   dotnet build
   ```

2. **Verify master registry exists**:
   ```bash
   cat /Users/philcarbone/src/whizbang/samples/ECommerce/.whizbang/message-registry.json | python3 -m json.tool | head -50
   ```

   Should show 6 messages with their dispatchers, receptors, and perspectives.

3. **Compile the extension**:
   ```bash
   cd /Users/philcarbone/src/whizbang-vscode
   pnpm run compile
   ```

---

## Testing Method 1: Extension Development Host (Recommended)

This method launches a new VSCode window with the extension loaded for testing.

### Steps

1. **Open extension in VSCode**:
   ```bash
   cd /Users/philcarbone/src/whizbang-vscode
   code .
   ```

2. **Launch Extension Development Host**:
   - Press `F5` (or `Run > Start Debugging`)
   - A new VSCode window will open with "[Extension Development Host]" in the title

3. **Open the ECommerce sample**:
   - In the Extension Development Host window: `File > Open Folder...`
   - Navigate to `/Users/philcarbone/src/whizbang/samples/ECommerce`
   - Open the folder

4. **Verify extension activation**:
   - The extension should activate automatically (C# files present)
   - Check the Output panel: `View > Output`, select "Whizbang" from dropdown
   - Should see logs like:
     ```
     Whizbang extension is now active!
     Found 1 registry file(s): /Users/philcarbone/src/whizbang/samples/ECommerce/.whizbang/message-registry.json
     Merged 1 registries into 6 unique messages
     Total: 4 dispatchers, 3 receptors, 2 perspectives
     ```

5. **Test Code Lens annotations**:
   - Open a message file: `ECommerce.Contracts/Commands/CreateOrderCommand.cs`
   - Should see inline annotations above the class:
     - "0 dispatchers" (or "1 dispatcher" with link)
     - "1 receptor" (with link)
     - "0 perspectives"

6. **Test Hover tooltips**:
   - Hover over `CreateOrderCommand` class name
   - Should see rich markdown tooltip with:
     - Message type (Command)
     - List of receptors with file locations
     - Clickable links to navigate

7. **Test Navigation commands**:
   - Place cursor on `CreateOrderCommand`
   - Open Command Palette: `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Whizbang: Go to Receptor"
   - Should navigate to `CreateOrderReceptor.HandleAsync` at line 19

8. **Test with an Event**:
   - Open `ECommerce.Contracts/Events/OrderCreatedEvent.cs`
   - Should see:
     - "1 dispatcher" (from CreateOrderReceptor)
     - "0 receptors" (events don't have receptors)
     - "2 perspectives" (InventoryWorker, NotificationWorker)

---

## Testing Method 2: Install Locally (Production-like)

This method installs the extension into your actual VSCode instance.

### Steps

1. **Package the extension**:
   ```bash
   cd /Users/philcarbone/src/whizbang-vscode
   pnpm run package
   ```

   Creates `whizbang-0.1.0.vsix`

2. **Install the extension**:
   ```bash
   code --install-extension whizbang-0.1.0.vsix
   ```

3. **Reload VSCode**:
   - `Cmd+Shift+P` → "Developer: Reload Window"

4. **Open ECommerce sample**:
   ```bash
   code /Users/philcarbone/src/whizbang/samples/ECommerce
   ```

5. **Verify same features as Method 1**

6. **Uninstall when done**:
   ```bash
   code --uninstall-extension whizbang-lib.whizbang
   ```

---

## Expected Behavior

### Messages in Registry

The master registry should contain these 6 messages:

1. **CreateOrderCommand** (Command)
   - 0 dispatchers
   - 1 receptor: CreateOrderReceptor.HandleAsync (OrderService.API)
   - 0 perspectives

2. **OrderCreatedEvent** (Event)
   - 1 dispatcher: CreateOrderReceptor.HandleAsync (OrderService.API)
   - 0 receptors
   - 2 perspectives:
     - OrderInventoryPerspective.Update (InventoryWorker)
     - OrderNotificationPerspective.Update (NotificationWorker)

3. **ReserveInventoryCommand** (Command)
   - 1 dispatcher: OrderInventoryPerspective.Update (InventoryWorker)
   - 1 receptor: ReserveInventoryReceptor.HandleAsync (InventoryWorker)
   - 0 perspectives

4. **InventoryReservedEvent** (Event)
   - 1 dispatcher: ReserveInventoryReceptor.HandleAsync (InventoryWorker)
   - 0 receptors
   - 0 perspectives

5. **SendNotificationCommand** (Command)
   - 1 dispatcher: OrderNotificationPerspective.Update (NotificationWorker)
   - 1 receptor: SendNotificationReceptor.HandleAsync (NotificationWorker)
   - 0 perspectives

6. **NotificationSentEvent** (Event)
   - 1 dispatcher: SendNotificationReceptor.HandleAsync (NotificationWorker)
   - 0 receptors
   - 0 perspectives

### Code Lens Annotations

For each message type, you should see inline annotations showing counts and providing clickable links:

```csharp
// 0 dispatchers | 1 receptor | 0 perspectives
public record CreateOrderCommand(string OrderId, string CustomerId) : ICommand<OrderCreatedEvent>;
```

### Hover Tooltips

Rich markdown tooltips with:
- **Message Type**: Command/Event
- **Dispatchers**: List of locations that send/publish this message
- **Receptors**: List of handlers (commands only)
- **Perspectives**: List of observers (events only)
- **Clickable links** to navigate to each location

### Navigation Commands

All commands accessible via Command Palette:
- `Whizbang: Go to Dispatcher` - Navigate to message sender
- `Whizbang: Go to Receptor` - Navigate to command handler
- `Whizbang: Go to Perspective` - Navigate to event observer
- `Whizbang: Find Message Usages` - Show all usages
- `Whizbang: Show Flow Diagram` - (Future feature)
- `Whizbang: Refresh Message Registry` - Reload registry from disk

---

## Troubleshooting

### Extension Not Activating

**Symptom**: No Code Lens or hover tooltips appear

**Checks**:
1. Verify C# files are open (extension only activates for C# projects)
2. Check Output panel (View > Output, select "Whizbang")
3. Verify registry file exists:
   ```bash
   ls -la /Users/philcarbone/src/whizbang/samples/ECommerce/.whizbang/message-registry.json
   ```

### Registry Not Found

**Symptom**: Warning "No message-registry.json files found"

**Solution**:
```bash
cd /Users/philcarbone/src/whizbang/samples/ECommerce
dotnet clean && dotnet build
```

### Empty Registry

**Symptom**: Registry found but shows 0 messages

**Solution**: Check registry content manually:
```bash
cat /Users/philcarbone/src/whizbang/samples/ECommerce/.whizbang/message-registry.json | python3 -m json.tool
```

If empty, rebuild with diagnostics:
```bash
dotnet clean && dotnet build -v detailed
```

### Code Lens Not Showing

**Symptom**: Registry loaded but Code Lens annotations don't appear

**Checks**:
1. Verify setting: `whizbang.enableCodeLens` is `true`
   - `Cmd+,` → Search "Whizbang" → Check "Enable Code Lens"
2. Reload window: `Cmd+Shift+P` → "Developer: Reload Window"

### File Navigation Fails

**Symptom**: Clicking Code Lens link shows "File not found"

**Cause**: File paths in registry are absolute, but extension expects relative paths

**Solution**: This is a known issue - file paths should be workspace-relative. Future fix required.

---

## Quick Verification Checklist

Use this checklist to verify the extension works correctly:

- [ ] Extension compiles without errors (`pnpm run compile`)
- [ ] Master registry exists and contains 6 messages
- [ ] Extension Development Host launches successfully (F5)
- [ ] Extension activates when opening ECommerce sample
- [ ] Output panel shows registry loaded with correct message count
- [ ] Code Lens annotations appear on message types
- [ ] Hover tooltips display message information
- [ ] Navigation commands work (Go to Receptor, etc.)
- [ ] Links in Code Lens are clickable and navigate correctly
- [ ] Multiple receptors/perspectives show as list in tooltips

---

## Success Criteria

The extension is working correctly if:

1. ✅ Registry auto-discovers the master file at `.whizbang/message-registry.json`
2. ✅ Merges multiple registry files if present (though only 1 master in this case)
3. ✅ Displays Code Lens annotations with correct counts
4. ✅ Shows rich hover tooltips with clickable links
5. ✅ Navigation commands work without errors
6. ✅ File watcher reloads registry when source files change and project rebuilds

---

## Next Steps

After verifying the extension works:

1. **Test with multiple projects** - Add more projects to the sample solution
2. **Test file watching** - Make a code change, rebuild, verify registry updates
3. **Test error handling** - Delete registry file, verify graceful degradation
4. **Test performance** - Open large solution, verify extension remains responsive

---

## Notes

- The extension uses the **pattern** `**/.whizbang/message-registry.json` to find all registry files
- It automatically **merges** multiple registries if projects have their own partial registries
- File paths in the registry are **absolute** - this may need to be changed to workspace-relative for cross-machine compatibility
- The extension **watches** registry files and reloads automatically on changes
