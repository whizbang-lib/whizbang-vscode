import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WhizbangOutputChannel } from './outputChannel';
import { MessageRegistry, MessageInfo, CodeLocation, WhizbangPackageRef } from './types';

export class RegistryLoader {
  private registry: MessageRegistry = { messages: [] };
  private registryPaths: string[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private onRegistryChangedEmitter = new vscode.EventEmitter<MessageRegistry>();
  public readonly onRegistryChanged = this.onRegistryChangedEmitter.event;

  constructor(private output: WhizbangOutputChannel) {}

  public async initialize(): Promise<boolean> {
    await this.cleanupOrphanedLegacyRegistries();
    this.registryPaths = await this.findAllRegistryFiles();

    if (this.registryPaths.length === 0) {
      vscode.window.showWarningMessage(
        'Whizbang: No message-registry.json files found. Build your project to generate them.'
      );
      return false;
    }

    this.output.log(`Found ${this.registryPaths.length} registry file(s): ${this.registryPaths.join(', ')}`);

    this.loadAndMergeRegistries();
    this.setupFileWatchers();
    return true;
  }

  // The project directory that owns a registry file: the path up to the `.whizbang` segment. This
  // normalizes the two nesting depths (`.whizbang/cache/…` vs legacy `.whizbang/…`) to the same key.
  private projectDirOf(fsPath: string): string {
    const marker = `${path.sep}.whizbang${path.sep}`;
    const idx = fsPath.lastIndexOf(marker);
    return idx >= 0 ? fsPath.slice(0, idx) : path.dirname(fsPath);
  }

  /**
   * Self-heal: when a project has migrated to the new `.whizbang/cache/message-registry.json`, an
   * orphaned legacy `.whizbang/message-registry.json` may be left behind at the folder root. It is a
   * regenerable artifact (never source of truth), so delete it once a cache/ copy exists for the same
   * project — otherwise an old registry can shadow the current one. Opt out with
   * `whizbang.cleanupLegacyRegistry: false`.
   */
  private async cleanupOrphanedLegacyRegistries(): Promise<void> {
    if (!vscode.workspace.getConfiguration('whizbang').get<boolean>('cleanupLegacyRegistry', true)) {
      return;
    }
    const generated = await vscode.workspace.findFiles('**/.whizbang/cache/message-registry.json');
    const legacy = await vscode.workspace.findFiles('**/.whizbang/message-registry.json');
    const migrated = new Set(generated.map(uri => this.projectDirOf(uri.fsPath)));
    for (const uri of legacy) {
      if (migrated.has(this.projectDirOf(uri.fsPath))) {
        try {
          fs.unlinkSync(uri.fsPath);
          this.output.log(`Removed orphaned legacy registry (superseded by .whizbang/cache/): ${uri.fsPath}`);
        } catch (error) {
          this.output.warn(`Could not remove orphaned legacy registry ${uri.fsPath}: ${error}`);
        }
      }
    }
  }

  private async findAllRegistryFiles(): Promise<string[]> {
    // The message registry moved from .whizbang/ into the git-ignored .whizbang/cache/ subfolder.
    // Prefer the new location; fall back to the legacy .whizbang/ path for projects still on an
    // older Whizbang generator. Dedupe by project directory so a stale legacy copy left behind after
    // an upgrade doesn't shadow or duplicate the current one.
    const generated = await vscode.workspace.findFiles('**/.whizbang/cache/message-registry.json');
    const legacy = await vscode.workspace.findFiles('**/.whizbang/message-registry.json');
    const covered = new Set(generated.map(uri => this.projectDirOf(uri.fsPath)));
    const result = generated.map(uri => uri.fsPath);
    for (const uri of legacy) {
      if (!covered.has(this.projectDirOf(uri.fsPath))) {
        result.push(uri.fsPath);
      }
    }
    return result;
  }

  private loadAndMergeRegistries(): void {
    try {
      const registries: MessageRegistry[] = [];

      // Load all registry files
      for (const registryPath of this.registryPaths) {
        try {
          const content = fs.readFileSync(registryPath, 'utf-8');
          const registry: MessageRegistry = JSON.parse(content);
          registries.push(registry);
        } catch (error) {
          this.output.error(`Failed to parse registry at ${registryPath}: ${error}`);
        }
      }

      // Merge registries
      this.registry = this.mergeRegistries(registries);
      this.onRegistryChangedEmitter.fire(this.registry);

      this.output.log(`Merged ${registries.length} registries into ${this.registry.messages.length} unique messages`);

      // Log dispatcher/receptor/perspective counts for debugging
      const dispatcherCount = this.registry.messages.reduce((sum, m) => sum + m.dispatchers.length, 0);
      const receptorCount = this.registry.messages.reduce((sum, m) => sum + m.receptors.length, 0);
      const perspectiveCount = this.registry.messages.reduce((sum, m) => sum + m.perspectives.length, 0);
      this.output.log(`Total: ${dispatcherCount} dispatchers, ${receptorCount} receptors, ${perspectiveCount} perspectives`);

    } catch (error) {
      this.output.error(`Failed to load registries: ${error}`);
      this.registry = { messages: [] };
    }
  }

  private mergeRegistries(registries: MessageRegistry[]): MessageRegistry {
    // Collect all messages by type name
    const messageMap = new Map<string, MessageInfo>();

    for (const registry of registries) {
      for (const message of registry.messages) {
        const existing = messageMap.get(message.type);

        if (existing) {
          // Merge dispatchers, receptors, and perspectives (avoiding duplicates)
          existing.dispatchers = this.mergeLocations(existing.dispatchers, message.dispatchers);
          existing.receptors = this.mergeLocations(existing.receptors, message.receptors);
          existing.perspectives = this.mergeLocations(existing.perspectives, message.perspectives);
        } else {
          // First time seeing this message type
          messageMap.set(message.type, { ...message });
        }
      }
    }

    // Convert map back to array
    const messages = Array.from(messageMap.values());

    // Collect all package references from all registries
    const allPackages: WhizbangPackageRef[] = [];
    for (const registry of registries) {
      if (registry.whizbangPackages) {
        allPackages.push(...registry.whizbangPackages);
      }
    }

    return { messages, whizbangPackages: allPackages };
  }

  private mergeLocations(existing: CodeLocation[], incoming: CodeLocation[]): CodeLocation[] {
    const merged = [...existing];

    for (const loc of incoming) {
      // Check if this location is already in the list (by file path and line number)
      const isDuplicate = merged.some(
        m => m.filePath === loc.filePath && m.lineNumber === loc.lineNumber
      );

      if (!isDuplicate) {
        merged.push(loc);
      }
    }

    return merged;
  }

  private setupFileWatchers(): void {
    // Dispose existing watchers
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];

    // Create watcher for each registry file
    for (const registryPath of this.registryPaths) {
      const watcher = vscode.workspace.createFileSystemWatcher(registryPath);

      watcher.onDidChange(() => {
        this.output.log(`Registry file changed: ${registryPath}, reloading all...`);
        this.loadAndMergeRegistries();
      });

      watcher.onDidCreate(() => {
        this.output.log(`Registry file created: ${registryPath}, reloading all...`);
        this.loadAndMergeRegistries();
      });

      watcher.onDidDelete(() => {
        this.output.log(`Registry file deleted: ${registryPath}, reloading all...`);
        this.loadAndMergeRegistries();
      });

      this.watchers.push(watcher);
    }
  }

  public getRegistry(): MessageRegistry {
    return this.registry;
  }

  public findMessage(typeName: string): MessageInfo | undefined {
    return this.registry.messages.find(m => m.type.endsWith(typeName));
  }

  /**
   * Returns deduplicated package references from all merged registries.
   * Each project's registry includes which Whizbang packages it references.
   */
  public getPackageRefs(): WhizbangPackageRef[] {
    const refs = this.registry.whizbangPackages || [];
    // Deduplicate by id (keep first occurrence)
    const seen = new Set<string>();
    return refs.filter(r => {
      if (seen.has(r.id)) { return false; }
      seen.add(r.id);
      return true;
    });
  }

  public dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
    this.onRegistryChangedEmitter.dispose();
  }
}
