import * as vscode from 'vscode';
import { WhizbangLspClient } from './lspClient';
import { WhizbangOutputChannel } from './outputChannel';

type StatusState = 'loading' | 'ready' | 'no-registry' | 'no-server' | 'error';

/**
 * Provides a status bar item showing Whizbang server status.
 * Click toggles between collapsed and expanded views.
 * Expanded view auto-collapses after 10 seconds.
 */
export class StatusBarProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private expanded = false;
  private collapseTimer: NodeJS.Timeout | undefined;
  private state: StatusState = 'loading';
  private lastMessageCount = 0;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private lspClient: WhizbangLspClient,
    private output: WhizbangOutputChannel,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'whizbang.toggleStatusBar';
    this.updateStatus('loading');
    this.statusBarItem.show();

    // Listen for registry changes from the server
    this.disposables.push(
      this.lspClient.onRegistryChanged((params) => {
        this.lastMessageCount = params.messageCount;
        if (params.messageCount > 0) {
          this.updateStatus('ready');
        } else {
          this.updateStatus('no-registry');
        }
      }),
    );
  }

  /**
   * Update the status bar state and re-render.
   */
  updateStatus(state: StatusState): void {
    this.state = state;
    this.render();
  }

  /**
   * Toggle between collapsed and expanded display.
   */
  toggle(): void {
    if (this.state !== 'ready') {
      return;
    }

    this.expanded = !this.expanded;
    this.render();

    // Clear any existing collapse timer
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = undefined;
    }

    // Auto-collapse after 10 seconds
    if (this.expanded) {
      // Fetch fresh status from server when expanding
      this.lspClient.getStatus().then(status => {
        if (status) {
          this.lastMessageCount = status.messageCount ?? this.lastMessageCount;
          this.render();
        }
      });

      this.collapseTimer = setTimeout(() => {
        this.expanded = false;
        this.render();
        this.collapseTimer = undefined;
      }, 10_000);
    }
  }

  private render(): void {
    switch (this.state) {
      case 'loading':
        this.statusBarItem.text = '$(sync~spin) Whizbang';
        this.statusBarItem.tooltip = this.buildTooltip();
        break;

      case 'ready':
        if (this.expanded) {
          this.statusBarItem.text = `$(check) Whizbang: ${this.lastMessageCount} msgs`;
        } else {
          this.statusBarItem.text = '$(check) Whizbang';
        }
        this.statusBarItem.tooltip = this.buildTooltip();
        break;

      case 'no-registry':
        this.statusBarItem.text = '$(warning) Whizbang';
        this.statusBarItem.tooltip = this.buildTooltip();
        break;

      case 'no-server':
        this.statusBarItem.text = '$(circle-slash) Whizbang';
        this.statusBarItem.tooltip = this.buildTooltip();
        break;

      case 'error':
        this.statusBarItem.text = '$(error) Whizbang';
        this.statusBarItem.tooltip = this.buildTooltip();
        break;
    }
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const version = '0.6.1';
    md.appendMarkdown(`**Whizbang Extension v${version}**\n\n---\n\n`);

    if (this.state === 'loading') {
      md.appendMarkdown('Loading...\n\n');
    } else if (this.state === 'no-registry') {
      md.appendMarkdown('No message registry found. Build your project to generate one.\n\n');
    } else if (this.state === 'no-server') {
      md.appendMarkdown('Language server not available.\n\n');
      md.appendMarkdown('Navigation commands still work, but hover, CodeLens,\n');
      md.appendMarkdown('search, and flow diagrams require the server.\n\n');
    } else if (this.state === 'error') {
      md.appendMarkdown('Error communicating with language server.\n\n');
    } else {
      md.appendMarkdown(`Messages: ${this.lastMessageCount}\n\n`);
      md.appendMarkdown(`Server: connected\n\n`);

      // Cache info
      const config = vscode.workspace.getConfiguration('whizbang');
      const ttlHours = config.get<number>('docsCacheTtlHours', 24);
      md.appendMarkdown(`Cache TTL: ${ttlHours}h\n\n`);
    }

    md.appendMarkdown('---\n\n');
    md.appendMarkdown('Click to expand/collapse');

    return md;
  }

  dispose(): void {
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer);
    }
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
