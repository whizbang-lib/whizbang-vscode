import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { WhizbangOutputChannel } from './outputChannel';
import { SearchResult, SymbolInfo, TestEntry, StatusInfo } from './types';

export class WhizbangLspClient implements vscode.Disposable {
  private client: LanguageClient | undefined;
  private output: WhizbangOutputChannel;
  private _onRegistryChanged = new vscode.EventEmitter<{ messageCount: number }>();
  public readonly onRegistryChanged = this._onRegistryChanged.event;

  constructor(output: WhizbangOutputChannel) {
    this.output = output;
  }

  async start(context: vscode.ExtensionContext): Promise<boolean> {
    // Find the C# server
    // Try multiple locations:
    // 1. whizbang.languageServerPath setting (explicit path)
    // 2. Sibling repo: ../whizbang/tools/Whizbang.LanguageServer
    // 3. Workspace: tools/Whizbang.LanguageServer

    const config = vscode.workspace.getConfiguration('whizbang');
    const serverPath = config.get<string>('languageServerPath', '');

    let serverCommand: string;
    let serverArgs: string[];

    if (serverPath) {
      // Explicit path to published server binary
      serverCommand = serverPath;
      serverArgs = [];
    } else {
      // Try dotnet run with the project
      // Look for the server project relative to workspace
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let projectPath = '';

      if (workspaceFolders) {
        for (const folder of workspaceFolders) {
          // Check sibling whizbang repo
          const siblingPath = path.resolve(folder.uri.fsPath, '..', 'whizbang', 'tools', 'Whizbang.LanguageServer', 'Whizbang.LanguageServer.csproj');
          const parentPath = path.resolve(folder.uri.fsPath, 'tools', 'Whizbang.LanguageServer', 'Whizbang.LanguageServer.csproj');

          // Try both
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(siblingPath));
            projectPath = siblingPath;
            break;
          } catch {
            // Not found, try next
          }
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(parentPath));
            projectPath = parentPath;
            break;
          } catch {
            // Not found, try next
          }
        }
      }

      if (!projectPath) {
        this.output.warn('Language server not found — running in standalone mode. Flow diagrams and debug keepalive require the server.');
        return false;
      }

      serverCommand = 'dotnet';
      serverArgs = ['run', '--project', projectPath, '--no-build'];
    }

    const serverOptions: ServerOptions = {
      run: { command: serverCommand, args: serverArgs, transport: TransportKind.stdio },
      debug: { command: serverCommand, args: serverArgs, transport: TransportKind.stdio }
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ scheme: 'file', language: 'csharp' }],
      initializationOptions: {
        docsBaseUrl: config.get<string>('docsBaseUrl', 'https://whizbang-lib.github.io'),
        cacheTtlHours: config.get<number>('docsCacheTtlHours', 24),
        storageUri: context.storageUri?.fsPath || '',
        localLibraryPath: config.get<string>('localLibraryPath', ''),
        libraryRepoUrl: config.get<string>('libraryRepoUrl', 'https://github.com/whizbang-lib/whizbang/blob/develop/'),
      },
      synchronize: {
        // Watch both the new .whizbang-generated/ location and the legacy .whizbang/ location.
        fileEvents: vscode.workspace.createFileSystemWatcher('**/.whizbang{-generated,}/message-registry.json')
      }
    };

    this.client = new LanguageClient('whizbang', 'Whizbang Language Server', serverOptions, clientOptions);

    // Handle notifications
    this.client.onNotification('whizbang/log', (params: { level: string; message: string }) => {
      if (params.level === 'warn') { this.output.warn(`[Server] ${params.message}`); }
      else if (params.level === 'error') { this.output.error(`[Server] ${params.message}`); }
      else { this.output.log(`[Server] ${params.message}`); }
    });

    this.client.onNotification('whizbang/registryChanged', (params: { messageCount: number }) => {
      this._onRegistryChanged.fire(params);
    });

    this.client.onNotification('whizbang/dataLoaded', (params: { key: string; count: number }) => {
      this.output.log(`[Server] Data loaded: ${params.key} (${params.count} entries)`);
    });

    try {
      await this.client.start();
      this.output.log('Language server started');
      return true;
    } catch (err) {
      this.output.error('Failed to start language server', err instanceof Error ? err : undefined);
      this.client = undefined;
      return false;
    }
  }

  get isRunning(): boolean {
    return this.client?.isRunning() ?? false;
  }

  // Custom request helpers
  async searchDocs(query: string): Promise<SearchResult[]> {
    if (!this.client?.isRunning()) { return []; }
    return this.client.sendRequest('whizbang/searchDocs', { query });
  }

  async getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
    if (!this.client?.isRunning()) { return null; }
    return this.client.sendRequest('whizbang/getSymbolInfo', { symbol });
  }

  async getTestsForSymbol(symbol: string): Promise<TestEntry[]> {
    if (!this.client?.isRunning()) { return []; }
    return this.client.sendRequest('whizbang/getTestsForSymbol', { symbol });
  }

  async generateFlowDiagram(messageType: string): Promise<{ mermaidCode: string } | null> {
    if (!this.client?.isRunning()) { return null; }
    return this.client.sendRequest('whizbang/generateFlowDiagram', { messageType });
  }

  async getStatus(): Promise<StatusInfo | null> {
    if (!this.client?.isRunning()) { return null; }
    return this.client.sendRequest('whizbang/getStatus', {});
  }

  async notifyDebugPaused(): Promise<void> {
    if (!this.client?.isRunning()) { return; }
    this.client.sendNotification('whizbang/debugSessionPaused', {});
  }

  async notifyDebugResumed(): Promise<void> {
    if (!this.client?.isRunning()) { return; }
    this.client.sendNotification('whizbang/debugSessionResumed', {});
  }

  dispose(): void {
    this.client?.stop();
    this._onRegistryChanged.dispose();
  }
}
