import * as vscode from 'vscode';
import { RegistryLoader } from './registryLoader';
import { CodeLocation, TestInfo } from './types';

export class MessageHoverProvider implements vscode.HoverProvider {
  constructor(private registryLoader: RegistryLoader) {}

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const message = this.registryLoader.findMessage(word);

    if (!message) {
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
