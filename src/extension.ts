import * as vscode from 'vscode';
import * as path from 'path';
import { WhizbangOutputChannel } from './outputChannel';
import { RegistryLoader } from './registryLoader';
import { DataLoader } from './dataLoader';
import { MessageCodeLensProvider } from './codeLensProvider';
import { MessageHoverProvider } from './hoverProvider';
import { TypeDocsProvider } from './typeDocsProvider';
import { TypeDocIndex } from './typeDocIndex';
import { TestCoverageProvider, showTestsForSymbol } from './testCoverageProvider';
import { XmlDocProvider } from './xmlDocProvider';
import { DocSearchProvider } from './docSearchProvider';
import { WhizbangLspClient } from './lspClient';
import { StatusBarProvider } from './statusBarProvider';
import { MessageInfo, CodeLocation, TestInfo, TestEntry } from './types';
import { renderAnsiBanner, getPlainBanner } from './banner';
import { showFlowDiagramPanel } from './views/flowDiagramPanel';

let registryLoader: RegistryLoader;
let lspClient: WhizbangLspClient | null = null;

export async function activate(context: vscode.ExtensionContext) {
  try {
  const startTime = Date.now();

  // 1. Create output channel FIRST, show banner, and show it
  const output = WhizbangOutputChannel.getInstance();
  context.subscriptions.push(output);

  // Show banner in output channel
  const bannerLines = getPlainBanner();
  for (const line of bannerLines) {
    // Replace regular spaces with non-breaking spaces (U+00A0) to prevent
    // VSCode from rendering indent guides on the banner art
    const cleaned = line.trimEnd().replace(/ /g, '\u00A0');
    output.raw(cleaned.trim() === '' ? '' : cleaned);
  }
  output.raw('');

  output.log('Whizbang extension activating...');
  output.show();

  // 2. Log settings
  const config = vscode.workspace.getConfiguration('whizbang');
  const docsBaseUrl = config.get<string>('docsBaseUrl', 'https://whizbang-lib.github.io');
  const cacheTtl = config.get<number>('docsCacheTtlHours', 24);
  output.log(`Settings: docsBaseUrl=${docsBaseUrl}, cacheTtlHours=${cacheTtl}`);

  // Show branded banner in a terminal on startup
  _showBannerTerminal(context);

  // 3. Initialize RegistryLoader (loads .whizbang/cache/message-registry.json, legacy .whizbang/ fallback)
  registryLoader = new RegistryLoader(output);
  await registryLoader.initialize();

  // 4. Initialize DataLoader (fetches vscode-feed.json, code-docs-map.json)
  const dataLoader = new DataLoader(context, output);
  context.subscriptions.push(dataLoader);
  await dataLoader.preload();

  // 5. Register CodeLensProvider (from local registry)
  const codeLensProvider = new MessageCodeLensProvider(registryLoader, output);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'csharp', scheme: 'file' },
      codeLensProvider,
    )
  );

  // 6. Initialize TypeDocsProvider + TypeDocIndex
  const typeDocsProvider = new TypeDocsProvider(context, dataLoader, output);
  await typeDocsProvider.initialize();
  context.subscriptions.push(typeDocsProvider);

  const typeDocIndex = new TypeDocIndex(dataLoader, output);
  await typeDocIndex.initialize();

  // 7. Initialize XmlDocProvider (member-level docs/tests from NuGet XML)
  // Pass package refs from merged registries for per-project version resolution
  const allPackageRefs = registryLoader.getPackageRefs();
  const xmlDocProvider = new XmlDocProvider(output);
  try {
    await xmlDocProvider.initialize(allPackageRefs.length > 0 ? allPackageRefs : undefined);
  } catch (err) {
    output.error('XmlDocProvider initialization failed', err instanceof Error ? err : new Error(String(err)));
  }
  context.subscriptions.push(xmlDocProvider);

  // 8. Register HoverProvider (from local registry + type docs + XML docs)
  const hoverProvider = new MessageHoverProvider(registryLoader, output, typeDocsProvider, typeDocIndex, xmlDocProvider);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'csharp', scheme: 'file' },
      hoverProvider,
    )
  );

  // 8. Register TestCoverageProvider (from local data)
  const testCoverageProvider = new TestCoverageProvider(dataLoader, registryLoader, output);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'csharp', scheme: 'file' },
      testCoverageProvider,
    )
  );

  // 9. Register DocSearchProvider (local MiniSearch)
  const docSearch = new DocSearchProvider(dataLoader, output);
  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.searchDocs', () => docSearch.showSearch())
  );

  // 10. Register all navigation commands
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
      const message = getMessageAtCursor();
      if (message) {
        if (message.dispatchers.length > 0) {
          await showLocations(message.dispatchers, 'Dispatchers');
        } else {
          vscode.window.showInformationMessage(`No dispatchers found for ${message.type}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.goToReceptor', async () => {
      const message = getMessageAtCursor();
      if (message) {
        if (message.receptors.length > 0) {
          await showLocations(message.receptors, 'Receptors');
        } else {
          vscode.window.showInformationMessage(`No receptors found for ${message.type}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.goToPerspective', async () => {
      const message = getMessageAtCursor();
      if (message) {
        if (message.perspectives.length > 0) {
          await showLocations(message.perspectives, 'Perspectives');
        } else {
          vscode.window.showInformationMessage(`No perspectives found for ${message.type}`);
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

  // Register refresh command (works with local registry)
  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.refreshMessageRegistry', async () => {
      await registryLoader.initialize();
      const count = registryLoader.getRegistry().messages.length;
      vscode.window.showInformationMessage(`Whizbang: Registry refreshed — ${count} message(s)`);
    })
  );

  // 11. Try to start LSP client (non-blocking, graceful failure)
  const lspInstance = new WhizbangLspClient(output);
  context.subscriptions.push(lspInstance);

  const serverStarted = await lspInstance.start(context);
  if (serverStarted) {
    lspClient = lspInstance;
    output.log('Language server connected — enhanced features available');
  } else {
    lspClient = null;
    output.log('Running in standalone mode — all core features active');
  }

  // 12. Register StatusBarProvider (uses registry data, optionally enhanced by LSP)
  const statusBar = new StatusBarProvider(registryLoader, lspClient, output);
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.toggleStatusBar', () => {
      statusBar.toggle();
    })
  );

  // Set initial status bar state
  const messageCount = registryLoader.getRegistry().messages.length;
  if (messageCount > 0) {
    statusBar.updateStatus('ready');
  } else {
    statusBar.updateStatus('no-registry');
  }

  // 13. Register debug session listeners only if LSP is available
  if (lspClient) {
    const client = lspClient;
    context.subscriptions.push(
      vscode.debug.onDidStartDebugSession(() => {
        client.notifyDebugPaused();
      })
    );

    context.subscriptions.push(
      vscode.debug.onDidTerminateDebugSession(() => {
        client.notifyDebugResumed();
      })
    );
  }

  // 14. Flow diagram command: try LSP first, show "server required" if not available
  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.showFlowDiagram', async () => {
      if (!lspClient || !lspClient.isRunning) {
        vscode.window.showWarningMessage('Whizbang: Flow diagrams require the language server. Install and start the Whizbang Language Server for this feature.');
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

  // Log "Ready in Xms"
  const elapsed = Date.now() - startTime;
  output.log(`Ready in ${elapsed}ms`);
  } catch (err) {
    // Catch activation errors so extension doesn't silently fail
    const output = WhizbangOutputChannel.getInstance();
    output.error('Extension activation failed', err instanceof Error ? err : new Error(String(err)));
    output.show();
    vscode.window.showErrorMessage(`Whizbang: Activation failed — ${err instanceof Error ? err.message : String(err)}. Check Output panel for details.`);
  }
}

export function deactivate() {
  const output = WhizbangOutputChannel.getInstance();
  output.log('Whizbang extension deactivated');
}

/**
 * Get the message at the current cursor position using the LOCAL registryLoader.
 */
function getMessageAtCursor(): MessageInfo | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const position = editor.selection.active;
  const wordRange = editor.document.getWordRangeAtPosition(position);
  if (!wordRange) {
    return undefined;
  }

  const word = editor.document.getText(wordRange);
  const message = registryLoader.findMessage(word);
  if (!message) {
    vscode.window.showInformationMessage('Whizbang: No message found at cursor position');
    return undefined;
  }
  return message;
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
