import * as vscode from 'vscode';
import { DataLoader } from './dataLoader';
import { WhizbangOutputChannel } from './outputChannel';

/**
 * Shape of each entry in code-docs-map.json.
 */
export interface CodeDocsEntry {
  file: string;
  line: number;
  symbol: string;
  docs: string;
}

/**
 * The raw shape of code-docs-map.json: symbol name → entry.
 */
type CodeDocsMap = Record<string, CodeDocsEntry>;

const DEFAULT_BASE_URL = 'https://whizbang-lib.github.io';
const DEFAULT_DOCS_VERSION = 'v1.0.0';

/**
 * Wraps code-docs-map.json to provide doc paths for all Whizbang symbols.
 *
 * This is a broader index than the vscode-feed (which covers ~100 types);
 * code-docs-map covers all 501+ symbols with `<docs>` tags in the library.
 */
export class TypeDocIndex {
  private docsMap: Map<string, CodeDocsEntry> = new Map();

  constructor(
    private dataLoader: DataLoader,
    private output: WhizbangOutputChannel,
  ) {}

  async initialize(): Promise<void> {
    // code-docs-map is an eager data source, so it may already be loaded
    let raw = this.dataLoader.get<CodeDocsMap>('code-docs-map');

    if (!raw) {
      raw = await this.dataLoader.getAsync<CodeDocsMap>('code-docs-map');
    }

    if (!raw) {
      this.output.warn('TypeDocIndex: No code-docs-map data available');
      return;
    }

    // Build the internal map
    for (const [symbolName, entry] of Object.entries(raw)) {
      this.docsMap.set(symbolName, entry);
    }

    this.output.log(`TypeDocIndex: Initialized with ${this.docsMap.size} symbol(s)`);

    // Listen for updates (background refresh)
    this.dataLoader.onDataLoaded(key => {
      if (key === 'code-docs-map') {
        const updated = this.dataLoader.get<CodeDocsMap>('code-docs-map');
        if (updated) {
          this.docsMap.clear();
          for (const [symbolName, entry] of Object.entries(updated)) {
            this.docsMap.set(symbolName, entry);
          }
          this.output.log(`TypeDocIndex: Updated with ${this.docsMap.size} symbol(s)`);
        }
      }
    });
  }

  /**
   * Get the documentation path (relative) for a symbol.
   */
  getDocPath(symbol: string): string | undefined {
    return this.docsMap.get(symbol)?.docs;
  }

  /**
   * Get the full documentation URL for a symbol.
   */
  getDocUrl(symbol: string): string | undefined {
    const entry = this.docsMap.get(symbol);
    if (!entry) {
      return undefined;
    }

    const config = vscode.workspace.getConfiguration('whizbang');
    const baseUrl = config.get<string>('docsBaseUrl', DEFAULT_BASE_URL);
    return `${baseUrl}/docs/${DEFAULT_DOCS_VERSION}/${entry.docs}`;
  }

  /**
   * Get the source file path for a symbol.
   */
  getSourceFile(symbol: string): string | undefined {
    return this.docsMap.get(symbol)?.file;
  }

  /**
   * Get the source line number for a symbol.
   */
  getSourceLine(symbol: string): number | undefined {
    return this.docsMap.get(symbol)?.line;
  }

  /**
   * Check whether a symbol exists in the index.
   */
  has(symbol: string): boolean {
    return this.docsMap.has(symbol);
  }
}
