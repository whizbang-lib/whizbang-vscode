import * as vscode from 'vscode';
import MiniSearch from 'minisearch';
import { DataLoader } from './dataLoader';
import { WhizbangOutputChannel } from './outputChannel';

/**
 * A document from the search-index.json feed.
 */
interface SearchDocument {
  type: string;
  slug: string;
  title: string;
  category: string;
  url: string;
  chunks: SearchChunk[];
}

interface SearchChunk {
  id: string;
  text: string;
  preview: string;
}

/**
 * Flattened chunk used as a MiniSearch document.
 */
interface IndexedChunk {
  id: string;
  title: string;
  category: string;
  content: string;
  url: string;
  slug: string;
  preview: string;
}

/**
 * Synonym data structure from keyword-synonyms.json.
 */
interface SynonymData {
  concepts: Record<string, string[]>;
}

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
 * Provides a QuickPick-based documentation search powered by MiniSearch.
 *
 * Lazily loads the search index from DataLoader on first invocation,
 * expands queries using keyword-synonyms.json, and opens selected
 * results in the browser.
 */
export class DocSearchProvider {
  private miniSearch: MiniSearch<IndexedChunk> | undefined;
  private synonymMap: Map<string, string[]> | undefined;
  private indexBuilt = false;
  private buildingIndex: Promise<void> | undefined;

  constructor(
    private dataLoader: DataLoader,
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

    // Ensure index is built before showing the picker
    if (!this.indexBuilt) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Loading Whizbang search index...' },
        () => this.ensureIndex(),
      );
    }

    if (!this.miniSearch) {
      vscode.window.showErrorMessage('Failed to load Whizbang search index. Check the Output panel for details.');
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
      debounceTimer = setTimeout(() => {
        quickPick.items = this.search(value);
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

  private async ensureIndex(): Promise<void> {
    if (this.indexBuilt) {
      return;
    }
    if (this.buildingIndex) {
      return this.buildingIndex;
    }
    this.buildingIndex = this.buildIndex();
    await this.buildingIndex;
    this.buildingIndex = undefined;
  }

  private async buildIndex(): Promise<void> {
    try {
      // Load search index (lazy, fetched on demand)
      const documents = await this.dataLoader.getAsync<SearchDocument[]>('search-index');
      if (!documents || !Array.isArray(documents)) {
        this.output.warn('DocSearch: search-index data is empty or invalid');
        return;
      }

      // Load synonyms (bundled, should already be in memory)
      const synonymData = this.dataLoader.get<SynonymData>('keyword-synonyms');
      this.buildSynonymMap(synonymData);

      // Flatten chunks into indexable documents
      const chunks: IndexedChunk[] = [];
      for (const doc of documents) {
        if (!doc.chunks || !Array.isArray(doc.chunks)) {
          continue;
        }
        for (const chunk of doc.chunks) {
          chunks.push({
            id: chunk.id,
            title: doc.title,
            category: doc.category,
            content: chunk.text,
            url: doc.url,
            slug: doc.slug,
            preview: chunk.preview,
          });
        }
      }

      // Build MiniSearch index
      this.miniSearch = new MiniSearch<IndexedChunk>({
        fields: ['title', 'category', 'content'],
        storeFields: ['title', 'category', 'url', 'slug', 'preview'],
        searchOptions: {
          prefix: true,
          fuzzy: 0.2,
          boost: { title: 3, category: 2, content: 1 },
        },
      });

      this.miniSearch.addAll(chunks);
      this.indexBuilt = true;

      this.output.log(`DocSearch: Indexed ${chunks.length} chunk(s) from ${documents.length} document(s)`);
    } catch (err) {
      this.output.error('DocSearch: Failed to build search index', err instanceof Error ? err : undefined);
    }
  }

  private buildSynonymMap(synonymData: SynonymData | undefined): void {
    this.synonymMap = new Map();

    if (!synonymData?.concepts) {
      return;
    }

    // Build a reverse lookup: for each synonym term, map to all terms in its concept
    for (const [concept, synonyms] of Object.entries(synonymData.concepts)) {
      const allTerms = [concept, ...synonyms];

      for (const term of allTerms) {
        const normalized = term.toLowerCase();
        const existing = this.synonymMap.get(normalized) || [];
        // Add all other terms from this concept group
        for (const other of allTerms) {
          const otherNormalized = other.toLowerCase();
          if (otherNormalized !== normalized && !existing.includes(otherNormalized)) {
            existing.push(otherNormalized);
          }
        }
        this.synonymMap.set(normalized, existing);
      }
    }
  }

  private expandQuery(query: string): string {
    if (!this.synonymMap || this.synonymMap.size === 0) {
      return query;
    }

    const queryLower = query.toLowerCase().trim();
    const expansions = new Set<string>();

    // Check the full query as a phrase
    const phraseExpansions = this.synonymMap.get(queryLower);
    if (phraseExpansions) {
      for (const expansion of phraseExpansions) {
        expansions.add(expansion);
      }
    }

    // Check individual words
    const words = queryLower.split(/\s+/);
    for (const word of words) {
      const wordExpansions = this.synonymMap.get(word);
      if (wordExpansions) {
        for (const expansion of wordExpansions) {
          expansions.add(expansion);
        }
      }
    }

    if (expansions.size === 0) {
      return query;
    }

    // Concatenate original query with expansions
    return `${query} ${[...expansions].join(' ')}`;
  }

  private search(query: string): DocQuickPickItem[] {
    if (!this.miniSearch || !query.trim()) {
      return [];
    }

    const expandedQuery = this.expandQuery(query);
    const results = this.miniSearch.search(expandedQuery);

    // Deduplicate by slug (keep highest-scoring result per document)
    const seen = new Map<string, typeof results[0]>();
    for (const result of results) {
      const existing = seen.get(result.slug);
      if (!existing || result.score > existing.score) {
        seen.set(result.slug, result);
      }
    }

    const deduplicated = [...seen.values()].sort((a, b) => b.score - a.score);

    return deduplicated.slice(0, 20).map(result => {
      const preview = result.preview
        ? result.preview.length > PREVIEW_MAX_LENGTH
          ? result.preview.substring(0, PREVIEW_MAX_LENGTH) + '...'
          : result.preview
        : '';

      return {
        label: result.title,
        description: result.category,
        detail: preview,
        slug: result.slug,
      };
    });
  }
}
