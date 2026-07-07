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

  private async findAllRegistryFiles(): Promise<string[]> {
    // The message registry moved from .whizbang/ to the git-ignored .whizbang-generated/ folder.
    // Prefer the new location; fall back to the legacy .whizbang/ location for projects still on an
    // older Whizbang generator. Dedupe by project directory so a stale legacy copy left behind after
    // an upgrade doesn't shadow or duplicate the current generated one.
    const generated = await vscode.workspace.findFiles('**/.whizbang-generated/message-registry.json');
    const legacy = await vscode.workspace.findFiles('**/.whizbang/message-registry.json');
    const projectDir = (fsPath: string): string => path.dirname(path.dirname(fsPath));
    const covered = new Set(generated.map(uri => projectDir(uri.fsPath)));
    const result = generated.map(uri => uri.fsPath);
    for (const uri of legacy) {
      if (!covered.has(projectDir(uri.fsPath))) {
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
