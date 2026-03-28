import * as vscode from 'vscode';
import { MessageInfo } from '../types';

/**
 * Generates a Mermaid flowchart string from a MessageInfo object.
 * Shows: Dispatchers -> Message -> Receptors/Perspectives
 */
function generateMermaid(message: MessageInfo): string {
  const lines: string[] = ['graph LR'];

  // Extract short type name from fully-qualified name
  const shortName = message.type.includes('.')
    ? message.type.split('.').pop()!
    : message.type;

  // Dispatchers subgraph
  if (message.dispatchers.length > 0) {
    lines.push('  subgraph Dispatchers');
    for (let i = 0; i < message.dispatchers.length; i++) {
      const d = message.dispatchers[i];
      lines.push(`    D${i}[${d.class}.${d.method}]`);
    }
    lines.push('  end');
  }

  // Message node
  lines.push(`  MSG((${shortName}))`);

  // Dispatcher -> Message edges
  for (let i = 0; i < message.dispatchers.length; i++) {
    lines.push(`  D${i} --> MSG`);
  }

  // Receptor edges
  for (let i = 0; i < message.receptors.length; i++) {
    const r = message.receptors[i];
    lines.push(`  MSG --> R${i}[${r.class}.${r.method}]`);
  }

  // Perspective edges
  for (let i = 0; i < message.perspectives.length; i++) {
    const p = message.perspectives[i];
    lines.push(`  MSG --> P${i}[${p.class}]`);
  }

  return lines.join('\n');
}

/**
 * Creates and shows a WebviewPanel rendering a Mermaid flow diagram
 * for the given message.
 */
export function showFlowDiagramPanel(
  context: vscode.ExtensionContext,
  message: MessageInfo,
): void {
  const shortName = message.type.includes('.')
    ? message.type.split('.').pop()!
    : message.type;

  const panel = vscode.window.createWebviewPanel(
    'whizbangFlowDiagram',
    `Flow: ${shortName}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
    },
  );

  const mermaidCode = generateMermaid(message);
  const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
    || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

  panel.webview.html = getWebviewHtml(mermaidCode, isDark);

  // Update theme if user changes it while panel is open
  const themeListener = vscode.window.onDidChangeActiveColorTheme((theme) => {
    const nowDark = theme.kind === vscode.ColorThemeKind.Dark
      || theme.kind === vscode.ColorThemeKind.HighContrast;
    panel.webview.html = getWebviewHtml(mermaidCode, nowDark);
  });

  panel.onDidDispose(() => {
    themeListener.dispose();
  });

  context.subscriptions.push(panel);
}

function getWebviewHtml(mermaidCode: string, isDark: boolean): string {
  const theme = isDark ? 'dark' : 'default';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      justify-content: center;
      padding: 20px;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="mermaid">
${mermaidCode}
  </div>
  <script>mermaid.initialize({ theme: '${theme}', startOnLoad: true });</script>
</body>
</html>`;
}
