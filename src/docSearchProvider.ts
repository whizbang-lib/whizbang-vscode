import * as vscode from 'vscode';
import { WhizbangLspClient } from './lspClient';
import { WhizbangOutputChannel } from './outputChannel';

/**
 * QuickPick item that carries a slug for navigation.
 */
interface DocQuickPickItem extends vscode.QuickPickItem {
  slug: string;
}

const DEFAULT_BASE_URL = 'https://whizbang-lib.github.io';
const DEBOUNCE_MS = 150;
const PREVIEW_MAX_LENGTH = 120;

/**
 * Provides a QuickPick-based documentation search that delegates
 * to the Whizbang Language Server for search results.
 *
 * Falls back to showing a "server not available" message when
 * the language server is not running.
 */
export class DocSearchProvider {
  constructor(
    private lspClient: WhizbangLspClient,
    private output: WhizbangOutputChannel,
  ) {}

  /**
   * Show the documentation search QuickPick.
   */
  async showSearch(): Promise<void> {
    const config = vscode.workspace.getConfiguration('whizbang');
    const enabled = config.get<boolean>('enableDocSearch', true);
    if (!enabled) {
      vscode.window.showInformationMessage('Whizbang documentation search is disabled. Enable it via whizbang.enableDocSearch.');
      return;
    }

    if (!this.lspClient.isRunning) {
      vscode.window.showWarningMessage('Whizbang: Language server not available. Documentation search requires the server.');
      return;
    }

    const docsBaseUrl = config.get<string>('docsBaseUrl', DEFAULT_BASE_URL);

    const quickPick = vscode.window.createQuickPick<DocQuickPickItem>();
    quickPick.placeholder = 'Search Whizbang documentation...';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    quickPick.onDidChangeValue(value => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(async () => {
        quickPick.busy = true;
        try {
          quickPick.items = await this.search(value);
        } finally {
          quickPick.busy = false;
        }
      }, DEBOUNCE_MS);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        const url = `${docsBaseUrl}/docs/${selected.slug}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
      quickPick.dispose();
    });

    quickPick.onDidHide(() => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      quickPick.dispose();
    });

    quickPick.show();
  }

  // ── Internal ────────────────────────────────────────────────────

  private async search(query: string): Promise<DocQuickPickItem[]> {
    if (!query.trim()) {
      return [];
    }

    try {
      const results = await this.lspClient.searchDocs(query);

      if (!Array.isArray(results)) {
        return [];
      }

      return results.slice(0, 20).map((result: any) => {
        const preview = result.preview
          ? result.preview.length > PREVIEW_MAX_LENGTH
            ? result.preview.substring(0, PREVIEW_MAX_LENGTH) + '...'
            : result.preview
          : '';

        return {
          label: result.title || result.label || '',
          description: result.category || result.description || '',
          detail: preview,
          slug: result.slug || '',
        };
      });
    } catch (err) {
      this.output.error('DocSearch: Server search failed', err instanceof Error ? err : undefined);
      return [];
    }
  }
}
