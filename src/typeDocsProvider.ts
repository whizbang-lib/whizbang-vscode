import * as vscode from 'vscode';
import { WhizbangOutputChannel } from './outputChannel';
import { DataLoader } from './dataLoader';

export interface TypeDocInfo {
  docs: string;
  title: string;
  file: string;
  line: number;
  tests?: string[];
}

interface VscodeFeed {
  version: string;
  generated: string;
  baseUrl: string;
  docsVersion: string;
  types: Record<string, TypeDocInfo>;
}

const DEFAULT_BASE_URL = 'https://whizbang-lib.github.io';

export class TypeDocsProvider implements vscode.Disposable {
  private feed: VscodeFeed | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private dataLoader: DataLoader,
    private output: WhizbangOutputChannel,
  ) {
    // Listen for data loader updates to vscode-feed
    this.disposables.push(
      dataLoader.onDataLoaded(key => {
        if (key === 'vscode-feed') {
          this.feed = dataLoader.get<VscodeFeed>('vscode-feed');
          if (this.feed) {
            this.output.log(`TypeDocsProvider: Updated with ${Object.keys(this.feed.types).length} type docs`);
          }
        }
      })
    );
  }

  async initialize(): Promise<void> {
    // Try to get already-loaded data from DataLoader (eager preload may have completed)
    this.feed = this.dataLoader.get<VscodeFeed>('vscode-feed');

    if (this.feed) {
      this.output.log(`TypeDocsProvider: Initialized with ${Object.keys(this.feed.types).length} type docs`);
      return;
    }

    // Wait for it if not yet available
    const feed = await this.dataLoader.getAsync<VscodeFeed>('vscode-feed');
    if (feed) {
      this.feed = feed;
      this.output.log(`TypeDocsProvider: Initialized with ${Object.keys(this.feed.types).length} type docs`);
    } else {
      this.output.warn('TypeDocsProvider: No vscode-feed data available');
    }
  }

  getTypeInfo(symbolName: string): TypeDocInfo | undefined {
    return this.feed?.types[symbolName];
  }

  getDocsUrl(symbolName: string): string | undefined {
    const info = this.getTypeInfo(symbolName);
    if (!info || !this.feed) {
      return undefined;
    }
    return `${this.feed.baseUrl}/${this.feed.docsVersion}/${info.docs}`;
  }

  get baseUrl(): string {
    return this.feed?.baseUrl || `${DEFAULT_BASE_URL}/docs`;
  }

  get docsVersion(): string {
    return this.feed?.docsVersion || 'v1.0.0';
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
