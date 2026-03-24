import * as vscode from 'vscode';

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

interface CachedFeed {
  feed: VscodeFeed;
  fetchedAt: number;
}

const FEED_URL_PATH = '/assets/vscode-feed.json';
const DEFAULT_BASE_URL = 'https://whizbang-lib.github.io';
const DEFAULT_TTL_HOURS = 24;

export class TypeDocsProvider implements vscode.Disposable {
  private feed: VscodeFeed | undefined;
  private loading: Promise<void> | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    this.loading = this.loadFeed();
    await this.loading;
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
    // Nothing to dispose
  }

  private async loadFeed(): Promise<void> {
    // Try cache first
    const cached = this.context.globalState.get<CachedFeed>('whizbang.vscodeFeed');
    const config = vscode.workspace.getConfiguration('whizbang');
    const ttlHours = config.get<number>('docsCacheTtlHours', DEFAULT_TTL_HOURS);

    if (cached && Date.now() - cached.fetchedAt < ttlHours * 60 * 60 * 1000) {
      this.feed = cached.feed;
      console.log(`Whizbang: Loaded ${Object.keys(this.feed.types).length} type docs from cache`);
      // Refresh in background if cache is older than half the TTL
      if (Date.now() - cached.fetchedAt > (ttlHours * 60 * 60 * 1000) / 2) {
        this.fetchAndCache().catch(() => {}); // Silent background refresh
      }
      return;
    }

    // Fetch fresh
    await this.fetchAndCache();

    // Fall back to stale cache if fetch failed
    if (!this.feed && cached) {
      this.feed = cached.feed;
      console.log('Whizbang: Using stale cache (fetch failed)');
    }
  }

  private async fetchAndCache(): Promise<void> {
    const config = vscode.workspace.getConfiguration('whizbang');
    const siteBaseUrl = config.get<string>('docsBaseUrl', DEFAULT_BASE_URL);
    const feedUrl = `${siteBaseUrl}${FEED_URL_PATH}`;

    try {
      const response = await fetch(feedUrl);
      if (!response.ok) {
        console.warn(`Whizbang: Failed to fetch type docs feed: ${response.status}`);
        return;
      }

      const feed = (await response.json()) as VscodeFeed;

      if (!feed.types || typeof feed.types !== 'object') {
        console.warn('Whizbang: Invalid feed format');
        return;
      }

      this.feed = feed;

      // Cache it
      await this.context.globalState.update('whizbang.vscodeFeed', {
        feed,
        fetchedAt: Date.now(),
      } as CachedFeed);

      console.log(`Whizbang: Fetched ${Object.keys(feed.types).length} type docs from ${feedUrl}`);
    } catch (err) {
      console.warn(`Whizbang: Could not fetch type docs feed: ${err}`);
    }
  }
}
