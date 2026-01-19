import * as vscode from 'vscode';
import { RegistryLoader } from './registryLoader';

export class MessageCodeLensProvider implements vscode.CodeLensProvider {
  private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(private registryLoader: RegistryLoader) {
    // Refresh code lenses when registry changes
    registryLoader.onRegistryChanged(() => {
      this.onDidChangeCodeLensesEmitter.fire();
    });
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];
    const registry = this.registryLoader.getRegistry();

    for (const message of registry.messages) {
      // Check if message is defined in current file
      // Normalize both paths for comparison
      const normalizedMessagePath = message.filePath.replace(/\\/g, '/');
      const normalizedDocPath = document.uri.fsPath.replace(/\\/g, '/');

      if (normalizedMessagePath !== normalizedDocPath) {
        continue;
      }

      const line = message.lineNumber - 1; // Convert to 0-based
      const range = new vscode.Range(line, 0, line, 0);

      // Add dispatcher count
      if (message.dispatchers.length > 0) {
        const count = message.dispatchers.length;
        const label = count === 1 ? 'dispatcher' : 'dispatchers';
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `📤 ${count} ${label}`,
            command: 'whizbang.showDispatchers',
            arguments: [message],
          })
        );
      }

      // Add receptor count
      if (message.receptors.length > 0) {
        const count = message.receptors.length;
        const label = count === 1 ? 'receptor' : 'receptors';
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `🎯 ${count} ${label}`,
            command: 'whizbang.showReceptors',
            arguments: [message],
          })
        );
      }

      // Add perspective count (events only)
      if (message.isEvent && message.perspectives.length > 0) {
        const count = message.perspectives.length;
        const label = count === 1 ? 'perspective' : 'perspectives';
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `👁️ ${count} ${label}`,
            command: 'whizbang.showPerspectives',
            arguments: [message],
          })
        );
      }

      // Add test count
      if (message.tests && message.tests.length > 0) {
        const count = message.tests.length;
        const label = count === 1 ? 'test' : 'tests';
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `🧪 ${count} ${label}`,
            command: 'whizbang.showTests',
            arguments: [message],
          })
        );
      }

      // Add documentation link
      if (message.docsUrl) {
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `📚 View Documentation`,
            command: 'whizbang.openDocs',
            arguments: [message.docsUrl],
          })
        );
      }
    }

    return codeLenses;
  }

  public dispose(): void {
    this.onDidChangeCodeLensesEmitter.dispose();
  }
}
