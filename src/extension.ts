import * as vscode from 'vscode';
import * as path from 'path';
import { WhizbangOutputChannel } from './outputChannel';
import { DataLoader } from './dataLoader';
import { RegistryLoader } from './registryLoader';
import { MessageCodeLensProvider } from './codeLensProvider';
import { MessageHoverProvider } from './hoverProvider';
import { TypeDocsProvider } from './typeDocsProvider';
import { MessageInfo, CodeLocation, TestInfo } from './types';
import { renderAnsiBanner } from './banner';
import { DocSearchProvider } from './docSearchProvider';

let registryLoader: RegistryLoader;
let typeDocsProvider: TypeDocsProvider;
let dataLoader: DataLoader;

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

  // 4. Initialize RegistryLoader (pass output channel)
  registryLoader = new RegistryLoader(output);
  const initialized = await registryLoader.initialize();

  // 5. Log registry status
  if (!initialized) {
    output.warn('No message registries found. Build your project to generate them.');
    // Extension stays active but provides no features from the registry
  } else {
    const registry = registryLoader.getRegistry();
    output.log(`Registry loaded: ${registry.messages.length} message(s)`);
  }

  // 6. Initialize DataLoader (pass context + output channel)
  dataLoader = new DataLoader(context, output);
  context.subscriptions.push(dataLoader);

  // 7. Trigger eager preload
  dataLoader.preload().then(() => {
    // 8. Log data load status
    output.log('DataLoader: Eager preload complete');
  }).catch(err => {
    output.error('DataLoader: Eager preload failed', err instanceof Error ? err : undefined);
  });

  // 9. Register providers (pass output channel)

  // Register CodeLens provider
  const codeLensProvider = new MessageCodeLensProvider(registryLoader, output);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'csharp', scheme: 'file' },
      codeLensProvider
    )
  );

  // Initialize type docs provider (delegates to DataLoader)
  typeDocsProvider = new TypeDocsProvider(context, dataLoader, output);
  typeDocsProvider.initialize().catch(err => {
    output.error('Type docs provider initialization failed', err instanceof Error ? err : undefined);
  });

  // Register Hover provider
  const hoverProvider = new MessageHoverProvider(registryLoader, output, typeDocsProvider);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: 'csharp', scheme: 'file' }, hoverProvider)
  );

  // Register navigation commands
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
      const message = await getMessageAtCursor();
      if (message) {
        await showLocations(message.dispatchers, 'Dispatchers');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.goToReceptor', async () => {
      const message = await getMessageAtCursor();
      if (message) {
        await showLocations(message.receptors, 'Receptors');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.goToPerspective', async () => {
      const message = await getMessageAtCursor();
      if (message) {
        await showLocations(message.perspectives, 'Perspectives');
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

  // Register documentation search
  const docSearch = new DocSearchProvider(dataLoader, output);
  context.subscriptions.push(
    vscode.commands.registerCommand('whizbang.searchDocs', () => docSearch.showSearch())
  );

  // Add cleanup
  context.subscriptions.push(registryLoader);
  context.subscriptions.push(codeLensProvider);
  context.subscriptions.push(typeDocsProvider);

  // 10. Log "Ready in Xms"
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

async function getMessageAtCursor(): Promise<MessageInfo | undefined> {
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
  return registryLoader.findMessage(word);
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
