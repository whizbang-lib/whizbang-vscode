import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DataLoader } from './dataLoader';
import { RegistryLoader } from './registryLoader';
import { WhizbangOutputChannel } from './outputChannel';

/**
 * Shape of each test entry in code-tests-map.json's codeToTests.
 */
interface TestEntry {
  testFile: string;
  testMethod: string;
  linkSource: string;
}

/**
 * Shape of code-tests-map.json.
 */
interface CodeTestsMap {
  codeToTests: Record<string, TestEntry[]>;
}

const TYPE_DECLARATION_REGEX = /\b(?:class|record|struct|interface|enum)\s+(\w+)/g;

/**
 * CodeLens provider that shows test coverage counts above C# type declarations.
 *
 * Uses code-tests-map.json (loaded lazily via DataLoader) to look up tests
 * for each type found in the current document.
 */
export class TestCoverageProvider implements vscode.CodeLensProvider {
  private testsMap: Map<string, TestEntry[]> | null = null;
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(
    private dataLoader: DataLoader,
    private registryLoader: RegistryLoader,
    private output: WhizbangOutputChannel,
  ) {
    // Refresh code lenses when data loads
    dataLoader.onDataLoaded(key => {
      if (key === 'code-tests-map') {
        this.loadTestsMap();
        this.onDidChangeCodeLensesEmitter.fire();
      }
    });

    // Refresh when registry changes (new types may appear)
    registryLoader.onRegistryChanged(() => {
      this.onDidChangeCodeLensesEmitter.fire();
    });
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('whizbang');
    if (!config.get<boolean>('enableTestCoverage', true)) {
      return [];
    }

    // Lazy load the tests map on first invocation
    if (!this.testsMap) {
      this.loadTestsMap();
    }

    if (!this.testsMap) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    const text = document.getText();

    // Reset regex state
    TYPE_DECLARATION_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = TYPE_DECLARATION_REGEX.exec(text)) !== null) {
      if (token.isCancellationRequested) {
        break;
      }

      const typeName = match[1];
      const tests = this.testsMap.get(typeName);

      if (tests && tests.length > 0) {
        const position = document.positionAt(match.index);
        const range = new vscode.Range(position.line, 0, position.line, 0);
        const count = tests.length;
        const label = count === 1 ? 'test' : 'tests';

        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `\uD83E\uDDEA ${count} ${label}`,
            command: 'whizbang.showTestsForSymbol',
            arguments: [typeName, tests],
          })
        );
      }
    }

    return codeLenses;
  }

  private loadTestsMap(): void {
    const raw = this.dataLoader.get<CodeTestsMap>('code-tests-map');
    if (!raw || !raw.codeToTests) {
      // Trigger lazy load if not available yet
      this.dataLoader.getAsync<CodeTestsMap>('code-tests-map').then(data => {
        if (data?.codeToTests) {
          this.testsMap = new Map(Object.entries(data.codeToTests));
          this.output.log(`TestCoverageProvider: Loaded ${this.testsMap.size} symbol(s) with tests`);
          this.onDidChangeCodeLensesEmitter.fire();
        }
      }).catch(() => {});
      return;
    }

    this.testsMap = new Map(Object.entries(raw.codeToTests));
    this.output.log(`TestCoverageProvider: Loaded ${this.testsMap.size} symbol(s) with tests`);
  }

  public dispose(): void {
    this.onDidChangeCodeLensesEmitter.dispose();
  }
}

/**
 * Shows a QuickPick for test methods associated with a symbol,
 * and navigates to the selected test.
 */
export async function showTestsForSymbol(symbol: string, tests: TestEntry[]): Promise<void> {
  if (tests.length === 0) {
    vscode.window.showInformationMessage(`No tests found for ${symbol}`);
    return;
  }

  const config = vscode.workspace.getConfiguration('whizbang');
  const localLibraryPath = config.get<string>('localLibraryPath', '');
  const testRepoUrl = config.get<string>(
    'testRepoUrl',
    'https://github.com/whizbang-lib/whizbang/blob/develop/',
  );

  const items = tests.map(test => {
    // Extract class name from testFile for display
    const fileName = path.basename(test.testFile, '.cs');
    return {
      label: `$(beaker) ${test.testMethod}`,
      description: test.testFile,
      detail: `Link: ${test.linkSource}`,
      test,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Tests for ${symbol} (${tests.length})`,
    matchOnDescription: true,
  });

  if (!selected) {
    return;
  }

  const test = selected.test;

  // Try local navigation first
  if (localLibraryPath) {
    const localPath = path.join(localLibraryPath, test.testFile);
    if (fs.existsSync(localPath)) {
      const doc = await vscode.workspace.openTextDocument(localPath);
      const editor = await vscode.window.showTextDocument(doc);

      // Try to find the test method in the file
      const text = doc.getText();
      const methodIndex = text.indexOf(test.testMethod);
      if (methodIndex >= 0) {
        const position = doc.positionAt(methodIndex);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      }
      return;
    }
  }

  // Fall back to opening GitHub URL
  const url = `${testRepoUrl}${test.testFile}`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}
