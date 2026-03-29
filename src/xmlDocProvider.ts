import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WhizbangOutputChannel } from './outputChannel';

/**
 * Parsed member info from the Whizbang XML documentation file.
 */
export interface XmlMemberInfo {
  /** Full member name (e.g., "M:Whizbang.Core.IDispatcher.SendAsync``1(``0)") */
  fullName: string;
  /** Member kind: T=type, M=method, P=property, F=field, E=event */
  kind: string;
  /** Simple name extracted from fullName (e.g., "SendAsync") */
  simpleName: string;
  /** Parent type name (e.g., "IDispatcher") */
  parentType: string;
  /** Summary text */
  summary?: string;
  /** Documentation page paths from <docs> tags */
  docs: string[];
  /** Test references from <tests> tags */
  tests: string[];
}

/**
 * Loads and parses Whizbang XML documentation files from the NuGet cache
 * or project output, providing member-level docs/tests lookups.
 */
export class XmlDocProvider implements vscode.Disposable {
  /** Map from simple name → members (multiple overloads possible) */
  private membersByName = new Map<string, XmlMemberInfo[]>();
  /** Map from parent type + simple name → members */
  private membersByQualified = new Map<string, XmlMemberInfo[]>();
  private loaded = false;

  constructor(private output: WhizbangOutputChannel) {}

  /**
   * Find and load Whizbang XML documentation files.
   * Searches NuGet cache and workspace output directories.
   */
  async initialize(): Promise<void> {
    this.output.log('XmlDocProvider: Searching for Whizbang XML documentation files...');

    const xmlPaths = await this.findXmlFiles();

    this.output.log(`XmlDocProvider: Found ${xmlPaths.length} XML file(s)`);
    for (const p of xmlPaths) {
      this.output.log(`XmlDocProvider:   ${p}`);
    }

    if (xmlPaths.length === 0) {
      this.output.log('XmlDocProvider: No Whizbang XML documentation files found');
      return;
    }

    let totalMembers = 0;
    let totalDocs = 0;
    let totalTests = 0;

    for (const xmlPath of xmlPaths) {
      try {
        const content = fs.readFileSync(xmlPath, 'utf-8');
        const members = this.parseXml(content);
        for (const member of members) {
          // Index by simple name
          const existing = this.membersByName.get(member.simpleName) || [];
          existing.push(member);
          this.membersByName.set(member.simpleName, existing);

          // Index by qualified name (ParentType.SimpleName)
          const qualKey = `${member.parentType}.${member.simpleName}`;
          const qualExisting = this.membersByQualified.get(qualKey) || [];
          qualExisting.push(member);
          this.membersByQualified.set(qualKey, qualExisting);

          totalMembers++;
          totalDocs += member.docs.length;
          totalTests += member.tests.length;
        }
      } catch (err) {
        this.output.warn(`XmlDocProvider: Failed to parse ${xmlPath}`);
      }
    }

    this.loaded = true;
    this.output.log(`XmlDocProvider: Loaded ${totalMembers} members (${totalDocs} doc links, ${totalTests} test links) from ${xmlPaths.length} XML file(s)`);
  }

  /**
   * Look up members by simple name (e.g., "SendAsync").
   * Returns all overloads/matches.
   */
  getByName(name: string): XmlMemberInfo[] {
    return this.membersByName.get(name) || [];
  }

  /**
   * Look up members by qualified name (e.g., "IDispatcher.SendAsync").
   */
  getByQualifiedName(parentType: string, memberName: string): XmlMemberInfo[] {
    return this.membersByQualified.get(`${parentType}.${memberName}`) || [];
  }

  /**
   * Check if we have any info for this name.
   */
  has(name: string): boolean {
    return this.membersByName.has(name);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Find Whizbang XML files in NuGet cache and workspace.
   */
  private async findXmlFiles(): Promise<string[]> {
    const found: string[] = [];

    // 1. Search NuGet package cache
    const nugetBase = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.nuget', 'packages'
    );

    this.output.log(`XmlDocProvider: Checking NuGet cache at ${nugetBase}`);

    if (fs.existsSync(nugetBase)) {
      try {
        // Scan all Whizbang packages in NuGet cache for XML files.
        // Different projects may use different versions, so we find ALL
        // versions that have XML and load them (deduplicating by filename).
        const entries = fs.readdirSync(nugetBase);
        const whizbangPkgs = entries.filter(e => e.startsWith('softwareextravaganza.whizbang'));
        const loadedXmlNames = new Set<string>();

        for (const pkg of whizbangPkgs) {
          const pkgDir = path.join(nugetBase, pkg);
          // Sort versions descending so we find the latest XML first
          const versions = fs.readdirSync(pkgDir).sort().reverse();

          for (const ver of versions) {
            const libDir = path.join(pkgDir, ver, 'lib');
            if (!fs.existsSync(libDir)) { continue; }

            // Check for XML in any TFM subfolder
            const beforeCount = found.length;
            this.findXmlInDir(libDir, found);

            if (found.length > beforeCount) {
              // Track which assembly XMLs we've loaded to avoid duplicates
              const newFiles = found.slice(beforeCount);
              for (const f of newFiles) {
                const xmlName = f.split('/').pop() || '';
                loadedXmlNames.add(xmlName);
              }
              this.output.log(`XmlDocProvider:   ${pkg}@${ver} → ${found.length - beforeCount} XML file(s)`);
              break; // Got XML for this package, skip older versions
            }
          }
        }
      } catch (err) {
        this.output.warn(`XmlDocProvider: Error scanning NuGet cache: ${err}`);
      }
    }

    // 2. Search workspace bin/Debug output
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const pattern = new vscode.RelativePattern(folder, '**/bin/Debug/**/Whizbang*.xml');
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 20);
        for (const file of files) {
          if (!found.includes(file.fsPath)) {
            found.push(file.fsPath);
          }
        }
      }
    }

    return found;
  }

  /**
   * Find resolved Whizbang package versions from project.assets.json files
   * in the workspace. Returns a map of package ID → version.
   */
  private async findResolvedVersions(): Promise<Map<string, string>> {
    const versions = new Map<string, string>();
    // Track all version candidates per package to pick the best one
    const allCandidates = new Map<string, string[]>();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return versions; }

    // Scan ALL project.assets.json files (not just the first)
    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, '**/obj/project.assets.json');
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 20);

      for (const file of files) {
        try {
          const content = fs.readFileSync(file.fsPath, 'utf-8');
          const regex = /"(SoftwareExtravaganza\.Whizbang[^"/]*)["/](?::?\s*")?(\d+\.\d+[^"]*)?"/g;
          let match;
          while ((match = regex.exec(content)) !== null) {
            const pkgId = match[1];
            const ver = match[2];
            if (pkgId && ver) {
              const existing = allCandidates.get(pkgId) || [];
              if (!existing.includes(ver)) { existing.push(ver); }
              allCandidates.set(pkgId, existing);
            }
          }
        } catch {
          // Can't read this assets file
        }
      }
    }

    // For each package, prefer non-local versions (published packages have XML)
    for (const [pkgId, vers] of allCandidates) {
      // Prefer: non-local > local, highest version
      const nonLocal = vers.filter(v => !v.includes('local'));
      const best = nonLocal.length > 0
        ? nonLocal[nonLocal.length - 1]  // Last non-local (roughly latest)
        : vers[vers.length - 1];          // Last local as fallback
      versions.set(pkgId, best);
    }

    return versions;
  }

  private findXmlInDir(dir: string, results: string[]): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.findXmlInDir(full, results);
        } else if (entry.name.endsWith('.xml') && entry.name.startsWith('Whizbang')) {
          if (!results.includes(full)) {
            results.push(full);
          }
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  /**
   * Parse XML documentation content into member entries.
   * Keeps members that have <summary>, <docs>, or <tests> tags.
   */
  private parseXml(content: string): XmlMemberInfo[] {
    const members: XmlMemberInfo[] = [];

    // Split by <member> tags
    const memberRegex = /<member\s+name="([^"]+)">([\s\S]*?)<\/member>/g;
    let match;

    while ((match = memberRegex.exec(content)) !== null) {
      const fullName = match[1];
      const body = match[2];

      // Extract <docs> tags
      const docs: string[] = [];
      const docsRegex = /<docs>(.*?)<\/docs>/g;
      let docsMatch;
      while ((docsMatch = docsRegex.exec(body)) !== null) {
        docs.push(docsMatch[1].trim());
      }

      // Extract <tests> tags
      const tests: string[] = [];
      const testsRegex = /<tests>(.*?)<\/tests>/g;
      let testsMatch;
      while ((testsMatch = testsRegex.exec(body)) !== null) {
        tests.push(testsMatch[1].trim());
      }

      // Extract summary
      const summaryMatch = body.match(/<summary>([\s\S]*?)<\/summary>/);
      const summary = summaryMatch
        ? summaryMatch[1].replace(/\s*\/\/\/\s*/g, '').replace(/\s+/g, ' ').trim()
        : undefined;

      // Only keep members with summary, docs, or tests
      if (!summary && docs.length === 0 && tests.length === 0) { continue; }

      // Parse member kind and names
      const kind = fullName.charAt(0); // T, M, P, F, E
      const { simpleName, parentType } = this.parseMemberName(fullName);

      members.push({
        fullName,
        kind,
        simpleName,
        parentType,
        summary,
        docs,
        tests,
      });
    }

    return members;
  }

  /**
   * Extract simple name and parent type from XML member name.
   * Examples:
   *   "T:Whizbang.Core.IDispatcher" → { simpleName: "IDispatcher", parentType: "IDispatcher" }
   *   "M:Whizbang.Core.IDispatcher.SendAsync``1(``0)" → { simpleName: "SendAsync", parentType: "IDispatcher" }
   *   "P:Whizbang.Core.Dispatch.DispatchOptions.Timeout" → { simpleName: "Timeout", parentType: "DispatchOptions" }
   */
  private parseMemberName(fullName: string): { simpleName: string; parentType: string } {
    // Remove prefix (T:, M:, P:, F:, E:)
    const withoutPrefix = fullName.substring(2);

    // Remove generic parameters for parsing
    // ``1 = method-level generics, `1 = type-level generics
    const withoutGenerics = withoutPrefix.replace(/`+\d+/g, '').replace(/\(.*$/, '');

    const parts = withoutGenerics.split('.');
    const simpleName = parts[parts.length - 1];

    // For types, parent is the type itself
    // For members, parent is the second-to-last part
    const parentType = parts.length >= 2 ? parts[parts.length - 2] : simpleName;

    // Handle constructors
    if (simpleName === '#ctor') {
      return { simpleName: parentType, parentType };
    }

    return { simpleName, parentType };
  }

  private pascalCase(pkgName: string): string {
    // softwareextravaganza.whizbang.core → SoftwareExtravaganza.Whizbang.Core
    return pkgName.split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('.');
  }

  dispose(): void {
    this.membersByName.clear();
    this.membersByQualified.clear();
  }
}
