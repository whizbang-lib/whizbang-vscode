import * as vscode from 'vscode';
import { RegistryLoader } from './registryLoader';
import { DataLoader } from './dataLoader';
import { WhizbangOutputChannel } from './outputChannel';
import { MessageRegistry } from './types';

type StatusState = 'loading' | 'ready' | 'no-registry' | 'error';

/**
 * Provides a status bar item showing Whizbang registry status.
 * Click toggles between collapsed and expanded views.
 * Expanded view auto-collapses after 10 seconds.
 */
export class StatusBarProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private expanded = false;
  private collapseTimer: NodeJS.Timeout | undefined;
  private state: StatusState = 'loading';
  private disposables: vscode.Disposable[] = [];

  constructor(
    private registryLoader: RegistryLoader,
    private dataLoader: DataLoader,
    private output: WhizbangOutputChannel,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'whizbang.toggleStatusBar';
    this.updateStatus('loading');
    this.statusBarItem.show();

    // Listen for registry changes
    this.disposables.push(
      this.registryLoader.onRegistryChanged(() => {
        const registry = this.registryLoader.getRegistry();
        if (registry.messages.length > 0) {
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
          const counts = this.getCounts();
          this.statusBarItem.text = `$(check) Whizbang: ${counts.total} msgs | ${counts.commands} cmds | ${counts.events} evts`;
        } else {
          this.statusBarItem.text = '$(check) Whizbang';
        }
        this.statusBarItem.tooltip = this.buildTooltip();
        break;

      case 'no-registry':
        this.statusBarItem.text = '$(warning) Whizbang';
        this.statusBarItem.tooltip = this.buildTooltip();
        break;

      case 'error':
        this.statusBarItem.text = '$(error) Whizbang';
        this.statusBarItem.tooltip = this.buildTooltip();
        break;
    }
  }

  private getCounts(): { total: number; commands: number; events: number } {
    const registry = this.registryLoader.getRegistry();
    const total = registry.messages.length;
    const commands = registry.messages.filter(m => m.isCommand).length;
    const events = registry.messages.filter(m => m.isEvent).length;
    return { total, commands, events };
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const version = '0.6.1';
    md.appendMarkdown(`**Whizbang Extension v${version}**\n\n---\n\n`);

    if (this.state === 'loading') {
      md.appendMarkdown('Loading registry...\n\n');
    } else if (this.state === 'no-registry') {
      md.appendMarkdown('No message registry found. Build your project to generate one.\n\n');
    } else if (this.state === 'error') {
      md.appendMarkdown('Error loading registry.\n\n');
    } else {
      const counts = this.getCounts();
      md.appendMarkdown(`Messages: ${counts.total} (${counts.commands} commands, ${counts.events} events)\n\n`);

      // Type docs info
      const typeDocsFeed = this.dataLoader.get<unknown[]>('vscode-feed');
      const typeDocsCount = Array.isArray(typeDocsFeed) ? typeDocsFeed.length : 0;
      md.appendMarkdown(`Type Docs: ${typeDocsCount} symbols loaded\n\n`);

      // Test coverage info
      const codeTestsMap = this.dataLoader.get<Record<string, unknown>>('code-tests-map');
      let testCount = 0;
      if (codeTestsMap && typeof codeTestsMap === 'object') {
        for (const val of Object.values(codeTestsMap)) {
          if (Array.isArray(val)) {
            testCount += val.length;
          }
        }
      }
      md.appendMarkdown(`Tests: ${testCount.toLocaleString()} mapped\n\n`);

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
