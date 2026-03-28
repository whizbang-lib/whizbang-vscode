import * as vscode from 'vscode';
import * as path from 'path';
import { WhizbangOutputChannel } from './outputChannel';
import { WhizbangLspClient } from './lspClient';
import { MessageInfo, CodeLocation, TestInfo, TestEntry, SymbolInfo } from './types';
import { renderAnsiBanner } from './banner';
import { DocSearchProvider } from './docSearchProvider';
import { showFlowDiagramPanel } from './views/flowDiagramPanel';
import { StatusBarProvider } from './statusBarProvider';

let lspClient: WhizbangLspClient;

export async function activate(context: vscode.ExtensionContext) {
  const startTime = Date.now();

  // 1. Create output channel FIRST
  const output = WhizbangOutputChannel.getInstance();
  context.subscriptions.push(output);

  // 2. Log startup
  output.log('Whizbang extension activating...');

  // 3. Log settings
  const config = vscode.workspace.getConfiguration('whizbang');
  const docsBaseUrl = config.get<string>('docsBaseUrl', 'https://whizbang-lib.github.io');
  const cacheTtl = config.get<number>('docsCacheTtlHours', 24);
  output.log(`Settings: docsBaseUrl=${docsBaseUrl}, cacheTtlHours=${cacheTtl}`);

  // Show branded banner in a terminal on startup
  _showBannerTerminal(context);

  // 4. Initialize LSP client (graceful degradation if server unavailable)
  lspClient = new WhizbangLspClient(output);
  context.subscriptions.push(lspClient);

  const serverStarted = await lspClient.start(context);
  if (!serverStarted) {
    output.warn('Language server not available. Navigation commands still work, but hover, CodeLens, search, and flow diagrams require the server.');
  }

  // 5. Register navigation commands (work with or without server)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'whizbang.navigateToLocation',
      async (args: { filePath: string; lineNumber: number }) => {
        await navigateToLocation(args.filePath, args.lineNumber);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.showDispatchers', async (message: MessageInfo) => {
      await showLocations(message.dispatchers, 'Dispatchers');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.showReceptors', async (message: MessageInfo) => {
      await showLocations(message.receptors, 'Receptors');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.showPerspectives', async (message: MessageInfo) => {
      await showLocations(message.perspectives, 'Perspectives');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.goToDispatcher', async () => {
      const info = await getSymbolAtCursor();
      if (info) {
        if (info.dispatcherCount > 0) {
          vscode.window.showInformationMessage(`${info.name}: ${info.dispatcherCount} dispatcher(s) — use CodeLens to navigate`);
        } else {
          vscode.window.showInformationMessage(`No dispatchers found for ${info.name}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.goToReceptor', async () => {
      const info = await getSymbolAtCursor();
      if (info) {
        if (info.receptorCount > 0) {
          vscode.window.showInformationMessage(`${info.name}: ${info.receptorCount} receptor(s) — use CodeLens to navigate`);
        } else {
          vscode.window.showInformationMessage(`No receptors found for ${info.name}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.goToPerspective', async () => {
      const info = await getSymbolAtCursor();
      if (info) {
        if (info.perspectiveCount > 0) {
          vscode.window.showInformationMessage(`${info.name}: ${info.perspectiveCount} perspective(s) — use CodeLens to navigate`);
        } else {
          vscode.window.showInformationMessage(`No perspectives found for ${info.name}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.showTests', async (message: MessageInfo) => {
      await showTestLocations(message.tests || [], 'Tests');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.openDocs', async (docsUrl: string) => {
      await vscode.env.openExternal(vscode.Uri.parse(docsUrl));
    })
  );

  // Register test navigation command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'whizbang.showTestsForSymbol',
      async (symbol: string, tests: TestEntry[]) => {
        if (!tests || tests.length === 0) {
          vscode.window.showInformationMessage(`No tests found for ${symbol}`);
          return;
        }
        const items = tests.map((t: TestEntry) => ({
          label: `${t.testClass || ''}.${t.testMethod}`,
          description: t.testFile,
          test: t,
        }));
        if (items.length === 1) {
          await navigateToLocation(items[0].test.testFile, 1);
          return;
        }
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Select test for ${symbol}`,
        });
        if (selected) {
          await navigateToLocation(selected.test.testFile, 1);
        }
      }
    )
  );

  // Register documentation search (delegates to server)
  const docSearch = new DocSearchProvider(lspClient, output);
  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.searchDocs', () => docSearch.showSearch())
  );

  // Register flow diagram command (delegates to server for mermaid generation)
  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.showFlowDiagram', async () => {
      if (!lspClient.isRunning) {
        vscode.window.showWarningMessage('Whizbang: Language server not available. Cannot generate flow diagram.');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Whizbang: No active editor');
        return;
      }

      const position = editor.selection.active;
      const wordRange = editor.document.getWordRangeAtPosition(position);
      if (!wordRange) {
        vscode.window.showInformationMessage('Whizbang: No message found at cursor position');
        return;
      }

      const word = editor.document.getText(wordRange);
      const result = await lspClient.generateFlowDiagram(word);
      if (result?.mermaidCode) {
        showFlowDiagramPanel(context, word, result.mermaidCode);
      } else {
        vscode.window.showInformationMessage('Whizbang: No flow diagram available for this symbol');
      }
    })
  );

  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.refreshMessageRegistry', async () => {
      if (!lspClient.isRunning) {
        vscode.window.showWarningMessage('Whizbang: Language server not available.');
        return;
      }
      // The server handles registry refresh via file watching;
      // this command can trigger a status check
      const status = await lspClient.getStatus();
      if (status) {
        vscode.window.showInformationMessage(`Whizbang: Registry has ${status.messageCount ?? 0} message(s)`);
      }
    })
  );

  // Register status bar provider (delegates to server)
  const statusBar = new StatusBarProvider(lspClient, output);
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.toggleStatusBar', () => {
      statusBar.toggle();
    })
  );

  // Set initial status bar state
  if (serverStarted) {
    statusBar.updateStatus('ready');
  } else {
    statusBar.updateStatus('no-server');
  }

  // Register debug session listeners
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(() => {
      lspClient.notifyDebugPaused();
    })
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(() => {
      lspClient.notifyDebugResumed();
    })
  );

  // Log "Ready in Xms"
  const elapsed = Date.now() - startTime;
  output.log(`Ready in ${elapsed}ms`);
}

export function deactivate() {
  const output = WhizbangOutputChannel.getInstance();
  output.log('Whizbang extension deactivated');
}

async function navigateToLocation(filePath: string, lineNumber: number): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return;
  }

  let fullPath: string | undefined;

  // Check if path is absolute
  if (path.isAbsolute(filePath)) {
    // Use absolute path directly
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      fullPath = filePath;
    } catch {
      // File not found at absolute path
      vscode.window.showErrorMessage(`File not found: ${filePath}`);
      return;
    }
  } else {
    // Find file in workspace (relative path)
    for (const folder of workspaceFolders) {
      const candidatePath = vscode.Uri.joinPath(folder.uri, filePath).fsPath;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(candidatePath));
        fullPath = candidatePath;
        break;
      } catch {
        // File not found in this workspace folder
      }
    }

    if (!fullPath) {
      vscode.window.showErrorMessage(`File not found: ${filePath}`);
      return;
    }
  }

  // Open document and navigate
  const document = await vscode.workspace.openTextDocument(fullPath);
  const editor = await vscode.window.showTextDocument(document);

  const line = lineNumber - 1; // Convert to 0-based
  const position = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function showLocations(locations: CodeLocation[], kind: string): Promise<void> {
  if (locations.length === 0) {
    vscode.window.showInformationMessage(`No ${kind.toLowerCase()} found`);
    return;
  }

  if (locations.length === 1) {
    await navigateToLocation(locations[0].filePath, locations[0].lineNumber);
    return;
  }

  const items = locations.map(loc => ({
    label: `${loc.class}.${loc.method}`,
    description: `${loc.filePath}:${loc.lineNumber}`,
    location: loc,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Select ${kind.toLowerCase()}`,
  });

  if (selected) {
    await navigateToLocation(selected.location.filePath, selected.location.lineNumber);
  }
}

async function showTestLocations(tests: TestInfo[], kind: string): Promise<void> {
  if (tests.length === 0) {
    vscode.window.showInformationMessage(`No ${kind.toLowerCase()} found`);
    return;
  }

  if (tests.length === 1) {
    await navigateToLocation(tests[0].testFile, tests[0].testLine);
    return;
  }

  const items = tests.map(test => ({
    label: `${test.testClass}.${test.testMethod}`,
    description: `${test.testFile}:${test.testLine}`,
    test: test,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Select ${kind.toLowerCase()}`,
  });

  if (selected) {
    await navigateToLocation(selected.test.testFile, selected.test.testLine);
  }
}

async function getSymbolAtCursor(): Promise<SymbolInfo | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  if (!lspClient.isRunning) {
    vscode.window.showWarningMessage('Whizbang: Language server not available. Cannot resolve message at cursor.');
    return undefined;
  }

  const position = editor.selection.active;
  const wordRange = editor.document.getWordRangeAtPosition(position);
  if (!wordRange) {
    return undefined;
  }

  const word = editor.document.getText(wordRange);
  const info = await lspClient.getSymbolInfo(word);
  if (!info) {
    vscode.window.showInformationMessage('Whizbang: No message found at cursor position');
    return undefined;
  }
  return info;
}

function _showBannerTerminal(context: vscode.ExtensionContext): void {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<void>();

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {
      const banner = renderAnsiBanner();
      writeEmitter.fire(banner);
      writeEmitter.fire('\r\n');
    },
    close: () => {
      // No cleanup needed
    },
  };

  const terminal = vscode.window.createTerminal({
    name: 'Whizbang',
    pty,
    isTransient: true,
  });

  context.subscriptions.push(terminal);
}
