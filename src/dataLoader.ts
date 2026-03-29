import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WhizbangOutputChannel } from './outputChannel';

/**
 * Metadata for a cached data source file on disk.
 */
interface CacheMeta {
  fetchedAt: number;
  etag?: string;
}

/**
 * Describes a data source that the DataLoader manages.
 */
interface DataSourceDescriptor {
  /** Key used for cache file naming and internal map */
  key: string;
  /** URL path appended to base URL (undefined = bundled, no fetch) */
  urlPath?: string;
  /** If true, loaded eagerly on preload(); otherwise loaded on first access */
  eager: boolean;
}

const DATA_SOURCES: DataSourceDescriptor[] = [
  { key: 'keyword-synonyms', eager: true },                           // bundled
  { key: 'vscode-feed', urlPath: '/assets/vscode-feed.json', eager: true },
  { key: 'code-docs-map', urlPath: '/assets/code-docs-map.json', eager: true },
  { key: 'search-index', urlPath: '/assets/search-index.json', eager: false },
  { key: 'code-tests-map', urlPath: '/assets/code-tests-map.json', eager: false },
];

const DEFAULT_BASE_URL = 'https://whizbang-lib.github.io';
const DEFAULT_TTL_HOURS = 24;
const CACHE_META_SUFFIX = '.meta.json';

/**
 * Central data loading service that fetches, caches, and provides all JSON data sources.
 *
 * Uses `context.storageUri` for filesystem caching to avoid the 1 MB globalState limit.
 * Eager sources are fetched at activation; lazy sources are fetched on first access.
 * Background refresh is triggered when cache age exceeds 50 % of TTL.
 */
export class DataLoader implements vscode.Disposable {
  private data = new Map<string, unknown>();
  private loadingPromises = new Map<string, Promise<unknown>>();
  private cacheDir: string | undefined;
  private output: WhizbangOutputChannel;

  private onDataLoadedEmitter = new vscode.EventEmitter<string>();
  public readonly onDataLoaded = this.onDataLoadedEmitter.event;

  constructor(
    private context: vscode.ExtensionContext,
    output: WhizbangOutputChannel,
  ) {
    this.output = output;

    // Ensure cache directory exists
    if (context.storageUri) {
      this.cacheDir = context.storageUri.fsPath;
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Trigger eager preload of small/critical data sources.
   * Call once during activation.
   */
  async preload(): Promise<void> {
    const eager = DATA_SOURCES.filter(d => d.eager);
    await Promise.allSettled(eager.map(d => this.ensureLoaded(d.key)));
  }

  /**
   * Get cached data for a source. If not yet loaded, triggers a lazy load and returns undefined
   * until the data is available (listen to `onDataLoaded` for notification).
   */
  get<T = unknown>(key: string): T | undefined {
    const cached = this.data.get(key) as T | undefined;

    if (!cached) {
      // Trigger lazy load if not already in progress
      if (!this.loadingPromises.has(key)) {
        this.ensureLoaded(key).catch(() => {});
      }
    }

    return cached;
  }

  /**
   * Get data, waiting for it to load if necessary.
   */
  async getAsync<T = unknown>(key: string): Promise<T | undefined> {
    if (this.data.has(key)) {
      return this.data.get(key) as T;
    }
    return (await this.ensureLoaded(key)) as T | undefined;
  }

  /**
   * Force a refresh of a specific data source from the network.
   */
  async refresh(key: string): Promise<void> {
    const descriptor = DATA_SOURCES.find(d => d.key === key);
    if (!descriptor) {
      this.output.warn(`DataLoader: Unknown data source key '${key}'`);
      return;
    }
    await this.fetchAndCache(descriptor, true);
  }

  dispose(): void {
    this.onDataLoadedEmitter.dispose();
    this.data.clear();
    this.loadingPromises.clear();
  }

  // ── Internal ────────────────────────────────────────────────────

  private async ensureLoaded(key: string): Promise<unknown> {
    // Already loaded
    if (this.data.has(key)) {
      return this.data.get(key);
    }

    // Already loading
    const existing = this.loadingPromises.get(key);
    if (existing) {
      return existing;
    }

    const descriptor = DATA_SOURCES.find(d => d.key === key);
    if (!descriptor) {
      this.output.warn(`DataLoader: Unknown data source key '${key}'`);
      return undefined;
    }

    const promise = this.loadSource(descriptor);
    this.loadingPromises.set(key, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.loadingPromises.delete(key);
    }
  }

  private async loadSource(descriptor: DataSourceDescriptor): Promise<unknown> {
    // Bundled source (no URL, shipped with extension)
    if (!descriptor.urlPath) {
      return this.loadBundled(descriptor);
    }

    // Try disk cache first
    const cached = this.readDiskCache(descriptor.key);
    if (cached) {
      const meta = this.readCacheMeta(descriptor.key);
      const ttlMs = this.getTtlMs();

      if (meta && (Date.now() - meta.fetchedAt) < ttlMs) {
        this.data.set(descriptor.key, cached);
        this.onDataLoadedEmitter.fire(descriptor.key);
        this.output.log(`DataLoader: Loaded '${descriptor.key}' from disk cache`);

        // Background refresh if >50% stale
        if ((Date.now() - meta.fetchedAt) > ttlMs / 2) {
          this.fetchAndCache(descriptor, false).catch(() => {});
        }

        return cached;
      }
    }

    // Fetch fresh
    const fetched = await this.fetchAndCache(descriptor, false);

    // Fall back to stale cache if fetch failed
    if (!fetched && cached) {
      this.data.set(descriptor.key, cached);
      this.onDataLoadedEmitter.fire(descriptor.key);
      this.output.warn(`DataLoader: Using stale cache for '${descriptor.key}' (fetch failed)`);
      return cached;
    }

    return fetched;
  }

  private loadBundled(descriptor: DataSourceDescriptor): unknown {
    try {
      // Try inline require first (works with esbuild bundling)
      let parsed: unknown;
      if (descriptor.key === 'keyword-synonyms') {
        parsed = require('./data/keyword-synonyms.json');
      } else {
        // Fallback to filesystem for unknown bundled keys
        const candidates = [
          path.join(__dirname, '..', 'src', 'data', `${descriptor.key}.json`),
          path.join(__dirname, 'data', `${descriptor.key}.json`),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            const content = fs.readFileSync(candidate, 'utf-8');
            parsed = JSON.parse(content);
            break;
          }
        }
      }

      if (parsed) {
        this.data.set(descriptor.key, parsed);
        this.onDataLoadedEmitter.fire(descriptor.key);
        this.output.log(`DataLoader: Loaded bundled '${descriptor.key}'`);
        return parsed;
      }

      this.output.warn(`DataLoader: Bundled file not found for '${descriptor.key}'`);
      return undefined;
    } catch (err) {
      this.output.error(`DataLoader: Failed to load bundled '${descriptor.key}'`, err instanceof Error ? err : undefined);
      return undefined;
    }
  }

  private async fetchAndCache(descriptor: DataSourceDescriptor, force: boolean): Promise<unknown> {
    if (!descriptor.urlPath) {
      return undefined;
    }

    const config = vscode.workspace.getConfiguration('whizbang');
    const siteBaseUrl = config.get<string>('docsBaseUrl', DEFAULT_BASE_URL);
    const url = `${siteBaseUrl}${descriptor.urlPath}`;

    try {
      this.output.log(`DataLoader: Fetching '${descriptor.key}' from ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        this.output.warn(`DataLoader: HTTP ${response.status} fetching '${descriptor.key}'`);
        return undefined;
      }

      const json = await response.json();

      // Store in memory
      this.data.set(descriptor.key, json);
      this.onDataLoadedEmitter.fire(descriptor.key);

      // Write to disk cache
      this.writeDiskCache(descriptor.key, json);
      this.writeCacheMeta(descriptor.key, {
        fetchedAt: Date.now(),
        etag: response.headers.get('etag') || undefined,
      });

      this.output.log(`DataLoader: Cached '${descriptor.key}' to disk`);
      return json;
    } catch (err) {
      this.output.error(
        `DataLoader: Failed to fetch '${descriptor.key}'`,
        err instanceof Error ? err : undefined,
      );
      return undefined;
    }
  }

  // ── Disk cache helpers ──────────────────────────────────────────

  private getCachePath(key: string): string | undefined {
    if (!this.cacheDir) {
      return undefined;
    }
    return path.join(this.cacheDir, `${key}.json`);
  }

  private getMetaPath(key: string): string | undefined {
    if (!this.cacheDir) {
      return undefined;
    }
    return path.join(this.cacheDir, `${key}${CACHE_META_SUFFIX}`);
  }

  private readDiskCache(key: string): unknown {
    const cachePath = this.getCachePath(key);
    if (!cachePath || !fs.existsSync(cachePath)) {
      return undefined;
    }
    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  private writeDiskCache(key: string, data: unknown): void {
    const cachePath = this.getCachePath(key);
    if (!cachePath) {
      return;
    }
    try {
      fs.writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
    } catch (err) {
      this.output.warn(`DataLoader: Failed to write cache for '${key}'`);
    }
  }

  private readCacheMeta(key: string): CacheMeta | undefined {
    const metaPath = this.getMetaPath(key);
    if (!metaPath || !fs.existsSync(metaPath)) {
      return undefined;
    }
    try {
      const content = fs.readFileSync(metaPath, 'utf-8');
      return JSON.parse(content) as CacheMeta;
    } catch {
      return undefined;
    }
  }

  private writeCacheMeta(key: string, meta: CacheMeta): void {
    const metaPath = this.getMetaPath(key);
    if (!metaPath) {
      return;
    }
    try {
      fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf-8');
    } catch {
      this.output.warn(`DataLoader: Failed to write cache meta for '${key}'`);
    }
  }

  private getTtlMs(): number {
    const config = vscode.workspace.getConfiguration('whizbang');
    const ttlHours = config.get<number>('docsCacheTtlHours', DEFAULT_TTL_HOURS);
    return ttlHours * 60 * 60 * 1000;
  }
}
