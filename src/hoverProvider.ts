import * as vscode from 'vscode';
import { RegistryLoader } from './registryLoader';
import { TypeDocsProvider } from './typeDocsProvider';
import { TypeDocIndex } from './typeDocIndex';
import { XmlDocProvider } from './xmlDocProvider';
import { WhizbangOutputChannel } from './outputChannel';
import { CodeLocation, TestInfo } from './types';

export class MessageHoverProvider implements vscode.HoverProvider {
  constructor(
    private registryLoader: RegistryLoader,
    private output: WhizbangOutputChannel,
    private typeDocsProvider?: TypeDocsProvider,
    private typeDocIndex?: TypeDocIndex,
    private xmlDocProvider?: XmlDocProvider,
  ) {}

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const message = this.registryLoader.findMessage(word);

    if (!message) {
      // Fallback 1: check type docs provider (vscode-feed) for non-message Whizbang types
      const hover = this.provideTypeDocsHover(word);
      if (hover) {
        return hover;
      }

      // Fallback 2: check TypeDocIndex (code-docs-map) for broader symbol coverage
      const docIndexHover = this.provideDocIndexHover(word);
      if (docIndexHover) {
        return docIndexHover;
      }

      // Fallback 3: use definition provider to get fully qualified type,
      // then look up member-level docs/tests from NuGet XML
      if (this.xmlDocProvider?.isLoaded) {
        try {
          const xmlHover = await this.resolveAndProvideXmlDocHover(document, position, word);
          if (xmlHover) {
            return xmlHover;
          }
        } catch {
          // Definition provider not available
        }
      }

      // Only log for words that look like type names (PascalCase, 4+ chars)
      if (word.length >= 4 && /^[A-Z]/.test(word)) {
        this.output.log(`HoverProvider: No info for '${word}'`);
      }
      return undefined;
    }

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    // Header
    const emoji = message.isCommand ? '📬' : '📣';
    markdown.appendMarkdown(`### ${emoji} ${message.type}\n\n`);
    markdown.appendMarkdown(`**Type:** ${message.isCommand ? 'Command' : 'Event'}\n\n`);

    // Message location
    if (message.filePath && message.lineNumber) {
      const messageLocation = this.createNavigationLink({
        class: '',
        method: '',
        filePath: message.filePath,
        lineNumber: message.lineNumber,
        tests: [],
      });
      const relativePath = this.getRelativePath(message.filePath);
      markdown.appendMarkdown(`**Defined in:** \`${relativePath}:${message.lineNumber}\` ${messageLocation}\n\n`);
    }

    // Documentation link
    if (message.docsUrl) {
      markdown.appendMarkdown(`**Documentation:** [View Docs](${message.docsUrl}) 📚\n\n`);
    }

    // Tests for message
    if (message.tests && message.tests.length > 0) {
      markdown.appendMarkdown(`#### 🧪 Tests\n\n`);
      for (const test of message.tests) {
        const link = this.createTestNavigationLink(test);
        const relativePath = this.getRelativePath(test.testFile);
        markdown.appendMarkdown(`- ${test.testClass}.${test.testMethod}() ${link}\n`);
        markdown.appendMarkdown(`  \`${relativePath}:${test.testLine}\`\n`);
      }
      markdown.appendMarkdown('\n');
    }

    // Dispatchers
    if (message.dispatchers.length > 0) {
      markdown.appendMarkdown(`#### 📤 Dispatched By\n\n`);
      for (const dispatcher of message.dispatchers) {
        const link = this.createNavigationLink(dispatcher);
        markdown.appendMarkdown(`- ${dispatcher.class}.${dispatcher.method}() ${link}\n`);

        // Show tests for dispatcher
        if (dispatcher.tests && dispatcher.tests.length > 0) {
          for (const test of dispatcher.tests) {
            const testLink = this.createTestNavigationLink(test);
            markdown.appendMarkdown(`  - 🧪 ${test.testClass}.${test.testMethod}() ${testLink}\n`);
          }
        }
      }
      markdown.appendMarkdown('\n');
    }

    // Receptors
    if (message.receptors.length > 0) {
      markdown.appendMarkdown(`#### 🎯 Handled By\n\n`);
      for (const receptor of message.receptors) {
        const link = this.createNavigationLink(receptor);
        markdown.appendMarkdown(`- ${receptor.class}.${receptor.method}() ${link}\n`);

        // Show tests for receptor
        if (receptor.tests && receptor.tests.length > 0) {
          for (const test of receptor.tests) {
            const testLink = this.createTestNavigationLink(test);
            markdown.appendMarkdown(`  - 🧪 ${test.testClass}.${test.testMethod}() ${testLink}\n`);
          }
        }
      }
      markdown.appendMarkdown('\n');
    }

    // Perspectives (events only)
    if (message.isEvent && message.perspectives.length > 0) {
      markdown.appendMarkdown(`#### 👁️ Perspectives\n\n`);
      for (const perspective of message.perspectives) {
        const link = this.createNavigationLink(perspective);
        markdown.appendMarkdown(`- ${perspective.class}.${perspective.method}() ${link}\n`);

        // Show tests for perspective
        if (perspective.tests && perspective.tests.length > 0) {
          for (const test of perspective.tests) {
            const testLink = this.createTestNavigationLink(test);
            markdown.appendMarkdown(`  - 🧪 ${test.testClass}.${test.testMethod}() ${testLink}\n`);
          }
        }
      }
    }

    return new vscode.Hover(markdown);
  }

  private provideTypeDocsHover(word: string): vscode.Hover | undefined {
    if (!this.typeDocsProvider) {
      return undefined;
    }

    const typeInfo = this.typeDocsProvider.getTypeInfo(word);
    if (!typeInfo) {
      return undefined;
    }

    const docsUrl = this.typeDocsProvider.getDocsUrl(word);
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    const repoUrl = vscode.workspace.getConfiguration('whizbang').get<string>(
      'libraryRepoUrl', 'https://github.com/whizbang-lib/whizbang/blob/develop/');

    markdown.appendMarkdown(`### Whizbang: ${word}\n\n`);

    if (typeInfo.title) {
      markdown.appendMarkdown(`**${typeInfo.title}**\n\n`);
    }

    markdown.appendMarkdown(`---\n\n`);

    // Documentation link
    if (docsUrl) {
      markdown.appendMarkdown(`#### 📚 Documentation\n\n`);
      markdown.appendMarkdown(`[View Documentation](${docsUrl})\n\n`);
    }

    // Source file — linked to GitHub
    if (typeInfo.file) {
      markdown.appendMarkdown(`#### 📁 Source\n\n`);
      const line = typeInfo.line || 1;
      const ghSourceUrl = `${repoUrl}${typeInfo.file}#L${line}`;
      markdown.appendMarkdown(`[\`${typeInfo.file}:${line}\`](${ghSourceUrl})\n\n`);
    }

    // Tests - each linked to GitHub
    if (typeInfo.tests && typeInfo.tests.length > 0) {
      markdown.appendMarkdown(`#### 🧪 Tests (${typeInfo.tests.length})\n\n`);
      for (const testRef of typeInfo.tests) {
        // Format: "tests/Project.Tests/SomeTests.cs:TestMethodName"
        const colonIdx = testRef.lastIndexOf(':');
        if (colonIdx > 0) {
          const testFile = testRef.substring(0, colonIdx);
          const testMethod = testRef.substring(colonIdx + 1);
          const fileName = testFile.split('/').pop() || testFile;
          const className = fileName.replace('.cs', '');
          const ghTestUrl = `${repoUrl}${testFile}`;
          markdown.appendMarkdown(`- [\`${className}.${testMethod}()\`](${ghTestUrl})\n`);
        } else {
          markdown.appendMarkdown(`- \`${testRef}\`\n`);
        }
      }
    }

    return new vscode.Hover(markdown);
  }

  private provideDocIndexHover(word: string): vscode.Hover | undefined {
    if (!this.typeDocIndex) {
      return undefined;
    }

    if (!this.typeDocIndex.has(word)) {
      return undefined;
    }

    const docUrl = this.typeDocIndex.getDocUrl(word);
    const sourceFile = this.typeDocIndex.getSourceFile(word);
    const sourceLine = this.typeDocIndex.getSourceLine(word);

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    markdown.appendMarkdown(`### Whizbang: ${word}\n\n`);

    markdown.appendMarkdown(`---\n\n`);

    // Documentation link
    if (docUrl) {
      markdown.appendMarkdown(`#### 📚 Documentation\n\n`);
      markdown.appendMarkdown(`[View Documentation](${docUrl})\n\n`);
    }

    // Source file location — linked to GitHub
    if (sourceFile) {
      markdown.appendMarkdown(`#### 📁 Source\n\n`);
      const repoUrl = vscode.workspace.getConfiguration('whizbang').get<string>(
        'libraryRepoUrl', 'https://github.com/whizbang-lib/whizbang/blob/develop/');
      const line = sourceLine || 1;
      const ghUrl = `${repoUrl}${sourceFile}#L${line}`;
      markdown.appendMarkdown(`[\`${sourceFile}:${line}\`](${ghUrl})\n`);
    }

    return new vscode.Hover(markdown);
  }

  /**
   * Uses the C# definition provider to resolve the fully qualified type at
   * the cursor, then looks up docs/tests from NuGet XML.
   * Uses executeDefinitionProvider (not executeHoverProvider — that would
   * cause infinite recursion since WE are a hover provider).
   */
  private async resolveAndProvideXmlDocHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    word: string,
  ): Promise<vscode.Hover | undefined> {
    try {
      // Use Go to Definition to find where this symbol is defined
      const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider', document.uri, position
      );

      if (!definitions || definitions.length === 0) {
        this.output.log(`HoverProvider: No definitions found for '${word}'`);
        return undefined;
      }

      // Check all definitions for a Whizbang match
      const def = definitions[0];
      const defUri = 'targetUri' in def ? def.targetUri : def.uri;
      const defPath = defUri.fsPath || defUri.toString();

      this.output.log(`HoverProvider: Definition for '${word}' → ${defPath}`);

      // Extract parent type from the definition file name
      const fileName = defPath.split('/').pop()?.split('\\').pop() || '';
      const parentType = fileName.endsWith('.cs') ? fileName.replace('.cs', '') : '';

      if (!parentType) {
        this.output.log(`HoverProvider: Could not extract parent type from '${fileName}'`);
        return undefined;
      }

      // Check if this parent type exists in our XML data (confirms it's a Whizbang type)
      const hasParent = this.xmlDocProvider!.has(parentType) ||
        this.xmlDocProvider!.getByQualifiedName(parentType, word).length > 0;

      if (!hasParent) {
        this.output.log(`HoverProvider: '${parentType}' not found in XML data (not a Whizbang type)`);
        return undefined;
      }

      this.output.log(`HoverProvider: Found parent '${parentType}' in XML, looking up '${parentType}.${word}'`);

      // Look up in XML: try qualified (parentType.word) then simple name
      let members = this.xmlDocProvider!.getByQualifiedName(parentType, word);
      if (members.length === 0) {
        members = this.xmlDocProvider!.getByName(word);
        // Filter to members whose parent type matches the definition file
        if (parentType && members.length > 1) {
          const filtered = members.filter(m => m.parentType === parentType);
          if (filtered.length > 0) {
            members = filtered;
          }
        }
      }

      if (members.length === 0) {
        return undefined;
      }

      return this.buildXmlDocHover(members, `${parentType}.${word}`);
    } catch {
      return undefined;
    }
  }

  /**
   * Build a rich hover tooltip from resolved XML member info.
   */
  private buildXmlDocHover(members: import('./xmlDocProvider').XmlMemberInfo[], displayName: string): vscode.Hover {
    const repoUrl = vscode.workspace.getConfiguration('whizbang').get<string>(
      'libraryRepoUrl', 'https://github.com/whizbang-lib/whizbang/blob/develop/');
    const docsBaseUrl = vscode.workspace.getConfiguration('whizbang').get<string>(
      'docsBaseUrl', 'https://whizbang-lib.github.io');

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    const primary = members[0];

    markdown.appendMarkdown(`### Whizbang: ${displayName}\n\n`);

    if (primary.summary) {
      markdown.appendMarkdown(`${primary.summary}\n\n`);
    }

    if (members.length > 1) {
      markdown.appendMarkdown(`*${members.length} overloads*\n\n`);
    }

    markdown.appendMarkdown(`---\n\n`);

    // Documentation links (deduplicated across overloads)
    const allDocs = new Set<string>();
    for (const m of members) {
      for (const doc of m.docs) { allDocs.add(doc); }
    }

    if (allDocs.size > 0) {
      markdown.appendMarkdown(`#### 📚 Documentation\n\n`);
      for (const doc of allDocs) {
        const url = `${docsBaseUrl}/docs/v1.0.0/${doc}`;
        const displayLabel = doc.split('/').pop()?.replace(/-/g, ' ') || doc;
        markdown.appendMarkdown(`[${displayLabel}](${url})\n\n`);
      }
    }

    // Tests (deduplicated across overloads)
    const allTests = new Set<string>();
    for (const m of members) {
      for (const t of m.tests) { allTests.add(t); }
    }

    if (allTests.size > 0) {
      markdown.appendMarkdown(`#### 🧪 Tests (${allTests.size})\n\n`);
      for (const testRef of allTests) {
        const colonIdx = testRef.lastIndexOf(':');
        if (colonIdx > 0) {
          const testFile = testRef.substring(0, colonIdx);
          const testMethod = testRef.substring(colonIdx + 1);
          const fileName = testFile.split('/').pop() || testFile;
          const className = fileName.replace('.cs', '');
          const ghTestUrl = `${repoUrl}${testFile}`;
          markdown.appendMarkdown(`- [\`${className}.${testMethod}()\`](${ghTestUrl})\n`);
        } else {
          markdown.appendMarkdown(`- \`${testRef}\`\n`);
        }
      }
    }

    return new vscode.Hover(markdown);
  }

  private createNavigationLink(location: CodeLocation): string {
    const args = encodeURIComponent(
      JSON.stringify({
        filePath: location.filePath,
        lineNumber: location.lineNumber,
      })
    );
    return `[(go to source)](command:whizbang.navigateToLocation?${args})`;
  }

  private createTestNavigationLink(test: TestInfo): string {
    const args = encodeURIComponent(
      JSON.stringify({
        filePath: test.testFile,
        lineNumber: test.testLine,
      })
    );
    return `[(go to test)](command:whizbang.navigateToLocation?${args})`;
  }

  private getRelativePath(filePath: string): string {
    // Try to get workspace-relative path
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const relativePath = filePath.replace(workspaceFolder.uri.fsPath, '');
      if (relativePath !== filePath) {
        return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
      }
    }

    // Fallback to just the filename if we can't get a relative path
    const parts = filePath.split('/');
    return parts[parts.length - 1] || filePath;
  }
}
