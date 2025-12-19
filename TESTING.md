# Testing the Whizbang VSCode Extension

This guide walks you through testing the extension locally during development.

## Quick Start (TL;DR)

```bash
# 0. Install pnpm if not already installed
npm install -g pnpm

# 1. Build the sample project to generate the registry
cd /Users/philcarbone/src/whizbang/samples/ECommerce
dotnet build

# 2. Open the extension in VSCode
cd /Users/philcarbone/src/whizbang-vscode
code .

# 3. Press F5 to launch Extension Development Host
# 4. In the new window, open the sample project
# File → Open Folder → /Users/philcarbone/src/whizbang/samples/ECommerce
```

## Detailed Testing Steps

### Step 1: Prepare the Sample Project

The extension needs a Whizbang project with a generated message registry.

```bash
# Navigate to sample project
cd /Users/philcarbone/src/whizbang/samples/ECommerce

# Build all projects
dotnet build

# Verify registry was generated
ls -la ECommerce.OrderService.API/.whizbang/message-registry.json
```

**Expected output**: You should see `message-registry.json` file created.

### Step 2: Open Extension in VSCode

```bash
# Open the extension project
cd /Users/philcarbone/src/whizbang-vscode
code .
```

### Step 3: Install Dependencies (First Time Only)

```bash
pnpm install
```

This installs VSCode extension development dependencies using pnpm (fast and disk-efficient).

### Step 4: Compile TypeScript

```bash
pnpm run compile
```

Or use watch mode for automatic recompilation:

```bash
pnpm run watch
```

Keep this terminal running during development.

### Step 5: Launch Extension Development Host

**Method 1: Keyboard Shortcut**
- Press `F5` in VSCode

**Method 2: Command Palette**
- Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
- Type "Debug: Start Debugging"
- Select it

**Method 3: Debug Panel**
- Click the Debug icon in the sidebar (bug icon)
- Click the green play button

**What Happens:**
- A new VSCode window opens (Extension Development Host)
- The extension is loaded in this window
- Console output appears in the original window's Debug Console

### Step 6: Open Sample Project in Extension Host

In the **Extension Development Host** window:

```
File → Open Folder → /Users/philcarbone/src/whizbang/samples/ECommerce
```

### Step 7: Verify Extension Activated

Check the Debug Console in the **original VSCode window**:

```
Whizbang extension is now active!
```

### Step 8: Test Features

#### Test 1: Code Lens

1. Open a message file that exists in the registry
2. **Expected**: You should see Code Lens annotations above message types
3. Click annotations to navigate

#### Test 2: Hover Tooltips

1. Hover over a message type name
2. **Expected**: Rich markdown tooltip with:
   - Message type and kind
   - Dispatchers list
   - Receptors list
   - Perspectives list (events only)
   - Clickable "go to source" links

3. Click links to navigate

#### Test 3: Navigation Commands

1. Place cursor on a message type name
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Type "Whizbang"
4. **Expected**: See commands:
   - Whizbang: Go to Dispatcher
   - Whizbang: Go to Receptor
   - Whizbang: Go to Perspective
5. Select a command and verify navigation

#### Test 4: File Watching

1. Make a change to trigger rebuild
2. Rebuild the project: `dotnet build`
3. **Expected**: Extension reloads registry automatically
4. Check Debug Console for: `Registry file changed, reloading...`

## Troubleshooting

### Extension Doesn't Activate

**Check:**
1. Registry file exists: `.whizbang/message-registry.json`
2. Workspace folder is open (not individual files)
3. No errors in Debug Console

**Fix:**
```bash
# Rebuild sample project
cd /Users/philcarbone/src/whizbang/samples/ECommerce
dotnet clean
dotnet build

# Verify registry
cat */. whizbang/message-registry.json
```

### Code Lens Not Showing

**Check:**
1. Registry contains messages
2. File is C# (`.cs` extension)
3. VSCode CodeLens setting enabled

**Fix:**
```
File → Preferences → Settings
Search: "codelens"
Ensure "Editor › Code Lens" is enabled
```

### TypeScript Compilation Errors

**Check:**
1. Node modules installed
2. TypeScript version compatible

**Fix:**
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm run compile
```

### Debugger Not Attaching

**Check:**
1. Launch configuration exists (`.vscode/launch.json`)
2. Extension compiled successfully
3. No other instance of Extension Development Host running

**Fix:**
- Close all Extension Development Host windows
- Press F5 again

## Development Workflow

### Typical Development Cycle

```bash
# Terminal 1: Watch mode for TypeScript
cd /Users/philcarbone/src/whizbang-vscode
pnpm run watch

# Terminal 2: Sample project
cd /Users/philcarbone/src/whizbang/samples/ECommerce

# Make changes to extension code
# Save files (TypeScript auto-compiles)
# Reload Extension Development Host (Ctrl+R / Cmd+R)
# Test the changes
```

### Quick Test Iteration

1. **Make code change** in `src/*.ts`
2. **Save file** (watch mode auto-compiles)
3. **Reload Extension Host**: `Ctrl+R` / `Cmd+R`
4. **Test feature**
5. Repeat

## Testing Checklist

### ✅ Extension Activation
- [ ] Extension activates when opening project with registry
- [ ] Console shows "Whizbang extension is now active!"
- [ ] Warning shown when registry missing

### ✅ Code Lens
- [ ] Annotations appear on message types
- [ ] Dispatcher count shown with 📤 emoji
- [ ] Receptor count shown with 🎯 emoji
- [ ] Perspective count shown with 👁️ emoji (events only)
- [ ] Clicking navigates to correct location
- [ ] Quick pick shown for multiple locations

### ✅ Hover Tooltips
- [ ] Tooltip appears on hover over message type
- [ ] Shows correct emoji (📬 for commands, 📣 for events)
- [ ] Lists all dispatchers with navigation links
- [ ] Lists all receptors with navigation links
- [ ] Lists all perspectives with navigation links (events only)
- [ ] "go to source" links work correctly

### ✅ Navigation Commands
- [ ] "Go to Dispatcher" command works
- [ ] "Go to Receptor" command works
- [ ] "Go to Perspective" command works
- [ ] Commands disabled when no message at cursor
- [ ] Quick pick shows correct locations
- [ ] Navigation opens correct file and line

### ✅ File Watching
- [ ] Registry reloads on file change
- [ ] Features update with new registry data
- [ ] No errors on registry deletion
- [ ] Graceful handling of malformed JSON
